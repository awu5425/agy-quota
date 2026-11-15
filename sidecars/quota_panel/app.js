(() => {
  const POLL_MS = 60_000;
  const COUNTDOWN_TICK_MS = 30_000;

  const I18N = {
    zh: {
      title: 'AGY 账号额度',
      pools: '配额池',
      models: '模型',
      arc: '半弧',
      ring: '圆环',
      refresh: '刷新额度',
      loading: '正在读取 Antigravity 账号额度...',
      errorTitle: '读取失败',
      retry: '重试',
      weekly: '周额度',
      fiveHour: '5 小时窗口',
      summaryTitle: '官方配额分组',
      trendTitle: '近期消耗趋势',
      trendEmpty: '监控中 — 产生额度消耗后将在此显示柱状图与预计耗尽时间',
      modelsTitle: '模型明细',
      creditsTitle: '订阅积分 (Credits)',
      promptCredits: 'Prompt 积分',
      flowCredits: 'Flow 积分',
      locked: '当前套餐不可用',
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
      noModels: '暂无可用模型数据',
    },
    en: {
      title: 'AGY Quota',
      pools: 'Pools',
      models: 'Models',
      arc: 'Arc',
      ring: 'Ring',
      refresh: 'Refresh quota',
      loading: 'Fetching Antigravity quota...',
      errorTitle: 'Connection failed',
      retry: 'Retry',
      weekly: 'Weekly',
      fiveHour: '5h Window',
      summaryTitle: 'Official Quota Groups',
      trendTitle: 'Usage Trend',
      trendEmpty: 'Monitoring — bars and burn rate appear once quota drops',
      modelsTitle: 'Model Breakdown',
      creditsTitle: 'Credits',
      promptCredits: 'Prompt Credits',
      flowCredits: 'Flow Credits',
      locked: 'Unavailable on tier',
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
      noModels: 'No active model data',
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

  const defaultLang = navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  const state = {
    lang: readPref('agy_quota_lang', defaultLang),
    viewMode: readPref('agy_quota_view', 'pools'),
    gaugeStyle: readPref('agy_quota_gauge', 'semi-arc'),
    emailMasked: readPref('agy_quota_mask_email', '0') === '1',
    collapsed: {
      summary: readPref('agy_quota_col_summary', '0') === '1',
      trend: readPref('agy_quota_col_trend', '0') === '1',
      models: readPref('agy_quota_col_models', '0') === '1',
      credits: readPref('agy_quota_col_credits', '0') === '1',
    },
    data: null,
    loading: false,
    error: '',
  };

  const t = (key) => I18N[state.lang]?.[key] ?? I18N.en[key] ?? key;

  // -------------------------------------------------------------------------
  // Theme Sync (mirrors host CSS tokens injected by /preload.js)
  // -------------------------------------------------------------------------
  function syncScheme() {
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;color:var(--background, #f7f7f8)';
    document.documentElement.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    const nums = (c.match(/[\d.]+/g) || []).map(Number);
    if (nums.length < 3) return;
    const scale = c.startsWith('color(') ? 1 : 255;
    const [r, g, b] = nums.slice(0, 3).map((v) => v / scale);
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const theme = lum < 0.5 ? 'dark' : 'light';
    if (document.documentElement.dataset.theme !== theme) {
      document.documentElement.dataset.theme = theme;
    }
  }
  syncScheme();
  new MutationObserver(() => syncScheme()).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style'],
  });

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

  function renderGaugeCard({ label, remaining, hasData, resetDate, resetTime, color, weekly, prediction, tooltip }) {
    const pct = hasData ? Math.min(100, Math.max(0, remaining)) : 0;
    const liveCountdown = resetDate ? formatCountdown(resetDate - Date.now(), resetTime) : resetTime || 'N/A';
    const pctStr = hasData ? formatPercent(liveCountdown === t('ready') && hasData ? Math.max(pct, remaining) : pct) : 'N/A';
    const activeColor = hasData ? color : 'var(--qp-fg-muted)';

    let visualHtml = '';
    if (state.gaugeStyle === 'classic-donut') {
      const emptyColor = 'rgba(128, 128, 128, 0.16)';
      const grad = `conic-gradient(${activeColor} 0% ${pct}%, ${emptyColor} ${pct}% 100%)`;
      visualHtml = `
        <div class="gauge-visual">
          <div class="pie-ring" style="background: ${grad}"></div>
          <div class="gauge-center">
            <div class="gauge-val">${esc(pctStr)}${hasData ? '<span class="gauge-unit">%</span>' : ''}</div>
          </div>
        </div>
        <div class="gauge-label">${esc(label)}</div>
        <div class="gauge-reset-inner">↻ ${esc(liveCountdown)}</div>
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
      `;
    }

    let rateHtml = '';
    if (prediction && prediction.usageRate > 0.05) {
      const runwayText = prediction.runway && prediction.runway !== 'Stable'
        ? ` · ${t('runwayPrefix')} ${prediction.runway}`
        : '';
      rateHtml = `<div class="gauge-rate-tag">${prediction.usageRate.toFixed(1)} ${t('rateUnit')}${esc(runwayText)}</div>`;
    }

    let weeklyHtml = '';
    if (weekly) {
      const wPct = Math.min(100, Math.max(0, weekly.remaining));
      const wCountdown = weekly.resetDate ? formatCountdown(weekly.resetDate - Date.now(), weekly.resetTime) : weekly.resetTime;
      const wClock = weekly.resetDate ? formatResetClock(weekly.resetDate) : '';
      weeklyHtml = `
        <div class="weekly-box" title="${esc(wClock ? `${t('resetAt')}: ${wClock}` : '')}">
          <div class="weekly-head">
            <span>${esc(t('weekly'))}</span>
            <strong>${esc(formatPercent(wPct))}%</strong>
          </div>
          <div class="weekly-track">
            <div class="weekly-fill" style="width: ${wPct}%; background: ${activeColor};"></div>
          </div>
          <div class="weekly-reset">↻ ${esc(wCountdown)}</div>
        </div>
      `;
    }

    return `
      <div class="gauge-card style-${esc(state.gaugeStyle)}" title="${esc(tooltip || '')}">
        ${visualHtml}
        ${rateHtml}
        ${weeklyHtml}
      </div>
    `;
  }

  // -------------------------------------------------------------------------
  // Render Sections
  // -------------------------------------------------------------------------
  function renderControlsText() {
    $('title-text').textContent = t('title');
    $('seg-pools').textContent = t('pools');
    $('seg-models').textContent = t('models');
    $('seg-arc').textContent = t('arc');
    $('seg-donut').textContent = t('ring');
    $('btn-refresh').title = t('refresh');
    $('loading-text').textContent = t('loading');
    $('error-title').textContent = t('errorTitle');
    $('btn-retry').textContent = t('retry');
    $('btn-lang').textContent = state.lang === 'zh' ? 'EN' : '中文';

    document.querySelectorAll('[data-view]').forEach((el) => {
      el.classList.toggle('active', el.dataset.view === state.viewMode);
    });
    document.querySelectorAll('[data-gauge]').forEach((el) => {
      el.classList.toggle('active', el.dataset.gauge === state.gaugeStyle);
    });
  }

  function renderUserCard(data) {
    const el = $('user-card');
    const u = data.userInfo || {};
    if (!u.email && !u.name && !u.tier) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    el.innerHTML = `
      <div class="user-meta">
        <div class="user-name-row">
          <span class="user-name">${esc(u.name || 'Antigravity User')}</span>
        </div>
        ${u.email ? `<span id="user-email" class="user-email ${state.emailMasked ? 'masked' : ''}" title="${esc(t('emailTip'))}">${esc(u.email)}</span>` : ''}
      </div>
      <div class="tier-badges">
        ${u.tier ? `<span class="tier-badge">${esc(u.tier)}</span>` : ''}
        ${u.planName && u.planName !== u.tier ? `<span class="plan-badge">${esc(u.planName)}</span>` : ''}
      </div>
    `;
    const emailEl = $('user-email');
    if (emailEl) {
      emailEl.addEventListener('click', () => {
        state.emailMasked = !state.emailMasked;
        writePref('agy_quota_mask_email', state.emailMasked ? '1' : '0');
        emailEl.classList.toggle('masked', state.emailMasked);
      });
    }
  }

  function renderGauges(data) {
    const el = $('gauges-section');
    el.classList.remove('hidden');

    if (state.viewMode === 'models') {
      const models = data.models || [];
      if (!models.length) {
        el.innerHTML = `<div class="card muted-note">${esc(t('noModels'))}</div>`;
        return;
      }
      el.innerHTML = models
        .map((m) =>
          renderGaugeCard({
            label: m.label,
            remaining: m.remainingPercentage,
            hasData: true,
            resetDate: m.resetDate,
            resetTime: m.timeUntilReset,
            color: m.color,
            weekly: null,
            prediction: null,
            tooltip: `${m.label} (${m.modelId})`,
          }),
        )
        .join('');
      return;
    }

    const pools = data.pools || [];
    el.innerHTML = pools
      .map((p) =>
        renderGaugeCard({
          label: p.label,
          remaining: p.remaining,
          hasData: p.hasData,
          resetDate: p.resetDate,
          resetTime: p.resetTime,
          color: p.themeColor,
          weekly: p.weekly,
          prediction: p.prediction,
          tooltip: p.resetDate ? `${p.label} · ${t('resetAt')}: ${formatResetClock(p.resetDate)}` : p.label,
        }),
      )
      .join('');
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

  function groupAccentColor(displayName = '') {
    const lower = displayName.toLowerCase();
    if (lower.includes('argon')) return '#B388FF';
    if (lower.includes('claude') || lower.includes('gpt')) return '#FFAB40';
    return '#40C4FF';
  }

  function renderSummarySection(data) {
    const el = $('summary-section');
    const groups = data.summaryGroups || [];
    if (!groups.length) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    const isCollapsed = state.collapsed.summary;

    const groupsHtml = groups
      .map((g) => {
        const accent = groupAccentColor(g.displayName);
        const bucketsHtml = (g.buckets || [])
          .map((b) => {
            const pct = Math.min(100, Math.max(0, b.remainingPercentage));
            const countdown = b.resetDate ? formatCountdown(b.resetDate - Date.now(), b.timeUntilReset) : b.timeUntilReset;
            const clock = b.resetDate ? formatResetClock(b.resetDate) : '';
            const winLabel = b.window === 'weekly' ? t('weekly') : t('fiveHour');
            return `
              <div class="bucket-row">
                <div class="bucket-meta">
                  <span class="bucket-label">${esc(winLabel)}</span>
                  <span class="bucket-values">
                    <strong>${esc(formatPercent(pct))}%</strong>
                    <span class="bucket-reset">↻ ${esc(countdown)}${clock ? ` (${esc(clock)})` : ''}</span>
                  </span>
                </div>
                <div class="bar-track">
                  <div class="bar-fill" style="width: ${pct}%; background: ${colorForPct(pct, accent)};"></div>
                </div>
              </div>
            `;
          })
          .join('');

        return `
          <div class="summary-group">
            <div class="summary-group-head">
              <span class="summary-group-name">${esc(g.displayName)}</span>
            </div>
            ${g.description ? `<div class="summary-group-desc">${esc(g.description)}</div>` : ''}
            ${bucketsHtml}
          </div>
        `;
      })
      .join('');

    el.innerHTML = `
      <div class="section-header">
        <h2 class="section-title">${esc(t('summaryTitle'))}</h2>
        <button id="btn-col-summary" type="button" class="collapse-btn">${esc(isCollapsed ? t('expand') : t('collapse'))}</button>
      </div>
      <div id="body-summary" class="section-body ${isCollapsed ? 'hidden' : ''}">
        ${groupsHtml}
      </div>
    `;
    bindCollapse('summary', 'btn-col-summary', 'body-summary');
  }

  function renderTrendSection(data) {
    const el = $('trend-section');
    const history = data.history;
    if (!history) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    const isCollapsed = state.collapsed.trend;

    const buckets = history.buckets || [];
    const totals = buckets.map((b) => (b.items || []).reduce((acc, it) => acc + it.usage, 0));
    const maxTotal = Math.max(1, ...totals);

    const barsHtml = history.hasUsage
      ? `
        <div class="trend-bars">
          ${buckets
            .map((b, idx) => {
              const total = totals[idx];
              const segs = (b.items || [])
                .map((it) => {
                  const hPct = (it.usage / maxTotal) * 100;
                  return `<div class="trend-seg" style="height: ${hPct.toFixed(1)}%; background: ${esc(it.color)};" title="${esc(it.poolId)}: -${it.usage.toFixed(1)}pp"></div>`;
                })
                .join('');
              return `<div class="trend-col" title="${total > 0 ? `-${total.toFixed(1)}pp` : '0pp'}">${segs}</div>`;
            })
            .join('')}
        </div>
        <div class="trend-axis">
          <span>-${esc(history.windowMinutes)}m</span>
          <span>${esc(t('windowLabel').replace('{n}', String(history.windowMinutes)))}</span>
          <span>0m</span>
        </div>
      `
      : `<div class="muted-note">${esc(t('trendEmpty'))}</div>`;

    const chipsHtml = (data.pools || [])
      .filter((p) => p.hasData)
      .map((p) => {
        const rate = p.prediction?.usageRate ?? 0;
        const runway = p.prediction?.runway && p.prediction.runway !== 'Stable' ? p.prediction.runway : t('stable');
        return `
          <span class="trend-chip">
            <span class="dot" style="background: ${esc(p.themeColor)};"></span>
            <span>${esc(p.shortLabel)}</span>
            <strong>${rate.toFixed(1)} ${esc(t('rateUnit'))}</strong>
            <span class="muted-note">· ${esc(runway)}</span>
          </span>
        `;
      })
      .join('');

    el.innerHTML = `
      <div class="section-header">
        <h2 class="section-title">${esc(t('trendTitle'))}</h2>
        <button id="btn-col-trend" type="button" class="collapse-btn">${esc(isCollapsed ? t('expand') : t('collapse'))}</button>
      </div>
      <div id="body-trend" class="section-body ${isCollapsed ? 'hidden' : ''}">
        ${barsHtml}
        <div class="trend-stats">${chipsHtml}</div>
      </div>
    `;
    bindCollapse('trend', 'btn-col-trend', 'body-trend');
  }

  function renderModelsSection(data) {
    const el = $('models-section');
    const models = data.models || [];
    const disabled = data.disabledModels || [];
    if (!models.length && !disabled.length) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    const isCollapsed = state.collapsed.models;

    const familyOrder = ['gemini-argon', 'gemini-pro', 'gemini-flash', 'claude', 'gpt', 'other'];
    const byFamily = new Map();
    for (const m of models) {
      if (!byFamily.has(m.groupId)) byFamily.set(m.groupId, []);
      byFamily.get(m.groupId).push(m);
    }

    let html = '';
    for (const fid of familyOrder) {
      const list = byFamily.get(fid);
      if (!list || !list.length) continue;
      const first = list[0];
      html += `
        <div class="family-block">
          <div class="family-title">
            <span class="dot" style="background: ${esc(first.color)};"></span>
            <span>${esc(first.groupLabel)}</span>
          </div>
          ${list
            .map((m) => {
              const pct = Math.min(100, Math.max(0, m.remainingPercentage));
              const countdown = m.resetDate ? formatCountdown(m.resetDate - Date.now(), m.timeUntilReset) : m.timeUntilReset;
              return `
                <div class="model-row" title="${esc(m.modelId)}">
                  <span class="model-name">${esc(m.label)}</span>
                  <span class="model-stats">
                    <strong>${esc(formatPercent(pct))}%</strong>
                    <span class="model-reset">↻ ${esc(countdown)}</span>
                  </span>
                  <div class="model-bar"><div style="width: ${pct}%; background: ${esc(m.color)};"></div></div>
                </div>
              `;
            })
            .join('')}
        </div>
      `;
    }

    if (disabled.length) {
      html += `
        <div class="family-block">
          ${disabled
            .map(
              (m) => `
              <div class="model-row disabled" title="${esc(m.modelId)}">
                <span class="model-name">${esc(m.label)}</span>
                <span class="lock-tag">${esc(t('locked'))}</span>
              </div>
            `,
            )
            .join('')}
        </div>
      `;
    }

    el.innerHTML = `
      <div class="section-header">
        <h2 class="section-title">${esc(t('modelsTitle'))}</h2>
        <span class="section-sub">${models.length}</span>
        <button id="btn-col-models" type="button" class="collapse-btn">${esc(isCollapsed ? t('expand') : t('collapse'))}</button>
      </div>
      <div id="body-models" class="section-body ${isCollapsed ? 'hidden' : ''}">
        ${html}
      </div>
    `;
    bindCollapse('models', 'btn-col-models', 'body-models');
  }

  function formatCreditType(rawType) {
    return String(rawType || '')
      .split('_')
      .filter(Boolean)
      .map((w) => (w.toLowerCase() === 'ai' ? 'AI' : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
      .join(' ');
  }

  function renderCreditsSection(data) {
    const el = $('credits-section');
    const c = data.credits || {};
    const hasRows = Boolean(c.prompt || c.flow || (c.userCredits && c.userCredits.length));
    if (!hasRows) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    const isCollapsed = state.collapsed.credits;

    const userPills = (c.userCredits || [])
      .map((uc) => {
        const label = formatCreditType(uc.creditType);
        const detail = uc.creditAmount !== null
          ? formatCreditNum(uc.creditAmount)
          : uc.minimumCreditAmountForUsage !== null
            ? `${t('minUsage')}: ${uc.minimumCreditAmountForUsage}`
            : 'Active';
        return `<span class="credit-pill">${esc(label)} · <strong>${esc(detail)}</strong></span>`;
      })
      .join('');

    const barRow = (label, item, color) => {
      if (!item) return '';
      const pct = Math.min(100, Math.max(0, item.remainingPercentage));
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
    };

    el.innerHTML = `
      <div class="section-header">
        <h2 class="section-title">${esc(t('creditsTitle'))}</h2>
        <button id="btn-col-credits" type="button" class="collapse-btn">${esc(isCollapsed ? t('expand') : t('collapse'))}</button>
      </div>
      <div id="body-credits" class="section-body ${isCollapsed ? 'hidden' : ''}">
        ${userPills ? `<div class="credit-pill-list">${userPills}</div>` : ''}
        ${barRow(t('promptCredits'), c.prompt, '#40C4FF')}
        ${barRow(t('flowCredits'), c.flow, '#B388FF')}
      </div>
    `;
    bindCollapse('credits', 'btn-col-credits', 'body-credits');
  }

  function renderAll() {
    renderControlsText();
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
    renderSummarySection(state.data);
    renderTrendSection(state.data);
    renderModelsSection(state.data);
    renderCreditsSection(state.data);
  }

  // -------------------------------------------------------------------------
  // Data Fetching & Event Wiring
  // -------------------------------------------------------------------------
  async function loadQuota(force = false) {
    if (state.loading) return;
    state.loading = true;
    $('btn-refresh').classList.add('spinning');
    if (!state.data) {
      $('status-dot').className = 'status-dot connecting';
    }

    try {
      const f = window.sidecar?.fetch ? window.sidecar.fetch.bind(window.sidecar) : fetch;
      const url = force ? '/api/quota?force=1' : '/api/quota';
      const res = await f(url, { method: 'GET' });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      state.data = json;
      state.error = '';
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
    } finally {
      state.loading = false;
      $('btn-refresh').classList.remove('spinning');
      renderAll();
    }
  }

  $('btn-refresh').addEventListener('click', () => loadQuota(true));
  $('btn-retry').addEventListener('click', () => loadQuota(true));

  $('btn-lang').addEventListener('click', () => {
    state.lang = state.lang === 'zh' ? 'en' : 'zh';
    writePref('agy_quota_lang', state.lang);
    renderAll();
  });

  document.querySelectorAll('[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.viewMode = btn.dataset.view;
      writePref('agy_quota_view', state.viewMode);
      renderAll();
    });
  });

  document.querySelectorAll('[data-gauge]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.gaugeStyle = btn.dataset.gauge;
      writePref('agy_quota_gauge', state.gaugeStyle);
      renderAll();
    });
  });

  renderControlsText();
  loadQuota(false);

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
