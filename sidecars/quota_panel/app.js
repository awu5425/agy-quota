(() => {
  'use strict';

  const APP_VERSION = '1.3.1';
  const DEFAULT_GITHUB_REPO = 'awu5425/agy-quota';
  const POLL_MS = 60_000;
  const COUNTDOWN_TICK_MS = 30_000;
  const CHART_BUCKETS = 18;
  const BUCKET_MINUTES = 5;
  const TREND_GRANULARITY_KEY = 'agy_quota_trend_granularity';

  const FIXED_POOLS = [
    { id: 'gemini', label: 'Gemini', shortLabel: 'Gemini', themeColor: '#40C4FF' },
    { id: 'argon', label: 'Argon', shortLabel: 'Argon', themeColor: '#B388FF' },
    { id: 'non-google', label: 'Claude / GPT', shortLabel: 'Claude', themeColor: '#FFAB40' },
  ];

  const KNOWN_MODEL_POOL = {
    MODEL_PLACEHOLDER_M417: 'argon',
    MODEL_PLACEHOLDER_M418: 'argon',
    MODEL_PLACEHOLDER_M419: 'argon',
    MODEL_PLACEHOLDER_M668: 'argon',
    MODEL_PLACEHOLDER_M427: 'gemini',
    MODEL_PLACEHOLDER_M318: 'gemini',
    MODEL_PLACEHOLDER_M319: 'gemini',
    MODEL_PLACEHOLDER_M320: 'gemini',
    MODEL_PLACEHOLDER_M47: 'gemini',
    MODEL_PLACEHOLDER_M525: 'gemini',
    MODEL_PLACEHOLDER_M526: 'gemini',
    MODEL_PLACEHOLDER_M527: 'gemini',
    MODEL_PLACEHOLDER_M528: 'gemini',
    MODEL_PLACEHOLDER_M36: 'gemini',
    MODEL_PLACEHOLDER_M37: 'gemini',
    MODEL_PLACEHOLDER_M400: 'non-google',
    MODEL_PLACEHOLDER_M401: 'non-google',
    MODEL_PLACEHOLDER_M402: 'non-google',
    MODEL_PLACEHOLDER_M403: 'non-google',
    MODEL_PLACEHOLDER_M404: 'non-google',
    MODEL_PLACEHOLDER_M405: 'non-google',
    MODEL_PLACEHOLDER_M26: 'non-google',
    MODEL_PLACEHOLDER_M35: 'non-google',
    MODEL_OPENAI_GPT_OSS_120B_MEDIUM: 'non-google',
  };

  const EFFORT_SUFFIX_RE = /\s*\((?:low|medium|med|high|xhigh|x-high|extra\s+high|minimal|min|thinking|non-thinking|standard|max)\)\s*$/i;

  const I18N = {
    zh: {
      title: 'AGY 账号额度',
      arc: '半弧',
      ring: '圆环',
      current: '当前',
      refresh: '刷新额度',
      loading: '正在读取 Antigravity 账号额度...',
      errorTitle: '读取失败',
      retry: '重试',
      weekly: '周额度',
      trendTitle: '近期消耗趋势',
      trendEmpty: '监控中 · 产生消耗后显示柱状波动',
      byModel: '按模型',
      byPool: '按池',
      callsUnit: '次调用',
      noRecentModelUsage: '近 90 分钟暂无模型消耗 · 额度平稳',
      trendGranularityTip: '切换按具体模型或按配额池查看消耗趋势',
      creditsTitle: '订阅积分 (Credits)',
      promptCredits: 'Prompt 积分',
      flowCredits: 'Flow 积分',
      includedPlan: '按套餐池计费',
      standardRule: '订阅规则生效',
      ready: '已就绪',
      stable: '平稳',
      rateUnit: 'pp/h',
      runwayPrefix: '预计可用',
      collapse: '收起',
      expand: '展开',
      emailTip: '点击隐藏/显示邮箱',
      minUsage: '单次最低扣减',
      resetAt: '重置',
      windowLabel: '近 {n} 分钟消耗 (pp)',
      updatedTip: '最近刷新时间',
      themeAuto: '跟随',
      themeDark: '暗',
      themeLight: '亮',
      themeGroupTip: '主题模式：跟随系统与宿主 / 深色 / 浅色',
      langGroupTip: '切换中英文界面语言',
      upToDate: '已是最新',
      checkUpdate: '检查更新',
      checkingUpdate: '检查中...',
      updateFound: '发现 v{v}',
      updateNow: '立即更新',
      updating: '更新中...',
      updatedOk: '已更新 v{v}',
      updateFailed: '检查失败',
      autoUpdate: '自动更新',
      autoUpdateTip: '检测到新版本时自动热更新',
    },
    en: {
      title: 'AGY Quota',
      arc: 'Arc',
      ring: 'Ring',
      current: 'Active',
      refresh: 'Refresh quota',
      loading: 'Fetching Antigravity quota...',
      errorTitle: 'Connection failed',
      retry: 'Retry',
      weekly: 'Weekly',
      trendTitle: 'Usage Trend',
      trendEmpty: 'Monitoring · bars appear once quota drops',
      byModel: 'Models',
      byPool: 'Pools',
      callsUnit: 'calls',
      noRecentModelUsage: 'No model usage in last 90m · Quota stable',
      trendGranularityTip: 'Switch trend view between per-model and per-pool',
      creditsTitle: 'Credits',
      promptCredits: 'Prompt Credits',
      flowCredits: 'Flow Credits',
      includedPlan: 'Included in plan',
      standardRule: 'Active plan rules',
      ready: 'Ready',
      stable: 'Stable',
      rateUnit: 'pp/h',
      runwayPrefix: 'Runway',
      collapse: 'Hide',
      expand: 'Show',
      emailTip: 'Click to toggle email privacy',
      minUsage: 'Min usage',
      resetAt: 'Resets',
      windowLabel: 'Last {n}m drop (pp)',
      updatedTip: 'Last updated',
      themeAuto: 'Auto',
      themeDark: 'Dark',
      themeLight: 'Light',
      themeGroupTip: 'Theme: Follow host & OS / Dark / Light',
      langGroupTip: 'Switch UI language (中文 / English)',
      upToDate: 'Up to date',
      checkUpdate: 'Check update',
      checkingUpdate: 'Checking...',
      updateFound: 'v{v} available',
      updateNow: 'Update now',
      updating: 'Updating...',
      updatedOk: 'Updated v{v}',
      updateFailed: 'Check failed',
      autoUpdate: 'Auto-update',
      autoUpdateTip: 'Automatically apply updates when available',
    },
  };

  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const readPref = (key, fallback) => {
    try {
      const val = localStorage.getItem(key);
      return val !== null ? val : fallback;
    } catch {
      return fallback;
    }
  };
  const writePref = (key, val) => {
    try {
      localStorage.setItem(key, String(val));
    } catch {
      // Ignore storage errors inside restricted frames
    }
  };
  const removePref = (key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      // Ignore storage errors
    }
  };

  const normalizeLangCode = (raw) => {
    const s = String(raw || '').trim().toLowerCase();
    if (s.startsWith('en')) return 'en';
    if (s.startsWith('zh')) return 'zh';
    return '';
  };

  const normalizeThemeMode = (raw) => {
    const s = String(raw || '').trim().toLowerCase();
    if (s === 'dark' || s === 'light') return s;
    return 'auto';
  };

  function detectDefaultLang() {
    const saved = normalizeLangCode(readPref('agy_quota_lang', ''));
    if (saved) return saved;
    const nav = normalizeLangCode(typeof navigator !== 'undefined' ? navigator.language : '');
    if (nav) return nav;
    const docLang = normalizeLangCode(document.documentElement?.lang || '');
    if (docLang) return docLang;
    return 'zh';
  }

  const state = {
    lang: detectDefaultLang(),
    themeMode: normalizeThemeMode(readPref('agy_quota_theme', 'auto')),
    resolvedTheme: 'dark',
    gaugeStyle: readPref('agy_quota_gauge', 'semi-arc') === 'classic-donut' ? 'classic-donut' : 'semi-arc',
    trendGranularity: readPref(TREND_GRANULARITY_KEY, 'model') === 'pool' ? 'pool' : 'model',
    emailMasked: readPref('agy_quota_mask_email', '0') === '1',
    collapsed: {
      trend: readPref('agy_quota_col_trend', '0') === '1',
      credits: readPref('agy_quota_col_credits', '0') === '1',
    },
    data: null,
    activeModelOverride: null,
    snapshotOverrideLocked: false,
    loading: false,
    error: '',
    update: {
      currentVersion: APP_VERSION,
      latestVersion: '',
      hasUpdate: false,
      checking: false,
      applying: false,
      autoUpdate: readPref('agy_quota_auto_update', '1') !== '0',
      checkedAt: 0,
      releaseUrl: `https://github.com/${DEFAULT_GITHUB_REPO}/releases`,
      error: '',
      justUpdatedTo: '',
      autoAttemptedVersion: '',
    },
  };

  const t = (key) => I18N[state.lang]?.[key] ?? I18N.zh[key] ?? key;

  function getApiFetch() {
    return window.sidecar?.fetch ? window.sidecar.fetch.bind(window.sidecar) : fetch;
  }

  function buildJsonHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    const token = globalThis.__AGY_QUOTA_CSRF_TOKEN__;
    if (typeof token === 'string' && token.trim()) {
      headers['X-AGY-Quota-Token'] = token.trim();
    }
    return headers;
  }

  // -------------------------------------------------------------------------
  // Semver Helper
  // -------------------------------------------------------------------------
  function parseSemver(v) {
    const clean = String(v || '').trim().replace(/^v/i, '').split('+')[0];
    const [core, pre = ''] = clean.split('-', 2);
    const parts = core.split('.').map((n) => Number.parseInt(n, 10));
    if (parts.length < 3 || parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
    return { major: parts[0], minor: parts[1], patch: parts[2], pre };
  }

  function compareSemver(a, b) {
    const pa = parseSemver(a);
    const pb = parseSemver(b);
    if (!pa || !pb) return 0;
    if (pa.major !== pb.major) return pa.major > pb.major ? 1 : -1;
    if (pa.minor !== pb.minor) return pa.minor > pb.minor ? 1 : -1;
    if (pa.patch !== pb.patch) return pa.patch > pb.patch ? 1 : -1;
    if (!pa.pre && pb.pre) return 1;
    if (pa.pre && !pb.pre) return -1;
    return pa.pre.localeCompare(pb.pre);
  }

  // -------------------------------------------------------------------------
  // Theme Sync (Auto-Follow Host / Sidecar CSS Vars / OS Color Scheme + Manual)
  // -------------------------------------------------------------------------
  function parseColorLuminance(cssColor) {
    if (!cssColor || typeof cssColor !== 'string') return null;
    const s = cssColor.trim();
    if (!s || s === 'transparent' || s === 'inherit' || s === 'initial') return null;

    if (s.startsWith('#')) {
      const hex = s.slice(1);
      if (hex.length === 3 || hex.length === 4) {
        const alpha = hex.length === 4 ? Number.parseInt(hex[3] + hex[3], 16) / 255 : 1;
        if (alpha < 0.08) return null;
        const r = Number.parseInt(hex[0] + hex[0], 16) / 255;
        const g = Number.parseInt(hex[1] + hex[1], 16) / 255;
        const b = Number.parseInt(hex[2] + hex[2], 16) / 255;
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      }
      if (hex.length === 6 || hex.length === 8) {
        const alpha = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1;
        if (alpha < 0.08) return null;
        const r = Number.parseInt(hex.slice(0, 2), 16) / 255;
        const g = Number.parseInt(hex.slice(2, 4), 16) / 255;
        const b = Number.parseInt(hex.slice(4, 6), 16) / 255;
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      }
    }

    const m = s.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?/i);
    if (m) {
      const alpha = m[4] !== undefined ? Number(m[4]) : 1;
      if (Number.isFinite(alpha) && alpha < 0.08) return null;
      const [r, g, b] = [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    if (s.startsWith('color(')) {
      const nums = (s.match(/[\d.]+/g) || []).map(Number);
      if (nums.length >= 3) {
        const alpha = nums.length >= 4 ? nums[3] : 1;
        if (Number.isFinite(alpha) && alpha < 0.08) return null;
        return 0.2126 * nums[0] + 0.7152 * nums[1] + 0.0722 * nums[2];
      }
    }
    return null;
  }

  function extractExplicitHostTheme(el) {
    if (!el || typeof el.getAttribute !== 'function') return '';
    for (const attr of ['data-theme', 'data-color-mode', 'data-vscode-theme-kind']) {
      const val = String(el.getAttribute(attr) || '').trim().toLowerCase();
      if (!val) continue;
      if (val.includes('light')) return 'light';
      if (val.includes('dark') || val.includes('hc-black') || val.includes('high-contrast')) return 'dark';
    }
    if (el.classList && el.classList.length > 0) {
      const classes = Array.from(el.classList);
      for (let i = classes.length - 1; i >= 0; i -= 1) {
        const c = classes[i].toLowerCase();
        if (c === 'vscode-light' || c === 'vscode-high-contrast-light' || c === 'theme-light' || c === 'light-theme' || c === 'light') {
          return 'light';
        }
        if (c === 'vscode-dark' || c === 'vscode-high-contrast' || c === 'theme-dark' || c === 'dark-theme' || c === 'dark') {
          return 'dark';
        }
      }
    }
    return '';
  }

  function resolveEffectiveTheme() {
    if (state.themeMode === 'dark') return 'dark';
    if (state.themeMode === 'light') return 'light';

    const docEl = document.documentElement;
    const bodyEl = document.body;

    // 1. Inline background override on body/html
    for (const el of [bodyEl, docEl]) {
      const inlineBg = el?.style?.backgroundColor || el?.style?.background || '';
      const lum = parseColorLuminance(inlineBg);
      if (lum !== null) return lum < 0.52 ? 'dark' : 'light';
    }

    // 2. Explicit host attributes / classes on html or body
    for (const el of [docEl, bodyEl]) {
      const exp = extractExplicitHostTheme(el);
      if (exp) return exp;
    }

    // 3. Antigravity Sidecar injected --background CSS custom property
    if (typeof getComputedStyle === 'function' && docEl) {
      try {
        const hostBgVar = getComputedStyle(docEl).getPropertyValue('--background').trim();
        if (hostBgVar) {
          const lum = parseColorLuminance(hostBgVar);
          if (lum !== null) return lum < 0.52 ? 'dark' : 'light';
        }
      } catch {
        // ignore style error
      }
    }

    // 4. OS / Browser prefers-color-scheme media query
    try {
      if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        const mql = window.matchMedia('(prefers-color-scheme: dark)');
        if (mql && typeof mql.matches === 'boolean') {
          return mql.matches ? 'dark' : 'light';
        }
      }
    } catch {
      // ignore matchMedia error
    }

    return 'dark';
  }

  let isUpdatingThemeAttr = false;
  function syncScheme() {
    const resolved = resolveEffectiveTheme();
    state.resolvedTheme = resolved;
    isUpdatingThemeAttr = true;
    try {
      if (document.documentElement.getAttribute('data-qp-theme') !== resolved) {
        document.documentElement.setAttribute('data-qp-theme', resolved);
      }
      const appEl = $('app');
      if (appEl && appEl.getAttribute('data-theme') !== resolved) {
        appEl.setAttribute('data-theme', resolved);
      }
      document.querySelectorAll('[data-theme-mode]').forEach((el) => {
        el.classList.toggle('active', el.dataset.themeMode === state.themeMode);
      });
    } finally {
      isUpdatingThemeAttr = false;
    }
  }

  syncScheme();
  const hostThemeAttrFilter = ['style', 'class', 'data-theme', 'data-color-mode', 'data-vscode-theme-kind'];
  const hostThemeObserver = new MutationObserver(() => {
    if (!isUpdatingThemeAttr && state.themeMode === 'auto') {
      syncScheme();
    }
  });
  if (document.documentElement) {
    hostThemeObserver.observe(document.documentElement, { attributes: true, attributeFilter: hostThemeAttrFilter });
  }
  if (document.body) {
    hostThemeObserver.observe(document.body, { attributes: true, attributeFilter: hostThemeAttrFilter });
  }
  try {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      const onMql = () => {
        if (state.themeMode === 'auto') syncScheme();
      };
      if (typeof mql?.addEventListener === 'function') mql.addEventListener('change', onMql);
      else if (typeof mql?.addListener === 'function') mql.addListener(onMql);
    }
  } catch {
    // ignore
  }

  // -------------------------------------------------------------------------
  // Formatters & Gauge SVG Geometry
  // -------------------------------------------------------------------------
  function formatCountdown(ms, fallback = 'N/A') {
    if (!Number.isFinite(ms)) return fallback;
    if (ms <= 0) return t('ready');
    const mins = Math.ceil(ms / 60_000);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours >= 24) {
      const days = Math.floor(hours / 24);
      const remHours = hours % 24;
      if (days >= 7) {
        const weeks = Math.floor(days / 7);
        const remDays = days % 7;
        if (remDays === 0 && remHours === 0) return `${weeks}w`;
        if (remDays === 0) return `${weeks}w ${remHours}h`;
        if (remHours === 0) return `${weeks}w ${remDays}d`;
        return `${weeks}w ${remDays}d ${remHours}h`;
      }
      return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
    }
    const remMins = mins % 60;
    return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
  }

  function formatResetClock(resetDate) {
    if (!Number.isFinite(resetDate)) return '';
    const d = new Date(resetDate);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function formatPercent(val) {
    if (!Number.isFinite(val)) return 'N/A';
    if (val >= 99.95) return '100';
    if (val <= 0) return '0';
    return val % 1 === 0 ? val.toFixed(0) : val.toFixed(1);
  }

  function formatCreditNum(val) {
    const n = Number(val);
    if (!Number.isFinite(n)) return String(val ?? '0');
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toLocaleString();
  }

  function cleanTierValue(val) {
    const s = String(val ?? '').trim();
    if (!s || /未知|unknown|unspecified/i.test(s)) return '';
    return s;
  }

  function getArcPath(cx, cy, r, startAngle, endAngle) {
    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;
    const x1 = cx + r * Math.cos(startRad);
    const y1 = cy - r * Math.sin(startRad);
    const x2 = cx + r * Math.cos(endRad);
    const y2 = cy - r * Math.sin(endRad);
    const largeArc = Math.abs(endAngle - startAngle) > 180 ? 1 : 0;
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  }

  function getArcLength(r, sweepDeg) {
    return (Math.abs(sweepDeg) / 360) * 2 * Math.PI * r;
  }

  const SEMI_ARC_PATH = getArcPath(50, 40, 36, 195, -15);
  const SEMI_ARC_LEN = getArcLength(36, 210);

  function colorForPct(pct, fallback) {
    if (pct <= 10) return 'var(--qp-crit)';
    if (pct <= 25) return 'var(--qp-warn)';
    return fallback;
  }

  function toFinite(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function normalizeModelLabel(label = '') {
    let out = String(label || '').trim();
    while (EFFORT_SUFFIX_RE.test(out)) {
      out = out.replace(EFFORT_SUFFIX_RE, '').trim();
    }
    return out || String(label || '').trim();
  }

  function classifyPoolId(rawText = '') {
    const trimmed = String(rawText || '').trim();
    if (!trimmed) return null;
    if (KNOWN_MODEL_POOL[trimmed]) return KNOWN_MODEL_POOL[trimmed];
    const lower = trimmed.toLowerCase();
    if (lower === 'argon' || lower.includes('shared_gemini_argon') || lower.includes('argon')) return 'argon';
    if (
      lower === 'non-google'
      || lower.includes('shared_3p')
      || lower.includes('claude')
      || lower.includes('sonnet')
      || lower.includes('opus')
      || lower.includes('haiku')
      || lower.includes('gpt')
      || lower.includes('openai')
      || lower.includes('anthropic')
      || lower.includes('3p')
    ) {
      return 'non-google';
    }
    if (
      lower === 'gemini'
      || lower.includes('shared_gemini')
      || lower.includes('gemini')
      || lower.includes('carbon')
      || lower.includes('hydrogen')
      || lower.includes('flash')
    ) {
      return 'gemini';
    }
    return null;
  }

  function detectHasIndependentArgonPool(summaryGroups = [], models = []) {
    const groups = Array.isArray(summaryGroups) ? summaryGroups : [];
    for (const g of groups) {
      const gName = String(g?.displayName || '').trim().toLowerCase();
      if (gName.includes('argon')) return true;
      for (const b of Array.isArray(g?.buckets) ? g.buckets : []) {
        const bid = String(b?.bucketId || b?.id || '').trim().toLowerCase();
        const bName = String(b?.displayName || '').trim().toLowerCase();
        if (bid.includes('argon') || bName.includes('argon')) return true;
      }
    }

    const hasSummaryBuckets = groups.some((g) => Array.isArray(g?.buckets) && g.buckets.length > 0);
    if (hasSummaryBuckets) {
      return false;
    }

    const activeModels = (Array.isArray(models) ? models : []).filter((m) => m && !m.disabled);
    const argonModels = activeModels.filter(
      (m) => (m.initialPoolId || classifyPoolId(`${m.modelId || ''} ${m.label || ''}`)) === 'argon',
    );
    const geminiModels = activeModels.filter(
      (m) => (m.initialPoolId || classifyPoolId(`${m.modelId || ''} ${m.label || ''}`)) === 'gemini',
    );

    if (argonModels.length > 0 && geminiModels.length > 0) {
      const pickMin = (arr) =>
        arr.reduce((min, cur) => {
          const curVal = Number(cur.rawRemainingPercentage ?? cur.remainingPercentage ?? 100);
          const minVal = Number(min.rawRemainingPercentage ?? min.remainingPercentage ?? 100);
          return curVal < minVal ? cur : min;
        });
      const minArgon = pickMin(argonModels);
      const minGemini = pickMin(geminiModels);
      const aPct = Number(minArgon.rawRemainingPercentage ?? minArgon.remainingPercentage ?? 0);
      const gPct = Number(minGemini.rawRemainingPercentage ?? minGemini.remainingPercentage ?? 0);
      if (Math.abs(aPct - gPct) > 0.05) return true;

      const aReset = toFinite(minArgon.resetDate);
      const gReset = toFinite(minGemini.resetDate);
      if ((aReset === null) !== (gReset === null)) return true;
      if (aReset !== null && gReset !== null && Math.abs(aReset - gReset) > 60_000) return true;
    }

    return false;
  }

  function shortenModelFamilyName(baseLabel, poolId) {
    const lbl = normalizeModelLabel(baseLabel);
    if (!lbl) return { name: '', rank: 99 };

    if (poolId === 'argon') {
      return { name: lbl, rank: /orchestrator/i.test(lbl) ? 50 : 10 };
    }

    if (poolId === 'gemini') {
      const elemMatch = lbl.match(/^Gemini(?:\s+\d+(?:\.\d+)?)?\s+(Carbon|Argon|Hydrogen|Helium|Neon|Krypton|Xenon)\b/i);
      if (elemMatch) {
        const rawElem = elemMatch[1];
        const name = rawElem.charAt(0).toUpperCase() + rawElem.slice(1).toLowerCase();
        const lower = name.toLowerCase();
        const rank = lower === 'carbon' ? 10 : (lower === 'argon' ? 20 : (lower === 'hydrogen' ? 30 : 35));
        return { name, rank };
      }
      const stripped = lbl.replace(/^Gemini\s+/i, '').trim() || lbl;
      const rank = /flash|lite/i.test(stripped) ? 50 : 40;
      return { name: stripped, rank };
    }

    const claudeVerFirst = lbl.match(/^(?:Anthropic\s+)?Claude\s+(\d+(?:\.\d+)?)\s+(Sonnet|Opus|Haiku)\b/i);
    if (claudeVerFirst) {
      const tierWord = claudeVerFirst[2].charAt(0).toUpperCase() + claudeVerFirst[2].slice(1).toLowerCase();
      const name = `${tierWord} ${claudeVerFirst[1]}`;
      const lower = tierWord.toLowerCase();
      const rank = lower === 'sonnet' ? 10 : (lower === 'opus' ? 20 : 30);
      return { name, rank };
    }

    const claudeTierFirst = lbl.match(/^(?:Anthropic\s+)?Claude\s+(.+)$/i);
    if (claudeTierFirst) {
      const name = claudeTierFirst[1].trim();
      const rank = /^sonnet\b/i.test(name) ? 10 : (/^opus\b/i.test(name) ? 20 : (/^haiku\b/i.test(name) ? 30 : 35));
      return { name, rank };
    }

    if (/^(?:OpenAI\s+)?GPT[-\s]?OSS(?:\s+\d+[Bb])?\b/i.test(lbl)) {
      return { name: 'GPT-OSS', rank: 40 };
    }

    const cleaned3p = lbl.replace(/^(?:OpenAI|Anthropic|Meta|Mistral|xAI)\s+/i, '').trim() || lbl;
    const rank = /^gpt\b/i.test(cleaned3p) ? 42 : 50;
    return { name: cleaned3p, rank };
  }

  function derivePoolFamilyInfo(pool, allModels = [], summaryGroups = [], hasArgon = false) {
    if (typeof pool?.familySummary === 'string' && pool.familySummary.trim()) {
      const familySummary = pool.familySummary.trim();
      const families = Array.isArray(pool.families) && pool.families.length
        ? pool.families.map((s) => String(s || '').trim()).filter(Boolean)
        : familySummary.split(/\s*·\s*/).filter(Boolean);
      const modelLabels = Array.isArray(pool.modelLabels) && pool.modelLabels.length
        ? pool.modelLabels.map((s) => String(s || '').trim()).filter(Boolean)
        : families;
      return { families, familySummary, modelLabels };
    }

    if (Array.isArray(pool?.families) && pool.families.length > 0) {
      const families = pool.families.map((s) => String(s || '').trim()).filter(Boolean);
      const familySummary = families.join(' · ');
      const modelLabels = Array.isArray(pool.modelLabels) && pool.modelLabels.length
        ? pool.modelLabels.map((s) => String(s || '').trim()).filter(Boolean)
        : families;
      return { families, familySummary, modelLabels };
    }

    const pid = pool?.id || 'gemini';
    const seenLabelLower = new Set();
    const modelLabels = [];
    const addLabel = (raw) => {
      const clean = normalizeModelLabel(raw);
      if (!clean || /^MODEL_PLACEHOLDER_/i.test(clean) || clean.toLowerCase() === 'unknown') return;
      const k = clean.toLowerCase();
      if (!seenLabelLower.has(k)) {
        seenLabelLower.add(k);
        modelLabels.push(clean);
      }
    };

    for (const g of Array.isArray(summaryGroups) ? summaryGroups : []) {
      const gDisp = String(g?.displayName || '');
      const gBuckets = Array.isArray(g?.buckets) ? g.buckets : [];
      let gPid = null;
      if (gDisp.toLowerCase().includes('argon') || gBuckets.some((b) => String(b?.bucketId || '').toLowerCase().includes('argon'))) {
        gPid = hasArgon ? 'argon' : 'gemini';
      } else if (classifyPoolId(gDisp) === 'non-google' || gBuckets.some((b) => /^3p/i.test(String(b?.bucketId || '')))) {
        gPid = 'non-google';
      } else if (classifyPoolId(gDisp) === 'gemini' || gBuckets.some((b) => /^gemini/i.test(String(b?.bucketId || '')))) {
        gPid = 'gemini';
      }
      if (gPid === pid && typeof g?.description === 'string' && g.description.trim()) {
        for (const part of g.description.split(',')) {
          const base = normalizeModelLabel(part);
          if (!base || base.length > 48) continue;
          if (/\b(?:quota|shared|across|models|limit|window|reset)\b/i.test(base)) continue;
          if (!/\b(?:gemini|claude|gpt|sonnet|opus|haiku|carbon|argon|hydrogen|flash|orchestrator|openai|o\d)\b/i.test(base)) continue;
          const partPid = classifyPoolId(base);
          if (hasArgon && pid === 'gemini' && partPid === 'argon') continue;
          if (pid === 'argon' && partPid && partPid !== 'argon') continue;
          addLabel(base);
        }
      }
    }

    for (const m of Array.isArray(allModels) ? allModels : []) {
      if (!m || m.disabled) continue;
      const rawPid = classifyPoolId(`${m.modelId || ''} ${m.label || ''}`) || m.poolId || 'non-google';
      const effPid = !hasArgon && rawPid === 'argon' ? 'gemini' : rawPid;
      if (effPid !== pid) continue;
      addLabel(m.label || m.modelId || '');
    }

    const nonOrch = modelLabels.filter((l) => !/orchestrator/i.test(l));
    const srcLabels = nonOrch.length > 0 ? nonOrch : modelLabels;
    const ranked = [];
    const seenFamLower = new Set();

    srcLabels.forEach((lbl, idx) => {
      const { name, rank } = shortenModelFamilyName(lbl, pid);
      if (!name) return;
      const k = name.toLowerCase();
      if (seenFamLower.has(k)) return;
      seenFamLower.add(k);
      ranked.push({ name, rank, idx });
    });

    ranked.sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.idx - b.idx));
    const families = ranked.map((r) => r.name);
    return {
      families,
      familySummary: families.join(' · '),
      modelLabels,
    };
  }

  function resolveSnapshotHasArgon(snap, rawPools) {
    if (snap?.poolMode === '2-pool' || snap?.hasIndependentArgonPool === false) return false;
    if (snap?.poolMode === '3-pool' || snap?.hasIndependentArgonPool === true) return true;

    const poolArr = Array.isArray(rawPools) ? rawPools : [];
    const argonPool = poolArr.find((p) => p && p.id === 'argon');
    if (!argonPool) return false;

    const wBid = String(argonPool.weekly?.bucketId || '').toLowerCase();
    if (wBid.includes('argon') || argonPool.source === '5h-bucket' || argonPool.source === 'weekly-bucket') {
      return true;
    }

    const hasGroups = Array.isArray(snap?.summaryGroups) && snap.summaryGroups.length > 0;
    const hasModels = Array.isArray(snap?.models) && snap.models.length > 0;
    if (hasGroups || hasModels) {
      return detectHasIndependentArgonPool(snap.summaryGroups || [], snap.models || []);
    }

    const geminiPool = poolArr.find((p) => p && p.id === 'gemini');
    if (argonPool.hasData && geminiPool?.hasData) {
      if (Math.abs((Number(argonPool.remaining) || 0) - (Number(geminiPool.remaining) || 0)) > 0.05) {
        return true;
      }
      if ((argonPool.resetDate ?? null) !== (geminiPool.resetDate ?? null)) {
        return true;
      }
      if (Boolean(argonPool.weekly) !== Boolean(geminiPool.weekly)) {
        return true;
      }
    }
    return Boolean(argonPool.hasData);
  }

  function resolveEffectiveActivePoolId(rawActivePoolId, pools) {
    if (!rawActivePoolId) return null;
    if (!Array.isArray(pools) || pools.length === 0) return rawActivePoolId;
    if (pools.some((p) => p && p.id === rawActivePoolId)) {
      return rawActivePoolId;
    }
    if (rawActivePoolId === 'argon' && pools.some((p) => p && p.id === 'gemini')) {
      return 'gemini';
    }
    return null;
  }

  function detectActivePoolId(data, pools) {
    const candidates = [];
    if (state.activeModelOverride !== null && state.activeModelOverride !== undefined && state.activeModelOverride !== '') {
      if (typeof state.activeModelOverride === 'object') {
        const mo = state.activeModelOverride;
        candidates.push(mo.modelId, mo.label, mo.title, mo.name, mo.key, mo.id, mo.poolId, mo.groupId);
      } else {
        candidates.push(state.activeModelOverride);
      }
    }
    if (data && typeof data === 'object') {
      const dm = data.currentModel ?? data.activeModel ?? data.activeModelHint;
      if (dm && typeof dm === 'object') {
        candidates.push(dm.rawModelId, dm.rawLabel, dm.modelId, dm.label, dm.title, dm.name, dm.key, dm.id, dm.poolId, dm.groupId);
      } else if (typeof dm === 'string') {
        candidates.push(dm);
      }
      if (data.activePoolId) candidates.push(data.activePoolId);
    }
    for (const cand of candidates) {
      const pid = classifyPoolId(cand);
      if (pid) return resolveEffectiveActivePoolId(pid, pools);
    }
    return null;
  }

  function normalizePools(rawPools, snap = null) {
    const poolArr = Array.isArray(rawPools) ? rawPools : [];
    const byId = new Map();
    for (const p of poolArr) {
      if (p && p.id) byId.set(p.id, p);
    }
    const hasArgon = resolveSnapshotHasArgon(snap, poolArr);
    const activeConfigs = hasArgon
      ? FIXED_POOLS
      : FIXED_POOLS.filter((c) => c.id !== 'argon');

    const allModels = Array.isArray(snap?.models) ? snap.models : [];
    const summaryGroups = Array.isArray(snap?.summaryGroups) ? snap.summaryGroups : [];

    return activeConfigs.map((cfg) => {
      const found = byId.get(cfg.id);
      const fam = derivePoolFamilyInfo(found || { id: cfg.id }, allModels, summaryGroups, hasArgon);
      if (!found) {
        return {
          id: cfg.id,
          label: cfg.label,
          shortLabel: cfg.shortLabel,
          themeColor: cfg.themeColor,
          hasData: false,
          remaining: 0,
          resetDate: null,
          resetTime: 'N/A',
          families: fam.families,
          familySummary: fam.familySummary,
          modelLabels: fam.modelLabels,
          weekly: null,
          prediction: { usageRate: 0, runway: 'Stable' },
        };
      }
      return {
        ...found,
        id: cfg.id,
        label: found.label || cfg.label,
        shortLabel: found.shortLabel || cfg.shortLabel,
        themeColor: found.themeColor || cfg.themeColor,
        families: fam.families,
        familySummary: fam.familySummary,
        modelLabels: fam.modelLabels,
        prediction: found.prediction || { usageRate: 0, runway: 'Stable' },
      };
    });
  }

  function renderGaugeCard(pool, activePoolId) {
    const {
      id,
      label,
      remaining,
      hasData,
      resetDate,
      resetTime,
      themeColor,
      weekly,
      prediction,
      familySummary = '',
      modelLabels = [],
    } = pool;
    const isCurrent = Boolean(activePoolId && activePoolId === id);
    const pct = hasData ? Math.min(100, Math.max(0, Number(remaining) || 0)) : 0;
    const liveCountdown = resetDate ? formatCountdown(resetDate - Date.now(), resetTime || 'N/A') : (resetTime || 'N/A');
    const pctStr = hasData ? formatPercent(pct) : 'N/A';
    const activeColor = hasData ? colorForPct(pct, themeColor) : 'var(--qp-fg-muted)';
    const resetClock = resetDate ? formatResetClock(resetDate) : '';
    const submodelsTitle = Array.isArray(modelLabels) && modelLabels.length > 0
      ? modelLabels.join(' · ')
      : familySummary;
    const tooltipBase = resetClock ? `${label} · ${t('resetAt')}: ${resetClock}` : label;
    const tooltip = familySummary ? `${tooltipBase} · ${familySummary}` : tooltipBase;
    const submodelsHtml = familySummary
      ? `<div class="gauge-submodels" title="${esc(submodelsTitle)}">${esc(familySummary)}</div>`
      : `<div class="gauge-submodels" aria-hidden="true"></div>`;

    let visualHtml = '';
    if (state.gaugeStyle === 'classic-donut') {
      const emptyColor = 'rgba(128, 128, 128, 0.16)';
      const grad = `conic-gradient(${activeColor} 0% ${pct}%, ${emptyColor} ${pct}% 100%)`;
      visualHtml = `
        <div class="gauge-visual">
          <div class="pie-ring" style="background: ${grad}"></div>
          <div class="gauge-center">
            <div class="gauge-val">${esc(pctStr)}${hasData ? '<span class="gauge-unit">%</span>' : ''}</div>
            <div class="gauge-reset-inner">${esc(liveCountdown)}</div>
          </div>
        </div>
        <div class="gauge-label">${esc(label)}</div>
        ${submodelsHtml}
      `;
    } else {
      const dashOffset = SEMI_ARC_LEN - (pct / 100) * SEMI_ARC_LEN;
      visualHtml = `
        <div class="gauge-visual">
          <svg viewBox="0 0 100 70" class="gauge-svg" aria-hidden="true">
            <path class="gauge-track-bg" d="${SEMI_ARC_PATH}" />
            <path class="gauge-fill" d="${SEMI_ARC_PATH}"
              style="stroke: ${activeColor}; color: ${activeColor}; stroke-dasharray: ${SEMI_ARC_LEN.toFixed(2)}; stroke-dashoffset: ${dashOffset.toFixed(2)};" />
          </svg>
          <div class="gauge-center">
            <div class="gauge-val">${esc(pctStr)}${hasData ? '<span class="gauge-unit">%</span>' : ''}</div>
            <div class="gauge-reset-inner">${esc(liveCountdown)}</div>
          </div>
        </div>
        <div class="gauge-label">${esc(label)}</div>
        ${submodelsHtml}
      `;
    }

    const rateVal = Number(prediction?.usageRate) || 0;
    const hasBurn = hasData && rateVal > 0.05;
    const runwayRaw = prediction?.runway && prediction.runway !== 'Stable' ? prediction.runway : '';
    const rateLabel = !hasData
      ? `— ${t('rateUnit')}`
      : hasBurn
        ? `${rateVal.toFixed(1)} ${t('rateUnit')}${runwayRaw ? ` · ${runwayRaw}` : ` · ${t('stable')}`}`
        : `0.0 ${t('rateUnit')} · ${t('stable')}`;
    const rateTitle = runwayRaw ? `${t('runwayPrefix')} ${runwayRaw}` : '';
    const rateHtml = `<div class="gauge-rate-tag" title="${esc(rateTitle)}">${esc(rateLabel)}</div>`;

    let weeklyHtml = '';
    if (weekly) {
      const wPct = Math.min(100, Math.max(0, Number(weekly.remaining) || 0));
      const wCountdown = weekly.resetDate ? formatCountdown(weekly.resetDate - Date.now(), weekly.resetTime || 'N/A') : (weekly.resetTime || 'N/A');
      const wClock = weekly.resetDate ? formatResetClock(weekly.resetDate) : '';
      weeklyHtml = `
        <div class="weekly-box" title="${esc(wClock ? `${t('resetAt')}: ${wClock}` : '')}">
          <div class="weekly-head">
            <span>${esc(t('weekly'))}</span>
            <strong>${esc(formatPercent(wPct))}%</strong>
          </div>
          <div class="weekly-track">
            <div class="weekly-fill" style="width: ${wPct}%; background: ${colorForPct(wPct, themeColor)};"></div>
          </div>
          <div class="weekly-reset">↻ ${esc(wCountdown)}</div>
        </div>
      `;
    } else {
      weeklyHtml = `
        <div class="weekly-box is-empty">
          <div class="weekly-head">
            <span>${esc(t('weekly'))}</span>
            <strong>--</strong>
          </div>
          <div class="weekly-track">
            <div class="weekly-fill" style="width: 0%;"></div>
          </div>
          <div class="weekly-reset">↻ N/A</div>
        </div>
      `;
    }

    return `
      <div class="gauge-card style-${esc(state.gaugeStyle)}${isCurrent ? ' is-current' : ''}" data-pool-id="${esc(id)}" style="--pool-accent: ${esc(themeColor)};" title="${esc(tooltip)}">
        ${isCurrent ? `<span class="qp-current-badge">${esc(t('current'))}</span>` : ''}
        ${visualHtml}
        ${rateHtml}
        ${weeklyHtml}
      </div>
    `;
  }

  // -------------------------------------------------------------------------
  // Render Four Layers + Update Footer Bar
  // -------------------------------------------------------------------------
  function renderControlsText() {
    document.documentElement.lang = state.lang === 'en' ? 'en' : 'zh-CN';
    $('title-text').textContent = t('title');
    $('seg-arc').textContent = t('arc');
    $('seg-donut').textContent = t('ring');
    $('seg-theme-auto').textContent = t('themeAuto');
    $('seg-theme-dark').textContent = t('themeDark');
    $('seg-theme-light').textContent = t('themeLight');
    $('theme-group').title = t('themeGroupTip');
    $('btn-lang').title = t('langGroupTip');
    $('btn-refresh').title = t('refresh');
    $('updated-at').title = t('updatedTip');
    $('loading-text').textContent = t('loading');
    $('error-title').textContent = t('errorTitle');
    $('btn-retry').textContent = t('retry');

    document.querySelectorAll('[data-gauge]').forEach((el) => {
      el.classList.toggle('active', el.dataset.gauge === state.gaugeStyle);
    });
    document.querySelectorAll('[data-theme-mode]').forEach((el) => {
      el.classList.toggle('active', el.dataset.themeMode === state.themeMode);
    });
    document.querySelectorAll('[data-lang]').forEach((el) => {
      el.classList.toggle('active', el.dataset.lang === state.lang);
    });
  }

  function renderUserCard(data) {
    const el = $('user-card');
    const u = data.userInfo || {};
    const tier = cleanTierValue(u.tier) || cleanTierValue(u.planName);
    const planExtra = cleanTierValue(u.planName);
    if (!u.email && !u.name && !tier) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    el.innerHTML = `
      <div class="qp-user-left">
        <span class="user-name">${esc(u.name || 'Antigravity')}</span>
        ${u.email ? `<span class="user-sep">·</span><span id="user-email" class="user-email ${state.emailMasked ? 'masked' : ''}" role="button" tabindex="0" title="${esc(t('emailTip'))}">${esc(u.email)}</span>` : ''}
      </div>
      <div class="tier-badges">
        ${tier ? `<span class="tier-badge">${esc(tier)}</span>` : ''}
        ${planExtra && planExtra !== tier ? `<span class="plan-badge">${esc(planExtra)}</span>` : ''}
      </div>
    `;
    const emailEl = $('user-email');
    if (emailEl) {
      const toggleMask = () => {
        state.emailMasked = !state.emailMasked;
        writePref('agy_quota_mask_email', state.emailMasked ? '1' : '0');
        emailEl.classList.toggle('masked', state.emailMasked);
      };
      emailEl.addEventListener('click', toggleMask);
      emailEl.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          toggleMask();
        }
      });
    }
  }

  function renderGauges(data) {
    const el = $('gauges-section');
    el.classList.remove('hidden');
    const pools = normalizePools(data.pools, data);
    const poolCols = Math.max(1, pools.length);
    const activePoolId = detectActivePoolId(data, pools);
    el.dataset.cols = String(poolCols);
    el.style.setProperty('--qp-cols', String(poolCols));
    el.innerHTML = pools.map((p) => renderGaugeCard(p, activePoolId)).join('');
  }

  function bindCollapse(sectionKey, btnId, bodyId) {
    const btn = $(btnId);
    const body = $(bodyId);
    if (!btn || !body) return;
    btn.addEventListener('click', () => {
      state.collapsed[sectionKey] = !state.collapsed[sectionKey];
      writePref(`agy_quota_col_${sectionKey}`, state.collapsed[sectionKey] ? '1' : '0');
      body.classList.toggle('hidden', state.collapsed[sectionKey]);
      btn.textContent = state.collapsed[sectionKey] ? t('expand') : t('collapse');
    });
  }

  const clamp = (n, min, max) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return min;
    return Math.min(max, Math.max(min, v));
  };

  function formatClockHm(ts) {
    if (!Number.isFinite(ts) || ts <= 0) return '';
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function formatPpCompact(val) {
    const n = Number(val) || 0;
    if (n <= 0) return '0';
    if (n < 0.1) return n.toFixed(2);
    return n.toFixed(1);
  }

  function normalizeModelTrendBuckets(rawModelBuckets, fallbackPoolBuckets, pools, windowMins, refNow) {
    if (Array.isArray(rawModelBuckets) && rawModelBuckets.length > 0) {
      const src = rawModelBuckets.slice(-CHART_BUCKETS);
      if (src.length >= CHART_BUCKETS) return src;
      const bucketMs = BUCKET_MINUTES * 60_000;
      const firstStart = Number(src[0]?.startTime) || (refNow - windowMins * 60_000);
      const padLen = CHART_BUCKETS - src.length;
      const pad = Array.from({ length: padLen }, (_, i) => ({
        startTime: firstStart - (padLen - i) * bucketMs,
        endTime: firstStart - (padLen - i - 1) * bucketMs,
        totalPp: 0,
        totalCalls: 0,
        items: [],
      }));
      return [...pad, ...src];
    }

    const bucketMs = BUCKET_MINUTES * 60_000;
    const winStart = refNow - windowMins * 60_000;
    return fallbackPoolBuckets.map((pb, i) => {
      const bEnd = Number(pb?.endTime) > 0 ? Number(pb.endTime) : winStart + (i + 1) * bucketMs;
      const bStart = Number(pb?.startTime) > 0 ? Number(pb.startTime) : bEnd - bucketMs;
      const items = (pb?.items || [])
        .map((it) => {
          const u = Number(it?.usage) || 0;
          if (u <= 0.01) return null;
          const pCfg = pools.find((p) => p.id === it.poolId);
          return {
            modelId: `${it.poolId}-pool`,
            label: pCfg?.shortLabel || pCfg?.label || it.poolId,
            poolId: it.poolId,
            color: it.color || pCfg?.themeColor || '#40C4FF',
            usagePp: Number(u.toFixed(2)),
            calls: 0,
            activityScore: 0,
          };
        })
        .filter(Boolean);
      const totalPp = Number(items.reduce((s, x) => s + x.usagePp, 0).toFixed(2));
      return { startTime: bStart, endTime: bEnd, totalPp, totalCalls: 0, items };
    });
  }

  function deriveFallbackModelSummaries(modelBuckets, windowMins) {
    const map = new Map();
    for (const mb of modelBuckets) {
      for (const it of mb.items || []) {
        const cur = map.get(it.modelId) || {
          modelId: it.modelId,
          label: it.label,
          poolId: it.poolId,
          color: it.color,
          totalPp: 0,
          calls: 0,
        };
        cur.totalPp += Number(it.usagePp) || 0;
        cur.calls += Number(it.calls) || 0;
        map.set(it.modelId, cur);
      }
    }
    const hrs = Math.max(windowMins, 5) / 60;
    return Array.from(map.values())
      .filter((s) => s.totalPp > 0.005 || s.calls > 0)
      .map((s) => ({
        ...s,
        totalPp: Number(s.totalPp.toFixed(2)),
        usageRatePp: Number((s.totalPp / hrs).toFixed(2)),
      }))
      .sort((a, b) => (b.totalPp !== a.totalPp ? b.totalPp - a.totalPp : b.calls - a.calls));
  }

  function setTrendGranularity(nextMode) {
    const norm = String(nextMode || '').trim().toLowerCase() === 'pool' ? 'pool' : 'model';
    state.trendGranularity = norm;
    writePref(TREND_GRANULARITY_KEY, norm);
    if (state.data) renderTrendSection(state.data);
    return state.trendGranularity;
  }

  function normalizeTrendBuckets(rawBuckets) {
    const src = Array.isArray(rawBuckets) ? rawBuckets.slice(-CHART_BUCKETS) : [];
    if (src.length >= CHART_BUCKETS) return src;
    const padCount = CHART_BUCKETS - src.length;
    const empty = Array.from({ length: padCount }, () => ({ endTime: 0, items: [] }));
    return [...empty, ...src];
  }

  function renderTrendSection(data) {
    const el = $('trend-section');
    el.classList.remove('hidden');
    const isCollapsed = state.collapsed.trend;
    const isModelMode = state.trendGranularity !== 'pool';
    el.dataset.trendGranularity = isModelMode ? 'model' : 'pool';

    const pools = normalizePools(data.pools, data);
    const poolCols = Math.max(1, pools.length);
    const activePoolIds = new Set(pools.map((p) => p.id));
    const hasArgon = activePoolIds.has('argon');

    const history = data.history || { windowMinutes: 90, hasUsage: false, buckets: [] };
    const windowMins = Number(history.windowMinutes) || 90;
    const refNow = Number(data.timestamp) || Date.now();
    const buckets = normalizeTrendBuckets(history.buckets).map((b) => ({
      ...b,
      items: (b.items || []).filter((it) => !it?.poolId || activePoolIds.has(it.poolId)),
    }));

    let colsHtml = '';
    let hasUsage = false;
    let bottomSummaryHtml = '';

    if (isModelMode) {
      const modelBuckets = normalizeModelTrendBuckets(history.modelBuckets, buckets, pools, windowMins, refNow).map((mb) => {
        const mbItems = (mb.items || [])
          .map((it) => {
            if (!it) return null;
            const mappedPid = !hasArgon && it.poolId === 'argon' ? 'gemini' : it.poolId;
            if (mappedPid && !activePoolIds.has(mappedPid)) return null;
            return { ...it, poolId: mappedPid || 'gemini', label: normalizeModelLabel(it.label || it.modelId || '') };
          })
          .filter(Boolean);
        const totalPp = Number(mbItems.reduce((s, it) => s + (Number(it.usagePp) || 0), 0).toFixed(2));
        const totalCalls = mbItems.reduce((s, it) => s + (Number(it.calls) || 0), 0);
        return { ...mb, totalPp, totalCalls, items: mbItems };
      });

      const modelSummaries = Array.isArray(history.modelSummaries)
        ? history.modelSummaries
            .map((ms) => {
              if (!ms) return null;
              const mappedPid = !hasArgon && ms.poolId === 'argon' ? 'gemini' : ms.poolId;
              if (mappedPid && !activePoolIds.has(mappedPid)) return null;
              return { ...ms, poolId: mappedPid || 'gemini', label: normalizeModelLabel(ms.label || ms.modelId || '') };
            })
            .filter((ms) => ms && ((Number(ms.totalPp) || 0) > 0.005 || (Number(ms.calls) || 0) > 0))
        : deriveFallbackModelSummaries(modelBuckets, windowMins);

      const maxBucketPp = Math.max(0.5, ...modelBuckets.map((mb) => Number(mb.totalPp) || 0));
      hasUsage = modelBuckets.some((mb) => mb.totalPp > 0.005 || mb.totalCalls > 0);

      colsHtml = modelBuckets
        .map((mb, idx) => {
          const bucketMs = BUCKET_MINUTES * 60_000;
          const bEnd = Number(mb.endTime) > 0 ? Number(mb.endTime) : (refNow - (CHART_BUCKETS - 1 - idx) * bucketMs);
          const bStart = Number(mb.startTime) > 0 ? Number(mb.startTime) : (bEnd - bucketMs);
          const rangeStr = `${formatClockHm(bStart)}–${formatClockHm(bEnd)}`;

          const ppItems = mb.items.filter((it) => (Number(it.usagePp) || 0) > 0.005);
          const callOnlyItems = mb.items.filter((it) => (Number(it.usagePp) || 0) <= 0.005 && (Number(it.calls) || 0) > 0);

          let segs = '';
          if (ppItems.length > 0) {
            const reservedPct = callOnlyItems.length > 0 ? Math.min(14, callOnlyItems.length * 7) : 0;
            const colPct = clamp((mb.totalPp / maxBucketPp) * (100 - reservedPct), 9, 100 - reservedPct);
            const sumPp = ppItems.reduce((s, it) => s + (Number(it.usagePp) || 0), 0) || 1;
            segs += ppItems
              .map((it) => {
                const u = Number(it.usagePp) || 0;
                const hPct = Math.max(4, (u / sumPp) * colPct);
                const c = Number(it.calls) || 0;
                const segTip = `${rangeStr} · ${it.label}: -${u.toFixed(2)} pp${c > 0 ? ` · ${c} ${t('callsUnit')}` : ''}`;
                return `<div class="trend-seg" style="height: ${hPct.toFixed(1)}%; background: ${esc(it.color || '#38BDF8')};" title="${esc(segTip)}"></div>`;
              })
              .join('');
            if (callOnlyItems.length > 0) {
              const eachPct = reservedPct / callOnlyItems.length;
              segs += callOnlyItems
                .map((it) => {
                  const c = Math.max(1, Number(it.calls) || 1);
                  const segTip = `${rangeStr} · ${it.label}: 0.00 pp · ${c} ${t('callsUnit')}`;
                  return `<div class="trend-seg" style="height: ${eachPct.toFixed(1)}%; background: ${esc(it.color || '#38BDF8')}; opacity: 0.85;" title="${esc(segTip)}"></div>`;
                })
                .join('');
            }
          } else if (callOnlyItems.length > 0) {
            const totalCalls = callOnlyItems.reduce((s, it) => s + (Number(it.calls) || 1), 0);
            const totalPx = clamp(3.4 + Math.log2(1 + totalCalls) * 0.85, 3.5, 6);
            const eachPx = totalPx / callOnlyItems.length;
            segs = callOnlyItems
              .map((it) => {
                const c = Math.max(1, Number(it.calls) || 1);
                const segTip = `${rangeStr} · ${it.label}: 0.00 pp · ${c} ${t('callsUnit')}`;
                return `<div class="trend-seg" style="height: ${eachPx.toFixed(1)}px; background: ${esc(it.color || '#38BDF8')}; opacity: 0.88;" title="${esc(segTip)}"></div>`;
              })
              .join('');
          }

          let colTip = `${rangeStr} · 0 pp`;
          if (mb.items.length > 0) {
            const header = mb.totalPp > 0.005 ? `${rangeStr} (-${mb.totalPp.toFixed(2)} pp)` : rangeStr;
            const lines = mb.items.map((it) => {
              const u = Number(it.usagePp) || 0;
              const c = Number(it.calls) || 0;
              if (u > 0.005 && c > 0) return `• ${it.label}: -${u.toFixed(2)} pp · ${c} ${t('callsUnit')}`;
              if (u > 0.005) return `• ${it.label}: -${u.toFixed(2)} pp`;
              return `• ${it.label}: 0.00 pp · ${c} ${t('callsUnit')}`;
            });
            colTip = [header, ...lines].join('\n');
          }

          return `<div class="trend-col" title="${esc(colTip)}">${segs}</div>`;
        })
        .join('');

      if (modelSummaries.length > 0) {
        const modelChipsHtml = modelSummaries
          .map((ms) => {
            const cleanName = normalizeModelLabel(ms.label || ms.modelId || '');
            const totPp = Number(ms.totalPp) || 0;
            const ratePp = Number(ms.usageRatePp) || 0;
            const calls = Number(ms.calls) || 0;
            const metaText = totPp > 0.005
              ? `-${formatPpCompact(totPp)}pp · ${ratePp.toFixed(1)} ${t('rateUnit')}`
              : `${Math.max(1, calls)} ${t('callsUnit')}`;
            const fullTip = `${cleanName}: -${totPp.toFixed(2)} pp · ${ratePp.toFixed(1)} ${t('rateUnit')}${calls > 0 ? ` · ${calls} ${t('callsUnit')}` : ''}`;
            return `
              <span class="trend-model-chip" data-model-id="${esc(ms.modelId)}" title="${esc(fullTip)}">
                <span class="trend-model-left">
                  <span class="dot" style="background: ${esc(ms.color || '#38BDF8')};"></span>
                  <span class="trend-model-name">${esc(cleanName)}</span>
                </span>
                <span class="trend-model-meta">${esc(metaText)}</span>
              </span>
            `;
          })
          .join('');
        bottomSummaryHtml = `<div class="trend-model-chips">${modelChipsHtml}</div>`;
      } else {
        bottomSummaryHtml = `<div class="trend-model-empty">${esc(t('noRecentModelUsage'))}</div>`;
      }
    } else {
      const totals = buckets.map((b) => (b.items || []).reduce((acc, it) => acc + (Number(it.usage) || 0), 0));
      const maxTotal = Math.max(0.5, ...totals);
      hasUsage = totals.some((v) => v > 0.01);

      colsHtml = buckets
        .map((b, idx) => {
          const total = totals[idx];
          const segs = (b.items || [])
            .map((it) => {
              const usage = Number(it.usage) || 0;
              const hPct = (usage / maxTotal) * 100;
              return `<div class="trend-seg" style="height: ${hPct.toFixed(1)}%; background: ${esc(it.color || '#40C4FF')};" title="${esc(it.poolId)}: -${usage.toFixed(2)}pp"></div>`;
            })
            .join('');
          return `<div class="trend-col" title="${total > 0 ? `-${total.toFixed(2)}pp` : '0pp'}">${segs}</div>`;
        })
        .join('');

      const chipsHtml = pools
        .map((p) => {
          const rate = Number(p.prediction?.usageRate) || 0;
          const runway = p.prediction?.runway && p.prediction.runway !== 'Stable' ? p.prediction.runway : t('stable');
          const metric = p.hasData ? `${rate.toFixed(1)} ${t('rateUnit')} · ${runway}` : 'N/A';
          return `
            <span class="trend-chip" title="${esc(`${p.label}: ${metric}`)}">
              <span class="dot" style="background: ${esc(p.themeColor)};"></span>
              <span class="trend-chip-text">${esc(p.shortLabel)} <strong>${esc(p.hasData ? `${rate.toFixed(1)}` : 'N/A')}</strong>${p.hasData ? ` ${esc(t('rateUnit'))} · ${esc(runway)}` : ''}</span>
            </span>
          `;
        })
        .join('');
      bottomSummaryHtml = `<div class="trend-summary trend-stats" data-cols="${poolCols}" style="--qp-cols: ${poolCols};">${chipsHtml}</div>`;
    }

    el.innerHTML = `
      <div class="section-header">
        <h2 class="section-title">${esc(t('trendTitle'))}</h2>
        <div class="section-header-actions">
          <div class="segmented trend-seg-toggle" role="group" aria-label="Trend granularity" title="${esc(t('trendGranularityTip'))}">
            <button type="button" class="seg-btn ${isModelMode ? 'active' : ''}" data-trend-granularity="model">${esc(t('byModel'))}</button>
            <button type="button" class="seg-btn ${!isModelMode ? 'active' : ''}" data-trend-granularity="pool">${esc(t('byPool'))}</button>
          </div>
          <button id="btn-col-trend" type="button" class="collapse-btn">${esc(isCollapsed ? t('expand') : t('collapse'))}</button>
        </div>
      </div>
      <div id="body-trend" class="section-body ${isCollapsed ? 'hidden' : ''}">
        <div class="trend-chart-wrap">
          <div class="trend-bars">${colsHtml}</div>
          ${!hasUsage ? `<div class="trend-idle-hint">${esc(t('trendEmpty'))}</div>` : ''}
        </div>
        <div class="trend-axis">
          <span>-${esc(windowMins)}m</span>
          <span>${esc(t('windowLabel').replace('{n}', String(windowMins)))}</span>
          <span>0m</span>
        </div>
        ${bottomSummaryHtml}
      </div>
    `;
    bindCollapse('trend', 'btn-col-trend', 'body-trend');
    el.querySelectorAll('[data-trend-granularity]').forEach((btn) => {
      btn.addEventListener('click', () => {
        setTrendGranularity(btn.getAttribute('data-trend-granularity'));
      });
    });
  }

  function formatCreditType(rawType) {
    const cleaned = String(rawType || '').trim();
    if (!cleaned || cleaned.toUpperCase() === 'UNKNOWN') return 'Google One AI';
    return cleaned
      .split('_')
      .filter(Boolean)
      .map((w) => (w.toLowerCase() === 'ai' ? 'AI' : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
      .join(' ');
  }

  function renderCreditsSection(data) {
    const el = $('credits-section');
    el.classList.remove('hidden');
    const isCollapsed = state.collapsed.credits;

    const c = data.credits || {};
    const u = data.userInfo || {};
    const rawUserCredits = Array.isArray(c.userCredits) ? c.userCredits : [];

    const userPills = rawUserCredits.length
      ? rawUserCredits
          .map((uc) => {
            const label = formatCreditType(uc.creditType);
            const detail = uc.creditAmount !== null && uc.creditAmount !== undefined
              ? formatCreditNum(uc.creditAmount)
              : uc.minimumCreditAmountForUsage !== null && uc.minimumCreditAmountForUsage !== undefined
                ? `${t('minUsage')}: ${uc.minimumCreditAmountForUsage}`
                : t('standardRule');
            return `<span class="credit-pill">${esc(label)} · <strong>${esc(detail)}</strong></span>`;
          })
          .join('')
      : `<span class="credit-pill">Google One AI · <strong>${esc(cleanTierValue(u.tier) || t('standardRule'))}</strong></span>`;

    const barRow = (label, item, color) => {
      if (item && Number.isFinite(Number(item.monthly)) && Number(item.monthly) > 0) {
        const pct = Math.min(100, Math.max(0, Number(item.remainingPercentage) || 0));
        return `
          <div class="credit-row">
            <div class="credit-head">
              <span>${esc(label)}</span>
              <span class="credit-val">${esc(formatCreditNum(item.available))} / ${esc(formatCreditNum(item.monthly))} (${esc(formatPercent(pct))}%)</span>
            </div>
            <div class="bar-track">
              <div class="bar-fill" style="width: ${pct}%; background: ${colorForPct(pct, color)};"></div>
            </div>
          </div>
        `;
      }
      return `
        <div class="credit-row">
          <div class="credit-head">
            <span>${esc(label)}</span>
            <span class="credit-val">${esc(t('includedPlan'))}</span>
          </div>
          <div class="bar-track">
            <div class="bar-fill" style="width: 100%; background: ${color}; opacity: 0.35;"></div>
          </div>
        </div>
      `;
    };

    el.innerHTML = `
      <div class="section-header">
        <h2 class="section-title">${esc(t('creditsTitle'))}</h2>
        <button id="btn-col-credits" type="button" class="collapse-btn">${esc(isCollapsed ? t('expand') : t('collapse'))}</button>
      </div>
      <div id="body-credits" class="section-body ${isCollapsed ? 'hidden' : ''}">
        <div class="credit-pill-list">${userPills}</div>
        ${barRow(t('promptCredits'), c.prompt, '#40C4FF')}
        ${barRow(t('flowCredits'), c.flow, '#B388FF')}
      </div>
    `;
    bindCollapse('credits', 'btn-col-credits', 'body-credits');
  }

  function renderFooterBar() {
    const el = $('footer-bar');
    if (!el) return;
    const u = state.update;
    let statusHtml = '';

    if (u.applying) {
      statusHtml = `<span class="qp-update-status has-update">${esc(t('updating'))}</span>`;
    } else if (u.checking) {
      statusHtml = `<span class="qp-update-status">${esc(t('checkingUpdate'))}</span>`;
    } else if (u.hasUpdate && u.latestVersion) {
      const foundText = t('updateFound').replace('{v}', u.latestVersion);
      statusHtml = `
        <span class="qp-update-status has-update">${esc(foundText)}</span>
        <button type="button" class="qp-update-btn primary" data-footer-action="apply-update">${esc(t('updateNow'))}</button>
      `;
    } else if (u.justUpdatedTo) {
      const okText = t('updatedOk').replace('{v}', u.justUpdatedTo);
      statusHtml = `
        <span class="qp-update-status is-ok">${esc(okText)}</span>
        <button type="button" class="qp-update-btn" data-footer-action="check-update">${esc(t('checkUpdate'))}</button>
      `;
    } else if (u.error) {
      statusHtml = `
        <span class="qp-update-status" title="${esc(u.error)}">${esc(t('updateFailed'))}</span>
        <button type="button" class="qp-update-btn" data-footer-action="check-update">${esc(t('checkUpdate'))}</button>
      `;
    } else {
      statusHtml = `
        <span class="qp-update-status">${esc(t('upToDate'))}</span>
        <button type="button" class="qp-update-btn" data-footer-action="check-update">${esc(t('checkUpdate'))}</button>
      `;
    }

    el.innerHTML = `
      <div class="qp-footer-left">
        <span class="qp-ver-label">AGY Quota v${esc(u.currentVersion)}</span>
        <span class="qp-footer-sep">·</span>
        ${statusHtml}
      </div>
      <button type="button" class="qp-switch-wrap" role="switch" aria-checked="${u.autoUpdate ? 'true' : 'false'}" data-footer-action="toggle-autoupdate" title="${esc(t('autoUpdateTip'))}">
        <span class="qp-switch-label">${esc(t('autoUpdate'))}</span>
        <span class="qp-switch ${u.autoUpdate ? 'on' : ''}"><span class="qp-switch-thumb"></span></span>
      </button>
    `;
  }

  function renderAll() {
    syncScheme();
    renderControlsText();
    renderFooterBar();

    const dot = $('status-dot');
    const errBanner = $('error-banner');
    const loadingBox = $('loading-state');

    if (state.error && !state.data) {
      dot.className = 'status-dot error';
      loadingBox.classList.add('hidden');
      errBanner.classList.remove('hidden');
      $('error-msg').textContent = state.error;
      return;
    }

    if (state.error) {
      dot.className = 'status-dot error';
      errBanner.classList.remove('hidden');
      $('error-msg').textContent = state.error;
    } else {
      errBanner.classList.add('hidden');
    }

    if (!state.data) {
      dot.className = 'status-dot connecting';
      loadingBox.classList.remove('hidden');
      return;
    }

    loadingBox.classList.add('hidden');
    if (!state.error) dot.className = 'status-dot connected';

    const dt = new Date(state.data.timestamp || Date.now());
    const pad = (n) => String(n).padStart(2, '0');
    $('updated-at').textContent = `${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;

    renderUserCard(state.data);
    renderGauges(state.data);
    renderTrendSection(state.data);
    renderCreditsSection(state.data);
  }

  // -------------------------------------------------------------------------
  // Update Status / Check / Apply (/api/update/* + Direct GitHub Fallback)
  // -------------------------------------------------------------------------
  function applyUpdateCheckPayload(json) {
    if (!json || typeof json !== 'object') return;
    const ver = json.currentVersion || json.version || json.status?.currentVersion;
    if (typeof ver === 'string' && parseSemver(ver)) {
      state.update.currentVersion = ver.replace(/^v/i, '');
    }
    const prefs = json.prefs || json.updatePrefs || json;
    if (prefs && typeof prefs.autoUpdate === 'boolean') {
      state.update.autoUpdate = prefs.autoUpdate;
      writePref('agy_quota_auto_update', prefs.autoUpdate ? '1' : '0');
    }
    const chk = json.lastCheck || json.checkResult || json.cachedCheck || json.result || json;
    if (chk && typeof chk === 'object') {
      const latest = String(chk.latestVersion || '').trim().replace(/^v/i, '');
      if (latest && parseSemver(latest)) {
        state.update.latestVersion = latest;
        state.update.hasUpdate = typeof chk.hasUpdate === 'boolean'
          ? chk.hasUpdate
          : compareSemver(latest, state.update.currentVersion) > 0;
      }
      if (Number.isFinite(Number(chk.checkedAt)) && Number(chk.checkedAt) > 0) {
        state.update.checkedAt = Number(chk.checkedAt);
      }
      if (typeof chk.releaseUrl === 'string' && chk.releaseUrl) {
        state.update.releaseUrl = chk.releaseUrl;
      }
    }
  }

  async function fetchGithubUpdateDirect() {
    const repo = DEFAULT_GITHUB_REPO;
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        method: 'GET',
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (res.ok) {
        const json = await res.json();
        const latestVersion = String(json?.tag_name || json?.name || '').trim().replace(/^v/i, '');
        if (parseSemver(latestVersion)) {
          return {
            ok: true,
            currentVersion: state.update.currentVersion,
            latestVersion,
            hasUpdate: compareSemver(latestVersion, state.update.currentVersion) > 0,
            releaseUrl: json?.html_url || `https://github.com/${repo}/releases`,
            checkedAt: Date.now(),
          };
        }
      }
    } catch {
      // fall through to raw package.json
    }
    const rawRes = await fetch(`https://raw.githubusercontent.com/${repo}/main/package.json`, {
      method: 'GET',
      cache: 'no-store',
    });
    if (!rawRes.ok) throw new Error(`HTTP ${rawRes.status}`);
    const pkg = await rawRes.json();
    const latestVersion = String(pkg?.version || '').trim().replace(/^v/i, '');
    if (!parseSemver(latestVersion)) throw new Error('Invalid version');
    return {
      ok: true,
      currentVersion: state.update.currentVersion,
      latestVersion,
      hasUpdate: compareSemver(latestVersion, state.update.currentVersion) > 0,
      releaseUrl: `https://github.com/${repo}`,
      checkedAt: Date.now(),
    };
  }

  let statusLoadedOnce = false;

  async function loadUpdateStatus() {
    try {
      const f = getApiFetch();
      const res = await f('/api/update/status', { method: 'GET' });
      if (res.ok) {
        const json = await res.json();
        applyUpdateCheckPayload(json);
        renderFooterBar();
      }
    } catch {
      // fail-open when running on older server
    } finally {
      statusLoadedOnce = true;
    }
  }

  async function checkUpdate(force = true) {
    if (state.update.checking || state.update.applying) return state.update;
    if (!statusLoadedOnce) {
      await loadUpdateStatus();
    }
    state.update.checking = true;
    state.update.error = '';
    renderFooterBar();

    try {
      const f = getApiFetch();
      let payload = null;
      try {
        const url = force ? '/api/update/check?force=1' : '/api/update/check';
        const res = await f(url, {
          method: 'POST',
          headers: buildJsonHeaders(),
          body: JSON.stringify({ force: Boolean(force) }),
        });
        if (res.ok) {
          payload = await res.json();
        }
      } catch {
        payload = null;
      }

      if (!payload || payload.ok === false) {
        payload = await fetchGithubUpdateDirect();
      }

      applyUpdateCheckPayload(payload);
    } catch (err) {
      state.update.error = err instanceof Error ? err.message : t('updateFailed');
    } finally {
      state.update.checking = false;
      renderFooterBar();
    }

    if (
      state.update.hasUpdate
      && state.update.autoUpdate
      && state.update.latestVersion
      && state.update.autoAttemptedVersion !== state.update.latestVersion
    ) {
      state.update.autoAttemptedVersion = state.update.latestVersion;
      await applyUpdate();
    }
    return { ...state.update };
  }

  async function setAutoUpdate(enabled) {
    const next = Boolean(enabled);
    state.update.autoUpdate = next;
    writePref('agy_quota_auto_update', next ? '1' : '0');
    renderFooterBar();

    try {
      const f = getApiFetch();
      await f('/api/update/prefs', {
        method: 'POST',
        headers: buildJsonHeaders(),
        body: JSON.stringify({ autoUpdate: next }),
      });
    } catch {
      // fail-open
    }

    if (next && state.update.hasUpdate && !state.update.applying) {
      applyUpdate();
    }
    return next;
  }

  async function applyUpdate() {
    if (state.update.applying) return { ok: false };
    state.update.applying = true;
    state.update.error = '';
    renderFooterBar();

    try {
      const f = getApiFetch();
      const res = await f('/api/update/apply', {
        method: 'POST',
        headers: buildJsonHeaders(),
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.ok === false) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      const nextVer = String(json.updatedVersion || state.update.latestVersion || state.update.currentVersion).replace(/^v/i, '');
      state.update.currentVersion = nextVer;
      state.update.hasUpdate = false;
      state.update.justUpdatedTo = nextVer;
      return { ok: true, updatedVersion: nextVer };
    } catch (err) {
      state.update.error = err instanceof Error ? err.message : String(err);
      return { ok: false, error: state.update.error };
    } finally {
      state.update.applying = false;
      renderFooterBar();
    }
  }

  // -------------------------------------------------------------------------
  // Data Fetching & Event Wiring
  // -------------------------------------------------------------------------
  function unwrapQuotaPayload(json) {
    if (!json || typeof json !== 'object') return null;
    if (json.snapshot && typeof json.snapshot === 'object') {
      return {
        ...json.snapshot,
        ok: json.ok !== false,
        timestamp: json.snapshot.timestamp || json.timestamp || Date.now(),
        connection: json.snapshot.connection || json.connection || null,
      };
    }
    return json;
  }

  async function loadQuota(force = false) {
    if (state.loading) return;
    if (!force && state.snapshotOverrideLocked) return;
    if (force) {
      state.snapshotOverrideLocked = false;
      state.activeModelOverride = null;
    }
    state.loading = true;
    $('btn-refresh').classList.add('spinning');
    if (!state.data) {
      $('status-dot').className = 'status-dot connecting';
    }

    try {
      const f = getApiFetch();
      const url = force ? '/api/quota?force=1' : '/api/quota';
      const res = await f(url, { method: 'GET' });
      const json = await res.json();
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      state.data = unwrapQuotaPayload(json);
      state.error = '';
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
    } finally {
      state.loading = false;
      $('btn-refresh').classList.remove('spinning');
      renderAll();
    }
  }

  function setLang(nextLang) {
    if (nextLang === 'auto' || nextLang === '' || nextLang === null || nextLang === undefined) {
      removePref('agy_quota_lang');
      state.lang = detectDefaultLang();
    } else {
      const norm = normalizeLangCode(nextLang) || 'zh';
      state.lang = norm;
      writePref('agy_quota_lang', norm);
    }
    renderAll();
    return state.lang;
  }

  function setTheme(nextMode) {
    state.themeMode = normalizeThemeMode(nextMode);
    writePref('agy_quota_theme', state.themeMode);
    syncScheme();
    return { themeMode: state.themeMode, resolvedTheme: state.resolvedTheme };
  }

  $('btn-refresh').addEventListener('click', () => loadQuota(true));
  $('btn-retry').addEventListener('click', () => loadQuota(true));

  $('btn-lang').addEventListener('click', (ev) => {
    const langBtn = ev.target?.closest?.('[data-lang]');
    if (langBtn) {
      setLang(langBtn.dataset.lang);
      return;
    }
    setLang(state.lang === 'zh' ? 'en' : 'zh');
  });

  document.querySelectorAll('[data-theme-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setTheme(btn.dataset.themeMode);
    });
  });

  document.querySelectorAll('[data-gauge]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.gaugeStyle = btn.dataset.gauge === 'classic-donut' ? 'classic-donut' : 'semi-arc';
      writePref('agy_quota_gauge', state.gaugeStyle);
      renderAll();
    });
  });

  $('footer-bar')?.addEventListener('click', (ev) => {
    const btn = ev.target?.closest?.('[data-footer-action]');
    if (!btn) return;
    const act = btn.getAttribute('data-footer-action');
    if (act === 'check-update') checkUpdate(true);
    else if (act === 'apply-update') applyUpdate();
    else if (act === 'toggle-autoupdate') setAutoUpdate(!state.update.autoUpdate);
  });

  const sidecarCtl = {
    version: APP_VERSION,
    getMode: () => 'sidecar',
    setLang,
    setTheme,
    setTrendGranularity,
    setAutoUpdate,
    checkUpdate: (force = true) => checkUpdate(Boolean(force)),
    applyUpdate,
    refresh: () => loadQuota(true),
    setActiveModelForTest: (modelOrNull) => {
      state.activeModelOverride = modelOrNull ?? null;
      renderAll();
      const pools = state.data ? normalizePools(state.data.pools, state.data) : [];
      return detectActivePoolId(state.data, pools);
    },
    setSnapshotForTest: (mockSnap, opts = {}) => {
      if (!mockSnap) {
        state.snapshotOverrideLocked = false;
        state.activeModelOverride = null;
        loadQuota(true);
        return null;
      }
      state.snapshotOverrideLocked = opts.lock !== false;
      if (opts.activeModel !== undefined) {
        state.activeModelOverride = opts.activeModel;
      }
      state.data = unwrapQuotaPayload(mockSnap);
      state.error = '';
      renderAll();
      return state.data;
    },
    getState: () => {
      const pools = state.data ? normalizePools(state.data.pools, state.data) : [];
      const activePoolId = state.data ? detectActivePoolId(state.data, pools) : null;
      return {
        version: APP_VERSION,
        mode: 'sidecar',
        lang: state.lang,
        themeMode: state.themeMode,
        resolvedTheme: state.resolvedTheme,
        gaugeStyle: state.gaugeStyle,
        trendGranularity: state.trendGranularity,
        emailMasked: state.emailMasked,
        poolMode: state.data?.poolMode || (pools.length === 3 ? '3-pool' : '2-pool'),
        poolCount: pools.length,
        activePoolId,
        modelSummariesCount: Array.isArray(state.data?.history?.modelSummaries)
          ? state.data.history.modelSummaries.length
          : 0,
        pools: pools.map((p) => ({
          id: p.id,
          label: p.label,
          remaining: p.remaining,
          hasData: p.hasData,
          familySummary: p.familySummary || '',
        })),
        autoUpdate: Boolean(state.update.autoUpdate),
        updateStatus: { ...state.update },
        timestamp: state.data?.timestamp || null,
      };
    },
  };
  globalThis.__AGY_QUOTA_SIDECAR_CTL__ = sidecarCtl;
  if (!globalThis.__AGY_QUOTA_OVERLAY_CTL__) {
    globalThis.__AGY_QUOTA_OVERLAY_CTL__ = sidecarCtl;
  }

  renderControlsText();
  renderFooterBar();
  loadQuota(false);

  loadUpdateStatus().finally(() => {
    setTimeout(() => checkUpdate(false), 1200);
  });

  setInterval(() => {
    if (!document.hidden) loadQuota(false);
  }, POLL_MS);

  setInterval(() => {
    if (state.data && !document.hidden) renderAll();
  }, COUNTDOWN_TICK_MS);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) loadQuota(false);
  });
})();
