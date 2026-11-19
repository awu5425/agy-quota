# 架构说明 (Architecture — v1.3.4)

本文档说明 **AGY Quota (`agy-quota` v1.3.4)** 的共享核心引擎、双模自适应右上角挂载架构（Standalone Top-Right HUD & Zero-Copy Companion Overlay）、自包含 Agent Skill（`/agy-quota`）双布局与自举机制、原生右侧栏可选共存机制、中英双语与宿主主题跟随系统、GitHub 在线热升级链路，以及 L0~L4 五级连接发现链。

---

## 1. 整体架构与桌面双 UI + Skill + CLI/Web 五大形态

`agy-quota` 采用 **100% 纯原创 Apache-2.0 代码** 与 **零运行时第三方依赖** 设计。所有运行形态统一复用 `src/quota-core.cjs`，并将时序历史与偏好配置收敛至单一共享目录 `~/.gemini/antigravity/agy-quota/`（含 `quota_history.json`、`last_ls_conn.json`、`settings.json` 与 `backups/`）：

1. **右上角半环看板模式（`cli.mjs --top-right` / `--meter-overlay`）**
   - **零前置依赖双模自适应**：
     - **Mode A — Context Meter 伴生模式（`companion`）**：当页面存在 `#ag-context-meter` 时，不修改上游 `dist/meter-*.js`、`dist/utils.js` 或 `live-runtime/*`，直接在 `#ag-context-meter.shadowRoot` 内接管 `#panel-quota` 为 `476px` 四层 `1×2 / 1×3` 自适应半环看板，并通过 Preload 拦截实现全机单次 RPC 零重复轮询。
     - **Mode B — 独立右上角模式（`standalone`）**：在未安装 `antigravity-context-viewer` 的干净客户端上，冷启动确认无 `#ag-context-meter` 后自动创建开放式 Shadow DOM 宿主 `<div id="agy-quota-standalone-hud">`，优先停靠宿主顶栏操作区或固定于右上角安全坐标（`right >= 120px`，避开窗口最小化/最大化/关闭三键且保留 `-webkit-app-region: no-drag`），渲染 SVG 进度环胶囊徽章与可展开 `476px` 四层半环弹窗；一旦后续检测到 `#ag-context-meter` 挂载，`<300ms` 内自动销毁独立 HUD 无感切回 `companion` 模式，彻底杜绝双图标冲突。
   - 默认自动卸载原生右侧栏以避免常驻双进程；若显式传入 `--keep-sidecar`，则同时保留/同步原生右侧栏插件实现双端共存。
2. **原生右侧栏面板模式（`install.mjs` / `cli.mjs --sidecar`）**
   - 基于 Antigravity 2.x 官方 `~/.gemini/config/plugins/agy-quota` 与 `SIDECAR_UI_ENTRYPOINT_AUX_PANE` 机制，**零 `app.asar` 改动**，完整包含 `package.json`、`src/quota-core.cjs`、`skills/agy-quota/*` 与 `sidecars/quota_panel/*` 自包含运行时。
3. **自包含 Agent Skill 模式（`/agy-quota` / `cli.mjs --skill` / `npx skills add`）**
   - 同时在仓库根目录（`SKILL.md` + `scripts/agy-quota.mjs`）与标准插件子目录（`skills/agy-quota/SKILL.md` + `skills/agy-quota/scripts/agy-quota.mjs`）提供一致的技能入口，零常驻进程，按需由 Agent 调用执行：
     - `node cli.mjs --skill` 将完整离线运行时预打包进 `~/.gemini/config/skills/agy-quota/runtime/`，本地 `0ms` 离线启动；
     - 通过 `npx skills add awu5425/agy-quota` 仅提取 `skills/agy-quota/` 子目录安装时，`scripts/agy-quota.mjs` 首次执行会自动从 GitHub 下载核心文件至临时 staging 目录、逐一执行 `node --check` 语法校验后原子落盘至 `./runtime/`；
     - 直接 `git clone` 至 `~/.gemini/config/skills/agy-quota` 或通过 `plugin.json` 安装插件时，直接解析相邻 `cli.mjs` 与 `src/quota-core.cjs`。
