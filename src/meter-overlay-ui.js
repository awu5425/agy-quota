(() => {
  'use strict';

  const OVERLAY_VERSION = '1.3.4';
  const CTL_KEY = '__AGY_QUOTA_OVERLAY_CTL__';
  const SNAP_CACHE_KEY = '__AGY_QUOTA_LAST_SNAPSHOT__';
  const UPDATED_BADGE_KEY = '__AGY_QUOTA_UPDATED_BADGE__';
  const HOOK_SYM = Symbol.for('agy.quota.meterSetterHook');

  const STYLE_EL_ID = 'agy-quota-overlay-styles';
  const ROOT_EL_ID = 'agy-quota-overlay-root';
  const HEADER_CTRL_ID = 'agy-quota-header-ctrl';

  const STANDALONE_HOST_ID = 'agy-quota-standalone-hud';
  const STANDALONE_BADGE_ID = 'agy-standalone-badge';
  const STANDALONE_PANEL_ID = 'agy-standalone-panel';
  const STANDALONE_BODY_ID = 'agy-standalone-body';
  const STANDALONE_DELAY_MS = 480;

  const TREND_GRANULARITY_KEY = 'agy_quota_trend_granularity';
  const LOCAL_HISTORY_KEY = 'agy_quota_overlay_history_v1';
  const DEFAULT_GITHUB_REPO = 'awu5425/agy-quota';

  const USER_STATUS_PATH = '/exa.language_server_pb.LanguageServerService/GetUserStatus';
  const QUOTA_SUMMARY_PATH = '/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary';
  const RPC_BODY = JSON.stringify({
    metadata: {
      ideName: 'antigravity',
      extensionName: 'antigravity',
      locale: 'en',
    },
  });

  const DIRECT_POLL_MS = 60_000;
  const UI_TICK_MS = 15_000;
  const CHART_WINDOW_MINUTES = 90;
  const CHART_BUCKETS = 18;
  const BUCKET_MINUTES = 5;
  const HISTORY_RETENTION_MS = 24 * 60 * 60 * 1000;
  const HISTORY_MIN_INTERVAL_MS = 60_000;
  const RESET_JUMP_PP = 0.1;

  const FIXED_POOLS = [
    {
      id: 'gemini',
      label: 'Gemini',
      shortLabel: 'Gemini',
      themeColor: '#40C4FF',
      fiveHourBucketIds: ['gemini-5h'],
      weeklyBucketIds: ['gemini-weekly'],
    },
    {
      id: 'argon',
      label: 'Argon',
      shortLabel: 'Argon',
      themeColor: '#B388FF',
      fiveHourBucketIds: ['gemini-argon-5h', 'argon-5h'],
      weeklyBucketIds: ['gemini-argon-wtu-weekly', 'argon-weekly'],
    },
    {
      id: 'non-google',
      label: 'Claude / GPT',
      shortLabel: 'Claude',
      themeColor: '#FFAB40',
      fiveHourBucketIds: ['3p-5h'],
      weeklyBucketIds: ['3p-weekly'],
    },
  ];

  const KNOWN_MODEL_POOL = {
    MODEL_PLACEHOLDER_M532: 'gemini',
    MODEL_PLACEHOLDER_M533: 'gemini',
    MODEL_PLACEHOLDER_M534: 'gemini',
    MODEL_PLACEHOLDER_M535: 'gemini',
    MODEL_PLACEHOLDER_M537: 'gemini',
    MODEL_PLACEHOLDER_M417: 'argon',
    MODEL_PLACEHOLDER_M418: 'argon',
    MODEL_PLACEHOLDER_M419: 'argon',
    MODEL_PLACEHOLDER_M668: 'argon',
    MODEL_PLACEHOLDER_M427: 'gemini',
    MODEL_PLACEHOLDER_M670: 'gemini',
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

  const I18N = {
    zh: {
      title: 'AGY 账号额度',
      arc: '半弧',
      ring: '圆环',
      current: '当前',
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
      creditBalance: '余额',
      minUsageShort: '起扣 ≥ {n}',
      belowMinUsage: '低于起扣 {n}',
      overageReady: '超额可用',
      creditsNoteEmpty: '当前无可用超额积分 · 默认按上方 5h / 周配额池计费',
      creditsNoteReady: '优先消耗上方 5h / 周配额池，耗尽后自动扣减超额积分',
      creditsNoteNoList: '默认按上方 5h / 周配额池计费（未检测到可用超额积分）',
      creditsZeroTip: '后端未返回 creditAmount（Protobuf 省略 0 值），表示当前可用超额积分为 0；仅在余额 ≥ 起扣门槛且基础池耗尽时触发超额扣减',
      ready: '已就绪',
      stable: '平稳',
      rateUnit: 'pp/h',
      runwayPrefix: '预计可用',
      collapse: '收起',
      expand: '展开',
      emailTip: '点击切换邮箱高斯模糊打码',
      minUsage: '单次最低扣减',
      resetAt: '重置',
      windowLabel: '近 {n} 分钟消耗 (pp)',
      loading: '正在同步额度看板...',
      retry: '重试',
      refresh: '刷新额度',
      close: '关闭面板',
      updatedTip: '最近刷新时间 / 下次自动同步倒计时',
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
      updatedOk: '已热更新 v{v}',
      updateFailed: '检查失败',
      autoUpdate: '自动更新',
      autoUpdateTip: '检测到新版本时自动拉取并热更新',
      badgeTipPrefix: '点击展开 AGY 账号额度',
    },
    en: {
      title: 'AGY Quota',
      arc: 'Arc',
      ring: 'Ring',
      current: 'Active',
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
      creditBalance: 'Balance',
      minUsageShort: 'Min ≥ {n}',
      belowMinUsage: 'Below min {n}',
      overageReady: 'Overage ready',
      creditsNoteEmpty: 'No usable overage credits · Billed from 5h / weekly pools above',
      creditsNoteReady: 'Uses 5h / weekly pools above first; overage credits apply after exhaustion',
      creditsNoteNoList: 'Billed from 5h / weekly pools above (no overage credits reported)',
      creditsZeroTip: 'Server omitted creditAmount (Protobuf zero default), meaning 0 usable overage credits; overages apply only once balance ≥ minimum and baseline quota is exhausted',
      ready: 'Ready',
      stable: 'Stable',
      rateUnit: 'pp/h',
      runwayPrefix: 'Runway',
      collapse: 'Hide',
      expand: 'Show',
      emailTip: 'Click to toggle email blur mask',
      minUsage: 'Min usage',
      resetAt: 'Resets',
      windowLabel: 'Last {n}m drop (pp)',
      loading: 'Syncing quota board...',
      retry: 'Retry',
      refresh: 'Refresh quota',
      close: 'Close panel',
      updatedTip: 'Last updated / Next auto-sync countdown',
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
      autoUpdateTip: 'Automatically download and hot-apply updates',
      badgeTipPrefix: 'Click to open AGY Quota',
    },
  };

  // Dispose any prior overlay instance idempotently before remounting
  if (globalThis[CTL_KEY] && typeof globalThis[CTL_KEY].dispose === 'function') {
    try {
      globalThis[CTL_KEY].dispose();
    } catch {
      // Ignore stale cleanup error
    }
  }
  try {
    document.querySelectorAll?.(`#${STANDALONE_HOST_ID}`).forEach((el) => el.remove());
  } catch {
    // Ignore early DOM cleanup error
  }

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const clamp = (n, min, max) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return min;
    return Math.min(max, Math.max(min, v));
  };

  const toFinite = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

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
      // Ignore storage failures
    }
  };

  const removePref = (key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      // Ignore storage failures
    }
  };

  const normalizeThemeMode = (raw) => {
    const s = String(raw || '').trim().toLowerCase();
    if (s === 'dark' || s === 'light') return s;
    return 'auto';
  };

  const normalizeLangCode = (raw) => {
    const s = String(raw || '').trim().toLowerCase();
    if (s.startsWith('en')) return 'en';
    if (s.startsWith('zh')) return 'zh';
    return '';
  };

  function resolveRuntimeVersion() {
    let bridgeVer = '';
    try {
      const b = globalThis.agyQuotaOverlay;
      bridgeVer = typeof b?.getVersion === 'function' ? b.getVersion() : b?.version;
    } catch {
      bridgeVer = '';
    }
    if (typeof bridgeVer === 'string' && /^\d+\.\d+\.\d+/.test(bridgeVer.trim())) {
      return compareSemver(bridgeVer.trim(), OVERLAY_VERSION) > 0 ? bridgeVer.trim() : OVERLAY_VERSION;
    }
    return OVERLAY_VERSION;
  }

  const initialHotUpdatedVer = typeof globalThis[UPDATED_BADGE_KEY] === 'string' ? globalThis[UPDATED_BADGE_KEY] : '';
  if (initialHotUpdatedVer) {
    try {
      delete globalThis[UPDATED_BADGE_KEY];
    } catch {
      globalThis[UPDATED_BADGE_KEY] = '';
    }
  }

  const state = {
    lang: normalizeLangCode(readPref('agy_quota_lang', '')) || 'zh',
    themeMode: normalizeThemeMode(readPref('agy_quota_theme', 'auto')),
    resolvedTheme: 'dark',
    gaugeStyle: readPref('agy_quota_gauge', 'semi-arc') === 'classic-donut' ? 'classic-donut' : 'semi-arc',
    trendGranularity: readPref(TREND_GRANULARITY_KEY, 'model') === 'pool' ? 'pool' : 'model',
    emailMasked: readPref('agy_quota_mask_email', '0') === '1',
    collapsed: {
      trend: readPref('agy_quota_col_trend', '0') === '1',
      credits: readPref('agy_quota_col_credits', '0') === '1',
    },
    standaloneOpen: false,
    data: globalThis[SNAP_CACHE_KEY] || null,
    activeModelOverride: null,
    snapshotOverrideLocked: false,
    loading: false,
    error: '',
    nextPollAtMs: Date.now() + DIRECT_POLL_MS,
    update: {
      currentVersion: resolveRuntimeVersion(),
      latestVersion: '',
      hasUpdate: false,
      checking: false,
      applying: false,
      autoUpdate: readPref('agy_quota_auto_update', '1') !== '0',
      checkedAt: 0,
      releaseUrl: `https://github.com/${DEFAULT_GITHUB_REPO}/releases`,
      error: '',
      justUpdatedTo: initialHotUpdatedVer,
      autoAttemptedVersion: '',
    },
    disposed: false,
  };

  const t = (key) => I18N[state.lang]?.[key] ?? I18N.zh[key] ?? key;

  // -------------------------------------------------------------------------
  // Semver Comparison Helper
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
  // Shadow DOM Scoped Styles (Mode A #panel-quota + Mode B Standalone HUD)
  // -------------------------------------------------------------------------
  const OVERLAY_CSS = `
    :host {
      -webkit-app-region: no-drag;
      app-region: no-drag;
    }

    #panel-quota {
      width: 476px !important;
      min-width: 476px !important;
      max-width: calc(100vw - 16px) !important;
      box-sizing: border-box !important;
    }
    @media (max-width: 496px) {
      #panel-quota {
        min-width: 0 !important;
        width: calc(100vw - 16px) !important;
      }
    }
    #panel-quota #quota-plan-tier-pill,
    #panel-quota #quota-times-grid,
    #panel-quota #quota-current-card,
    #panel-quota .quota-pools-header,
    #panel-quota #quota-pools-list,
    #panel-quota #quota-basis-note,
    #panel-quota #quota-usage-tip {
      display: none !important;
    }

    .qp-standalone-badge,
    .qp-standalone-panel,
    .agy-qp-header-ctrl,
    .agy-qp-scope {
      --qp-panel-bg: rgba(24, 28, 35, 0.97);
      --qp-card: rgba(255, 255, 255, 0.048);
      --qp-muted: rgba(255, 255, 255, 0.075);
      --qp-fg: #f1f3f5;
      --qp-fg-2: #c8d0d8;
      --qp-fg-muted: #8b95a1;
      --qp-border: rgba(255, 255, 255, 0.095);
      --qp-card-border: rgba(255, 255, 255, 0.115);
      --qp-primary: #40c4ff;
      --qp-ok: #69f0ae;
      --qp-warn: #ffab40;
      --qp-crit: #ff5252;
      --qp-hover: rgba(255, 255, 255, 0.09);
      --qp-track: rgba(255, 255, 255, 0.13);
      --qp-shadow: 0 14px 36px rgba(0, 0, 0, 0.46), 0 2px 8px rgba(0, 0, 0, 0.28);
      --qp-font: "Google Sans Flex", "Google Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      --qp-mono: "Google Sans Code", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-family: var(--qp-font);
      color: var(--qp-fg);
      box-sizing: border-box;
      -webkit-app-region: no-drag;
    }

    .qp-standalone-badge[data-theme="light"],
    .qp-standalone-panel[data-theme="light"],
    .agy-qp-header-ctrl[data-theme="light"],
    .agy-qp-scope[data-theme="light"] {
      --qp-panel-bg: rgba(248, 250, 252, 0.98);
      --qp-card: rgba(255, 255, 255, 0.92);
      --qp-muted: rgba(15, 23, 42, 0.058);
      --qp-fg: #182026;
      --qp-fg-2: #394452;
      --qp-fg-muted: #64748b;
      --qp-border: rgba(15, 23, 42, 0.1);
      --qp-card-border: rgba(15, 23, 42, 0.115);
      --qp-primary: #0284c7;
      --qp-ok: #16a34a;
      --qp-warn: #d97706;
      --qp-crit: #dc2626;
      --qp-hover: rgba(15, 23, 42, 0.065);
      --qp-track: rgba(15, 23, 42, 0.12);
      --qp-shadow: 0 14px 34px rgba(15, 23, 42, 0.16), 0 2px 8px rgba(15, 23, 42, 0.08);
    }

    .qp-standalone-wrap *,
    .agy-qp-scope *,
    .agy-qp-header-ctrl * {
      box-sizing: border-box;
    }

    /* Mode B: Standalone Top-Right HUD */
    .qp-standalone-wrap {
      position: relative;
      display: inline-flex;
      align-items: center;
      -webkit-app-region: no-drag;
    }

    .qp-standalone-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      height: 24px;
      padding: 0 8px 0 6px;
      border-radius: 999px;
      background: var(--qp-panel-bg);
      border: 1px solid var(--qp-card-border);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.22);
      cursor: pointer;
      user-select: none;
      line-height: 1;
      transition: border-color 0.15s ease, transform 0.12s ease, background 0.15s ease;
      backdrop-filter: blur(10px);
    }
    .qp-standalone-badge:hover,
    .qp-standalone-badge[aria-expanded="true"] {
      border-color: color-mix(in srgb, var(--qp-primary) 52%, var(--qp-card-border));
    }
    .qp-standalone-badge:active {
      transform: scale(0.97);
    }

    .qp-badge-ring {
      width: 14px;
      height: 14px;
      flex-shrink: 0;
      transform: rotate(-90deg);
    }
    .qp-badge-ring-bg {
      fill: none;
      stroke: var(--qp-track);
      stroke-width: 2.3;
    }
    .qp-badge-ring-fg {
      fill: none;
      stroke-width: 2.3;
      stroke-linecap: round;
      transition: stroke-dashoffset 0.45s ease, stroke 0.25s ease;
    }
    .qp-badge-pct {
      font-family: var(--qp-mono);
      font-size: 11px;
      font-weight: 600;
      color: var(--qp-fg);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .qp-badge-win {
      font-family: var(--qp-mono);
      font-size: 9px;
      font-weight: 600;
      padding: 1px 4px;
      border-radius: 999px;
      background: var(--qp-muted);
      color: var(--qp-fg-muted);
      line-height: 1.15;
    }
    .qp-badge-upd-dot {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: var(--qp-primary);
      flex-shrink: 0;
    }

    .qp-standalone-panel {
      position: fixed;
      top: 38px;
      right: 12px;
      width: 476px;
      min-width: 476px;
      max-width: calc(100vw - 16px);
      max-height: calc(100vh - 50px);
      display: flex;
      flex-direction: column;
      background: var(--qp-panel-bg);
      border: 1px solid var(--qp-card-border);
      border-radius: 12px;
      box-shadow: var(--qp-shadow);
      backdrop-filter: blur(14px);
      z-index: 2147483601;
      overflow: hidden;
    }
    @media (max-width: 496px) {
      .qp-standalone-panel {
        min-width: 0;
        width: calc(100vw - 16px);
      }
    }
    .qp-standalone-panel.qp-hidden {
      display: none !important;
    }

    .qp-standalone-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      padding: 8px 11px;
      border-bottom: 1px solid var(--qp-border);
      flex-shrink: 0;
    }
    .qp-standalone-brand {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }
    .qp-standalone-title {
      font-size: 12.5px;
      font-weight: 600;
      color: var(--qp-fg);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .qp-standalone-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }

    .qp-icon-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      padding: 0;
      border-radius: 6px;
      border: 1px solid var(--qp-border);
      background: var(--qp-card);
      color: var(--qp-fg-2);
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease;
      flex-shrink: 0;
    }
    .qp-icon-btn:hover {
      background: var(--qp-hover);
      color: var(--qp-fg);
    }
    .qp-icon-btn svg {
      width: 12px;
      height: 12px;
    }
    .qp-icon-btn.spinning svg {
      animation: agyQpSpin 0.75s linear infinite;
    }

    .qp-standalone-body {
      padding: 8px 11px 10px;
      overflow-y: auto;
      overscroll-behavior: contain;
    }

    /* Shared Top Header Controls */
    .agy-qp-header-ctrl {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-right: 3px;
      flex-shrink: 0;
    }

    .qp-updated-meta {
      font-family: var(--qp-mono);
      font-size: 9.5px;
      color: var(--qp-fg-muted);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    .qp-seg {
      display: inline-flex;
      align-items: center;
      padding: 1.5px;
      border-radius: 6px;
      background: var(--qp-muted);
      border: 1px solid var(--qp-border);
    }

    .qp-seg-btn {
      font: inherit;
      font-size: 10px;
      font-weight: 500;
      line-height: 1.25;
      padding: 2px 5px;
      border: none;
      border-radius: 4.5px;
      background: transparent;
      color: var(--qp-fg-muted);
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.15s ease, color 0.15s ease;
    }
    .qp-seg-btn:hover {
      color: var(--qp-fg);
    }
    .qp-seg-btn.active {
      background: var(--qp-card);
      color: var(--qp-fg);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.18);
    }

    .agy-qp-scope {
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: 100%;
      padding: 2px 0 2px;
    }

    .agy-qp-scope .qp-hidden {
      display: none !important;
    }

    .agy-qp-scope .qp-card {
      background: var(--qp-card);
      border: 1px solid var(--qp-card-border);
      border-radius: 10px;
      padding: 8px 10px;
    }

    /* Layer 1: Single-row compact account bar */
    .agy-qp-scope .qp-user-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 6.5px 10px;
      min-height: 34px;
      background: var(--qp-card);
      border: 1px solid var(--qp-card-border);
      border-radius: 9px;
    }
    .agy-qp-scope .qp-user-left {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 6px;
      flex: 1;
    }
    .qp-status-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
      background: var(--qp-ok);
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--qp-ok) 22%, transparent);
    }
    .qp-status-dot.is-error {
      background: var(--qp-crit);
      box-shadow: none;
    }
    .qp-status-dot.is-loading {
      background: var(--qp-warn);
      animation: agyQpPulse 1.2s ease-in-out infinite;
    }
    .agy-qp-scope .user-name {
      font-size: 12px;
      font-weight: 600;
      color: var(--qp-fg);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 132px;
    }
    .agy-qp-scope .user-sep {
      color: var(--qp-fg-muted);
      opacity: 0.55;
      font-size: 11px;
      flex-shrink: 0;
    }
    .agy-qp-scope .user-email {
      font-family: var(--qp-mono);
      font-size: 11px;
      color: var(--qp-fg-muted);
      cursor: pointer;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      transition: filter 0.16s ease, color 0.15s ease;
      user-select: none;
      padding: 1px 3px;
      border-radius: 4px;
    }
    .agy-qp-scope .user-email:hover {
      color: var(--qp-fg-2);
      background: var(--qp-hover);
    }
    .agy-qp-scope .user-email.masked {
      filter: blur(4.2px);
    }
    .agy-qp-scope .tier-badges {
      display: flex;
      align-items: center;
      gap: 5px;
      flex-shrink: 0;
    }
    .agy-qp-scope .tier-badge {
      font-size: 10.5px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--qp-primary) 16%, transparent);
      color: var(--qp-primary);
      border: 1px solid color-mix(in srgb, var(--qp-primary) 34%, transparent);
      white-space: nowrap;
    }
    .agy-qp-scope .plan-badge {
      font-size: 10px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 999px;
      background: var(--qp-muted);
      color: var(--qp-fg-2);
      border: 1px solid var(--qp-border);
      white-space: nowrap;
    }

    /* Layer 2: Dynamic 1x2 (Ultra) / 1x3 (Pro) equal-width semi-arc pool cards */
    .agy-qp-scope .gauges-grid {
      display: grid !important;
      grid-template-columns: repeat(var(--qp-cols, 2), minmax(0, 1fr)) !important;
      gap: 8px;
      width: 100%;
    }

    .agy-qp-scope .gauge-card {
      position: relative;
      min-width: 0;
      background: var(--qp-card);
      border: 1px solid var(--qp-card-border);
      border-radius: 10px;
      padding: 9px 7px 8px;
      display: flex;
      flex-direction: column;
      align-items: center;
      transition: border-color 0.16s ease, box-shadow 0.16s ease, transform 0.15s ease;
    }
    .agy-qp-scope .gauges-grid[data-cols="2"] .gauge-card {
      padding: 10px 10px 9px;
    }
    .agy-qp-scope .gauge-card:hover {
      transform: translateY(-1px);
      border-color: color-mix(in srgb, var(--qp-fg) 22%, transparent);
    }
    .agy-qp-scope .gauge-card.is-current {
      border-color: var(--pool-accent, var(--qp-primary));
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--pool-accent, var(--qp-primary)) 35%, transparent),
                  inset 0 0 18px color-mix(in srgb, var(--pool-accent, var(--qp-primary)) 7%, transparent);
    }

    .agy-qp-scope .qp-current-badge {
      position: absolute;
      top: 5px;
      right: 5px;
      font-size: 9px;
      font-weight: 600;
      line-height: 1.2;
      padding: 1px 4.5px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--pool-accent, var(--qp-primary)) 18%, transparent);
      color: var(--pool-accent, var(--qp-primary));
      border: 1px solid color-mix(in srgb, var(--pool-accent, var(--qp-primary)) 42%, transparent);
      pointer-events: none;
    }

    .agy-qp-scope .gauge-visual {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .agy-qp-scope .style-semi-arc .gauge-visual {
      width: 90px;
      height: 62px;
    }
    .agy-qp-scope .gauges-grid[data-cols="2"] .style-semi-arc .gauge-visual {
      width: 104px;
      height: 72px;
    }
    .agy-qp-scope .style-classic-donut .gauge-visual {
      width: 70px;
      height: 70px;
      margin-bottom: 3px;
    }
    .agy-qp-scope .gauges-grid[data-cols="2"] .style-classic-donut .gauge-visual {
      width: 78px;
      height: 78px;
    }
    .agy-qp-scope .gauge-svg {
      width: 100%;
      height: 100%;
      overflow: visible;
    }
    .agy-qp-scope .gauge-track-bg {
      fill: none;
      stroke: var(--qp-track);
      stroke-width: 6.2;
      stroke-linecap: butt;
    }
    .agy-qp-scope .gauge-fill {
      fill: none;
      stroke-width: 6.2;
      stroke-linecap: butt;
      transition: stroke-dashoffset 0.55s cubic-bezier(0.16, 1, 0.3, 1);
      filter: drop-shadow(0 0 2px color-mix(in srgb, currentColor 42%, transparent));
    }
    .agy-qp-scope .pie-ring {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      mask: radial-gradient(transparent 59%, black 61%);
      -webkit-mask: radial-gradient(transparent 59%, black 61%);
    }
    .agy-qp-scope .gauge-center {
      position: absolute;
      left: 50%;
      transform: translate(-50%, -50%);
      display: flex;
      flex-direction: column;
      align-items: center;
      pointer-events: none;
      width: 100%;
    }
    .agy-qp-scope .style-semi-arc .gauge-center { top: 67%; }
    .agy-qp-scope .style-classic-donut .gauge-center { top: 50%; }

    .agy-qp-scope .gauge-val {
      font-family: var(--qp-mono);
      font-size: 15px;
      font-weight: 600;
      line-height: 1;
      color: var(--qp-fg);
      font-variant-numeric: tabular-nums;
    }
    .agy-qp-scope .gauges-grid[data-cols="2"] .gauge-val {
      font-size: 16.5px;
    }
    .agy-qp-scope .gauge-unit {
      font-size: 9.5px;
      font-weight: 400;
      opacity: 0.75;
      margin-left: 1px;
    }
    .agy-qp-scope .gauge-reset-inner {
      font-family: var(--qp-mono);
      font-size: 10px;
      color: var(--qp-fg-2);
      margin-top: 2.5px;
      line-height: 1.1;
      white-space: nowrap;
    }
    .agy-qp-scope .gauge-label {
      margin-top: 2px;
      font-size: 11.5px;
      font-weight: 600;
      color: var(--qp-fg);
      text-align: center;
      line-height: 1.2;
      width: 100%;
      max-width: 100%;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .agy-qp-scope .gauges-grid[data-cols="2"] .gauge-label {
      font-size: 12px;
    }
    .agy-qp-scope .gauge-submodels {
      margin-top: 2px;
      font-size: 10.5px;
      font-weight: 400;
      line-height: 1.25;
      min-height: 13px;
      width: 100%;
      max-width: 100%;
      color: var(--qp-fg-muted);
      text-align: center;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      letter-spacing: -0.01em;
    }
    .agy-qp-scope .gauge-rate-tag {
      margin-top: 4px;
      max-width: 100%;
      font-family: var(--qp-mono);
      font-size: 9.5px;
      padding: 1px 6px;
      border-radius: 999px;
      background: var(--qp-muted);
      color: var(--qp-fg-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .agy-qp-scope .weekly-box {
      width: 100%;
      margin-top: 6px;
      padding-top: 5px;
      border-top: 1px dashed var(--qp-border);
      font-size: 10px;
    }
    .agy-qp-scope .weekly-box.is-empty {
      opacity: 0.6;
    }
    .agy-qp-scope .weekly-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: var(--qp-fg-2);
    }
    .agy-qp-scope .weekly-head strong {
      font-family: var(--qp-mono);
      font-weight: 600;
    }
    .agy-qp-scope .weekly-track {
      height: 4px;
      border-radius: 2px;
      background: var(--qp-track);
      overflow: hidden;
      margin: 3px 0 2px;
    }
    .agy-qp-scope .weekly-fill {
      height: 100%;
      border-radius: 2px;
      transition: width 0.45s ease;
    }
    .agy-qp-scope .weekly-reset {
      text-align: center;
      font-family: var(--qp-mono);
      font-size: 9.5px;
      color: var(--qp-fg-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Layers 3 & 4: Collapsible sections */
    .agy-qp-scope .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .agy-qp-scope .section-title {
      margin: 0;
      font-size: 11.5px;
      font-weight: 600;
      color: var(--qp-fg);
    }
    .agy-qp-scope .section-header-actions {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      flex-shrink: 0;
    }
    .agy-qp-scope .qp-trend-seg .qp-seg-btn {
      font-size: 9.5px;
      padding: 1.5px 5.5px;
    }
    .agy-qp-scope .collapse-btn {
      font: inherit;
      font-size: 10.5px;
      color: var(--qp-fg-muted);
      background: transparent;
      border: 1px solid var(--qp-border);
      border-radius: 5px;
      padding: 1px 7px;
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease;
    }
    .agy-qp-scope .collapse-btn:hover {
      background: var(--qp-hover);
      color: var(--qp-fg);
    }
    .agy-qp-scope .section-body {
      margin-top: 7px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    /* Layer 3: 90m 18x5m stacked bars + 1x3 rate chips */
    .agy-qp-scope .trend-chart-wrap {
      position: relative;
    }
    .agy-qp-scope .trend-bars {
      height: 44px;
      display: grid;
      grid-template-columns: repeat(18, minmax(0, 1fr));
      align-items: end;
      gap: 3px;
      padding: 3px 1px 0;
      border-bottom: 1px solid var(--qp-border);
    }
    .agy-qp-scope .trend-col {
      height: 100%;
      display: flex;
      flex-direction: column-reverse;
      justify-content: flex-start;
      border-radius: 2px 2px 0 0;
      overflow: hidden;
      background: rgba(128, 138, 150, 0.08);
    }
    .agy-qp-scope .trend-seg {
      width: 100%;
      min-height: 2px;
    }
    .agy-qp-scope .trend-idle-hint {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      font-size: 10px;
      color: var(--qp-fg-muted);
    }
    .agy-qp-scope .trend-axis {
      display: flex;
      justify-content: space-between;
      font-size: 9.5px;
      font-family: var(--qp-mono);
      color: var(--qp-fg-muted);
      margin-top: 2px;
    }
    .agy-qp-scope .trend-summary {
      display: grid !important;
      grid-template-columns: repeat(var(--qp-cols, 2), minmax(0, 1fr)) !important;
      gap: 6px;
      width: 100%;
    }
    .agy-qp-scope .trend-model-chips {
      display: grid !important;
      grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
      gap: 6px;
      width: 100%;
    }
    .agy-qp-scope .trend-model-chip {
      min-width: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      font-size: 10px;
      padding: 3.5px 7px;
      border-radius: 6px;
      background: var(--qp-muted);
      border: 1px solid var(--qp-border);
      white-space: nowrap;
      overflow: hidden;
    }
    .agy-qp-scope .trend-model-left {
      min-width: 0;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      overflow: hidden;
    }
    .agy-qp-scope .trend-model-name {
      font-weight: 600;
      color: var(--qp-fg);
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .agy-qp-scope .trend-model-meta {
      font-family: var(--qp-mono);
      font-size: 9.5px;
      color: var(--qp-fg-2);
      font-variant-numeric: tabular-nums;
      flex-shrink: 0;
    }
    .agy-qp-scope .trend-model-empty {
      font-size: 10px;
      color: var(--qp-fg-muted);
      text-align: center;
      padding: 4px 8px;
      border-radius: 6px;
      background: var(--qp-muted);
      border: 1px dashed var(--qp-border);
    }
    .agy-qp-scope .trend-chip {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 10px;
      padding: 3px 6px;
      border-radius: 6px;
      background: var(--qp-muted);
      border: 1px solid var(--qp-border);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .agy-qp-scope .trend-chip-text {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .agy-qp-scope .trend-chip strong {
      font-family: var(--qp-mono);
      font-size: 10px;
      color: var(--qp-fg);
    }
    .agy-qp-scope .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    /* Layer 4: Credits */
    .agy-qp-scope .credit-pill-list {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
    }
    .agy-qp-scope .credit-pill {
      font-size: 10px;
      padding: 2px 7px;
      border-radius: 6px;
      background: color-mix(in srgb, var(--qp-primary) 12%, transparent);
      border: 1px solid color-mix(in srgb, var(--qp-primary) 26%, transparent);
      color: var(--qp-fg);
    }
    .agy-qp-scope .credit-pill.is-empty {
      background: var(--qp-muted);
      border-color: var(--qp-border);
      color: var(--qp-fg-2);
    }
    .agy-qp-scope .credit-pill.is-usable {
      background: color-mix(in srgb, var(--qp-ok) 14%, transparent);
      border-color: color-mix(in srgb, var(--qp-ok) 36%, transparent);
      color: var(--qp-fg);
    }
    .agy-qp-scope .credit-pill-meta {
      font-size: 9.5px;
      color: var(--qp-fg-muted);
      font-weight: 400;
      margin-left: 3px;
    }
    .agy-qp-scope .credit-note {
      font-size: 10px;
      line-height: 1.35;
      color: var(--qp-fg-muted);
    }
    .agy-qp-scope .credit-row {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .agy-qp-scope .credit-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 6px;
      font-size: 10.5px;
      color: var(--qp-fg-2);
    }
    .agy-qp-scope .credit-val {
      font-family: var(--qp-mono);
      font-weight: 600;
      font-size: 10px;
      color: var(--qp-fg);
    }
    .agy-qp-scope .bar-track {
      height: 4.5px;
      border-radius: 999px;
      background: var(--qp-track);
      overflow: hidden;
    }
    .agy-qp-scope .bar-fill {
      height: 100%;
      border-radius: 999px;
      transition: width 0.45s ease;
    }

    /* Compact Version & Auto-Update Footer Bar */
    .agy-qp-scope .qp-footer-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 5.5px 9px;
      border-radius: 8px;
      background: var(--qp-card);
      border: 1px solid var(--qp-border);
      font-size: 10.5px;
      color: var(--qp-fg-muted);
    }
    .agy-qp-scope .qp-footer-left {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      flex-wrap: wrap;
    }
    .agy-qp-scope .qp-ver-label {
      font-family: var(--qp-mono);
      font-size: 10px;
      font-weight: 600;
      color: var(--qp-fg-2);
      white-space: nowrap;
    }
    .agy-qp-scope .qp-footer-sep {
      opacity: 0.45;
    }
    .agy-qp-scope .qp-update-status {
      font-size: 10px;
      color: var(--qp-fg-muted);
      white-space: nowrap;
    }
    .agy-qp-scope .qp-update-status.has-update {
      color: var(--qp-primary);
      font-weight: 600;
    }
    .agy-qp-scope .qp-update-status.is-ok {
      color: var(--qp-ok);
      font-weight: 600;
    }
    .agy-qp-scope .qp-update-btn {
      font: inherit;
      font-size: 10px;
      font-weight: 600;
      padding: 1.5px 6.5px;
      border-radius: 5px;
      border: 1px solid var(--qp-border);
      background: var(--qp-muted);
      color: var(--qp-fg-2);
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
    }
    .agy-qp-scope .qp-update-btn:hover:not(:disabled) {
      background: var(--qp-hover);
      color: var(--qp-fg);
    }
    .agy-qp-scope .qp-update-btn.primary {
      background: color-mix(in srgb, var(--qp-primary) 18%, transparent);
      border-color: color-mix(in srgb, var(--qp-primary) 42%, transparent);
      color: var(--qp-primary);
    }
    .agy-qp-scope .qp-update-btn:disabled {
      opacity: 0.55;
      cursor: default;
    }

    .agy-qp-scope .qp-switch-wrap {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 1px 2px;
      border: none;
      background: transparent;
      color: var(--qp-fg-2);
      font: inherit;
      font-size: 10px;
      cursor: pointer;
      flex-shrink: 0;
      user-select: none;
    }
    .agy-qp-scope .qp-switch-wrap:hover {
      color: var(--qp-fg);
    }
    .agy-qp-scope .qp-switch {
      position: relative;
      width: 24px;
      height: 13.5px;
      border-radius: 999px;
      background: var(--qp-track);
      border: 1px solid var(--qp-border);
      transition: background 0.18s ease, border-color 0.18s ease;
    }
    .agy-qp-scope .qp-switch.on {
      background: color-mix(in srgb, var(--qp-primary) 72%, transparent);
      border-color: var(--qp-primary);
    }
    .agy-qp-scope .qp-switch-thumb {
      position: absolute;
      top: 1.2px;
      left: 1.5px;
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: #ffffff;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.28);
      transition: transform 0.18s ease;
    }
    .agy-qp-scope .qp-switch.on .qp-switch-thumb {
      transform: translateX(10px);
    }

    /* Loading & Error states */
    .agy-qp-scope .qp-skel-grid {
      display: grid;
      grid-template-columns: repeat(var(--qp-cols, 2), minmax(0, 1fr));
      gap: 8px;
    }
    .agy-qp-scope .qp-skel-card {
      height: 132px;
      border-radius: 10px;
      background: var(--qp-muted);
      animation: agyQpPulse 1.2s ease-in-out infinite;
    }
    .agy-qp-scope .qp-loading-note {
      text-align: center;
      font-size: 11px;
      color: var(--qp-fg-muted);
      margin: 4px 0 0;
    }
    .agy-qp-scope .qp-err-box {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 7px 10px;
      border-radius: 8px;
      font-size: 11px;
      background: color-mix(in srgb, var(--qp-crit) 12%, var(--qp-card));
      border: 1px solid color-mix(in srgb, var(--qp-crit) 35%, transparent);
      color: var(--qp-fg-2);
    }
    .agy-qp-scope .qp-retry-btn {
      font: inherit;
      font-size: 10.5px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 5px;
      border: 1px solid var(--qp-border);
      background: var(--qp-card);
      color: var(--qp-fg);
      cursor: pointer;
      flex-shrink: 0;
    }
    @keyframes agyQpPulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.38; }
    }
    @keyframes agyQpSpin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `;

  // -------------------------------------------------------------------------
  // Formatting & SVG Geometry
  // -------------------------------------------------------------------------
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

  const SEMI_ARC_PATH = getArcPath(50, 40, 36, 195, -15);
  const SEMI_ARC_LEN = (210 / 360) * 2 * Math.PI * 36;
  const BADGE_RING_CIRC = 2 * Math.PI * 5.5;

  function formatCountdown(ms, fallback = 'N/A', readyWord = null) {
    if (!Number.isFinite(ms)) return fallback;
    if (ms <= 0) return readyWord || t('ready');
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

  function formatRunway(hours) {
    if (!Number.isFinite(hours) || hours <= 0) return 'Stable';
    if (hours < 1) return `~${Math.max(1, Math.round(hours * 60))}m`;
    if (hours < 24) return `~${Math.round(hours)}h`;
    const days = hours / 24;
    if (days < 7) return `~${Math.round(days)}d`;
    const weeks = Math.floor(days / 7);
    const remDays = Math.round(days - weeks * 7);
    return remDays <= 0 ? `~${weeks}w` : `~${weeks}w ${remDays}d`;
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

  function colorForPct(pct, fallback) {
    if (pct <= 10) return 'var(--qp-crit)';
    if (pct <= 25) return 'var(--qp-warn)';
    return fallback;
  }

  const EFFORT_SUFFIX_RE = /\s*\((?:low|medium|med|high|xhigh|x-high|extra\s+high|minimal|min|thinking|non-thinking|standard|max)\)\s*$/i;

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
    const exactPool = KNOWN_MODEL_POOL[trimmed] || KNOWN_MODEL_POOL[trimmed.toUpperCase()];
    if (exactPool) return exactPool;
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
      || lower.includes('neon')
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
        const rank = lower === 'neon' ? 10 : (lower === 'carbon' ? 15 : (lower === 'argon' ? 20 : (lower === 'hydrogen' ? 30 : 35)));
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
          if (!/\b(?:gemini|claude|gpt|sonnet|opus|haiku|neon|carbon|argon|hydrogen|flash|orchestrator|openai|o\d)\b/i.test(base)) continue;
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

  // -------------------------------------------------------------------------
  // Zero-Restart Direct Fetch Fallback + LocalStorage 90m Trend Aggregator
  // -------------------------------------------------------------------------
  function hashAccountKeyLight(email) {
    const norm = String(email || '').trim().toLowerCase();
    if (!norm) return '';
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let i = 0; i < norm.length; i += 1) {
      const ch = norm.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 0x01000193) >>> 0;
      h2 = Math.imul(h2 ^ ((ch << 5) | (ch >>> 3)), 0x85ebca6b) >>> 0;
    }
    return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0').slice(0, 4)}`;
  }

  function filterScopedLocalHistory(points, accountKey, hasIndependentArgonPool) {
    if (!Array.isArray(points) || points.length === 0) return [];
    return points.filter((pt) => {
      if (!pt || !pt.pools || typeof pt.pools !== 'object') return false;
      if (pt.acct) {
        return accountKey ? pt.acct === accountKey : false;
      }
      // Legacy un-keyed points: isolate 2-pool vs 3-pool shape so Pro/Ultra points never cross-contaminate
      const hasArgonEntry = pt.pools.argon !== undefined;
      if (!hasIndependentArgonPool && hasArgonEntry) return false;
      if (hasIndependentArgonPool && !hasArgonEntry) return false;
      return true;
    });
  }

  function findArgonBucketFallback(summaryGroups, bucketsById, windowType) {
    for (const [, bucket] of bucketsById.entries()) {
      if (bucket.window === windowType && /argon/i.test(String(bucket.bucketId || ''))) {
        return bucket;
      }
    }
    for (const group of Array.isArray(summaryGroups) ? summaryGroups : []) {
      if (!/argon/i.test(String(group?.displayName || ''))) continue;
      for (const bucket of Array.isArray(group.buckets) ? group.buckets : []) {
        if (bucket.window === windowType) return bucket;
      }
    }
    return null;
  }

  let cachedHostTokenHistory = { fetchedAt: 0, records: [] };

  function detectRawActiveSessionModelLabel(shadowRoot) {
    if (state.activeModelOverride) {
      if (typeof state.activeModelOverride === 'string') return state.activeModelOverride;
      if (typeof state.activeModelOverride === 'object') {
        return state.activeModelOverride.label || state.activeModelOverride.modelId || state.activeModelOverride.name || '';
      }
    }
    const qState = getHostQuotaRuntimeState();
    if (qState) {
      const cm = qState.view?.currentModel || qState.currentModel || qState.snapshot?.currentModel;
      if (cm && typeof cm === 'object') {
        const picked = cm.label || cm.title || cm.name || cm.modelId || cm.key || cm.id || '';
        if (picked) return String(picked);
      } else if (typeof cm === 'string' && cm.trim()) {
        return cm.trim();
      }
      if (qState.activeSessionModelKey) return String(qState.activeSessionModelKey);
      if (qState.currentModelKey) return String(qState.currentModelKey);
    }
    if (currentMode === 'companion' && shadowRoot) {
      const hiddenCurr = shadowRoot.getElementById('quota-current-card');
      if (hiddenCurr && hiddenCurr.textContent) {
        return hiddenCurr.textContent.trim().slice(0, 80);
      }
    }
    return '';
  }

  function classifyTrendModelFamily(rawModelText, hasIndependentArgonPool = false, knownModels = []) {
    const rawStr = String(rawModelText || '').trim();
    if (!rawStr) return null;
    const baseClean = normalizeModelLabel(rawStr).replace(/\s+standard$/i, '').trim();
    const hay = `${rawStr} ${baseClean}`.toLowerCase();

    const findKnownVersionLabel = (re, prefixWord) => {
      for (const km of Array.isArray(knownModels) ? knownModels : []) {
        const kl = normalizeModelLabel(km?.label || '');
        const m = kl.match(re);
        if (m && m[1]) return `${prefixWord} ${m[1].replace(/-/g, '.')}`;
      }
      return prefixWord;
    };

    if (hay.includes('neon') || /\bm(?:532|533|534|535|537)\b/i.test(rawStr)) {
      return { modelId: 'neon', label: 'Neon', poolId: 'gemini', color: '#22D3EE' };
    }
    if (hay.includes('carbon') || /\bm(?:427|437|667|670)\b/i.test(rawStr)) {
      return { modelId: 'carbon', label: 'Carbon', poolId: 'gemini', color: '#38BDF8' };
    }
    if (hay.includes('argon') || /\bm(?:417|418|419|668)\b/i.test(rawStr)) {
      return {
        modelId: 'argon',
        label: 'Argon',
        poolId: hasIndependentArgonPool ? 'argon' : 'gemini',
        color: '#A78BFA',
      };
    }
    if (hay.includes('hydrogen') || /\bm(?:525|526|527|528)\b/i.test(rawStr)) {
      return { modelId: 'hydrogen', label: 'Hydrogen', poolId: 'gemini', color: '#34D399' };
    }
    if (hay.includes('flash') || /\bm(?:318|319|320|47)\b/i.test(rawStr)) {
      const vm = hay.match(/(?:gemini[-\s_]+)?(\d+(?:[.-]\d+)?)[-\s_]*flash/i);
      let label = vm && vm[1] ? `${vm[1].replace(/-/g, '.')} Flash` : '';
      if (!label) {
        for (const km of Array.isArray(knownModels) ? knownModels : []) {
          const kmMatch = normalizeModelLabel(km?.label || '').match(/(\d+(?:\.\d+)?)\s+Flash/i);
          if (kmMatch) {
            label = `${kmMatch[1]} Flash`;
            break;
          }
        }
      }
      return { modelId: 'flash', label: label || 'Flash', poolId: 'gemini', color: '#2DD4BF' };
    }
    if (hay.includes('opus') || /\bm(?:26|400|401|402)\b/i.test(rawStr)) {
      const vm = hay.match(/opus[-\s_]+(\d+(?:[.-]\d+)?)/i) || hay.match(/claude[-\s_]+(\d+(?:[.-]\d+)?)[-\s_]+opus/i);
      const label = vm && vm[1]
        ? `Opus ${vm[1].replace(/-/g, '.')}`
        : findKnownVersionLabel(/Opus\s+(\d+(?:\.\d+)?)/i, 'Opus');
      return { modelId: 'claude-opus', label, poolId: 'non-google', color: '#FB923C' };
    }
    if (hay.includes('sonnet') || /\bm(?:35|403|404|405)\b/i.test(rawStr)) {
      const vm = hay.match(/sonnet[-\s_]+(\d+(?:[.-]\d+)?)/i) || hay.match(/claude[-\s_]+(\d+(?:[.-]\d+)?)[-\s_]+sonnet/i);
      const label = vm && vm[1]
        ? `Sonnet ${vm[1].replace(/-/g, '.')}`
        : findKnownVersionLabel(/Sonnet\s+(\d+(?:\.\d+)?)/i, 'Sonnet');
      return { modelId: 'claude-sonnet', label, poolId: 'non-google', color: '#FBBF24' };
    }
    if (hay.includes('haiku')) {
      const vm = hay.match(/haiku[-\s_]+(\d+(?:[.-]\d+)?)/i) || hay.match(/claude[-\s_]+(\d+(?:[.-]\d+)?)[-\s_]+haiku/i);
      const label = vm && vm[1] ? `Haiku ${vm[1].replace(/-/g, '.')}` : 'Haiku';
      return { modelId: 'claude-haiku', label, poolId: 'non-google', color: '#FCD34D' };
    }
    if (/gpt[-\s_]?oss/i.test(hay)) {
      return { modelId: 'gpt', label: 'GPT-OSS', poolId: 'non-google', color: '#F472B6' };
    }
    if (hay.includes('gpt') || hay.includes('openai') || /\bo[134](?:[-\s]|$)/i.test(hay)) {
      const shortName = shortenModelFamilyName(baseClean, 'non-google').name || 'GPT';
      return { modelId: 'gpt', label: shortName, poolId: 'non-google', color: '#F472B6' };
    }
    if (hay.includes('claude') || hay.includes('anthropic')) {
      const shortName = shortenModelFamilyName(baseClean, 'non-google').name || 'Claude';
      return { modelId: 'claude-sonnet', label: shortName, poolId: 'non-google', color: '#FBBF24' };
    }
    if (hay.includes('gemini')) {
      const shortName = shortenModelFamilyName(baseClean, 'gemini').name || 'Gemini';
      return {
        modelId: `gemini-${shortName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        label: shortName,
        poolId: 'gemini',
        color: '#40C4FF',
      };
    }
    return null;
  }

  async function collectHostRecentModelCalls(now = Date.now(), force = false) {
    const cutoff = now - 95 * 60_000;
    const upper = now + 120_000;
    const mergedById = new Map();

    const addRecord = (rec) => {
      if (!rec || typeof rec !== 'object') return;
      const rawTs = Number(rec.timestamp) || (rec.created_at ? Date.parse(rec.created_at) : NaN) || Number(rec.ts);
      if (!Number.isFinite(rawTs) || rawTs < cutoff || rawTs > upper) return;
      const modelStr = rec.modelLabel || rec.model || rec.modelKey || rec.poolKey || rec.modelExactId || '';
      if (!modelStr) return;
      const key = typeof rec.callId === 'string' && rec.callId.trim()
        ? `id:${rec.callId.trim()}`
        : `ts:${Math.round(rawTs / 1000)}:${String(modelStr).toLowerCase()}`;
      const existing = mergedById.get(key);
      if (!existing || (!existing.costUSD && Number(rec.costUSD) > 0)) {
        mergedById.set(key, {
          ts: rawTs,
          model: String(modelStr),
          costUSD: Number(rec.costUSD) || 0,
          inputTokens: Number(rec.inputTokens) || 0,
          outputTokens: Number(rec.outputTokens) || 0,
          cacheReadTokens: Number(rec.cacheReadTokens ?? rec.cacheTokens) || 0,
          calls: Math.max(1, Number(rec.calls) || 1),
        });
      }
    };

    try {
      const meterSnap = globalThis.__AGContextMeter?.snapshot?.();
      if (Array.isArray(meterSnap?.sessionCalls)) {
        for (const c of meterSnap.sessionCalls) addRecord(c);
      }
    } catch {
      // ignore host snapshot error
    }

    try {
      const api = globalThis.contextMeterAPI;
      if (api && typeof api.getTokenHistory === 'function') {
        const cacheFresh = !force && cachedHostTokenHistory.records.length > 0 && now - cachedHostTokenHistory.fetchedAt < 20_000;
        if (!cacheFresh) {
          const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), 800));
          const thRes = await Promise.race([Promise.resolve(api.getTokenHistory()), timeoutPromise]).catch(() => null);
          const data = thRes?.data || thRes;
          const freshRecords = [];
          if (Array.isArray(data?.speedRecords)) {
            freshRecords.push(...data.speedRecords);
          }
          if (freshRecords.length === 0 && Array.isArray(data?.recentModelUsage)) {
            freshRecords.push(...data.recentModelUsage);
          }
          cachedHostTokenHistory = { fetchedAt: now, records: freshRecords };
        }
        for (const r of cachedHostTokenHistory.records) {
          addRecord(r);
        }
      }
    } catch {
      // fail-open
    }

    return Array.from(mergedById.values()).sort((a, b) => a.ts - b.ts);
  }

  const MIN_LOCAL_BURN_SPAN_MS = 2 * 60_000;

  function computeEffectiveLocalRateHours(scopedPoints, poolId, windowStart, latestReset, now) {
    const rateFloor = latestReset ? Math.max(windowStart, latestReset) : windowStart;
    let hasPointAtOrBeforeFloor = false;
    let earliestAfterFloor = null;

    for (const pt of Array.isArray(scopedPoints) ? scopedPoints : []) {
      if (!pt || typeof pt.ts !== 'number') continue;
      if (poolId && pt.pools && pt.pools[poolId] === undefined) continue;
      if (latestReset && pt.ts < latestReset) continue;
      if (pt.ts <= rateFloor) {
        hasPointAtOrBeforeFloor = true;
      } else if (earliestAfterFloor === null || pt.ts < earliestAfterFloor) {
        earliestAfterFloor = pt.ts;
      }
    }

    const effectiveStart = hasPointAtOrBeforeFloor || earliestAfterFloor === null
      ? rateFloor
      : Math.max(rateFloor, earliestAfterFloor);
    return Math.max(now - effectiveStart, MIN_LOCAL_BURN_SPAN_MS) / 3_600_000;
  }

  function buildModelTrendAttribution({
    pools,
    buckets,
    scopedPoints = [],
    recentCalls = [],
    knownModels = [],
    activeModelHint = '',
    latestResetByPool = {},
    hasIndependentArgonPool = false,
    now = Date.now(),
  }) {
    const activePoolIds = new Set(pools.map((p) => p.id));
    const bucketMs = BUCKET_MINUTES * 60_000;
    const windowStart = now - CHART_WINDOW_MINUTES * 60_000;
    const activeHintFam = activeModelHint
      ? classifyTrendModelFamily(activeModelHint, hasIndependentArgonPool, knownModels)
      : null;

    const normalizedCalls = [];
    for (const c of Array.isArray(recentCalls) ? recentCalls : []) {
      const fam = classifyTrendModelFamily(c.model, hasIndependentArgonPool, knownModels);
      if (!fam || !activePoolIds.has(fam.poolId)) continue;
      const costUSD = Number(c.costUSD) || 0;
      const tokenWeight = ((Number(c.inputTokens) || 0) + 4 * (Number(c.outputTokens) || 0) + 0.1 * (Number(c.cacheReadTokens) || 0)) / 1e6;
      const weight = costUSD > 0 ? costUSD : Math.max(0.0002, tokenWeight || 0.001);
      normalizedCalls.push({
        ts: Number(c.ts),
        fam,
        weight,
        calls: Math.max(1, Number(c.calls) || 1),
      });
    }

    const pointModelHintsByBucket = Array.from({ length: buckets.length }, () => new Map());
    for (let i = 1; i < scopedPoints.length; i += 1) {
      const pt = scopedPoints[i];
      if (!pt || pt.ts < windowStart || !pt.activeModel) continue;
      const fam = classifyTrendModelFamily(pt.activeModel, hasIndependentArgonPool, knownModels);
      if (!fam || !activePoolIds.has(fam.poolId)) continue;
      const idx = Math.min(buckets.length - 1, Math.max(0, Math.floor((pt.ts - windowStart) / bucketMs)));
      pointModelHintsByBucket[idx].set(fam.poolId, fam);
    }

    const modelBuckets = buckets.map((b, idx) => {
      const bStart = b.startTime;
      const bEnd = b.endTime;
      const isLast = idx === buckets.length - 1;

      const inBucketByPool = new Map();
      for (const nc of normalizedCalls) {
        const inside = isLast ? (nc.ts >= bStart && nc.ts <= bEnd + 60_000) : (nc.ts >= bStart && nc.ts < bEnd);
        if (!inside) continue;
        let poolMap = inBucketByPool.get(nc.fam.poolId);
        if (!poolMap) {
          poolMap = new Map();
          inBucketByPool.set(nc.fam.poolId, poolMap);
        }
        const cur = poolMap.get(nc.fam.modelId) || { fam: nc.fam, weight: 0, calls: 0 };
        cur.weight += nc.weight;
        cur.calls += nc.calls;
        poolMap.set(nc.fam.modelId, cur);
      }

      const items = [];
      for (const pool of pools) {
        const pid = pool.id;
        const poolPp = Number(b.items?.[pid]) || 0;
        const poolMap = inBucketByPool.get(pid);

        if (poolMap && poolMap.size > 0) {
          let sumWeight = 0;
          for (const entry of poolMap.values()) sumWeight += entry.weight;
          for (const entry of poolMap.values()) {
            const sharePp = poolPp > 0.01 && sumWeight > 0 ? poolPp * (entry.weight / sumWeight) : 0;
            const activityScore = Number(Math.min(1, 0.28 + 0.16 * Math.log2(1 + entry.calls)).toFixed(3));
            items.push({
              modelId: entry.fam.modelId,
              label: entry.fam.label,
              poolId: pid,
              color: entry.fam.color,
              usagePp: Number(sharePp.toFixed(3)),
              calls: entry.calls,
              activityScore,
            });
          }
        } else if (poolPp > 0.01) {
          // 90s lookback for polling lag, then point hint / recent prior call within 15m, else pool default
          const lookbackMap = new Map();
          for (const nc of normalizedCalls) {
            if (nc.fam.poolId !== pid) continue;
            if (nc.ts >= bStart - 90_000 && nc.ts < bStart) {
              const cur = lookbackMap.get(nc.fam.modelId) || { fam: nc.fam, weight: 0 };
              cur.weight += nc.weight;
              lookbackMap.set(nc.fam.modelId, cur);
            }
          }

          if (lookbackMap.size > 0) {
            let sumW = 0;
            for (const entry of lookbackMap.values()) sumW += entry.weight;
            for (const entry of lookbackMap.values()) {
              items.push({
                modelId: entry.fam.modelId,
                label: entry.fam.label,
                poolId: pid,
                color: entry.fam.color,
                usagePp: Number((poolPp * (entry.weight / sumW)).toFixed(3)),
                calls: 0,
                activityScore: 0,
              });
            }
          } else {
            let fallbackFam = pointModelHintsByBucket[idx]?.get(pid) || null;
            if (!fallbackFam) {
              for (let k = normalizedCalls.length - 1; k >= 0; k -= 1) {
                const nc = normalizedCalls[k];
                if (nc.fam.poolId === pid && nc.ts < bEnd) {
                  fallbackFam = nc.fam;
                  break;
                }
              }
            }
            if (!fallbackFam && activeHintFam && activeHintFam.poolId === pid) {
              fallbackFam = activeHintFam;
            }
            if (fallbackFam) {
              items.push({
                modelId: fallbackFam.modelId,
                label: fallbackFam.label,
                poolId: pid,
                color: fallbackFam.color,
                usagePp: Number(poolPp.toFixed(3)),
                calls: 0,
                activityScore: 0,
              });
            } else {
              items.push({
                modelId: `${pid}-pool`,
                label: pool.shortLabel || pool.label || pid,
                poolId: pid,
                color: pool.themeColor || '#40C4FF',
                usagePp: Number(poolPp.toFixed(3)),
                calls: 0,
                activityScore: 0,
              });
            }
          }
        }
      }

      const totalPp = Number(items.reduce((s, it) => s + (Number(it.usagePp) || 0), 0).toFixed(2));
      const totalCalls = items.reduce((s, it) => s + (Number(it.calls) || 0), 0);
      return {
        startTime: bStart,
        endTime: bEnd,
        totalPp,
        totalCalls,
        items,
      };
    });

    const summaryByModel = new Map();
    for (const mb of modelBuckets) {
      for (const it of mb.items) {
        const prev = summaryByModel.get(it.modelId) || {
          modelId: it.modelId,
          label: it.label,
          poolId: it.poolId,
          color: it.color,
          totalPp: 0,
          postResetPp: 0,
          calls: 0,
        };
        const uPp = Number(it.usagePp) || 0;
        prev.totalPp += uPp;
        const latestReset = latestResetByPool[it.poolId] ?? null;
        if (!latestReset || mb.endTime > latestReset) {
          prev.postResetPp += uPp;
        }
        prev.calls += Number(it.calls) || 0;
        summaryByModel.set(it.modelId, prev);
      }
    }

    const modelSummaries = Array.from(summaryByModel.values())
      .filter((s) => s.totalPp > 0.005 || s.calls > 0)
      .map((s) => {
        const latestReset = latestResetByPool[s.poolId] ?? null;
        const elapsedHours = computeEffectiveLocalRateHours(
          scopedPoints,
          s.poolId,
          windowStart,
          latestReset,
          now,
        );
        return {
          modelId: s.modelId,
          label: s.label,
          poolId: s.poolId,
          color: s.color,
          totalPp: Number(s.totalPp.toFixed(2)),
          usageRatePp: Number((elapsedHours > 0 ? s.postResetPp / elapsedHours : 0).toFixed(2)),
          calls: s.calls,
        };
      })
      .sort((a, b) => (b.totalPp !== a.totalPp ? b.totalPp - a.totalPp : b.calls - a.calls));

    return { modelBuckets, modelSummaries };
  }

  function loadLocalHistory() {
    try {
      const raw = localStorage.getItem(LOCAL_HISTORY_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      const cutoff = Date.now() - HISTORY_RETENTION_MS;
      return arr.filter((pt) => pt && typeof pt.ts === 'number' && pt.ts >= cutoff && pt.pools);
    } catch {
      return [];
    }
  }

  function saveLocalHistory(points) {
    try {
      localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(points.slice(-600)));
    } catch {
      // Ignore quota exceeded
    }
  }

  function analyzeLocalHistory(pools, now, options = {}) {
    const persist = options?.persist !== false;
    const accountKey = typeof options?.accountKey === 'string' ? options.accountKey : '';
    const hasIndependentArgonPool = Boolean(
      options?.hasIndependentArgonPool ?? pools.some((p) => p && p.id === 'argon' && p.hasData),
    );

    const rawPoints = loadLocalHistory();
    let workingPoints = rawPoints;
    let prunedLegacy = false;

    // Purge un-keyed legacy/mock 3-pool points when running in real 2-pool mode
    if (!hasIndependentArgonPool) {
      const cleaned = rawPoints.filter((pt) => Boolean(pt?.acct) || pt?.pools?.argon === undefined);
      if (cleaned.length !== rawPoints.length) {
        workingPoints = cleaned;
        prunedLegacy = true;
      } else {
        workingPoints = [...rawPoints];
      }
    } else {
      workingPoints = [...rawPoints];
    }

    const scopedBefore = filterScopedLocalHistory(workingPoints, accountKey, hasIndependentArgonPool);
    const prev = scopedBefore.length ? scopedBefore[scopedBefore.length - 1] : null;
    const currentMap = {};
    const resets = [];
    let changed = false;

    for (const pool of pools) {
      if (!pool.hasData || !Number.isFinite(pool.rawRemaining)) continue;
      currentMap[pool.id] = pool.rawRemaining;
      const prevVal = prev?.pools?.[pool.id];
      if (prevVal === undefined) {
        changed = true;
      } else if (pool.rawRemaining > prevVal + RESET_JUMP_PP) {
        resets.push(pool.id);
        changed = true;
      } else if (Math.abs(pool.rawRemaining - prevVal) >= 0.05) {
        changed = true;
      }
    }

    const elapsed = prev ? now - prev.ts : Infinity;
    const activeModelHint = options?.activeModel || detectRawActiveSessionModelLabel(mountedShadow);
    if (Object.keys(currentMap).length > 0 && (changed || elapsed >= HISTORY_MIN_INTERVAL_MS)) {
      const nextPt = { ts: now, pools: currentMap, resets };
      if (accountKey) nextPt.acct = accountKey;
      if (activeModelHint) nextPt.activeModel = String(activeModelHint).slice(0, 80);
      workingPoints.push(nextPt);
      if (persist) {
        saveLocalHistory(workingPoints);
      }
    } else if (persist && prunedLegacy) {
      saveLocalHistory(workingPoints);
    }

    const scopedPoints = filterScopedLocalHistory(workingPoints, accountKey, hasIndependentArgonPool);

    const bucketMs = BUCKET_MINUTES * 60_000;
    const windowStart = now - CHART_WINDOW_MINUTES * 60_000;
    const buckets = Array.from({ length: CHART_BUCKETS }, (_, i) => ({
      startTime: windowStart + i * bucketMs,
      endTime: windowStart + (i + 1) * bucketMs,
      items: {},
    }));

    const latestResetByPool = {};
    for (const pt of scopedPoints) {
      if (Array.isArray(pt.resets)) {
        for (const pid of pt.resets) latestResetByPool[pid] = pt.ts;
      }
    }

    const activePoolIds = new Set(pools.map((p) => p.id));
    for (let i = 1; i < scopedPoints.length; i += 1) {
      const a = scopedPoints[i - 1];
      const b = scopedPoints[i];
      if (b.ts < windowStart) continue;
      if (b.ts - a.ts > 15 * 60_000) continue;

      const idx = Math.min(CHART_BUCKETS - 1, Math.max(0, Math.floor((b.ts - windowStart) / bucketMs)));
      for (const [pid, currVal] of Object.entries(b.pools)) {
        if (!activePoolIds.has(pid)) continue;
        if (Array.isArray(b.resets) && b.resets.includes(pid)) continue;
        const prevVal = a.pools?.[pid];
        if (prevVal === undefined) continue;
        const drop = prevVal - currVal;
        if (drop > 0.01) {
          buckets[idx].items[pid] = (buckets[idx].items[pid] || 0) + drop;
        }
      }
    }

    const predictions = {};
    for (const pool of pools) {
      if (!pool.hasData) {
        predictions[pool.id] = { usageRate: 0, runway: 'Stable' };
        continue;
      }
      const latestReset = latestResetByPool[pool.id] ?? null;
      let totalDrop = 0;
      for (const b of buckets) {
        if (latestReset && b.endTime <= latestReset) continue;
        totalDrop += b.items[pool.id] || 0;
      }
      const elapsedHours = computeEffectiveLocalRateHours(
        scopedPoints,
        pool.id,
        windowStart,
        latestReset,
        now,
      );
      const usageRate = elapsedHours > 0 ? totalDrop / elapsedHours : 0;
      let runway = 'Stable';
      if (usageRate > 0.05 && pool.remaining > 0) {
        const hoursUntilEmpty = pool.remaining / usageRate;
        const hoursUntilReset = pool.resetDate ? (pool.resetDate - now) / 3_600_000 : 5;
        if (!Number.isFinite(hoursUntilReset) || hoursUntilReset <= 0 || hoursUntilEmpty < hoursUntilReset) {
          runway = formatRunway(hoursUntilEmpty);
        }
      }
      predictions[pool.id] = {
        usageRate: Number(usageRate.toFixed(2)),
        runway,
      };
    }

    const formattedBuckets = buckets.map((b) => ({
      startTime: b.startTime,
      endTime: b.endTime,
      items: Object.entries(b.items)
        .filter(([, u]) => u > 0.01)
        .map(([poolId, u]) => {
          const cfg = FIXED_POOLS.find((p) => p.id === poolId);
          return {
            poolId,
            usage: Number(u.toFixed(2)),
            color: cfg?.themeColor || '#40C4FF',
          };
        }),
    }));

    const { modelBuckets, modelSummaries } = buildModelTrendAttribution({
      pools,
      buckets,
      scopedPoints,
      recentCalls: options?.recentCalls || [],
      knownModels: options?.knownModels || [],
      activeModelHint,
      latestResetByPool,
      hasIndependentArgonPool,
      now,
    });

    return {
      windowMinutes: CHART_WINDOW_MINUTES,
      bucketMinutes: BUCKET_MINUTES,
      hasUsage: formattedBuckets.some((b) => b.items.length > 0) || modelSummaries.length > 0,
      buckets: formattedBuckets,
      modelBuckets,
      modelSummaries,
      predictions,
    };
  }

  function parseDirectLsSnapshot(userStatusData, summaryData, opts = {}) {
    const persistHistory = opts?.persist !== false;
    const now = Date.now();
    const userStatus = userStatusData?.userStatus || {};
    const planStatus = userStatus.planStatus || {};
    const planInfo = planStatus.planInfo || {};
    const userTier = userStatus.userTier || {};

    const tierClean = cleanTierValue(userTier.name)
      || cleanTierValue(planInfo.planName)
      || cleanTierValue(planInfo.teamsTier);

    const userInfo = {
      name: userStatus.name || '',
      email: userStatus.email || '',
      tier: tierClean,
      tierId: userTier.id || '',
      planName: cleanTierValue(planInfo.planName),
    };

    let rawPromptCredits = null;
    const monthlyPrompt = toFinite(planInfo.monthlyPromptCredits);
    const availPrompt = toFinite(planStatus.availablePromptCredits ?? 0);
    if (monthlyPrompt !== null && monthlyPrompt > 0 && availPrompt !== null) {
      const avail = Math.max(0, availPrompt);
      rawPromptCredits = {
        available: avail,
        monthly: monthlyPrompt,
        remainingPercentage: clamp((avail / monthlyPrompt) * 100, 0, 100),
      };
    }

    let rawFlowCredits = null;
    const monthlyFlow = toFinite(planInfo.monthlyFlowCredits);
    const availFlow = monthlyFlow !== null ? toFinite(planStatus.availableFlowCredits ?? 0) : null;
    if (monthlyFlow !== null && monthlyFlow > 0 && availFlow !== null) {
      const avail = Math.max(0, availFlow);
      rawFlowCredits = {
        available: avail,
        monthly: monthlyFlow,
        remainingPercentage: clamp((avail / monthlyFlow) * 100, 0, 100),
      };
    }

    const userCredits = (userTier.availableCredits || []).map((c) => {
      const creditType = typeof c.creditType === 'string' && c.creditType.trim() ? c.creditType.trim() : 'GOOGLE_ONE_AI';
      const rawAmount = c.creditAmount !== undefined && c.creditAmount !== null && String(c.creditAmount).trim() !== ''
        ? String(c.creditAmount).trim()
        : null;
      const parsedAmount = rawAmount !== null ? toFinite(rawAmount) : null;
      const availableAmount = parsedAmount !== null ? Math.max(0, parsedAmount) : 0;
      const rawMin = c.minimumCreditAmountForUsage !== undefined && c.minimumCreditAmountForUsage !== null && String(c.minimumCreditAmountForUsage).trim() !== ''
        ? String(c.minimumCreditAmountForUsage).trim()
        : null;
      const parsedMin = rawMin !== null ? toFinite(rawMin) : null;
      const minUsageAmount = parsedMin !== null ? Math.max(0, parsedMin) : null;
      return {
        creditType,
        creditAmount: rawAmount,
        availableAmount,
        isOmittedAmount: rawAmount === null,
        minimumCreditAmountForUsage: rawMin,
        minUsageAmount,
        usable: availableAmount > 0 && (minUsageAmount === null || availableAmount >= minUsageAmount),
      };
    });

    const rawModels = userStatus.cascadeModelConfigData?.clientModelConfigs || [];
    const dedupedModelMap = new Map();
    for (const m of rawModels) {
      if (m.disabled || !m.quotaInfo) continue;
      const modelId = m.modelOrAlias?.model || 'unknown';
      const baseLabel = normalizeModelLabel(m.label || modelId);
      const initialPoolId = classifyPoolId(`${modelId} ${baseLabel}`) || 'non-google';
      const frac = clamp(m.quotaInfo.remainingFraction ?? 0, 0, 1);
      const parsedReset = m.quotaInfo.resetTime ? Date.parse(m.quotaInfo.resetTime) : NaN;
      const hasReset = Number.isFinite(parsedReset);
      const timeUntilReset = hasReset ? formatCountdown(parsedReset - now, 'N/A', 'Ready') : 'N/A';
      const remainingPct = frac * 100;
      const resetDate = hasReset ? parsedReset : null;
      const dedupeKey = `${initialPoolId}::${baseLabel.toLowerCase()}`;
      const existing = dedupedModelMap.get(dedupeKey);

      if (!existing) {
        dedupedModelMap.set(dedupeKey, {
          modelId,
          label: baseLabel,
          initialPoolId,
          poolId: initialPoolId,
          remainingPercentage: Number(remainingPct.toFixed(2)),
          rawRemainingPercentage: Number((frac * 100).toFixed(2)),
          resetDate,
          timeUntilReset,
        });
      } else {
        existing.remainingPercentage = Number(Math.min(existing.remainingPercentage, remainingPct).toFixed(2));
        existing.rawRemainingPercentage = Number(Math.min(existing.rawRemainingPercentage, frac * 100).toFixed(2));
        if (resetDate !== null && (existing.resetDate === null || (resetDate > now && resetDate < existing.resetDate))) {
          existing.resetDate = resetDate;
          existing.timeUntilReset = timeUntilReset;
        }
      }
    }
    const parsedModels = Array.from(dedupedModelMap.values());

    const rawGroups = summaryData?.response?.groups || summaryData?.groups || [];
    const bucketsById = new Map();
    const summaryGroups = [];
    for (const g of rawGroups) {
      const groupBuckets = [];
      for (const b of g.buckets || []) {
        if (typeof b.bucketId !== 'string') continue;
        if (b.window !== 'weekly' && b.window !== '5h') continue;
        if (b.remainingFraction === undefined && b.remainingAmount !== undefined) continue;
        const frac = clamp(b.remainingFraction ?? 0, 0, 1);
        const parsedReset = b.resetTime ? Date.parse(b.resetTime) : NaN;
        const hasReset = Number.isFinite(parsedReset);
        const timeUntilReset = hasReset ? formatCountdown(parsedReset - now, 'N/A', 'Ready') : 'N/A';
        const remainingPct = frac * 100;
        const bucketObj = {
          bucketId: b.bucketId,
          displayName: b.displayName || b.bucketId,
          window: b.window,
          remainingPercentage: Number(remainingPct.toFixed(2)),
          rawRemainingPercentage: Number((frac * 100).toFixed(2)),
          resetDate: hasReset ? parsedReset : null,
          timeUntilReset,
        };
        groupBuckets.push(bucketObj);
        bucketsById.set(b.bucketId, bucketObj);
      }
      summaryGroups.push({
        displayName: g.displayName || '',
        description: g.description || '',
        buckets: groupBuckets,
      });
    }

    const tierIdLower = String(userTier.id || '').trim().toLowerCase();
    const hasGoogleOneCredits = userCredits.some(
      (uc) => String(uc.creditType || '').toUpperCase() === 'GOOGLE_ONE_AI',
    );
    const isPoolBilledPlan = hasGoogleOneCredits
      || tierIdLower.startsWith('g1-')
      || tierIdLower === 'free-tier'
      || bucketsById.size > 0;
    const billingModel = isPoolBilledPlan ? 'pool-and-overage' : 'legacy-exa';
    const promptCredits = isPoolBilledPlan ? null : rawPromptCredits;
    const flowCredits = isPoolBilledPlan ? null : rawFlowCredits;

    const hasIndependentArgonPool = detectHasIndependentArgonPool(summaryGroups, parsedModels);
    if (!hasIndependentArgonPool) {
      for (const m of parsedModels) {
        if (m.poolId === 'argon') m.poolId = 'gemini';
      }
    }

    const activePoolConfigs = hasIndependentArgonPool
      ? FIXED_POOLS
      : FIXED_POOLS.filter((c) => c.id !== 'argon');

    const pools = activePoolConfigs.map((cfg) => {
      const poolModels = parsedModels.filter((m) => m.poolId === cfg.id);
      const minModel = poolModels.length
        ? poolModels.reduce((min, cur) => (cur.rawRemainingPercentage < min.rawRemainingPercentage ? cur : min))
        : null;

      let fiveHour = null;
      for (const bid of cfg.fiveHourBucketIds) {
        if (bucketsById.has(bid)) {
          fiveHour = bucketsById.get(bid);
          break;
        }
      }
      if (!fiveHour && cfg.id === 'argon') {
        fiveHour = findArgonBucketFallback(summaryGroups, bucketsById, '5h');
      }

      let weeklyBucket = null;
      for (const bid of cfg.weeklyBucketIds) {
        if (bucketsById.has(bid)) {
          weeklyBucket = bucketsById.get(bid);
          break;
        }
      }
      if (!weeklyBucket && cfg.id === 'argon') {
        weeklyBucket = findArgonBucketFallback(summaryGroups, bucketsById, 'weekly');
      }

      let hasData = false;
      let remaining = 0;
      let rawRemaining = null;
      let resetDate = null;
      let resetTime = 'N/A';

      if (fiveHour) {
        hasData = true;
        remaining = fiveHour.remainingPercentage;
        rawRemaining = fiveHour.rawRemainingPercentage;
        resetDate = fiveHour.resetDate;
        resetTime = fiveHour.timeUntilReset;
      } else if (minModel) {
        hasData = true;
        remaining = minModel.remainingPercentage;
        rawRemaining = minModel.rawRemainingPercentage;
        resetDate = minModel.resetDate;
        resetTime = minModel.timeUntilReset;
      } else if (weeklyBucket) {
        hasData = true;
        remaining = weeklyBucket.remainingPercentage;
        rawRemaining = weeklyBucket.rawRemainingPercentage;
        resetDate = weeklyBucket.resetDate;
        resetTime = weeklyBucket.timeUntilReset;
      }

      const fam = derivePoolFamilyInfo({ id: cfg.id }, parsedModels, summaryGroups, hasIndependentArgonPool);

      return {
        id: cfg.id,
        label: cfg.label,
        shortLabel: cfg.shortLabel,
        themeColor: cfg.themeColor,
        hasData,
        remaining,
        rawRemaining,
        resetDate,
        resetTime,
        families: fam.families,
        familySummary: fam.familySummary,
        modelLabels: fam.modelLabels,
        weekly: weeklyBucket
          ? {
              bucketId: weeklyBucket.bucketId,
              remaining: weeklyBucket.remainingPercentage,
              resetDate: weeklyBucket.resetDate,
              resetTime: weeklyBucket.timeUntilReset,
            }
          : null,
      };
    });

    const defaultOverrideModelId = String(
      userStatus.cascadeModelConfigData?.defaultOverrideModelConfig?.modelOrAlias?.model || '',
    ).trim();
    let activeModelHint = null;
    if (defaultOverrideModelId) {
      const matchedRaw = rawModels.find((m) => String(m?.modelOrAlias?.model || '').trim() === defaultOverrideModelId);
      const famSpec = classifyTrendModelFamily(
        matchedRaw?.label || defaultOverrideModelId,
        hasIndependentArgonPool,
        parsedModels,
      );
      if (famSpec) {
        activeModelHint = {
          modelId: famSpec.modelId,
          label: famSpec.label,
          poolId: famSpec.poolId,
          color: famSpec.color,
          rawModelId: defaultOverrideModelId,
          rawLabel: matchedRaw?.label ? normalizeModelLabel(matchedRaw.label) : famSpec.label,
        };
      }
    }

    const accountKey = hashAccountKeyLight(userInfo.email);
    const history = analyzeLocalHistory(pools, now, {
      persist: persistHistory,
      accountKey,
      hasIndependentArgonPool,
      recentCalls: opts?.recentCalls || [],
      knownModels: parsedModels,
      activeModel: opts?.activeModel || activeModelHint?.rawLabel || activeModelHint?.modelId || '',
    });
    for (const p of pools) {
      p.prediction = history.predictions[p.id] || { usageRate: 0, runway: 'Stable' };
    }

    return {
      ok: true,
      timestamp: now,
      poolMode: hasIndependentArgonPool ? '3-pool' : '2-pool',
      hasIndependentArgonPool,
      activeModelHint,
      connection: { source: 'same-origin-direct' },
      userInfo,
      credits: {
        billingModel,
        prompt: promptCredits,
        flow: flowCredits,
        ...(isPoolBilledPlan && (rawPromptCredits || rawFlowCredits)
          ? { legacyPrompt: rawPromptCredits, legacyFlow: rawFlowCredits }
          : {}),
        userCredits,
      },
      pools,
      summaryGroups,
      models: parsedModels,
      history,
    };
  }

  function discoverPageCsrfToken() {
    const appCfg = globalThis.__APP_CONFIG__ || globalThis.__JETSKI_CONFIG__ || null;
    if (appCfg && typeof appCfg === 'object') {
      const tok = appCfg.csrfToken || appCfg.csrf_token || appCfg.codeiumCsrfToken;
      if (typeof tok === 'string' && tok.trim()) return tok.trim();
    }
    const meta = document.querySelector?.('meta[name="csrf-token"], meta[name="x-codeium-csrf-token"]');
    if (meta?.content) return meta.content.trim();
    return '';
  }

  function discoverCandidateOrigins() {
    const origins = [];
    const pushOrigin = (u) => {
      if (!u || typeof u !== 'string') return;
      const clean = u.replace(/\/+$/, '');
      if (/^https?:\/\//i.test(clean) && !origins.includes(clean)) origins.push(clean);
    };
    if (typeof location !== 'undefined' && location?.origin && /^https?:\/\//i.test(location.origin)) {
      pushOrigin(location.origin);
    }
    const appCfg = globalThis.__APP_CONFIG__ || null;
    if (appCfg && typeof appCfg === 'object') {
      pushOrigin(appCfg.lsUrl || appCfg.serverUrl || appCfg.apiBaseUrl);
      const port = Number(appCfg.lsPort || appCfg.hubPort || appCfg.port);
      if (Number.isFinite(port) && port > 0) {
        pushOrigin(`https://127.0.0.1:${port}`);
        pushOrigin(`http://127.0.0.1:${port}`);
      }
    }
    return origins;
  }

  async function fetchDirectFromPageLs() {
    const csrfToken = discoverPageCsrfToken();
    const origins = discoverCandidateOrigins();
    if (!csrfToken || !origins.length) {
      throw new Error('Direct LS credentials unavailable in current frame');
    }

    const headers = {
      'Content-Type': 'application/json',
      'Connect-Protocol-Version': '1',
      'x-codeium-csrf-token': csrfToken,
    };

    let lastErr = null;
    for (const origin of origins) {
      try {
        const [statusRes, summaryRes, recentCalls] = await Promise.all([
          fetch(`${origin}${USER_STATUS_PATH}`, { method: 'POST', headers, body: RPC_BODY }),
          fetch(`${origin}${QUOTA_SUMMARY_PATH}`, { method: 'POST', headers, body: RPC_BODY }).catch(() => null),
          collectHostRecentModelCalls(Date.now(), false),
        ]);
        if (!statusRes.ok) {
          throw new Error(`LS HTTP ${statusRes.status}`);
        }
        const statusJson = await statusRes.json();
        if (!statusJson?.userStatus) {
          throw new Error('Missing userStatus in LS response');
        }
        const summaryJson = summaryRes && summaryRes.ok ? await summaryRes.json().catch(() => null) : null;
        return parseDirectLsSnapshot(statusJson, summaryJson, { recentCalls });
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('Unable to fetch quota from same-origin Language Server');
  }

  function adaptHostMeterQuotaFallback(hostQuota) {
    const raw = hostQuota?.data && typeof hostQuota.data === 'object' ? hostQuota.data : hostQuota;
    const snap = raw?.snapshot || raw?.view || raw;
    if (!snap || !Array.isArray(snap.pools)) return null;
    const now = Date.now();

    const syntheticGroups = snap.pools.map((p) => ({
      displayName: p.label || p.title || p.id || '',
      description: p.description || p.modelsText || '',
      buckets: (Array.isArray(p.buckets) ? p.buckets : []).map((b) => ({
        bucketId: b.bucketId || b.id || '',
        displayName: b.displayName || b.label || '',
      })),
    }));
    const hasArgon = snap.poolMode === '3-pool'
      || snap.pools.some((p) => classifyPoolId(`${p.id || ''} ${p.label || ''} ${p.title || ''}`) === 'argon')
      || detectHasIndependentArgonPool(syntheticGroups, snap.models || []);

    const activePoolConfigs = hasArgon
      ? FIXED_POOLS
      : FIXED_POOLS.filter((c) => c.id !== 'argon');

    const pools = activePoolConfigs.map((cfg) => {
      const match = snap.pools.find((p) => classifyPoolId(`${p.id || ''} ${p.label || ''} ${p.title || ''}`) === cfg.id);
      const fam = derivePoolFamilyInfo(match || { id: cfg.id }, snap.models || [], syntheticGroups, hasArgon);
      if (!match) {
        return {
          id: cfg.id,
          label: cfg.label,
          shortLabel: cfg.shortLabel,
          themeColor: cfg.themeColor,
          hasData: false,
          remaining: 0,
          rawRemaining: null,
          resetDate: null,
          resetTime: 'N/A',
          families: fam.families,
          familySummary: fam.familySummary,
          modelLabels: fam.modelLabels,
          weekly: null,
        };
      }
      const buckets = Array.isArray(match.buckets) ? match.buckets : [];
      const b5h = buckets.find((b) => b.window === '5h' || /5h/i.test(String(b.id || b.bucketId || ''))) || buckets[0] || null;
      const bWeekly = buckets.find((b) => b.window === 'weekly' || /week/i.test(String(b.id || b.bucketId || ''))) || null;
      const rawPct = toFinite(b5h?.remainingPct ?? b5h?.remainingPercentage ?? match.remainingPct ?? match.remainingPercentage);
      const frac = toFinite(b5h?.remainingFraction ?? match.remainingFraction);
      const pct = rawPct !== null ? clamp(rawPct, 0, 100) : (frac !== null ? clamp(frac * 100, 0, 100) : 0);
      const resetMs = toFinite(b5h?.resetAtMs ?? b5h?.resetDate) || (b5h?.resetTime ? Date.parse(b5h.resetTime) : NaN);
      const wPctRaw = toFinite(bWeekly?.remainingPct ?? bWeekly?.remainingPercentage);
      const wFrac = toFinite(bWeekly?.remainingFraction);
      const wPct = wPctRaw !== null ? clamp(wPctRaw, 0, 100) : (wFrac !== null ? clamp(wFrac * 100, 0, 100) : null);
      const wResetMs = toFinite(bWeekly?.resetAtMs ?? bWeekly?.resetDate) || (bWeekly?.resetTime ? Date.parse(bWeekly.resetTime) : NaN);

      return {
        id: cfg.id,
        label: cfg.label,
        shortLabel: cfg.shortLabel,
        themeColor: cfg.themeColor,
        hasData: rawPct !== null || frac !== null,
        remaining: pct,
        rawRemaining: pct,
        resetDate: Number.isFinite(resetMs) ? resetMs : null,
        resetTime: Number.isFinite(resetMs) ? formatCountdown(resetMs - now) : 'N/A',
        families: fam.families,
        familySummary: fam.familySummary,
        modelLabels: fam.modelLabels,
        weekly: wPct !== null
          ? {
              remaining: wPct,
              resetDate: Number.isFinite(wResetMs) ? wResetMs : null,
              resetTime: Number.isFinite(wResetMs) ? formatCountdown(wResetMs - now) : 'N/A',
            }
          : null,
      };
    });

    const fallbackEmail = snap.email || snap.accountEmail || '';
    let syncSessionCalls = [];
    try {
      const ms = globalThis.__AGContextMeter?.snapshot?.();
      if (Array.isArray(ms?.sessionCalls)) {
        syncSessionCalls = ms.sessionCalls.map((c) => ({
          ts: Number(c.timestamp) || (c.created_at ? Date.parse(c.created_at) : 0),
          model: c.modelLabel || c.model || c.modelKey || '',
          costUSD: Number(c.costUSD) || 0,
          inputTokens: Number(c.inputTokens) || 0,
          outputTokens: Number(c.outputTokens) || 0,
          cacheReadTokens: Number(c.cacheReadTokens ?? c.cacheTokens) || 0,
          calls: 1,
        }));
      }
    } catch {
      syncSessionCalls = [];
    }
    const history = analyzeLocalHistory(pools, now, {
      persist: true,
      accountKey: hashAccountKeyLight(fallbackEmail),
      hasIndependentArgonPool: hasArgon,
      recentCalls: syncSessionCalls,
      knownModels: snap.models || [],
    });
    for (const p of pools) {
      p.prediction = history.predictions[p.id] || { usageRate: 0, runway: 'Stable' };
    }

    return {
      ok: true,
      timestamp: now,
      poolMode: hasArgon ? '3-pool' : '2-pool',
      hasIndependentArgonPool: hasArgon,
      connection: { source: 'host-meter-fallback' },
      userInfo: {
        name: snap.userName || snap.accountName || 'Antigravity',
        email: snap.email || snap.accountEmail || '',
        tier: cleanTierValue(snap.planTier || snap.tierName || snap.tier),
        planName: '',
      },
      credits: { prompt: null, flow: null, userCredits: [] },
      pools,
      history,
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

  function normalizeIncomingSnapshot(snap) {
    if (!snap || typeof snap !== 'object') return null;
    const hasArgon = resolveSnapshotHasArgon(snap, snap.pools);
    const pools = normalizePools(snap.pools, snap, hasArgon);
    const activeIds = new Set(pools.map((p) => p.id));

    let history = snap.history;
    if (history && typeof history === 'object') {
      const cleanedBuckets = Array.isArray(history.buckets)
        ? history.buckets.map((b) => ({
            ...b,
            items: (Array.isArray(b?.items) ? b.items : []).filter((it) => !it?.poolId || activeIds.has(it.poolId)),
          }))
        : [];

      let cleanedModelBuckets = null;
      if (Array.isArray(history.modelBuckets)) {
        cleanedModelBuckets = history.modelBuckets.map((mb) => {
          const mbItems = (Array.isArray(mb?.items) ? mb.items : [])
            .map((it) => {
              if (!it) return null;
              const mappedPoolId = !hasArgon && it.poolId === 'argon' ? 'gemini' : it.poolId;
              if (mappedPoolId && !activeIds.has(mappedPoolId)) return null;
              return {
                ...it,
                poolId: mappedPoolId || 'gemini',
                label: normalizeModelLabel(it.label || it.modelId || ''),
              };
            })
            .filter(Boolean);
          const totalPp = Number(mbItems.reduce((s, it) => s + (Number(it.usagePp) || 0), 0).toFixed(2));
          const totalCalls = mbItems.reduce((s, it) => s + (Number(it.calls) || 0), 0);
          return {
            ...mb,
            totalPp,
            totalCalls,
            items: mbItems,
          };
        });
      }

      let cleanedModelSummaries = null;
      if (Array.isArray(history.modelSummaries)) {
        cleanedModelSummaries = history.modelSummaries
          .map((ms) => {
            if (!ms) return null;
            const mappedPoolId = !hasArgon && ms.poolId === 'argon' ? 'gemini' : ms.poolId;
            if (mappedPoolId && !activeIds.has(mappedPoolId)) return null;
            return {
              ...ms,
              poolId: mappedPoolId || 'gemini',
              label: normalizeModelLabel(ms.label || ms.modelId || ''),
            };
          })
          .filter((ms) => ms && ((Number(ms.totalPp) || 0) > 0.005 || (Number(ms.calls) || 0) > 0));
      }

      history = {
        ...history,
        buckets: cleanedBuckets,
        ...(cleanedModelBuckets ? { modelBuckets: cleanedModelBuckets } : {}),
        ...(cleanedModelSummaries ? { modelSummaries: cleanedModelSummaries } : {}),
        hasUsage:
          cleanedBuckets.some((b) => b.items.some((it) => (Number(it.usage) || 0) > 0.01))
          || Boolean(cleanedModelSummaries && cleanedModelSummaries.length > 0),
      };
    }

    return {
      ...snap,
      poolMode: hasArgon ? '3-pool' : '2-pool',
      hasIndependentArgonPool: hasArgon,
      pools,
      ...(history ? { history } : {}),
    };
  }

  function unwrapSnapshot(payload) {
    if (!payload || typeof payload !== 'object') return null;
    const snap = payload.snapshot && typeof payload.snapshot === 'object' ? payload.snapshot : payload;
    if (!Array.isArray(snap.pools) && !snap.userInfo) return null;
    return normalizeIncomingSnapshot({
      ...snap,
      timestamp: snap.timestamp || payload.timestamp || Date.now(),
      connection: snap.connection || payload.connection || null,
    });
  }

  // -------------------------------------------------------------------------
  // Host / System Introspection (Theme, Language, Active Model Pool, Timer)
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

  function extractExplicitThemeFromEl(el) {
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

  function resolveEffectiveTheme(shadowRoot) {
    if (state.themeMode === 'dark') return 'dark';
    if (state.themeMode === 'light') return 'light';

    const docEl = document.documentElement;
    const bodyEl = document.body;
    const meterHost = document.getElementById('ag-context-meter');

    // 1. Inline background override on html/body
    for (const el of [bodyEl, docEl]) {
      const inlineBg = el?.style?.backgroundColor || el?.style?.background || '';
      const lum = parseColorLuminance(inlineBg);
      if (lum !== null) return lum < 0.52 ? 'dark' : 'light';
    }

    // 2. Explicit theme attributes / classes on host DOM
    for (const el of [docEl, bodyEl, meterHost]) {
      const exp = extractExplicitThemeFromEl(el);
      if (exp) return exp;
    }

    // 3. Computed background luminance of host containers
    if (typeof getComputedStyle === 'function') {
      const workbench = document.querySelector?.('.monaco-workbench');
      const companionPanel = currentMode === 'companion' ? shadowRoot?.getElementById('panel-quota') : null;
      for (const el of [workbench, bodyEl, docEl, companionPanel]) {
        if (!el) continue;
        try {
          const lum = parseColorLuminance(getComputedStyle(el).backgroundColor);
          if (lum !== null) return lum < 0.52 ? 'dark' : 'light';
        } catch {
          // ignore computed style error
        }
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

  function detectPreferredLang(shadowRoot) {
    const saved = normalizeLangCode(readPref('agy_quota_lang', ''));
    if (saved) return saved;

    if (currentMode === 'companion' && shadowRoot) {
      const header = shadowRoot.querySelector('#panel-quota .panel-header-bar');
      if (header) {
        const clone = header.cloneNode(true);
        clone.querySelector?.(`#${HEADER_CTRL_ID}`)?.remove();
        const txt = clone.textContent || '';
        if (/[\u4e00-\u9fff]/.test(txt)) return 'zh';
        if (/[a-zA-Z]{4,}/.test(txt)) return 'en';
      }
    }

    if (globalThis.__AGY_CHINESE_CONFIG__?.enabled === true) {
      return 'zh';
    }

    const docLang = normalizeLangCode(document.documentElement?.lang || '');
    if (docLang) return docLang;

    const navLang = normalizeLangCode(typeof navigator !== 'undefined' ? navigator.language : '');
    if (navLang) return navLang;

    return 'zh';
  }

  function getHostQuotaRuntimeState() {
    try {
      const meter = globalThis.__AGContextMeter;
      if (meter && typeof meter.getModelQuotaStateForTest === 'function') {
        return meter.getModelQuotaStateForTest();
      }
    } catch {
      // Ignore host test getter errors
    }
    return null;
  }

  function resolveEffectiveActivePoolId(rawActivePoolId, pools) {
    if (!rawActivePoolId) return null;
    if (!Array.isArray(pools) || pools.length === 0) return rawActivePoolId;
    if (pools.some((p) => p && p.id === rawActivePoolId)) {
      return rawActivePoolId;
    }
    // In 2-pool mode (no independent 'argon' pool), Argon session models map to 'gemini'
    if (rawActivePoolId === 'argon' && pools.some((p) => p && p.id === 'gemini')) {
      return 'gemini';
    }
    return null;
  }

  function detectActivePoolId(shadowRoot, data = state.data, pools = null) {
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
      const dm = data.currentModel ?? data.activeModel;
      if (dm && typeof dm === 'object') {
        candidates.push(dm.modelId, dm.label, dm.title, dm.name, dm.key, dm.id, dm.poolId, dm.groupId);
      } else if (typeof dm === 'string') {
        candidates.push(dm);
      }
      if (data.activePoolId) candidates.push(data.activePoolId);
    }

    const qState = getHostQuotaRuntimeState();
    if (qState) {
      const cm = qState.view?.currentModel || qState.currentModel || qState.snapshot?.currentModel;
      // Check specific model identity BEFORE host poolId so Argon models highlight 'Argon' in 3-pool mode and 'Gemini' in 2-pool mode
      if (cm && typeof cm === 'object') {
        candidates.push(cm.modelId, cm.label, cm.title, cm.name, cm.key, cm.id);
      } else if (typeof cm === 'string') {
        candidates.push(cm);
      }
      candidates.push(qState.activeSessionModelKey, qState.currentModelKey);
      if (cm && typeof cm === 'object') {
        candidates.push(cm.poolId, cm.groupId);
      }
      candidates.push(qState.view?.activePoolId);
    }

    if (data?.activeModelHint && typeof data.activeModelHint === 'object') {
      const mh = data.activeModelHint;
      candidates.push(mh.rawModelId, mh.rawLabel, mh.modelId, mh.label, mh.poolId);
    }

    for (const cand of candidates) {
      const pid = classifyPoolId(cand);
      if (pid) return resolveEffectiveActivePoolId(pid, pools);
    }

    if (currentMode === 'companion') {
      const hiddenCurr = shadowRoot?.getElementById('quota-current-card');
      if (hiddenCurr && hiddenCurr.textContent) {
        const pid = classifyPoolId(hiddenCurr.textContent);
        if (pid) return resolveEffectiveActivePoolId(pid, pools);
      }
    }
    return null;
  }

  function computeHeaderTimestampText() {
    if (!state.data?.timestamp) return '--:--';
    const d = new Date(state.data.timestamp);
    const pad = (n) => String(n).padStart(2, '0');
    const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`;

    const qState = getHostQuotaRuntimeState();
    const hostNext = toFinite(qState?.nextRefreshAtMs ?? qState?.quotaState?.nextRefreshAtMs);
    const targetMs = hostNext && hostNext > Date.now() ? hostNext : state.nextPollAtMs;
    if (Number.isFinite(targetMs) && targetMs > Date.now()) {
      const sec = Math.max(1, Math.ceil((targetMs - Date.now()) / 1000));
      const nextStr = sec >= 60 ? `${Math.ceil(sec / 60)}m` : `${sec}s`;
      return `${clock}·↻${nextStr}`;
    }
    return clock;
  }

  // -------------------------------------------------------------------------
  // Update Engine Client (Preload Bridge -> Direct GitHub Fallback + Hot Swap)
  // -------------------------------------------------------------------------
  function unwrapObj(val, nestedKey) {
    if (!val || typeof val !== 'object') return null;
    if (nestedKey && val[nestedKey] && typeof val[nestedKey] === 'object') {
      return val[nestedKey];
    }
    return val;
  }

  let prefsSyncedOnce = false;

  async function syncUpdatePrefsFromBridge() {
    const bridge = globalThis.agyQuotaOverlay;
    if (!bridge || typeof bridge.getUpdatePrefs !== 'function') {
      prefsSyncedOnce = true;
      return;
    }
    try {
      const raw = await Promise.resolve(bridge.getUpdatePrefs());
      const prefs = unwrapObj(raw, 'prefs');
      if (prefs && typeof prefs.autoUpdate === 'boolean') {
        state.update.autoUpdate = prefs.autoUpdate;
        writePref('agy_quota_auto_update', prefs.autoUpdate ? '1' : '0');
        renderOverlay();
      }
    } catch {
      // fail-open
    } finally {
      prefsSyncedOnce = true;
    }
  }

  async function setAutoUpdatePref(enabled) {
    const next = Boolean(enabled);
    state.update.autoUpdate = next;
    writePref('agy_quota_auto_update', next ? '1' : '0');
    renderOverlay();

    const bridge = globalThis.agyQuotaOverlay;
    if (bridge && typeof bridge.setUpdatePrefs === 'function') {
      try {
        await Promise.resolve(bridge.setUpdatePrefs({ autoUpdate: next }));
      } catch {
        // fail-open
      }
    }

    if (next && state.update.hasUpdate && !state.update.applying) {
      triggerApplyUpdate();
    }
    return next;
  }

  async function fetchGithubUpdateDirect() {
    const repo = DEFAULT_GITHUB_REPO;
    const releaseEndpoint = `https://api.github.com/repos/${repo}/releases/latest`;
    try {
      const res = await fetch(releaseEndpoint, {
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
            source: 'github-release',
            releaseUrl: json?.html_url || `https://github.com/${repo}/releases`,
            checkedAt: Date.now(),
          };
        }
      }
    } catch {
      // fall through to raw package.json
    }

    const rawPkgUrl = `https://raw.githubusercontent.com/${repo}/main/package.json`;
    const pkgRes = await fetch(rawPkgUrl, { method: 'GET', cache: 'no-store' });
    if (!pkgRes.ok) {
      throw new Error(`HTTP ${pkgRes.status}`);
    }
    const pkgJson = await pkgRes.json();
    const latestVersion = String(pkgJson?.version || '').trim().replace(/^v/i, '');
    if (!parseSemver(latestVersion)) {
      throw new Error('Invalid remote version');
    }
    return {
      ok: true,
      currentVersion: state.update.currentVersion,
      latestVersion,
      hasUpdate: compareSemver(latestVersion, state.update.currentVersion) > 0,
      source: 'github-raw',
      releaseUrl: `https://github.com/${repo}`,
      checkedAt: Date.now(),
    };
  }

  async function triggerCheckUpdate(force = true) {
    if (state.disposed || state.update.checking || state.update.applying) return state.update;
    if (!prefsSyncedOnce) {
      await syncUpdatePrefsFromBridge();
    }
    state.update.checking = true;
    state.update.error = '';
    renderOverlay();

    try {
      let result = null;
      const bridge = globalThis.agyQuotaOverlay;
      if (bridge && typeof bridge.checkUpdate === 'function') {
        const raw = await Promise.resolve(bridge.checkUpdate({
          force: Boolean(force),
          currentVersion: state.update.currentVersion,
        }));
        result = unwrapObj(raw, 'result') || raw;
      } else {
        result = await fetchGithubUpdateDirect();
      }

      if (result && result.ok !== false) {
        if (typeof result.currentVersion === 'string' && parseSemver(result.currentVersion)) {
          state.update.currentVersion = result.currentVersion.replace(/^v/i, '');
        }
        const latest = String(result.latestVersion || '').trim().replace(/^v/i, '');
        state.update.latestVersion = latest || state.update.currentVersion;
        state.update.hasUpdate = typeof result.hasUpdate === 'boolean'
          ? result.hasUpdate
          : (latest ? compareSemver(latest, state.update.currentVersion) > 0 : false);
        state.update.checkedAt = Number(result.checkedAt) || Date.now();
        if (typeof result.releaseUrl === 'string' && result.releaseUrl) {
          state.update.releaseUrl = result.releaseUrl;
        }
      } else {
        state.update.error = String(result?.error || t('updateFailed'));
      }
    } catch (err) {
      state.update.error = err instanceof Error ? err.message : t('updateFailed');
    } finally {
      state.update.checking = false;
      renderOverlay();
      updateStandaloneBadge();
    }

    if (
      state.update.hasUpdate
      && state.update.autoUpdate
      && state.update.latestVersion
      && state.update.autoAttemptedVersion !== state.update.latestVersion
      && typeof globalThis.agyQuotaOverlay?.applyUpdate === 'function'
    ) {
      state.update.autoAttemptedVersion = state.update.latestVersion;
      await triggerApplyUpdate();
    }

    return { ...state.update };
  }

  async function triggerApplyUpdate() {
    if (state.disposed || state.update.applying) return { ok: false };
    const bridge = globalThis.agyQuotaOverlay;
    if (!bridge || typeof bridge.applyUpdate !== 'function') {
      if (state.update.releaseUrl && typeof window !== 'undefined' && typeof window.open === 'function') {
        window.open(state.update.releaseUrl, '_blank', 'noopener,noreferrer');
      }
      return { ok: false, openedReleasePage: true };
    }

    state.update.applying = true;
    state.update.error = '';
    renderOverlay();

    try {
      const raw = await Promise.resolve(bridge.applyUpdate({}));
      const res = unwrapObj(raw, 'result') || raw;
      if (!res || res.ok === false) {
        throw new Error(res?.error || 'Update failed');
      }
      const nextVer = String(res.updatedVersion || state.update.latestVersion || state.update.currentVersion).replace(/^v/i, '');
      state.update.currentVersion = nextVer;
      state.update.hasUpdate = false;
      state.update.justUpdatedTo = nextVer;

      if (typeof res.overlayUiCode === 'string' && res.overlayUiCode.trim()) {
        globalThis[UPDATED_BADGE_KEY] = nextVer;
        try {
          (0, eval)(res.overlayUiCode);
          return { ok: true, updatedVersion: nextVer, hotReloaded: true };
        } catch {
          // If CSP restricts eval, current instance remains updated in state
        }
      }
      return { ok: true, updatedVersion: nextVer, hotReloaded: false };
    } catch (err) {
      state.update.error = err instanceof Error ? err.message : String(err);
      return { ok: false, error: state.update.error };
    } finally {
      if (!state.disposed) {
        state.update.applying = false;
        renderOverlay();
        updateStandaloneBadge();
      }
    }
  }

  // -------------------------------------------------------------------------
  // Shared 4-Layer + Footer Rendering (Used identically by Mode A & Mode B)
  // -------------------------------------------------------------------------
  function normalizePools(rawPools, snap = null, forcedHasArgon = null) {
    const poolArr = Array.isArray(rawPools) ? rawPools : [];
    const byId = new Map();
    for (const p of poolArr) {
      if (p && p.id) byId.set(p.id, p);
    }

    const hasArgon = typeof forcedHasArgon === 'boolean'
      ? forcedHasArgon
      : resolveSnapshotHasArgon(snap, poolArr);
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

  function normalizeTrendBuckets(rawBuckets) {
    const src = Array.isArray(rawBuckets) ? rawBuckets.slice(-CHART_BUCKETS) : [];
    if (src.length >= CHART_BUCKETS) return src;
    const pad = Array.from({ length: CHART_BUCKETS - src.length }, () => ({ endTime: 0, items: [] }));
    return [...pad, ...src];
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
    const pct = hasData ? clamp(remaining, 0, 100) : 0;
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
    const rateText = !hasData
      ? `— ${t('rateUnit')}`
      : hasBurn
        ? `${rateVal.toFixed(1)} ${t('rateUnit')}${runwayRaw ? ` · ${runwayRaw}` : ` · ${t('stable')}`}`
        : `0.0 ${t('rateUnit')} · ${t('stable')}`;
    const rateTitle = runwayRaw ? `${t('runwayPrefix')} ${runwayRaw}` : '';

    let weeklyHtml = '';
    if (weekly) {
      const wPct = clamp(weekly.remaining, 0, 100);
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
        <div class="gauge-rate-tag" title="${esc(rateTitle)}">${esc(rateText)}</div>
        ${weeklyHtml}
      </div>
    `;
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

  function normalizeUserCreditItem(uc) {
    const creditType = formatCreditType(uc?.creditType);
    const rawAmount = uc?.creditAmount !== null && uc?.creditAmount !== undefined && String(uc.creditAmount).trim() !== ''
      ? String(uc.creditAmount).trim()
      : null;
    const explicitAvail = toFinite(uc?.availableAmount);
    const parsedRawAvail = rawAmount !== null ? toFinite(rawAmount) : null;
    const availableAmount = explicitAvail !== null
      ? Math.max(0, explicitAvail)
      : (parsedRawAvail !== null ? Math.max(0, parsedRawAvail) : 0);

    const rawMin = uc?.minimumCreditAmountForUsage !== null && uc?.minimumCreditAmountForUsage !== undefined && String(uc.minimumCreditAmountForUsage).trim() !== ''
      ? String(uc.minimumCreditAmountForUsage).trim()
      : null;
    const explicitMin = toFinite(uc?.minUsageAmount);
    const parsedRawMin = rawMin !== null ? toFinite(rawMin) : null;
    const minUsageAmount = explicitMin !== null
      ? Math.max(0, explicitMin)
      : (parsedRawMin !== null ? Math.max(0, parsedRawMin) : null);

    const isOmittedAmount = typeof uc?.isOmittedAmount === 'boolean' ? uc.isOmittedAmount : rawAmount === null;
    const usable = typeof uc?.usable === 'boolean'
      ? uc.usable
      : (availableAmount > 0 && (minUsageAmount === null || availableAmount >= minUsageAmount));

    return {
      creditType,
      availableAmount,
      isOmittedAmount,
      minUsageAmount,
      usable,
    };
  }

  function renderFooterBarHtml() {
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
        <button type="button" class="qp-update-btn primary" data-qp-action="apply-update">${esc(t('updateNow'))}</button>
      `;
    } else if (u.justUpdatedTo) {
      const okText = t('updatedOk').replace('{v}', u.justUpdatedTo);
      statusHtml = `
        <span class="qp-update-status is-ok">${esc(okText)}</span>
        <button type="button" class="qp-update-btn" data-qp-action="check-update">${esc(t('checkUpdate'))}</button>
      `;
    } else if (u.error) {
      statusHtml = `
        <span class="qp-update-status" title="${esc(u.error)}">${esc(t('updateFailed'))}</span>
        <button type="button" class="qp-update-btn" data-qp-action="check-update">${esc(t('checkUpdate'))}</button>
      `;
    } else {
      statusHtml = `
        <span class="qp-update-status">${esc(t('upToDate'))}</span>
        <button type="button" class="qp-update-btn" data-qp-action="check-update">${esc(t('checkUpdate'))}</button>
      `;
    }

    return `
      <footer class="qp-footer-bar">
        <div class="qp-footer-left">
          <span class="qp-ver-label">AGY Quota v${esc(u.currentVersion)}</span>
          <span class="qp-footer-sep">·</span>
          ${statusHtml}
        </div>
        <button type="button" class="qp-switch-wrap" role="switch" aria-checked="${u.autoUpdate ? 'true' : 'false'}" data-qp-action="toggle-autoupdate" title="${esc(t('autoUpdateTip'))}">
          <span class="qp-switch-label">${esc(t('autoUpdate'))}</span>
          <span class="qp-switch ${u.autoUpdate ? 'on' : ''}"><span class="qp-switch-thumb"></span></span>
        </button>
      </footer>
    `;
  }

  function buildHeaderCtrlInnerHtml() {
    return `
      <span id="agy-qp-updated-meta" class="qp-updated-meta">--:--</span>
      <div class="qp-seg" role="group" aria-label="Gauge style">
        <button type="button" class="qp-seg-btn" data-qp-gauge="semi-arc"></button>
        <button type="button" class="qp-seg-btn" data-qp-gauge="classic-donut"></button>
      </div>
      <div class="qp-seg" role="group" aria-label="Theme mode" id="agy-qp-theme-group">
        <button type="button" class="qp-seg-btn" data-qp-theme="auto"></button>
        <button type="button" class="qp-seg-btn" data-qp-theme="dark"></button>
        <button type="button" class="qp-seg-btn" data-qp-theme="light"></button>
      </div>
      <div class="qp-seg" role="group" aria-label="Language" id="agy-qp-lang-group">
        <button type="button" class="qp-seg-btn" data-qp-lang="zh">中</button>
        <button type="button" class="qp-seg-btn" data-qp-lang="en">EN</button>
      </div>
    `;
  }

  // -------------------------------------------------------------------------
  // Dual-Mode State & DOM Handles
  // -------------------------------------------------------------------------
  let currentMode = 'unmounted'; // 'companion' | 'standalone' | 'unmounted'
  let mountedShadow = null;
  let standaloneHost = null;
  let standaloneCheckTimer = null;
  let innerObserver = null;
  let badgeObserver = null;
  let isMutatingInternal = false;
  let boundRefreshBtn = null;
  let boundBadgeBtn = null;
  let observedMeterHost = null;

  function updateHeaderControls(shadowRoot, theme) {
    if (!shadowRoot) return;
    const headerCtrl = shadowRoot.getElementById(HEADER_CTRL_ID);
    if (!headerCtrl) return;
    headerCtrl.dataset.theme = theme;

    const metaEl = headerCtrl.querySelector('#agy-qp-updated-meta');
    if (metaEl) {
      metaEl.textContent = computeHeaderTimestampText();
      metaEl.title = t('updatedTip');
    }

    headerCtrl.querySelectorAll('[data-qp-gauge]').forEach((btn) => {
      const g = btn.getAttribute('data-qp-gauge');
      btn.textContent = g === 'classic-donut' ? t('ring') : t('arc');
      btn.classList.toggle('active', g === state.gaugeStyle);
    });

    const themeGroup = headerCtrl.querySelector('#agy-qp-theme-group');
    if (themeGroup) themeGroup.title = t('themeGroupTip');
    headerCtrl.querySelectorAll('[data-qp-theme]').forEach((btn) => {
      const m = btn.getAttribute('data-qp-theme');
      btn.textContent = m === 'dark' ? t('themeDark') : (m === 'light' ? t('themeLight') : t('themeAuto'));
      btn.classList.toggle('active', m === state.themeMode);
    });

    const langGroup = headerCtrl.querySelector('#agy-qp-lang-group');
    if (langGroup) langGroup.title = t('langGroupTip');
    headerCtrl.querySelectorAll('[data-qp-lang]').forEach((btn) => {
      const l = btn.getAttribute('data-qp-lang');
      btn.classList.toggle('active', l === state.lang);
    });
  }

  function pickRepresentativeBadgePool(pools, activePoolId) {
    if (activePoolId) {
      const active = pools.find((p) => p.id === activePoolId && p.hasData);
      if (active) return active;
    }
    const withData = pools.filter((p) => p.hasData);
    if (withData.length > 0) {
      return withData.reduce((lowest, cur) => (cur.remaining < lowest.remaining ? cur : lowest), withData[0]);
    }
    return pools[0] || { id: 'gemini', label: 'Gemini', hasData: false, remaining: 0, themeColor: '#40C4FF' };
  }

  function updateStandaloneBadge() {
    if (currentMode !== 'standalone' || !mountedShadow) return;
    const badge = mountedShadow.getElementById(STANDALONE_BADGE_ID);
    const panel = mountedShadow.getElementById(STANDALONE_PANEL_ID);
    if (!badge) return;

    const theme = state.resolvedTheme;
    badge.dataset.theme = theme;
    badge.setAttribute('aria-expanded', state.standaloneOpen ? 'true' : 'false');
    if (panel) {
      panel.dataset.theme = theme;
      panel.classList.toggle('qp-hidden', !state.standaloneOpen);
      const titleEl = mountedShadow.getElementById('agy-standalone-title');
      if (titleEl) titleEl.textContent = t('title');
      const refBtn = mountedShadow.getElementById('btn-standalone-refresh');
      if (refBtn) {
        refBtn.title = t('refresh');
        refBtn.classList.toggle('spinning', state.loading);
      }
      const closeBtn = mountedShadow.getElementById('btn-standalone-close');
      if (closeBtn) closeBtn.title = t('close');
      const dotEl = mountedShadow.getElementById('agy-standalone-dot');
      if (dotEl) {
        dotEl.className = `qp-status-dot${state.error ? ' is-error' : (!state.data ? ' is-loading' : '')}`;
      }
    }

    const pools = normalizePools(state.data?.pools, state.data);
    const activePoolId = detectActivePoolId(mountedShadow, state.data, pools);
    const rep = pickRepresentativeBadgePool(pools, activePoolId);
    const hasData = Boolean(state.data && rep.hasData);
    const pct = hasData ? clamp(rep.remaining, 0, 100) : 0;
    const pctText = hasData ? `${Math.round(pct)}%` : '--%';
    const strokeColor = !hasData
      ? 'var(--qp-fg-muted)'
      : pct <= 10
        ? 'var(--qp-crit)'
        : pct <= 25
          ? 'var(--qp-warn)'
          : 'var(--qp-ok)';
    const offset = BADGE_RING_CIRC - (pct / 100) * BADGE_RING_CIRC;

    badge.title = hasData
      ? `${t('badgeTipPrefix')} · ${rep.label}: ${formatPercent(pct)}% (5h)`
      : t('badgeTipPrefix');

    badge.innerHTML = `
      <svg class="qp-badge-ring" viewBox="0 0 16 16" aria-hidden="true">
        <circle class="qp-badge-ring-bg" cx="8" cy="8" r="5.5" />
        <circle class="qp-badge-ring-fg" cx="8" cy="8" r="5.5"
          style="stroke: ${strokeColor}; stroke-dasharray: ${BADGE_RING_CIRC.toFixed(2)}; stroke-dashoffset: ${offset.toFixed(2)};" />
      </svg>
      <span class="qp-badge-pct">${esc(pctText)}</span>
      <span class="qp-badge-win">5h</span>
      ${state.update.hasUpdate ? '<span class="qp-badge-upd-dot"></span>' : ''}
    `;
  }

  function syncThemeOnly() {
    if (state.disposed || !mountedShadow) return;
    const nextTheme = resolveEffectiveTheme(mountedShadow);
    state.resolvedTheme = nextTheme;
    const root = mountedShadow.getElementById(ROOT_EL_ID);
    if (root) root.dataset.theme = nextTheme;
    updateHeaderControls(mountedShadow, nextTheme);
    if (currentMode === 'standalone') {
      const badge = mountedShadow.getElementById(STANDALONE_BADGE_ID);
      const panel = mountedShadow.getElementById(STANDALONE_PANEL_ID);
      if (badge) badge.dataset.theme = nextTheme;
      if (panel) panel.dataset.theme = nextTheme;
    }
  }

  function renderOverlay() {
    if (state.disposed || !mountedShadow) return;
    const root = mountedShadow.getElementById(ROOT_EL_ID);
    if (!root) return;

    isMutatingInternal = true;
    try {
      state.lang = detectPreferredLang(mountedShadow);
      const theme = resolveEffectiveTheme(mountedShadow);
      state.resolvedTheme = theme;
      root.dataset.theme = theme;
      updateHeaderControls(mountedShadow, theme);
      if (currentMode === 'standalone') {
        updateStandaloneBadge();
      }

      const footerHtml = renderFooterBarHtml();

      if (!state.data) {
        if (state.error) {
          root.innerHTML = `
            <div class="qp-err-box" role="alert">
              <span>${esc(state.error)}</span>
              <button type="button" class="qp-retry-btn" data-qp-action="retry">${esc(t('retry'))}</button>
            </div>
            ${footerHtml}
          `;
        } else {
          root.innerHTML = `
            <div class="qp-skel-grid" style="--qp-cols: 2;">
              <div class="qp-skel-card"></div>
              <div class="qp-skel-card"></div>
            </div>
            <p class="qp-loading-note">${esc(t('loading'))}</p>
            ${footerHtml}
          `;
        }
        return;
      }

      const data = state.data;
      const u = data.userInfo || {};
      const tier = cleanTierValue(u.tier) || cleanTierValue(u.planName);
      const planExtra = cleanTierValue(u.planName);
      const pools = normalizePools(data.pools, data);
      const poolCols = Math.max(1, pools.length);
      const activePoolId = detectActivePoolId(mountedShadow, data, pools);
      const activePoolIds = new Set(pools.map((p) => p.id));

      // Layer 1: Compact Single-Row Account Bar
      const userHtml = `
        <section class="qp-user-bar user-card">
          <div class="qp-user-left">
            <span class="qp-status-dot"></span>
            <span class="user-name">${esc(u.name || 'Antigravity')}</span>
            ${u.email ? `<span class="user-sep">·</span><span class="user-email ${state.emailMasked ? 'masked' : ''}" data-qp-action="toggle-email" role="button" tabindex="0" title="${esc(t('emailTip'))}">${esc(u.email)}</span>` : ''}
          </div>
          <div class="tier-badges">
            ${tier ? `<span class="tier-badge">${esc(tier)}</span>` : ''}
            ${planExtra && planExtra !== tier ? `<span class="plan-badge">${esc(planExtra)}</span>` : ''}
          </div>
        </section>
      `;

      // Layer 2: Adaptive 1x2 (Ultra) / 1x3 (Pro) Equal-Width Semi-Arc Pool Cards
      const gaugesHtml = `
        <section class="gauges-grid" data-cols="${poolCols}" style="--qp-cols: ${poolCols};">
          ${pools.map((p) => renderGaugeCard(p, activePoolId)).join('')}
        </section>
      `;

      // Layer 3: Collapsible 90m 18x5m Trend (Per-Model Default | Per-Pool Toggle)
      const history = data.history || { windowMinutes: 90, hasUsage: false, buckets: [] };
      const windowMins = Number(history.windowMinutes) || 90;
      const refNow = Number(data.timestamp) || Date.now();
      const buckets = normalizeTrendBuckets(history.buckets).map((b) => ({
        ...b,
        items: (b.items || []).filter((it) => !it?.poolId || activePoolIds.has(it.poolId)),
      }));

      const isModelMode = state.trendGranularity !== 'pool';
      let colsHtml = '';
      let hasUsage = false;
      let bottomSummaryHtml = '';

      if (isModelMode) {
        const modelBuckets = normalizeModelTrendBuckets(history.modelBuckets, buckets, pools, windowMins, refNow).map((mb) => {
          const filteredItems = (mb.items || []).filter((it) => !it?.poolId || activePoolIds.has(it.poolId));
          const totalPp = Number(filteredItems.reduce((s, it) => s + (Number(it.usagePp) || 0), 0).toFixed(2));
          const totalCalls = filteredItems.reduce((s, it) => s + (Number(it.calls) || 0), 0);
          return { ...mb, totalPp, totalCalls, items: filteredItems };
        });
        const modelSummaries = Array.isArray(history.modelSummaries)
          ? history.modelSummaries.filter((ms) => ms && (!ms.poolId || activePoolIds.has(ms.poolId)))
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
            const tip = p.hasData ? `${p.label}: ${rate.toFixed(1)} ${t('rateUnit')} · ${runway}` : `${p.label}: N/A`;
            return `
              <span class="trend-chip" title="${esc(tip)}">
                <span class="dot" style="background: ${esc(p.themeColor)};"></span>
                <span class="trend-chip-text">${esc(p.shortLabel)} <strong>${esc(p.hasData ? rate.toFixed(1) : 'N/A')}</strong>${p.hasData ? ` ${esc(t('rateUnit'))} · ${esc(runway)}` : ''}</span>
              </span>
            `;
          })
          .join('');
        bottomSummaryHtml = `<div class="trend-summary trend-stats" data-cols="${poolCols}" style="--qp-cols: ${poolCols};">${chipsHtml}</div>`;
      }

      const trendCollapsed = state.collapsed.trend;
      const trendHtml = `
        <section id="agy-qp-trend" class="qp-card section-card" data-trend-granularity="${isModelMode ? 'model' : 'pool'}">
          <div class="section-header">
            <h3 class="section-title">${esc(t('trendTitle'))}</h3>
            <div class="section-header-actions">
              <div class="qp-seg qp-trend-seg" role="group" aria-label="Trend granularity" title="${esc(t('trendGranularityTip'))}">
                <button type="button" class="qp-seg-btn ${isModelMode ? 'active' : ''}" data-qp-trend-granularity="model">${esc(t('byModel'))}</button>
                <button type="button" class="qp-seg-btn ${!isModelMode ? 'active' : ''}" data-qp-trend-granularity="pool">${esc(t('byPool'))}</button>
              </div>
              <button type="button" class="collapse-btn" data-qp-collapse="trend">${esc(trendCollapsed ? t('expand') : t('collapse'))}</button>
            </div>
          </div>
          <div class="section-body ${trendCollapsed ? 'qp-hidden' : ''}">
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
        </section>
      `;

      // Layer 4: Collapsible Credits (Google One AI + Pool Billing / Legacy Prompt & Flow)
      const c = data.credits || {};
      const rawUserCredits = Array.isArray(c.userCredits) ? c.userCredits : [];
      const normalizedUserCredits = rawUserCredits.map(normalizeUserCreditItem);
      const hasAnyUsableCredit = normalizedUserCredits.some((uc) => uc.usable);
      const isPoolBilledUi =
        c.billingModel === 'pool-and-overage'
        || rawUserCredits.some((uc) => String(uc?.creditType || '').toUpperCase() === 'GOOGLE_ONE_AI')
        || /^g1-|^free-tier$/i.test(String(u.tierId || ''))
        || pools.some((p) => p && p.hasData);

      const userPills = normalizedUserCredits.length
        ? normalizedUserCredits
            .map((uc) => {
              const pillCls = uc.usable ? 'credit-pill is-usable' : 'credit-pill is-empty';
              const valStr = `${t('creditBalance')} ${formatCreditNum(uc.availableAmount)}`;
              let metaText = '';
              if (uc.minUsageAmount !== null) {
                if (uc.availableAmount === 0) {
                  metaText = t('minUsageShort').replace('{n}', formatCreditNum(uc.minUsageAmount));
                } else if (uc.usable) {
                  metaText = `${t('minUsageShort').replace('{n}', formatCreditNum(uc.minUsageAmount))} · ${t('overageReady')}`;
                } else {
                  metaText = t('belowMinUsage').replace('{n}', formatCreditNum(uc.minUsageAmount));
                }
              } else if (uc.usable) {
                metaText = t('overageReady');
              }
              const tipAttr = uc.availableAmount === 0 && uc.isOmittedAmount
                ? ` title="${esc(t('creditsZeroTip'))}"`
                : '';
              return `<span class="${pillCls}"${tipAttr}>${esc(uc.creditType)} · <strong>${esc(valStr)}</strong>${metaText ? `<span class="credit-pill-meta">(${esc(metaText)})</span>` : ''}</span>`;
            })
            .join('')
        : `<span class="credit-pill is-empty">Google One AI · <strong>${esc(tier || t('standardRule'))}</strong></span>`;

      const creditBarRow = (label, item, color) => {
        if (item && Number.isFinite(Number(item.monthly)) && Number(item.monthly) > 0) {
          const pct = clamp(item.remainingPercentage, 0, 100);
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

      const creditNoteText = normalizedUserCredits.length === 0
        ? t('creditsNoteNoList')
        : hasAnyUsableCredit
          ? t('creditsNoteReady')
          : t('creditsNoteEmpty');
      const creditBodyExtra = !isPoolBilledUi && (c.prompt || c.flow)
        ? `${creditBarRow(t('promptCredits'), c.prompt, '#40C4FF')}${creditBarRow(t('flowCredits'), c.flow, '#B388FF')}`
        : `<div class="credit-note">${esc(creditNoteText)}</div>`;

      const creditsCollapsed = state.collapsed.credits;
      const creditsHtml = `
        <section id="agy-qp-credits" class="qp-card section-card">
          <div class="section-header">
            <h3 class="section-title">${esc(t('creditsTitle'))}</h3>
            <button type="button" class="collapse-btn" data-qp-collapse="credits">${esc(creditsCollapsed ? t('expand') : t('collapse'))}</button>
          </div>
          <div class="section-body ${creditsCollapsed ? 'qp-hidden' : ''}">
            <div class="credit-pill-list">${userPills}</div>
            ${creditBodyExtra}
          </div>
        </section>
      `;

      const errInline = state.error
        ? `<div class="qp-err-box"><span>${esc(state.error)}</span><button type="button" class="qp-retry-btn" data-qp-action="retry">${esc(t('retry'))}</button></div>`
        : '';

      root.innerHTML = `${errInline}${userHtml}${gaugesHtml}${trendHtml}${creditsHtml}${footerHtml}`;
      healHostBadgeIfNeeded(mountedShadow, state.data, pools, activePoolId);
    } finally {
      isMutatingInternal = false;
    }
  }

  function healHostBadgeIfNeeded(shadowRoot, data = state.data, prePools = null, preActivePoolId = null) {
    if (currentMode !== 'companion' || !shadowRoot || !data || !Array.isArray(data.pools) || data.pools.length === 0) {
      return;
    }
    const prevMutating = isMutatingInternal;
    isMutatingInternal = true;
    try {
      const hostBanner = shadowRoot.getElementById('quota-banner');
      if (hostBanner) {
        hostBanner.style.display = 'none';
      }
      const hostBadge = shadowRoot.getElementById('badge-quota');
      if (!hostBadge) return;
      const qStateAttr = String(hostBadge.getAttribute('data-quota-state') || '').toLowerCase();
      const badgeText = String(hostBadge.textContent || '');
      const isBroken =
        qStateAttr === 'stale' ||
        qStateAttr === 'error' ||
        qStateAttr === 'unavailable' ||
        /失败|过期|重试|未知|failed|error|stale|retry/i.test(badgeText);
      if (!isBroken) return;

      const pools = Array.isArray(prePools) ? prePools : normalizePools(data.pools, data);
      const activePoolId = preActivePoolId ?? detectActivePoolId(shadowRoot, data, pools);
      const primaryPool =
        pools.find((p) => p.id === activePoolId && p.hasData) ||
        pools.find((p) => p.hasData) ||
        pools[0];
      if (!primaryPool || !Number.isFinite(Number(primaryPool.remaining))) return;

      const pctRound = Math.round(clamp(Number(primaryPool.remaining), 0, 100));
      const valEl = shadowRoot.getElementById('quota-badge-val');
      const tagEl = shadowRoot.getElementById('quota-badge-tag');
      const ringFill = shadowRoot.getElementById('quota-ring-fill');
      const cd = primaryPool.resetDate
        ? formatCountdown(primaryPool.resetDate - Date.now(), primaryPool.resetTime || '5h')
        : (primaryPool.resetTime || '5h');
      const safeCd = cd && cd !== 'N/A' ? cd : '5h';

      if (valEl) valEl.textContent = `${pctRound}%`;
      if (tagEl) tagEl.textContent = safeCd;
      if (ringFill) {
        const circ = 2 * Math.PI * 6.5;
        ringFill.setAttribute('stroke-dasharray', `${circ.toFixed(2)} ${circ.toFixed(2)}`);
        ringFill.setAttribute('stroke-dashoffset', (circ * (1 - pctRound / 100)).toFixed(2));
      }
      hostBadge.setAttribute('data-quota-state', 'ok');
      hostBadge.classList.remove('error', 'is-error', 'failed', 'stale', 'is-stale');
      hostBadge.title = `${primaryPool.label || 'Quota'} · ${pctRound}% · ${t('resetAt')}: ${safeCd}`;
    } finally {
      isMutatingInternal = prevMutating;
    }
  }

  // -------------------------------------------------------------------------
  // Data Loading Orchestrator (Preload Bridge -> Same-Origin Fetch -> Host Fallback)
  // -------------------------------------------------------------------------
  let pendingBridgeTimer = null;

  function applyNewSnapshot(snap, { cacheGlobal = true } = {}) {
    const normalized = normalizeIncomingSnapshot(snap);
    if (!normalized) return;
    state.data = normalized;
    state.error = '';
    state.nextPollAtMs = Date.now() + DIRECT_POLL_MS;
    if (cacheGlobal) {
      globalThis[SNAP_CACHE_KEY] = normalized;
    }
    renderOverlay();
  }

  async function loadQuota(force = false) {
    if (state.disposed || state.loading) return;
    if (!force && state.snapshotOverrideLocked) return;
    if (force) {
      state.snapshotOverrideLocked = false;
      state.activeModelOverride = null;
    }
    state.loading = true;
    if (currentMode === 'standalone') updateStandaloneBadge();
    try {
      const bridge = globalThis.agyQuotaOverlay;
      if (bridge && typeof bridge.getQuota === 'function') {
        const res = await bridge.getQuota({
          force: Boolean(force),
          origin: typeof location !== 'undefined' ? (location?.origin || '') : '',
          csrfToken: discoverPageCsrfToken(),
        });
        if (res?.ok && unwrapSnapshot(res)) {
          applyNewSnapshot(unwrapSnapshot(res));
          return;
        }
      }

      try {
        const directSnap = await fetchDirectFromPageLs();
        applyNewSnapshot(directSnap);
        return;
      } catch (directErr) {
        if (globalThis.contextMeterAPI && typeof globalThis.contextMeterAPI.getQuota === 'function') {
          const hostRes = await globalThis.contextMeterAPI.getQuota({ force: Boolean(force) }).catch(() => null);
          const adapted = adaptHostMeterQuotaFallback(hostRes);
          if (adapted) {
            applyNewSnapshot(adapted);
            return;
          }
        }
        const adaptedCached = adaptHostMeterQuotaFallback(getHostQuotaRuntimeState());
        if (adaptedCached) {
          applyNewSnapshot(adaptedCached);
          return;
        }
        throw directErr;
      }
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
      renderOverlay();
    } finally {
      state.loading = false;
      if (currentMode === 'standalone') updateStandaloneBadge();
    }
  }

  // -------------------------------------------------------------------------
  // Event Handlers
  // -------------------------------------------------------------------------
  const onHostRefreshClick = () => {
    if (state.disposed) return;
    if (pendingBridgeTimer) clearTimeout(pendingBridgeTimer);
    if (globalThis.agyQuotaOverlay && typeof globalThis.agyQuotaOverlay.onQuotaUpdated === 'function') {
      const prevTs = state.data?.timestamp || 0;
      pendingBridgeTimer = setTimeout(() => {
        if ((state.data?.timestamp || 0) <= prevTs) {
          loadQuota(true);
        }
      }, 450);
    } else {
      loadQuota(true);
    }
  };

  const onHostBadgeClick = () => {
    if (state.disposed) return;
    setTimeout(() => {
      renderOverlay();
      const age = Date.now() - (state.data?.timestamp || 0);
      if (!state.data || age > 45_000) {
        loadQuota(false);
      }
    }, 30);
  };

  function applyTrendGranularity(nextGranularity) {
    const norm = String(nextGranularity || '').trim().toLowerCase() === 'pool' ? 'pool' : 'model';
    if (state.trendGranularity !== norm) {
      state.trendGranularity = norm;
    }
    writePref(TREND_GRANULARITY_KEY, norm);
    renderOverlay();
    return state.trendGranularity;
  }

  function onOverlayRootClick(ev) {
    const target = ev.target?.closest?.('[data-qp-action], [data-qp-collapse], [data-qp-trend-granularity]');
    if (!target) return;

    const granularityAttr = target.getAttribute('data-qp-trend-granularity');
    if (granularityAttr) {
      applyTrendGranularity(granularityAttr);
      return;
    }

    const collapseKey = target.getAttribute('data-qp-collapse');
    if (collapseKey === 'trend' || collapseKey === 'credits') {
      state.collapsed[collapseKey] = !state.collapsed[collapseKey];
      writePref(`agy_quota_col_${collapseKey}`, state.collapsed[collapseKey] ? '1' : '0');
      renderOverlay();
      return;
    }

    const action = target.getAttribute('data-qp-action');
    if (action === 'toggle-email') {
      state.emailMasked = !state.emailMasked;
      writePref('agy_quota_mask_email', state.emailMasked ? '1' : '0');
      target.classList.toggle('masked', state.emailMasked);
    } else if (action === 'retry') {
      loadQuota(true);
    } else if (action === 'check-update') {
      triggerCheckUpdate(true);
    } else if (action === 'apply-update') {
      triggerApplyUpdate();
    } else if (action === 'toggle-autoupdate') {
      setAutoUpdatePref(!state.update.autoUpdate);
    }
  }

  function onOverlayRootKeydown(ev) {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const target = ev.target?.closest?.('[data-qp-action="toggle-email"]');
    if (!target) return;
    ev.preventDefault();
    state.emailMasked = !state.emailMasked;
    writePref('agy_quota_mask_email', state.emailMasked ? '1' : '0');
    target.classList.toggle('masked', state.emailMasked);
  }

  function applyLangSetting(nextLang) {
    if (nextLang === 'auto' || nextLang === '' || nextLang === null || nextLang === undefined) {
      removePref('agy_quota_lang');
      state.lang = detectPreferredLang(mountedShadow);
    } else {
      const norm = normalizeLangCode(nextLang) || 'zh';
      state.lang = norm;
      writePref('agy_quota_lang', norm);
    }
    renderOverlay();
    return state.lang;
  }

  function applyThemeSetting(nextMode) {
    const norm = normalizeThemeMode(nextMode);
    state.themeMode = norm;
    writePref('agy_quota_theme', norm);
    syncThemeOnly();
    return { themeMode: state.themeMode, resolvedTheme: state.resolvedTheme };
  }

  function onHeaderCtrlClick(ev) {
    const btn = ev.target?.closest?.('[data-qp-gauge], [data-qp-theme], [data-qp-lang]');
    if (!btn) return;
    ev.stopPropagation();

    if (btn.hasAttribute('data-qp-gauge')) {
      const nextGauge = btn.getAttribute('data-qp-gauge') === 'classic-donut' ? 'classic-donut' : 'semi-arc';
      if (state.gaugeStyle !== nextGauge) {
        state.gaugeStyle = nextGauge;
        writePref('agy_quota_gauge', state.gaugeStyle);
        renderOverlay();
      }
      return;
    }

    if (btn.hasAttribute('data-qp-theme')) {
      applyThemeSetting(btn.getAttribute('data-qp-theme'));
      return;
    }

    if (btn.hasAttribute('data-qp-lang')) {
      applyLangSetting(btn.getAttribute('data-qp-lang'));
    }
  }

  // -------------------------------------------------------------------------
  // Dual-Mode Mount Reconciler (Mode A Companion <-> Mode B Standalone HUD)
  // -------------------------------------------------------------------------
  function getValidCompanionTarget() {
    const host = document.getElementById('ag-context-meter');
    if (!host || !host.isConnected || host.hidden) return null;
    try {
      if (typeof getComputedStyle === 'function' && getComputedStyle(host).display === 'none') {
        return null;
      }
    } catch {
      // ignore computed style error
    }
    const shadow = host.shadowRoot;
    if (!shadow) return null;
    const panelQuota = shadow.getElementById('panel-quota');
    const viewQuota = shadow.getElementById('view-quota');
    if (!panelQuota || !viewQuota) return null;
    return { host, shadow, panelQuota, viewQuota };
  }

  function detachBoundHostListeners() {
    if (boundRefreshBtn) {
      boundRefreshBtn.removeEventListener('click', onHostRefreshClick);
      boundRefreshBtn = null;
    }
    if (boundBadgeBtn) {
      boundBadgeBtn.removeEventListener('click', onHostBadgeClick);
      boundBadgeBtn = null;
    }
    if (innerObserver) {
      innerObserver.disconnect();
      innerObserver = null;
    }
    if (badgeObserver) {
      badgeObserver.disconnect();
      badgeObserver = null;
    }
  }

  function cancelStandaloneTimer() {
    if (standaloneCheckTimer !== null) {
      clearTimeout(standaloneCheckTimer);
      standaloneCheckTimer = null;
    }
  }

  function destroyStandaloneHud() {
    cancelStandaloneTimer();
    state.standaloneOpen = false;
    if (standaloneHost) {
      try {
        standaloneHost.remove();
      } catch {
        // ignore removal error
      }
      standaloneHost = null;
    }
    try {
      document.querySelectorAll?.(`#${STANDALONE_HOST_ID}`).forEach((el) => el.remove());
    } catch {
      // ignore sweep error
    }
    if (currentMode === 'standalone') {
      mountedShadow = null;
      currentMode = 'unmounted';
    }
  }

  function computeStandaloneDockCoords() {
    let topPx = 8;
    let rightPx = 138;
    let dockType = 'fixed-fallback';

    try {
      const vw = Number(window.innerWidth) || 1280;
      const titlebar = document.querySelector?.('.monaco-workbench .part.titlebar, header.titlebar, [data-testid="titlebar"]');
      if (titlebar && typeof titlebar.getBoundingClientRect === 'function') {
        const tbRect = titlebar.getBoundingClientRect();
        if (tbRect.height >= 24 && tbRect.height <= 58 && tbRect.top >= -2 && tbRect.top <= 16) {
          topPx = clamp(Math.round(tbRect.top + (tbRect.height - 24) / 2), 4, 14);
        }
      }

      const rightClusters = document.querySelectorAll?.(
        '.monaco-workbench .part.titlebar .titlebar-right .action-toolbar-container, '
        + '.monaco-workbench .part.titlebar .titlebar-right .layout-controls-container, '
        + '.monaco-workbench .part.titlebar .window-controls-container',
      ) || [];

      let leftmostRightCluster = Infinity;
      for (const el of rightClusters) {
        if (!el || typeof el.getBoundingClientRect !== 'function') continue;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.top <= 48 && r.left > vw * 0.52) {
          if (r.left < leftmostRightCluster) {
            leftmostRightCluster = r.left;
          }
        }
      }

      if (Number.isFinite(leftmostRightCluster)) {
        rightPx = clamp(Math.round(vw - leftmostRightCluster + 8), 138, 420);
        dockType = 'topbar-aligned';
      }
    } catch {
      // fallback to top: 8px, right: 138px
    }

    return { topPx, rightPx, dockType };
  }

  function syncStandalonePosition() {
    if (!standaloneHost || !standaloneHost.isConnected) return;
    const { topPx, rightPx, dockType } = computeStandaloneDockCoords();
    standaloneHost.dataset.dock = dockType;
    standaloneHost.style.cssText = [
      'position: fixed',
      `top: ${topPx}px`,
      `right: ${rightPx}px`,
      'z-index: 2147483600',
      'display: block',
      'pointer-events: auto',
      '-webkit-app-region: no-drag',
      'app-region: no-drag',
    ].join('; ');

    if (state.standaloneOpen && mountedShadow) {
      const badge = mountedShadow.getElementById(STANDALONE_BADGE_ID);
      const panel = mountedShadow.getElementById(STANDALONE_PANEL_ID);
      if (badge && panel && typeof badge.getBoundingClientRect === 'function') {
        const vw = Number(window.innerWidth) || 1280;
        const bRect = badge.getBoundingClientRect();
        const panelWidth = Math.min(476, Math.max(280, vw - 16));
        const panelTop = Math.max(34, Math.round((bRect.bottom || (topPx + 24)) + 6));
        let panelRight = Math.max(8, Math.round(vw - (bRect.right || (vw - rightPx))));
        if (vw - panelRight - panelWidth < 8) {
          panelRight = Math.max(8, vw - panelWidth - 8);
        }
        panel.style.top = `${panelTop}px`;
        panel.style.right = `${panelRight}px`;
      }
    }
  }

  function setStandalonePanelOpen(open) {
    if (currentMode !== 'standalone' || !mountedShadow) return false;
    state.standaloneOpen = Boolean(open);
    updateStandaloneBadge();
    if (state.standaloneOpen) {
      syncStandalonePosition();
      renderOverlay();
      const age = Date.now() - (state.data?.timestamp || 0);
      if (!state.data || age > 45_000) {
        loadQuota(false);
      }
    }
    return state.standaloneOpen;
  }

  function mountCompanionMode(target) {
    const { host, shadow, panelQuota, viewQuota } = target;
    destroyStandaloneHud();

    const shadowChanged = currentMode !== 'companion' || mountedShadow !== shadow;
    if (shadowChanged) {
      detachBoundHostListeners();
      mountedShadow = shadow;
      currentMode = 'companion';
    }
    observeMeterHostAttrs(host);

    isMutatingInternal = true;
    try {
      let styleEl = shadow.getElementById(STYLE_EL_ID);
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = STYLE_EL_ID;
        styleEl.textContent = OVERLAY_CSS;
        shadow.appendChild(styleEl);
      } else if (styleEl.textContent !== OVERLAY_CSS) {
        styleEl.textContent = OVERLAY_CSS;
      }

      const refreshBtn = shadow.getElementById('btn-quota-refresh');
      const actionsContainer = panelQuota.querySelector('.panel-header-actions') || refreshBtn?.parentElement;
      if (actionsContainer) {
        let headerCtrl = shadow.getElementById(HEADER_CTRL_ID);
        if (!headerCtrl) {
          headerCtrl = document.createElement('div');
          headerCtrl.id = HEADER_CTRL_ID;
          headerCtrl.className = 'agy-qp-header-ctrl';
          headerCtrl.innerHTML = buildHeaderCtrlInnerHtml();
          headerCtrl.addEventListener('click', onHeaderCtrlClick);
        }
        if (headerCtrl.parentElement !== actionsContainer) {
          if (refreshBtn && refreshBtn.parentElement === actionsContainer) {
            actionsContainer.insertBefore(headerCtrl, refreshBtn);
          } else {
            actionsContainer.prepend(headerCtrl);
          }
        }
      }

      let rootEl = shadow.getElementById(ROOT_EL_ID);
      if (!rootEl) {
        rootEl = document.createElement('div');
        rootEl.id = ROOT_EL_ID;
        rootEl.className = 'agy-qp-scope';
        rootEl.addEventListener('click', onOverlayRootClick);
        rootEl.addEventListener('keydown', onOverlayRootKeydown);
      }
      if (rootEl.parentElement !== viewQuota) {
        const banner = shadow.getElementById('quota-banner');
        if (banner && banner.parentElement === viewQuota) {
          banner.insertAdjacentElement('afterend', rootEl);
        } else {
          viewQuota.prepend(rootEl);
        }
      }

      if (refreshBtn && boundRefreshBtn !== refreshBtn) {
        if (boundRefreshBtn) boundRefreshBtn.removeEventListener('click', onHostRefreshClick);
        boundRefreshBtn = refreshBtn;
        boundRefreshBtn.addEventListener('click', onHostRefreshClick);
      }
      const badgeBtn = shadow.getElementById('badge-quota');
      if (badgeBtn && boundBadgeBtn !== badgeBtn) {
        if (boundBadgeBtn) boundBadgeBtn.removeEventListener('click', onHostBadgeClick);
        boundBadgeBtn = badgeBtn;
        boundBadgeBtn.addEventListener('click', onHostBadgeClick);
        if (badgeObserver) badgeObserver.disconnect();
        badgeObserver = new MutationObserver(() => {
          if (isMutatingInternal || state.disposed) return;
          healHostBadgeIfNeeded(shadow, state.data);
        });
        badgeObserver.observe(badgeBtn, {
          attributes: true,
          attributeFilter: ['data-quota-state'],
          childList: true,
          subtree: true,
          characterData: true,
        });
      }

      if (!innerObserver) {
        innerObserver = new MutationObserver(() => {
          if (isMutatingInternal || state.disposed) return;
          if (!shadow.getElementById(ROOT_EL_ID) || !shadow.getElementById(HEADER_CTRL_ID)) {
            reconcileMount();
          }
        });
        innerObserver.observe(viewQuota, { childList: true });
      }
    } finally {
      isMutatingInternal = false;
    }

    if (shadowChanged || !shadow.getElementById(ROOT_EL_ID)?.childElementCount) {
      renderOverlay();
      if (!state.data && !state.loading) {
        loadQuota(false);
      }
    }
    return true;
  }

  function mountStandaloneMode() {
    if (state.disposed) return false;
    const companion = getValidCompanionTarget();
    if (companion) {
      return mountCompanionMode(companion);
    }

    cancelStandaloneTimer();
    detachBoundHostListeners();
    observeMeterHostAttrs(null);

    const mountParent = document.body || document.documentElement;
    if (!mountParent) return false;

    // Deduplicate any orphaned standalone hosts
    document.querySelectorAll?.(`#${STANDALONE_HOST_ID}`).forEach((el) => {
      if (el !== standaloneHost) el.remove();
    });

    let freshlyCreated = false;
    if (!standaloneHost || !standaloneHost.isConnected) {
      standaloneHost = document.createElement('div');
      standaloneHost.id = STANDALONE_HOST_ID;
      mountParent.appendChild(standaloneHost);
      freshlyCreated = true;
    }

    const shadow = standaloneHost.shadowRoot || standaloneHost.attachShadow({ mode: 'open' });
    mountedShadow = shadow;
    currentMode = 'standalone';

    if (freshlyCreated || !shadow.getElementById(ROOT_EL_ID)) {
      shadow.innerHTML = `
        <style id="${STYLE_EL_ID}">${OVERLAY_CSS}</style>
        <div class="qp-standalone-wrap">
          <button type="button" id="${STANDALONE_BADGE_ID}" class="qp-standalone-badge" aria-haspopup="dialog" aria-expanded="false"></button>
          <div id="${STANDALONE_PANEL_ID}" class="qp-standalone-panel qp-hidden" role="dialog" aria-label="AGY Quota">
            <div class="qp-standalone-header">
              <div class="qp-standalone-brand">
                <span id="agy-standalone-dot" class="qp-status-dot"></span>
                <span id="agy-standalone-title" class="qp-standalone-title"></span>
              </div>
              <div class="qp-standalone-actions">
                <div id="${HEADER_CTRL_ID}" class="agy-qp-header-ctrl">${buildHeaderCtrlInnerHtml()}</div>
                <button type="button" id="btn-standalone-refresh" class="qp-icon-btn" aria-label="Refresh">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M13.5 8a5.5 5.5 0 1 1-1.45-3.72"/>
                    <path d="M13.5 2.75v2.75h-2.75"/>
                  </svg>
                </button>
                <button type="button" id="btn-standalone-close" class="qp-icon-btn" aria-label="Close">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
                    <path d="M4 4l8 8M12 4l-8 8"/>
                  </svg>
                </button>
              </div>
            </div>
            <div id="${STANDALONE_BODY_ID}" class="qp-standalone-body">
              <div id="${ROOT_EL_ID}" class="agy-qp-scope"></div>
            </div>
          </div>
        </div>
      `;

      const badgeBtn = shadow.getElementById(STANDALONE_BADGE_ID);
      badgeBtn?.addEventListener('click', (ev) => {
        ev.stopPropagation();
        setStandalonePanelOpen(!state.standaloneOpen);
      });

      const headerCtrl = shadow.getElementById(HEADER_CTRL_ID);
      headerCtrl?.addEventListener('click', onHeaderCtrlClick);

      const refreshBtn = shadow.getElementById('btn-standalone-refresh');
      refreshBtn?.addEventListener('click', (ev) => {
        ev.stopPropagation();
        loadQuota(true);
      });

      const closeBtn = shadow.getElementById('btn-standalone-close');
      closeBtn?.addEventListener('click', (ev) => {
        ev.stopPropagation();
        setStandalonePanelOpen(false);
      });

      const rootEl = shadow.getElementById(ROOT_EL_ID);
      rootEl?.addEventListener('click', onOverlayRootClick);
      rootEl?.addEventListener('keydown', onOverlayRootKeydown);
    }

    syncStandalonePosition();
    renderOverlay();
    if (!state.data && !state.loading) {
      loadQuota(false);
    }
    return true;
  }

  function scheduleStandaloneFallback(delayMs = STANDALONE_DELAY_MS) {
    if (state.disposed || currentMode !== 'unmounted' || standaloneCheckTimer !== null) return;
    standaloneCheckTimer = setTimeout(() => {
      standaloneCheckTimer = null;
      if (state.disposed) return;
      reconcileMount({ immediateStandalone: true });
    }, delayMs);
  }

  function reconcileMount(opts = {}) {
    if (state.disposed) return false;
    const companion = getValidCompanionTarget();
    if (companion) {
      return mountCompanionMode(companion);
    }

    // Companion (#ag-context-meter) is NOT available
    if (currentMode === 'companion') {
      detachBoundHostListeners();
      observeMeterHostAttrs(null);
      mountedShadow = null;
      currentMode = 'unmounted';
    }

    if (currentMode === 'standalone' && standaloneHost?.isConnected && mountedShadow?.getElementById(ROOT_EL_ID)) {
      syncStandalonePosition();
      return true;
    }

    if (opts.immediateStandalone) {
      return mountStandaloneMode();
    }

    scheduleStandaloneFallback(STANDALONE_DELAY_MS);
    return false;
  }

  function resolveLiveMode() {
    if (state.disposed) return 'unmounted';
    const companion = getValidCompanionTarget();
    if (companion && currentMode === 'companion' && companion.shadow.getElementById(ROOT_EL_ID)) {
      return 'companion';
    }
    if (
      !companion
      && currentMode === 'standalone'
      && standaloneHost?.isConnected
      && standaloneHost.shadowRoot?.getElementById(STANDALONE_BADGE_ID)
    ) {
      return 'standalone';
    }
    return 'unmounted';
  }

  // -------------------------------------------------------------------------
  // Host Watchers (Setter Hook, DOM Observer, Theme Listeners, Outside Close)
  // -------------------------------------------------------------------------
  if (!globalThis[HOOK_SYM]) {
    let currentInst = globalThis.__AGContextMeter;
    const hookRecord = { onSet: null };
    try {
      const desc = Object.getOwnPropertyDescriptor(globalThis, '__AGContextMeter');
      if (!desc || desc.configurable !== false) {
        Object.defineProperty(globalThis, '__AGContextMeter', {
          configurable: true,
          enumerable: true,
          get() {
            return currentInst;
          },
          set(nextInst) {
            currentInst = nextInst;
            if (typeof hookRecord.onSet === 'function') {
              try {
                hookRecord.onSet(nextInst);
              } catch {
                // Never disrupt host Context Meter initialization
              }
            }
          },
        });
        globalThis[HOOK_SYM] = hookRecord;
      }
    } catch {
      // Fallback to DOM observer if defineProperty is restricted
    }
  }

  const hotReloadTimers = new Set();
  function scheduleFastRemount() {
    if (state.disposed) return;
    reconcileMount();
    queueMicrotask(() => reconcileMount());
    for (const delay of [16, 60]) {
      const tid = setTimeout(() => {
        hotReloadTimers.delete(tid);
        reconcileMount();
      }, delay);
      hotReloadTimers.add(tid);
    }
  }

  if (globalThis[HOOK_SYM]) {
    globalThis[HOOK_SYM].onSet = () => scheduleFastRemount();
  }

  // Theme attribute & OS color-scheme observers
  const themeAttrFilter = ['class', 'style', 'data-theme', 'data-color-mode', 'data-vscode-theme-kind'];
  const themeObserver = new MutationObserver(() => {
    if (state.disposed) return;
    if (state.themeMode === 'auto') {
      syncThemeOnly();
    }
  });
  const meterThemeObserver = new MutationObserver(() => {
    if (state.disposed) return;
    if (state.themeMode === 'auto') {
      syncThemeOnly();
    }
  });

  function observeMeterHostAttrs(hostEl) {
    if (observedMeterHost === hostEl) return;
    meterThemeObserver.disconnect();
    observedMeterHost = hostEl || null;
    if (observedMeterHost) {
      meterThemeObserver.observe(observedMeterHost, { attributes: true, attributeFilter: themeAttrFilter });
    }
  }

  let bodyObserved = false;
  function ensureHostThemeObservers() {
    if (document.documentElement) {
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: themeAttrFilter });
    }
    if (document.body && !bodyObserved) {
      bodyObserved = true;
      themeObserver.observe(document.body, { attributes: true, attributeFilter: themeAttrFilter });
    }
  }
  ensureHostThemeObservers();

  let colorSchemeMql = null;
  const onSystemColorSchemeChange = () => {
    if (!state.disposed && state.themeMode === 'auto') {
      syncThemeOnly();
    }
  };
  try {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      colorSchemeMql = window.matchMedia('(prefers-color-scheme: dark)');
      if (typeof colorSchemeMql?.addEventListener === 'function') {
        colorSchemeMql.addEventListener('change', onSystemColorSchemeChange);
      } else if (typeof colorSchemeMql?.addListener === 'function') {
        colorSchemeMql.addListener(onSystemColorSchemeChange);
      }
    }
  } catch {
    colorSchemeMql = null;
  }

  // DOM watcher for #ag-context-meter insertion, hot-reload replacement, OR removal!
  const docObserver = new MutationObserver(() => {
    if (state.disposed) return;
    if (!bodyObserved && document.body) {
      ensureHostThemeObservers();
    }
    const companion = getValidCompanionTarget();
    if (companion) {
      if (
        currentMode !== 'companion'
        || mountedShadow !== companion.shadow
        || !companion.shadow.getElementById(ROOT_EL_ID)
        || !companion.shadow.getElementById(STYLE_EL_ID)
      ) {
        reconcileMount();
      }
      return;
    }
    if (currentMode === 'companion' || (currentMode === 'standalone' && !standaloneHost?.isConnected)) {
      reconcileMount();
    }
  });

  if (document.documentElement) {
    docObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  // Global close handlers for Mode B standalone popover
  const onGlobalPointerDown = (ev) => {
    if (state.disposed || currentMode !== 'standalone' || !state.standaloneOpen || !standaloneHost) return;
    const path = typeof ev.composedPath === 'function' ? ev.composedPath() : [];
    if (!path.includes(standaloneHost) && ev.target !== standaloneHost) {
      setStandalonePanelOpen(false);
    }
  };

  const onGlobalKeydown = (ev) => {
    if (state.disposed || currentMode !== 'standalone' || !state.standaloneOpen) return;
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      setStandalonePanelOpen(false);
    }
  };

  const onWindowResize = () => {
    if (state.disposed || currentMode !== 'standalone') return;
    syncStandalonePosition();
  };

  document.addEventListener('pointerdown', onGlobalPointerDown, true);
  document.addEventListener('keydown', onGlobalKeydown, true);
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('resize', onWindowResize);
  }

  // Subscribe to Preload single-RPC bridge updates if available
  let unsubscribeBridge = null;
  if (globalThis.agyQuotaOverlay && typeof globalThis.agyQuotaOverlay.onQuotaUpdated === 'function') {
    try {
      unsubscribeBridge = globalThis.agyQuotaOverlay.onQuotaUpdated((payload) => {
        if (state.snapshotOverrideLocked) return;
        const snap = unwrapSnapshot(payload);
        if (snap) applyNewSnapshot(snap);
      });
    } catch {
      unsubscribeBridge = null;
    }
  }

  // Periodic countdown/theme tick + fallback polling when Preload bridge is absent
  const uiTickTimer = setInterval(() => {
    if (state.disposed || document.hidden) return;
    reconcileMount();
    if (mountedShadow && state.data) {
      renderOverlay();
    }
  }, UI_TICK_MS);

  const pollTimer = setInterval(() => {
    if (state.disposed || document.hidden) return;
    if (!globalThis.agyQuotaOverlay || currentMode === 'standalone') {
      loadQuota(false);
    }
  }, DIRECT_POLL_MS);

  const onVisibilityChange = () => {
    if (!document.hidden && !state.disposed) {
      reconcileMount();
      if (!globalThis.agyQuotaOverlay || currentMode === 'standalone') loadQuota(false);
      else renderOverlay();
    }
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  // Sync update prefs immediately (local IPC) & run non-blocking background version check
  syncUpdatePrefsFromBridge();
  const initUpdateTimer = setTimeout(() => {
    if (!state.disposed) {
      triggerCheckUpdate(false);
    }
  }, 1800);

  // -------------------------------------------------------------------------
  // Public Diagnostic & Automated Verification Controller
  // -------------------------------------------------------------------------
  globalThis[CTL_KEY] = {
    version: OVERLAY_VERSION,
    getMode: () => resolveLiveMode(),
    forceStandaloneCheck: () => {
      reconcileMount({ immediateStandalone: true });
      return resolveLiveMode();
    },
    setLang: (lang) => applyLangSetting(lang),
    setTheme: (mode) => applyThemeSetting(mode),
    setTrendGranularity: (mode) => applyTrendGranularity(mode),
    setAutoUpdate: (enabled) => setAutoUpdatePref(enabled),
    checkUpdate: (force = true) => triggerCheckUpdate(Boolean(force)),
    applyUpdate: () => triggerApplyUpdate(),
    openStandalonePanel: () => setStandalonePanelOpen(true),
    closeStandalonePanel: () => setStandalonePanelOpen(false),
    refresh: () => loadQuota(true),
    remount: () => reconcileMount(),
    parseDirectLsSnapshotForTest: (userStatusData, summaryData, opts = {}) =>
      parseDirectLsSnapshot(userStatusData, summaryData, { ...opts, persist: false }),
    setActiveModelForTest: (modelOrNull) => {
      state.activeModelOverride = modelOrNull ?? null;
      renderOverlay();
      const pools = state.data ? normalizePools(state.data.pools, state.data) : [];
      return detectActivePoolId(mountedShadow, state.data, pools);
    },
    setSnapshotForTest: (mockSnap, opts = {}) => {
      if (!mockSnap) {
        state.snapshotOverrideLocked = false;
        state.activeModelOverride = null;
        if (globalThis[SNAP_CACHE_KEY]) {
          applyNewSnapshot(globalThis[SNAP_CACHE_KEY], { cacheGlobal: false });
        }
        loadQuota(true);
        return null;
      }
      state.snapshotOverrideLocked = opts.lock !== false;
      if (opts.activeModel !== undefined) {
        state.activeModelOverride = opts.activeModel;
      }
      applyNewSnapshot(unwrapSnapshot(mockSnap) || mockSnap, { cacheGlobal: false });
      return state.data;
    },
    getState: () => {
      const mode = resolveLiveMode();
      const pools = state.data ? normalizePools(state.data.pools, state.data) : [];
      const activePoolId = state.data ? detectActivePoolId(mountedShadow, state.data, pools) : null;
      return {
        version: OVERLAY_VERSION,
        mode,
        mounted: mode !== 'unmounted',
        standaloneOpen: Boolean(state.standaloneOpen),
        hasBridge: Boolean(globalThis.agyQuotaOverlay),
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
        updateStatus: {
          currentVersion: state.update.currentVersion,
          latestVersion: state.update.latestVersion,
          hasUpdate: state.update.hasUpdate,
          checking: state.update.checking,
          applying: state.update.applying,
          checkedAt: state.update.checkedAt,
          error: state.update.error,
        },
        timestamp: state.data?.timestamp || null,
      };
    },
    dispose() {
      state.disposed = true;
      if (globalThis[HOOK_SYM]?.onSet) {
        globalThis[HOOK_SYM].onSet = null;
      }
      for (const tid of hotReloadTimers) clearTimeout(tid);
      hotReloadTimers.clear();
      cancelStandaloneTimer();
      clearTimeout(initUpdateTimer);
      if (pendingBridgeTimer) clearTimeout(pendingBridgeTimer);
      clearInterval(uiTickTimer);
      clearInterval(pollTimer);
      docObserver.disconnect();
      themeObserver.disconnect();
      meterThemeObserver.disconnect();
      if (colorSchemeMql) {
        try {
          if (typeof colorSchemeMql.removeEventListener === 'function') {
            colorSchemeMql.removeEventListener('change', onSystemColorSchemeChange);
          } else if (typeof colorSchemeMql.removeListener === 'function') {
            colorSchemeMql.removeListener(onSystemColorSchemeChange);
          }
        } catch {
          // ignore
        }
      }
      document.removeEventListener('visibilitychange', onVisibilityChange);
      document.removeEventListener('pointerdown', onGlobalPointerDown, true);
      document.removeEventListener('keydown', onGlobalKeydown, true);
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('resize', onWindowResize);
      }
      if (typeof unsubscribeBridge === 'function') {
        try {
          unsubscribeBridge();
        } catch {
          // Ignore unsubscribe error
        }
      }
      detachBoundHostListeners();
      if (currentMode === 'companion' && mountedShadow) {
        mountedShadow.getElementById(HEADER_CTRL_ID)?.remove();
        mountedShadow.getElementById(ROOT_EL_ID)?.remove();
        mountedShadow.getElementById(STYLE_EL_ID)?.remove();
      }
      destroyStandaloneHud();
      mountedShadow = null;
      currentMode = 'unmounted';
    },
  };

  // Normalize any pre-existing snapshot cached in globalThis before first mount
  if (state.data) {
    state.data = normalizeIncomingSnapshot(state.data);
  }

  // Initial mount & fresh data fetch
  scheduleFastRemount();
  loadQuota(true);
})();
