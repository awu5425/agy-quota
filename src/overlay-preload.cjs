'use strict';

/**
 * AGY Quota Top-Right & Companion Preload Bridge (overlay-preload.cjs — v1.3.1)
 *
 * Runs inside Electron's Preload context (CommonJS) with strict fail-open
 * protection so any unexpected runtime error never blocks the host window.
 *
 * Responsibilities:
 * 1. Expose `window.agyQuotaOverlay` ({
 *      version, getVersion, getQuota, onQuotaUpdated,
 *      checkUpdate, applyUpdate, getUpdatePrefs, setUpdatePrefs
 *    }) across Electron contextBridge.
 * 2. Deduplicate Language Server polling when Antigravity Context Meter is
 *    installed by intercepting `ipcRenderer.invoke('context-meter:get-quota', opts)`,
 *    performing a single `quota-core.cjs` fetch, broadcasting the full snapshot
 *    to overlay UI subscribers, and forwarding `{ userStatus, quotaSummary }`
 *    into the host collector's static pass-through branch.
 * 3. Inject `./meter-overlay-ui.js` into the Main World on DOMContentLoaded
 *    (which auto-mounts in Companion mode if `#ag-context-meter` is present,
 *    or Standalone top-right HUD mode when `antigravity-context-viewer` is absent).
 */