4. **终端 CLI 与实时监控模式（`cli.mjs` / `--watch [sec]` / `--models` / `--oauth` / `--json`）**
   - 支持单次彩色终端看板、`--watch` 定时刷新、`--models` 基础模型档位归并去重，以及无桌面环境下的 Cloud Code OAuth 直连兜底。
5. **Standalone 独立网页预览（`--standalone [--host] [--port]`）**
   - 内置轻量 HTTP 服务与 `/api/quota` + `/api/update/*` 路由，在任意本地或远程浏览器渲染完整的双语、三态主题四层半环面板。

---

## 2. 双模右上角挂载、Preload 桥接与抗在线升级设计

### 2.1 冷启动持久层与零前置依赖备份（`src/overlay-installer.mjs`）

`src/overlay-installer.mjs` 使用纯 Node.js 原生二进制切片读写 Chromium Pickle ASAR 格式：

- **单文件手术刀写入**：仅更新 `app.asar` 内 `dist/preload.js` 的内容、字节长度与 4MB 分块 SHA-256 完整性（`integrity`），100% 保留其余所有条目偏移与 `unpacked: true` 属性；写入前后强制执行 `new vm.Script(code)` 语法校验，并支持 Windows 文件锁下的 `r+` 原位安全回退写入。
- **无 `AntigravityContextMeter` 干净机器兼容**：自动创建运行时目录与统一备份目录 `~/.gemini/antigravity/agy-quota/backups/`（同时兼容已有 `<ContextMeterStateDir>/backups/agy-quota-pre-overlay.asar` 原始备份，绝不用已打补丁的 ASAR 覆盖洁净备份），并随宿主版本 (`hostVersion`) 自动刷新干净基线备份，写入 `installed-version.json`。
- **100% 兼容上游在线升级**：Context Meter 在线升级执行 `cleanPreloadSource()` 时完整保留 `/* === AGY_QUOTA_OVERLAY_START === */ ... /* === AGY_QUOTA_OVERLAY_END === */` 成对标记，且 `cleanUtilsSource` + `verifyCleanStructure` 校验 100% 返回 `true`。
- **宿主客户端自动更新后 `SessionStart` 极速自愈（`src/auto-ensure-hook.cjs` + `--ensure`）**：`--top-right` 会在 `~/.gemini/config/hooks.json` 注册仅耗时 `<10ms` 的 `agy-quota-auto-heal` 守护钩子；日常会话开启时直接秒放行（输出 `{}`），一旦检测到 Antigravity 客户端静默升级覆盖了新版 `app.asar`（擦除了 `AGY_QUOTA_OVERLAY` 或已启用的伴生 `Context Meter`），自动借助 60s `ensure.lock` 防重锁静默拉起 `overlay-installer.mjs --ensure --quiet`：先自动恢复 `AntigravityContextMeter/live-runtime/cli.js`（若存在且未禁用），再原位补回 `AGY_QUOTA_OVERLAY` 钩子并通过 CDP 预注入最新配额快照后免重启热挂载。卸载（`--uninstall-overlay`）时自动清理该钩子配置。

### 2.2 全机单次 RPC 去重与自更新 Preload 桥接（`src/overlay-preload.cjs`）

在 Electron Preload（CommonJS）隔离上下文中（全链路 `try/catch` fail-open 保护）：

1. 优先读取运行时目录 `installed-version.json` 与 `quota-core.cjs` 导出的最新版本号，通过 `contextBridge.exposeInMainWorld('agyQuotaOverlay', ...)` 向主世界安全暴露：
   - 配额数据流：`version`、`getVersion()`、`getQuota(opts)`、`onQuotaUpdated(cb)`；
   - 自更新桥接：`checkUpdate(opts)`、`applyUpdate(opts)`、`getUpdatePrefs()`、`setUpdatePrefs(patch)`（热更新成功后自动刷新 Preload 内 `quota-core.cjs` 模块缓存）。
2. 当宿主安装了 Context Meter 时，轻量包装 `ipcRenderer.invoke('context-meter:get-quota', opts)`：由 `quota-core.cjs` 执行唯一一次拉取并广播给半环看板，同时将 `{ userStatus, quotaSummary }` 直通传入 `meter-collector.js` 静态分支，消除二次请求。

### 2.3 中英双语、宿主/系统主题跟随与抗热重载 UI（`src/meter-overlay-ui.js` & `sidecars/quota_panel/*`）

- **双模统一渲染与诊断接口**：Mode A（`companion`）与 Mode B（`standalone`）100% 复用同一套四层 DOM/SVG 渲染逻辑，并在 `globalThis.__AGY_QUOTA_OVERLAY_CTL__` 上暴露 `getMode()`（`'companion' | 'standalone' | 'unmounted'`）、`forceStandaloneCheck()`、`setLang(lang)`、`setTheme(mode)`、`getState()` 与 `dispose()`。
- **中英双语切换（`中 / EN`）**：持久化 `localStorage['agy_quota_lang']`，未设置时自动识别宿主文档或浏览器语言，点击即时无刷新重绘全部标签与提示文案。
- **三态主题系统（`Auto / Dark / Light`）**：默认 `Auto` 模式同时通过 `MutationObserver` 监测宿主 `:root` / `body` / `#ag-context-meter` 的主题属性与真实背景色亮度，并监听 `window.matchMedia('(prefers-color-scheme: dark)')` 实时同步 `--qp-*` CSS 变量。

---

## 3. GitHub 在线检查与原子热更新引擎（Self-Updater）

`src/quota-core.cjs` 与 `sidecars/quota_panel/main.mjs` 提供完整的端到端在线更新能力：

1. **偏好持久化（`getUpdatePrefs` / `setUpdatePrefs`）**：在 `~/.gemini/antigravity/agy-quota/settings.json` 中持久化 `{ autoUpdate: true, lastCheckedAt, skippedVersion, channel: 'stable' }`。
2. **双通道版本探测（`checkSelfUpdate` / `--check-update`）**：自动读取 `HTTPS_PROXY` / `HTTP_PROXY` 及本机 `modules.json` 代理配置；优先查询 `https://api.github.com/repos/<repo>/releases/latest`，若未发布 Release（404）或受限则无缝回退读取 `https://raw.githubusercontent.com/<repo>/main/package.json`，执行 semver 比对与 6 小时非强制检查缓存。
3. **Staging 语法守卫与原子热替换（`applySelfUpdate` / `--update`）**：
   - 将远端核心运行时文件下载至临时 staging 目录，对全部 `.js/.cjs/.mjs` 执行严格语法完整性校验（支持 `dryRun: true` 演练），任一文件异常立即中止并清理临时目录；
   - 校验通过后原子同步至已激活的 `<StateDir>/agy-quota-overlay/`（更新 `installed-version.json`）、已安装的 `~/.gemini/config/plugins/agy-quota/` 以及已安装的 `~/.gemini/config/skills/agy-quota/runtime/`（绝不覆盖开发者的 Git 源码工作区），并返回最新 `overlayUiCode` 供前端免重启即时热替换。
4. **Web / Sidecar 更新接口**：内置 `GET /api/update/status`、`POST /api/update/check`、`POST /api/update/prefs` 与 `POST /api/update/apply` 路由。

---

## 4. L0~L4 五级连接发现链与配额池模型

`src/quota-core.cjs` 内置 15 秒内存去重缓存（`force: true` 绕过），按以下优先级获取配额：

1. **L0 页面同源直连**：渲染进程 `origin + __APP_CONFIG__.csrfToken` 直连本地 Language Server Connect-RPC（`GetUserStatus` + `RetrieveUserQuotaSummary`）。
2. **L1 宿主环境变量**：读取 `ANTIGRAVITY_LS_ADDRESS` 与 `ANTIGRAVITY_CSRF_TOKEN`。
3. **L2 最近连接缓存**：读取 `~/.gemini/antigravity/agy-quota/last_ls_conn.json`（`0600`）快速探测存活端口。
4. **L3 跨平台系统进程探测**：Windows（`Win32_Process` + `netstat`）、Linux（`/proc/<pid>/environ` + `ps` + `ss`）、macOS（`ps` + `lsof`）。
5. **L4 Google Cloud Code OAuth API 兜底**：自动读取 `~/.gemini/antigravity-cli/antigravity-oauth-token`（支持 `--profile-dir` 与 `~/.gemini-profiles/*` 多账号目录及过期自动刷新），请求 `loadCodeAssist`、`retrieveUserQuotaSummary` 与 `fetchAvailableModels` 合成统一快照。