(function initAgyQuotaOverlayPreload() {
  try {
    if (globalThis.__AGY_QUOTA_OVERLAY_PRELOAD__) {
      return;
    }
    globalThis.__AGY_QUOTA_OVERLAY_PRELOAD__ = true;

    const fs = require('node:fs');
    const path = require('node:path');
    const electron = require('electron');
    if (!electron || typeof electron !== 'object') {
      return;
    }

    const { contextBridge, ipcRenderer, webFrame } = electron;
    const DEFAULT_OVERLAY_VERSION = '1.3.1';
    const DEFAULT_UPDATE_PREFS = Object.freeze({
      autoUpdate: true,
      lastCheckedAt: 0,
      skippedVersion: '',
      channel: 'stable',
    });

    const subscribers = new Set();
    let cachedQuotaCore = null;
    let cachedCsrfToken = '';

    function getQuotaCorePath() {
      return path.join(__dirname, 'quota-core.cjs');
    }

    function getQuotaCore() {
      if (cachedQuotaCore) {
        return cachedQuotaCore;
      }
      try {
        cachedQuotaCore = require(getQuotaCorePath());
      } catch {
        cachedQuotaCore = null;
      }
      return cachedQuotaCore;
    }

    function reloadQuotaCoreSafe() {
      try {
        const resolved = require.resolve(getQuotaCorePath());
        if (resolved && require.cache && require.cache[resolved]) {
          delete require.cache[resolved];
        }
      } catch {
        // ignore cache clear errors
      }
      cachedQuotaCore = null;
      return getQuotaCore();
    }

    function normalizeSemver(raw) {
      if (typeof raw !== 'string') {
        return '';
      }
      const cleaned = raw.trim().replace(/^v/i, '');
      return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(cleaned) ? cleaned : '';
    }

    function compareSemver(a, b) {
      const pa = normalizeSemver(a).split(/[-+]/)[0].split('.').map((n) => Number(n) || 0);
      const pb = normalizeSemver(b).split(/[-+]/)[0].split('.').map((n) => Number(n) || 0);
      for (let i = 0; i < 3; i += 1) {
        if ((pa[i] || 0) !== (pb[i] || 0)) {
          return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
        }
      }
      return 0;
    }

    function resolveRuntimeVersion() {
      let best = '';

      // 1. Priority check: installed-version.json written by installer or self-updater
      try {
        const installedMetaPath = path.join(__dirname, 'installed-version.json');
        if (fs.existsSync(installedMetaPath)) {
          const meta = JSON.parse(fs.readFileSync(installedMetaPath, 'utf8'));
          const candidate = normalizeSemver(
            meta && (meta.version || meta.updatedVersion || meta.installedVersion),
          );
          if (candidate) {
            best = candidate;
          }
        }
      } catch {
        // ignore malformed installed-version.json
      }

      // 2. Check version exported by quota-core.cjs
      try {
        const quotaCore = getQuotaCore();
        if (quotaCore) {
          const rawCoreVer =
            typeof quotaCore.resolveCurrentVersion === 'function'
              ? quotaCore.resolveCurrentVersion({ dir: __dirname })
              : typeof quotaCore.getCurrentVersion === 'function'
                ? quotaCore.getCurrentVersion()
                : quotaCore.VERSION ||
                  quotaCore.QUOTA_CORE_VERSION ||
                  quotaCore.PACKAGE_VERSION ||
                  quotaCore.CURRENT_VERSION ||
                  quotaCore.version ||
                  '';
          const coreVer = normalizeSemver(rawCoreVer);
          if (coreVer && (!best || compareSemver(coreVer, best) > 0)) {
            best = coreVer;
          }
        }
      } catch {
        // ignore
      }

      // 3. Check sibling ../package.json when running from repository checkout
      if (!best) {
        try {
          const pkgPath = path.join(__dirname, '..', 'package.json');
          if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            const pkgVer = normalizeSemver(pkg && pkg.version);
            if (pkgVer) {
              best = pkgVer;
            }
          }
        } catch {
          // ignore
        }
      }

      if (best && compareSemver(best, DEFAULT_OVERLAY_VERSION) >= 0) {
        return best;
      }
      return best || DEFAULT_OVERLAY_VERSION;
    }

    function getSafeOrigin() {
      try {
        if (typeof location !== 'undefined' && location && typeof location.origin === 'string') {
          if (/^https?:\/\//i.test(location.origin)) {
            return location.origin;
          }
        }
      } catch {
        // ignore
      }
      return '';
    }

    async function resolveMainWorldCsrfToken() {
      if (cachedCsrfToken) {
        return cachedCsrfToken;
      }
      if (!webFrame || typeof webFrame.executeJavaScript !== 'function') {
        return '';
      }
      try {
        const probe = webFrame.executeJavaScript(
          '(function(){try{return (globalThis.__APP_CONFIG__&&globalThis.__APP_CONFIG__.csrfToken)||"";}catch(_){return "";}})()',
        );
        const timeout = new Promise((resolve) => setTimeout(() => resolve(''), 800));
        const token = await Promise.race([probe, timeout]);
        if (typeof token === 'string' && token.trim()) {
          cachedCsrfToken = token.trim();
        }
      } catch {
        // fail-open
      }
      return cachedCsrfToken;
    }

    function toPlainCloneable(value) {
      try {
        return JSON.parse(JSON.stringify(value));
      } catch {
        return null;
      }
    }

    function notifySubscribers(payload) {
      if (!payload || subscribers.size === 0) {
        return;
      }
      const safePayload = toPlainCloneable(payload);
      if (!safePayload) {
        return;
      }
      for (const fn of Array.from(subscribers)) {
        try {
          fn(safePayload);
        } catch {
          // isolate subscriber errors
        }
      }
    }

    function normalizeQuotaOptions(opts) {
      if (typeof opts === 'boolean') {
        return { force: opts };
      }
      if (opts && typeof opts === 'object') {
        return { ...opts };
      }
      return {};
    }

    async function fetchUnifiedBundle(opts) {
      const baseOpts = normalizeQuotaOptions(opts);
      const quotaCore = getQuotaCore();
      if (!quotaCore || typeof quotaCore.fetchQuotaBundle !== 'function') {
        return null;
      }
      const origin = baseOpts.origin || getSafeOrigin();
      const csrfToken = baseOpts.csrfToken || (await resolveMainWorldCsrfToken()) || undefined;
      const bundle = await quotaCore.fetchQuotaBundle({
        force: Boolean(baseOpts.force),
        origin: origin || undefined,
        csrfToken,
        oauthOnly: Boolean(baseOpts.oauthOnly),
        profileDir: typeof baseOpts.profileDir === 'string' ? baseOpts.profileDir : undefined,
      });
      if (bundle && bundle.ok && bundle.snapshot) {
        notifySubscribers({
          ok: true,
          timestamp: bundle.timestamp || Date.now(),
          connection: bundle.connection || null,
          snapshot: bundle.snapshot,
        });
      }
      return bundle;
    }

    const overlayApi = {
      version: resolveRuntimeVersion(),
      getVersion() {
        try {
          return resolveRuntimeVersion();
        } catch {
          return DEFAULT_OVERLAY_VERSION;
        }
      },
      async getQuota(opts) {
        try {
          const bundle = await fetchUnifiedBundle(opts);
          if (!bundle) {
            return {
              ok: false,
              timestamp: Date.now(),
              connection: null,
              snapshot: null,
              error: 'quota-core unavailable',
            };
          }
          return (
            toPlainCloneable({
              ok: Boolean(bundle.ok),
              timestamp: bundle.timestamp || Date.now(),
              connection: bundle.connection || null,
              snapshot: bundle.snapshot || null,
              error: bundle.error ? String(bundle.error) : null,
            }) || {
              ok: false,
              timestamp: Date.now(),
              connection: null,
              snapshot: null,
              error: 'serialization error',
            }
          );
        } catch (err) {
          return {
            ok: false,
            timestamp: Date.now(),
            connection: null,
            snapshot: null,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      },
      onQuotaUpdated(callback) {
        if (typeof callback !== 'function') {
          return () => {};
        }
        subscribers.add(callback);
        return () => {
          subscribers.delete(callback);
        };
      },
      async checkUpdate(opts) {
        const currentVersion = resolveRuntimeVersion();
        try {
          const quotaCore = getQuotaCore();
          const fn = quotaCore && (quotaCore.checkSelfUpdate || quotaCore.checkUpdate);
          if (typeof fn !== 'function') {
            return {
              ok: false,
              currentVersion,
              latestVersion: null,
              hasUpdate: false,
              checkedAt: Date.now(),
              error: 'update engine unavailable',
            };
          }
          const safeOpts = {
            force: Boolean(opts && typeof opts === 'object' ? opts.force : opts),
            currentVersion:
              opts && typeof opts === 'object' && typeof opts.currentVersion === 'string' && opts.currentVersion.trim()
                ? opts.currentVersion.trim()
                : currentVersion,
          };
          const result = await fn(safeOpts);
          return (
            toPlainCloneable(result) || {
              ok: false,
              currentVersion,
              latestVersion: null,
              hasUpdate: false,
              checkedAt: Date.now(),
              error: 'serialization error',
            }
          );
        } catch (err) {
          return {
            ok: false,
            currentVersion,
            latestVersion: null,
            hasUpdate: false,
            checkedAt: Date.now(),
            error: err instanceof Error ? err.message : String(err),
          };
        }
      },
      async applyUpdate(opts) {
        try {
          const quotaCore = getQuotaCore();
          const fn = quotaCore && (quotaCore.applySelfUpdate || quotaCore.applyUpdate);
          if (typeof fn !== 'function') {
            return {
              ok: false,
              updatedVersion: null,
              updatedTargets: [],
              overlayUiCode: null,
              error: 'update engine unavailable',
            };
          }
          const safeOpts = {
            dryRun: Boolean(opts && typeof opts === 'object' && opts.dryRun),
          };
          const result = await fn(safeOpts);
          if (result && result.ok && !safeOpts.dryRun) {
            reloadQuotaCoreSafe();
          }
          return (
            toPlainCloneable(result) || {
              ok: false,
              updatedVersion: null,
              updatedTargets: [],
              overlayUiCode: null,
              error: 'serialization error',
            }
          );
        } catch (err) {
          return {
            ok: false,
            updatedVersion: null,
            updatedTargets: [],
            overlayUiCode: null,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      },
      getUpdatePrefs() {
        try {
          const quotaCore = getQuotaCore();
          if (!quotaCore || typeof quotaCore.getUpdatePrefs !== 'function') {
            return { ...DEFAULT_UPDATE_PREFS };
          }
          const res = quotaCore.getUpdatePrefs();
          if (res && typeof res.then === 'function') {
            return res
              .then((val) => toPlainCloneable(val) || { ...DEFAULT_UPDATE_PREFS })
              .catch(() => ({ ...DEFAULT_UPDATE_PREFS }));
          }
          return toPlainCloneable(res) || { ...DEFAULT_UPDATE_PREFS };
        } catch {
          return { ...DEFAULT_UPDATE_PREFS };
        }
      },
      setUpdatePrefs(patch) {
        try {
          const safePatch = patch && typeof patch === 'object' ? toPlainCloneable(patch) || {} : {};
          const quotaCore = getQuotaCore();
          if (!quotaCore || typeof quotaCore.setUpdatePrefs !== 'function') {
            return {
              ...DEFAULT_UPDATE_PREFS,
              ...(typeof safePatch.autoUpdate === 'boolean' ? { autoUpdate: safePatch.autoUpdate } : {}),
            };
          }
          const res = quotaCore.setUpdatePrefs(safePatch);
          if (res && typeof res.then === 'function') {
            return res
              .then((val) => toPlainCloneable(val) || { ...DEFAULT_UPDATE_PREFS })
              .catch(() => ({ ...DEFAULT_UPDATE_PREFS }));
          }
          return toPlainCloneable(res) || { ...DEFAULT_UPDATE_PREFS };
        } catch {
          return { ...DEFAULT_UPDATE_PREFS };
        }
      },
      getUpdateStatus() {
        const currentVersion = resolveRuntimeVersion();
        try {
          const quotaCore = getQuotaCore();
          if (quotaCore && typeof quotaCore.getUpdateStatus === 'function') {
            const res = quotaCore.getUpdateStatus({ currentVersion });
            if (res && typeof res.then === 'function') {
              return res
                .then((val) => toPlainCloneable(val) || { ok: true, currentVersion, prefs: { ...DEFAULT_UPDATE_PREFS } })
                .catch(() => ({ ok: true, currentVersion, prefs: { ...DEFAULT_UPDATE_PREFS } }));
            }
            return toPlainCloneable(res) || { ok: true, currentVersion, prefs: { ...DEFAULT_UPDATE_PREFS } };
          }
          return { ok: true, currentVersion, prefs: { ...DEFAULT_UPDATE_PREFS } };
        } catch {
          return { ok: true, currentVersion, prefs: { ...DEFAULT_UPDATE_PREFS } };
        }
      },
    };

    try {
      if (contextBridge && typeof contextBridge.exposeInMainWorld === 'function') {
        contextBridge.exposeInMainWorld('agyQuotaOverlay', overlayApi);
      } else {
        globalThis.agyQuotaOverlay = overlayApi;
      }
    } catch {
      try {
        globalThis.agyQuotaOverlay = overlayApi;
      } catch {
        // ignore if contextBridge already registered
      }
    }

    // Wrap ipcRenderer.invoke to merge 'context-meter:get-quota' into a single RPC fetch
    if (ipcRenderer && typeof ipcRenderer.invoke === 'function' && !ipcRenderer.__agyQuotaWrapped) {
      const origInvoke = ipcRenderer.invoke.bind(ipcRenderer);
      const wrappedInvoke = async function agyQuotaWrappedInvoke(channel, opts, ...rest) {
        if (channel === 'context-meter:get-quota') {
          const baseOpts = normalizeQuotaOptions(opts);
          if (baseOpts.userStatus !== undefined || baseOpts.quotaSummary !== undefined) {
            return origInvoke(channel, opts, ...rest);
          }
          try {
            const bundle = await fetchUnifiedBundle(baseOpts);
            const raw = bundle && bundle.raw ? bundle.raw : null;
            if (bundle && bundle.ok && raw && (raw.userStatusRes || raw.quotaSummaryRes)) {
              const passthroughOpts = {
                ...baseOpts,
                origin: baseOpts.origin || getSafeOrigin() || undefined,
                userStatus: raw.userStatusRes ?? null,
                quotaSummary: raw.quotaSummaryRes ?? null,
              };
              return await origInvoke('context-meter:get-quota', passthroughOpts, ...rest);
            }
          } catch {
            // Fail-open: fall back to default host invoke
          }
        }
        return origInvoke(channel, opts, ...rest);
      };

      try {
        Object.defineProperty(wrappedInvoke, '__agyQuotaWrapped', { value: true });
      } catch {
        // ignore
      }

      try {
        ipcRenderer.invoke = wrappedInvoke;
      } catch {
        // fallback to defineProperty
      }
      if (ipcRenderer.invoke !== wrappedInvoke) {
        try {
          Object.defineProperty(ipcRenderer, 'invoke', {
            value: wrappedInvoke,
            configurable: true,
            writable: true,
          });
        } catch {
          // fail-open
        }
      }
      try {
        Object.defineProperty(ipcRenderer, '__agyQuotaWrapped', { value: true, configurable: true });
      } catch {
        // ignore
      }
    }

    // Inject UI script into Main World once DOM is ready (auto-detects Companion vs Standalone top-right HUD)
    let uiInjected = false;
    function injectOverlayUi() {
      if (uiInjected) {
        return;
      }
      try {
        if (typeof window !== 'undefined' && window.top && window !== window.top) {
          return;
        }
        if (typeof location !== 'undefined' && location && typeof location.protocol === 'string') {
          const proto = location.protocol;
          if (proto && !/^https?:$/i.test(proto) && proto !== 'file:') {
            return;
          }
        }
        const uiPath = path.join(__dirname, 'meter-overlay-ui.js');
        if (!fs.existsSync(uiPath)) {
          return;
        }
        const uiSource = fs.readFileSync(uiPath, 'utf8');
        if (!uiSource || !uiSource.trim()) {
          return;
        }
        if (webFrame && typeof webFrame.executeJavaScript === 'function') {
          uiInjected = true;
          const bootstrap = `globalThis.__AGY_CTX_CAPSULE_ACTIVE__ = true;\n${uiSource}`;
          Promise.resolve(webFrame.executeJavaScript(bootstrap)).catch(() => {});
        }
      } catch {
        // fail-open
      }
    }

    if (
      typeof document !== 'undefined' &&
      document &&
      (document.readyState === 'interactive' || document.readyState === 'complete')
    ) {
      injectOverlayUi();
    } else if (typeof window !== 'undefined' && window && typeof window.addEventListener === 'function') {
      window.addEventListener('DOMContentLoaded', injectOverlayUi, { once: true });
    }
  } catch {
    // Top-level fail-open guard: never disrupt host BrowserWindow startup
  }
})();