### 4.1 服务端真实配额组动态 `2 环 (Ultra)` / `3 环 (Pro)` 自适应与家族摘要

核心引擎（`src/quota-core.cjs`）与前端直连兜底解析器（`src/meter-overlay-ui.js` / `sidecars/quota_panel/app.js`）采用一致的 `hasIndependentArgonPool` 判定契约：

- **2 池模式（`poolMode === '2-pool'`，如 Google AI Ultra）**：当 `RetrieveUserQuotaSummary` 仅返回 `Gemini Models`（共用 `gemini-5h` + `gemini-weekly`）与 `Claude and GPT models`（`3p-5h` + `3p-weekly`）且 Argon 模型与常规 Gemini 模型剩余比例/重置时间一致时，自动将 `Gemini 4 Argon` / `Orchestrator (Argon)` 归入 `gemini` 池，仅输出 `['gemini', 'non-google']` 2 个真实池；UI 自动切换 `1×2` 等宽双环网格与双胶囊趋势条，并在当前会话使用 Argon 模型时智能映射高亮 `Gemini` 卡片。
- **3 池模式（`poolMode === '3-pool'`，如 Google AI Pro）**：当服务端返回独立 Argon 分组或专属桶（如 `gemini-argon-wtu-weekly` / `gemini-argon-5h`），或无 `quotaSummary` 时 Argon 模型余量/重置窗口独立于常规 Gemini 模型，自动输出 `['gemini', 'argon', 'non-google']` 3 个独立池；UI 自动切换 `1×3` 单行三环网格并在使用 Argon 模型时精准高亮 `Argon` 卡片。
- **池内模型家族微标（`pool.familySummary` / `.gauge-submodels`）**：从去重后的可用模型与配额组描述中动态提炼紧凑短名（如 `Carbon · Argon · Hydrogen · 3.8 Flash`、`Sonnet 4.6 · Opus 4.6 · GPT-OSS`），不硬编码版本号，兼顾一眼辨识扣费归属与悬浮完整模型列表提示。
- **近 90 分钟分模型消耗趋势归因（`history.modelBuckets` / `history.modelSummaries`）**：采集本机 `pricing_ledger_v1.json` 近期调用（无前置依赖时自动回退扫描近期活跃会话 `transcript.jsonl` 尾部；未重启主窗口免 Preload 兜底模式自动融合宿主只读 `sessionCalls` / `getTokenHistory` 与本地采样模型记录），将每个 5m 桶的池额度跌落按同池模型调用权重精准归因至基础模型家族（`Carbon`、`Argon`、`Hydrogen`、`3.8 Flash`、`Opus`、`Sonnet`、`GPT-OSS`），支持面板内 **`按模型 | 按池`**（`localStorage['agy_quota_trend_granularity']`）无刷新即时切换。

---

## 5. 致谢

- **[n2ns/antigravity-panel](https://github.com/n2ns/antigravity-panel)**（`@n2ns` / `Datafrog LLC` 及社区贡献者 `@HH-Tips`、`@AMDphreak`、`@chonkydonkers`、`@iskisraell`）：启发了 Language Server 配额 RPC 解析、三大配额池划分与 210° 半圆弧 SVG 几何模型。
- **[elviscjn-cjn/antigravity-context-viewer](https://github.com/elviscjn-cjn/antigravity-context-viewer)**（`@elviscjn-cjn`）：提供了优秀的右上角 Context Meter 宿主面板架构、开放式 Shadow DOM 视图容器与成对标记保留式安装机制。
