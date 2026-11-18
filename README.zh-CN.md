# AGY Quota (`agy-quota` v1.3.2)

[English](./README.md) | 简体中文

一个 **100% 原创、零运行时第三方依赖** 的 **Antigravity 2.x** 账号配额监控套件与 **Agent Skill（`/agy-quota`）**。底层共用单一核心引擎（`src/quota-core.cjs`）与统一缓存/配置目录（`~/.gemini/antigravity/agy-quota`）。

`agy-quota` v1.3.2 在桌面端提供 **两种自由可选（亦可共存）的 UI 形态**、**原生 `/agy-quota` 对话技能（Skill）**，并完整覆盖终端 CLI 与远程网页场景：

1. **右上角半环看板（`--top-right` / `--meter-overlay`，桌面端首选）** —— 支持 CDP 免重启即时热挂载，**双模自适应切换**：
   - **独立右上角模式（零前置依赖）**：在**未安装** `antigravity-context-viewer` 的干净客户端上开箱即用，自动在窗口右上角（智能避让最小化/最大化/关闭三键）挂载精致的 SVG 进度环胶囊按钮（`#agy-quota-standalone-hud`），点击弹出 `476px` 四层 `1×2 / 1×3` 自适应半环看板。
   - **Context Meter 伴生增强模式**：当检测到已安装 **[Antigravity Context Meter](https://github.com/elviscjn-cjn/antigravity-context-viewer)**（`#ag-context-meter`）时，自动销毁/退让独立徽章（确保右上角绝无双图标冲突！），无损接管 `#panel-quota` 弹出层、合并单次 RPC 零重复轮询，且 **100% 跨在线升级自动留存与重挂载**。
2. **原生右侧栏面板（`node install.mjs` / `--sidecar`）** —— 基于官方 `SIDECAR_UI_ENTRYPOINT_AUX_PANE` 机制挂载至右侧辅助栏（Auxiliary Side Pane），**零 `app.asar` 补丁**；既可单独使用，也可通过 `--top-right --keep-sidecar` 与右上角看板同时保留。
3. **自包含 Agent Skill（`/agy-quota` / `node cli.mjs --skill` / `npx skills add`）** —— 支持在对话中输入 `/agy-quota` 或直接用自然语言查询实时配额余量、评估跑大模型/Swarm 多智能体任务的额度预算，以及一句话安装/修复/切换桌面配额面板。
4. **终端 CLI 与实时监控（`agy-quota` / `--watch [sec]` / `--models` / `--oauth`）** —— 终端彩色看板、定时清屏刷新、基础模型合并去重明细，以及无桌面/无本地 Language Server 环境下的 Cloud Code OAuth 直连兜底。
5. **独立 Web 预览服务（`--standalone`）** —— 本地或远程无头服务器（支持 `--host 0.0.0.0`）启动轻量 HTTP 服务，在任意浏览器呈现同款四层半环看板。

---

## 运行形态对比

| 运行形态 | 安装 / 启动命令 | 是否依赖 `context-viewer` | 是否写入 `app.asar` | 是否常驻独立进程 | 适用场景 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1A. 右上角看板（独立徽章模式）** | `node cli.mjs --top-right` | **否**（未装时自动挂出右上角独立圆环） | 仅在 `dist/preload.js` 写入成对引导标记 | **否** | 纯净 Antigravity 客户端，一步挂出右上角半环额度弹窗 |
| **1B. 右上角看板（伴生融合模式）** | `node cli.mjs --top-right` *(等价 `--meter-overlay`)* | 自动检测 `#ag-context-meter` | 仅在 `dist/preload.js` 写入成对引导标记 | **否** | 已装 Context Meter 用户，合一接管 `#panel-quota` 且单次 RPC 零重复轮询 |
| **2. 原生右侧栏面板（Sidecar）** | `node install.mjs` *(或 `node cli.mjs --sidecar`)* | **否** | **否（零 ASAR 补丁）** | 是（`sidecar_sdk`） | 偏好完全不触碰 `app.asar` 的官方右侧辅助栏（加 `--keep-sidecar` 可与右上角共存） |
| **3. Agent Skill（`/agy-quota`）** | `node cli.mjs --skill` *(或 `npx skills add awu5425/agy-quota`)* | **否** | **否** | **否** | 对话内查额度、大模型/Swarm 预算评估、一句话安装/自愈面板 |
| **4. 终端 CLI / Watch** | `node cli.mjs` / `node cli.mjs --watch 15` | 否 | 否 | 否 | 终端速查、`agy` 命令行会话、远程无桌面 Linux 服务器（`--oauth`） |
| **5. 独立网页预览（Standalone）** | `node cli.mjs --standalone --port 4318` | 否 | 否 | 按需 HTTP 服务 | 本地浏览器独立打开或远程 SSH 端口转发查看 |

关于双模自适应右上角挂载、Agent Skill 双目录自举架构、单次 RPC 拦截去重、ASAR 手术刀改写、GitHub 在线校验热升级及 L0~L4 连接发现链的技术细节，请参阅：[架构说明 (docs/ARCHITECTURE.md)](./docs/ARCHITECTURE.md)。

---

## v1.3.2 全新升级与核心特性

- **安全加固与工程健壮性全面升级（`v1.3.2`）**：
  - **可信源强锁与 Web 更新接口鉴权**：在线自更新强绑定官方 `awu5425/agy-quota` 仓库并优先锁定 40 位不可变 Commit SHA 与跨文件版本一致性校验；Standalone 网页服务对 `/api/update/*` 强制校验回环地址 + 同源 CSRF 令牌，绑定 `0.0.0.0` 时默认禁用远端更新写入（除非显式配置 `--admin-token`）。
  - **非侵入式 HUD 安装默认策略**：`--top-right` 默认 100% 保持其他第三方或旧版工具（如 `context-capsule`）原样不动；仅在显式传入 `--migrate-capsule` 时备份迁移，并在 `--uninstall-overlay` 时自动完整恢复。
  - **全量统一打包清单与跨盘原子安装**：统一 `--skill`、`--sidecar` 与 `npx skills add` 24 项文件清单，写入前做完整性预检与同盘 staging 原子替换（内置 `EXDEV` 跨盘兜底），修复短采样窗口消耗速率低估、重置时间到期强显 `100%` 及自定义 Skill 目录热更新问题，并新增 `--read-only` 纯只读模式与 `npm test` 回归测试套件。

- **原生 `/agy-quota` Agent Skill 双形态自包含封装（`SKILL.md` + `skills/agy-quota/` + `node cli.mjs --skill`）**：
  - 同时兼容三种主流安装方式：`node cli.mjs --skill`（离线完整安装至 `~/.gemini/config/skills/agy-quota`，零常驻后台进程）、`npx skills add awu5425/agy-quota`（子目录单独分发时首次调用自动从 GitHub 拉取并通过 `node --check` 语法校验自举 `./runtime/`）、以及直接 `git clone` 至 `skills/agy-quota` 或随 `plugin.json` 原生插件自动加载。
  - 让 AI Agent 可随时按需读取脱敏实时配额池、在启动耗时任务或 Swarm 前给出选模与节奏建议，或直接代你执行 `--top-right` / `--ensure` / `--update`。
- **右上角双模无感自适应（`standalone` ↔ `companion`）**：
  - 未装 `context-viewer` 时自动挂载独立顶栏小圆环徽章与 `476px` 弹窗；一旦检测到 `#ag-context-meter` 出现，`<300ms` 内自动销毁独立徽章并无缝切入 `#panel-quota` 伴生模式，彻底杜绝右上角双图标。
- **中英双语实时切换（`中 / EN`）**：
  - 顶栏内置紧凑的 **`中 / EN`** 切换键（覆盖右上角看板、原生右侧栏与 `--standalone` 网页），默认自动跟随宿主/系统语言，点击即刻无刷新切换全界面文案并持久化至 `localStorage['agy_quota_lang']`。
- **主题跟随系统/宿主 + 三态切换（`Auto / Dark / Light`）**：
  - 默认 `Auto`（自动跟随）：实时监听 Antigravity 宿主页面类名、`data-theme`、背景明度以及系统 `prefers-color-scheme: dark` 事件，明暗切换毫秒级同步 `--qp-*` 亮暗色板；同时支持在顶栏手动锁定 `Dark` 或 `Light`（`localStorage['agy_quota_theme']`）。
- **GitHub 在线检查与免重启热升级（`--check-update` / `--update` 及面板自动更新开关）**：
  - 看板底部新增单行版本栏 `.qp-footer-bar`：展示 `AGY Quota v1.3.2`、一键检查/立即更新按钮与 **`自动更新`（`Auto-update`）** 开关（配置持久化于 `~/.gemini/antigravity/agy-quota/settings.json`）。
  - 支持环境变量及本机代理自动识别，双通道查询 GitHub `releases/latest` 与 `main/package.json`；下载至临时 staging 目录全量通过 JS 语法守卫后原子替换已激活的右上角/右侧栏/Skill 运行时，并支持前端 UI 免重启即时热替换。
- **476px 四层精简自适应半环看板（`1×2 Ultra` / `1×3 Pro`）**：
  1. **紧凑顶栏 & 单行账号条**：`半弧 | 圆环`（`Arc | Ring`）切换、`中 / EN`、`Auto / Dark / Light` 主题键、刷新倒计时、邮箱点击高斯模糊打码，以及精准解析的 `Google AI Pro` / `Google AI Ultra` 徽章。
  2. **按服务端真实配额组动态 `1×2` / `1×3` 等宽半环网格 + 池内家族微标**：严格依据 `RetrieveUserQuotaSummary` 与模型限额判定——在 Google AI Ultra（Argon 与 Gemini 共用 `gemini-5h` / `gemini-weekly`）下渲染 **`1×2` 双环卡片**（`Gemini` · `Claude / GPT`），在 Google AI Pro（存在独立 `gemini-argon-wtu-weekly` 等 Argon 桶）下自动切换 **`1×3` 三环卡片**（`Gemini` · `Argon` · `Claude / GPT`）；每张卡片标题下方附带精炼模型家族微标（如 `Carbon · Argon · Hydrogen · 3.8 Flash`、`Sonnet 4.6 · Opus 4.6 · GPT-OSS`），配合 210° 半圆弧仪表、当前会话模型池智能映射高亮、`pp/h` 速率与周额度进度条。
  3. **可收起 90 分钟分模型 / 分池消耗趋势（`按模型 | 按池`）**：默认选中 **`按模型`**（`Models`），将 `18 × 5m` 配额池跌落按单模型真实调用成本/Token 权重精准拆解为多模型彩色堆叠柱（对尚未触发百分比跳变的短调用渲染 `3~6px` 微柱），并在下方紧凑 2 列网格展示近期实际活跃模型的消耗量与速率胶囊（未使用的模型自动隐藏）；支持一键无刷新秒切 **`按池`**（`Pools`）视图。
  4. **可收起订阅积分 Credits & 底部更新栏**：`Google One AI` 状态徽章、`Prompt 积分` / `Flow 积分` 进度条与在线热更新控制栏。
- **L0~L4 五级自适应连接发现链**：
  - **L0** 页面同源 Connect-RPC → **L1** `ANTIGRAVITY_LS_*` 环境变量 → **L2** `last_ls_conn.json` 存活端口缓存 → **L3** 跨平台进程与端口探测 → **L4** Google Cloud Code OAuth API 直连兜底（支持 `--oauth` 与 `--profile-dir` 多账号目录）。

---

## 项目目录结构

```text
agy-quota/
├── package.json                     # v1.3.2 包配置（Apache-2.0，零运行时第三方依赖）
├── cli.mjs                          # 统一 CLI 入口（--top-right、--sidecar、--skill、--watch、--update、--standalone）
├── install.mjs                      # 零补丁原生右侧栏 Sidecar 与自包含 Agent Skill 安装/卸载器
├── plugin.json                      # Antigravity 2.x 原生插件清单（同时包含 Sidecar 与 /agy-quota Skill）
├── SKILL.md                         # 根目录 Agent Skill 定义（兼容直接 git clone 至 skills/ 目录）
├── scripts/
│   └── agy-quota.mjs                # 支持离线路由与首次运行自动安全自举的 Skill 执行器
├── skills/
│   └── agy-quota/                   # 标准插件规范与 `npx skills add` 分发目录
│       ├── SKILL.md
│       └── scripts/
│           └── agy-quota.mjs
├── README.md                        # English README
├── README.zh-CN.md                  # 简体中文文档
├── LICENSE                          # Apache License 2.0 协议
├── NOTICE                           # 上游项目归属声明
├── docs/
│   └── ARCHITECTURE.md              # 双模右上角挂载、Agent Skill、ASAR 手术刀改写与 RPC 架构文档
├── assets/
│   └── logo.svg                     # 插件图标
├── src/
│   ├── quota-core.cjs               # 共享 CommonJS 核心引擎（L0~L4 发现、OAuth、三池/90m 趋势、GitHub 在线自更新）
│   ├── overlay-preload.cjs          # Electron Preload 桥接（IPC 单次去重直通 + 配额/更新 contextBridge + UI 注入）
│   ├── meter-overlay-ui.js          # 双模 Shadow DOM 476px 四层半环看板（独立右上角/伴生自适应、双语、三态主题、热更新）
│   ├── overlay-installer.mjs        # --top-right 手术刀安装/巡检/卸载、--ensure 自愈与 CDP 免重启热挂载
│   └── auto-ensure-hook.cjs         # 极速 (<10ms) Antigravity SessionStart 守护钩子（客户端更新后自动无感恢复）
└── sidecars/
    └── quota_panel/
        ├── package.json             # ESM 模块标记 ("type": "module")
        ├── sidecar.json             # 注册原生右侧栏 SIDECAR_UI_ENTRYPOINT_AUX_PANE ("Quota")
        ├── main.mjs                 # CLI / --watch / --check-update / --update / --standalone / Sidecar 服务端
        ├── index.html               # Standalone 与 Sidecar 页面骨架
        ├── styles.css               # 四层半环响应式样式与亮/暗双主题变量
        └── app.js                   # Standalone 与 Sidecar 前端控制器（双语、主题跟随、在线更新栏）
```

---

## 快速上手

### 1. 桌面端方式一：右上角半环看板（`--top-right`，推荐）

无论是否安装了 `antigravity-context-viewer` 均可直接运行（已装自动走伴生融合模式，未装自动挂出右上角独立圆环徽章）：

```bash
git clone https://github.com/awu5425/agy-quota.git
cd agy-quota

# 一键安装右上角半环看板并通过 CDP 免重启即时热挂载（--meter-overlay 为等价别名）
# 默认自动停用原生右侧栏以避免双进程重复轮询
node cli.mjs --top-right

# 若希望【同时保留】右上角半环看板与原生右侧栏面板：
node cli.mjs --top-right --keep-sidecar

# 巡检 ASAR 钩子、自愈守卫、当前自适应 UI 模式、运行时文件、备份与右侧栏共存状态
node cli.mjs --overlay-status

# 检查 ASAR 注入是否因宿主自动更新丢失（如已装 Context Meter 则一并自动恢复），缺失时自动自愈并热挂载
node cli.mjs --ensure

# 随时干净卸载右上角钩子、自愈守卫与运行时文件
node cli.mjs --uninstall-overlay
```

> **Antigravity 客户端自动更新后免重装自愈**：执行 `--top-right` 时会自动向 `~/.gemini/config/hooks.json` 注册轻量化 `<10ms` `SessionStart` 守护钩子（`~/.gemini/antigravity/agy-quota/auto-ensure-hook.cjs`）。一旦桌面端后台自动更新覆盖了新版 `app.asar`，下次会话启动时会自动静默拉起 `overlay-installer.mjs --ensure --quiet`，顺次恢复原版 `antigravity-context-viewer`（若本机已安装）与 `agy-quota` 半环看板并免重启 CDP 热挂载。

### 2. 桌面端方式二：原生右侧栏面板（`install.mjs` / `--sidecar`，零 ASAR 补丁）

若偏好完全不修改 `app.asar`，直接使用 Antigravity 2.x 右侧辅助面板（Auxiliary Side Pane）：

```bash
# 安装/启用原生右侧栏插件（~/.gemini/config/plugins/agy-quota）
node install.mjs
# （等价命令：node cli.mjs --sidecar  或  node cli.mjs install）

# 卸载原生右侧栏插件
node install.mjs --uninstall
# （等价命令：node cli.mjs --uninstall-sidecar）
```

### 3. Agent Skill 形态（`/agy-quota`，对话即查额度 & 一句话装面板）

支持将 `agy-quota` 安装为自包含的全局 Agent Skill（默认位于 `~/.gemini/config/skills/agy-quota`，**零常驻后台进程**），任选以下三种方式之一即可：

```bash
# 方式 A：从本地仓库一键安装完整离线 Skill 运行时
node cli.mjs --skill
node cli.mjs --skill-status

# 方式 B：通过社区通用 skills CLI 一行安装（首次触发时自动拉取并语法校验 runtime/）
npx skills add awu5425/agy-quota

# 方式 C：直接 Git Clone 到 Antigravity 全局技能目录
git clone https://github.com/awu5425/agy-quota.git ~/.gemini/config/skills/agy-quota
```

安装后即可在聊天框输入 `/agy-quota` 或直接用自然语言对话：
- `/agy-quota` —— *“帮我看下现在还剩多少配额、什么时候重置、近 90 分钟哪个模型消耗最多”*
- *“先查一下我的 Argon 和 Claude 额度，评估够不够开 4 个 Swarm 并发跑重构”*
- *“/agy-quota 帮我把右上角半环额度看板装上（或客户端升级后帮我自愈恢复）”*

### 4. GitHub 在线检查更新与一键热升级

```bash
# 检查 GitHub 是否有新版本发布
node cli.mjs --check-update

# 安全下载新版本、执行 staging 语法守卫校验并原子热更新已安装的右上角/右侧栏/Skill 运行时
node cli.mjs --update
```

*（亦可直接在面板底部的版本栏开启 **`自动更新`** 开关或点击检查/立即更新。）*

### 5. 终端 CLI、实时刷新与独立网页预览

```bash
# 默认终端彩色配额看板（2 池 Ultra / 3 池 Pro 自适应、5h/周窗口摘要、订阅 Credits）
node cli.mjs

# 每 15 秒自动清屏刷新监控（默认 30 秒）
node cli.mjs --watch 15

# 附带按基础模型合并去重后的单模型配额明细并打码邮箱
node cli.mjs --models --mask

# 强制使用 Cloud Code OAuth API 直连兜底（无需本地运行中的 Language Server）
node cli.mjs --oauth --mask
node cli.mjs --oauth --profile-dir ~/.gemini-profiles/1

# 启动独立网页预览服务（支持本地查看或远程服务器 SSH 端口转发）
node cli.mjs --standalone --port 4318
node cli.mjs --standalone --host 0.0.0.0 --port 14318 --admin-token <your-secret>
```

---

## 🤝 推荐黄金搭档：Antigravity Context Meter (`antigravity-context-viewer`)

如果你想获得完整的 Antigravity 2.x 桌面端全功能监控与增强体验，强烈推荐将 `agy-quota` 与 **[elviscjn-cjn/antigravity-context-viewer](https://github.com/elviscjn-cjn/antigravity-context-viewer)**（*Antigravity Context Meter*，作者 **[`@elviscjn-cjn`](https://github.com/elviscjn-cjn)**，MIT 开源协议）搭配使用：

- **`antigravity-context-viewer` 提供的核心强大能力**：
  - 顶栏实时流式生成速度（`tok/s` / TTFT）监控与多模型历史速度对比；
  - 单会话上下文结构拆解与 PDF/Office/图片等多格式附件的 Token 精细审计；
  - 日/周/月/年气泡/累计五视图 Token 用量热力图，以及订阅套餐与参考 API 费用多币种折算；
  - 桌面客户端界面汉化、免 TUN 局域网代理（ProxyNoTun）、上下文窗口上限解锁、当前工作区一键弹窗启动 `agy` CLI 终端，以及内置 GitHub 在线检查与热更新。
- **与 `agy-quota` 的零侵入互补协作**：
  - `agy-quota` 严格恪守 **100% 原创代码（零拷贝上游源码）** 边界，专注做好 **半环配额池视觉、Ultra/Pro 真实配额组动态自适应、近 90 分钟分模型消耗归因与跨平台终端 CLI / OAuth 能力**；
  - 当本机同时安装两者时，`node cli.mjs --top-right` 会自动以零拷贝伴生模式无缝嵌入右上角 `#panel-quota` 弹窗、合并单次 RPC 请求杜绝重复轮询、100% 无损兼容原作者的在线热更新，并在 Antigravity 客户端后台自动升级后一并无感自愈恢复。

---

## 🙏 致谢 (Acknowledgements)

衷心感谢以下开源项目、作者及社区贡献者的开创性工作，为本项目提供了宝贵的思路灵感与生态铺垫：

- **[`@elviscjn-cjn`](https://github.com/elviscjn-cjn)** 与 **[elviscjn-cjn/antigravity-context-viewer](https://github.com/elviscjn-cjn/antigravity-context-viewer)**（*Antigravity Context Meter*，MIT 协议）—— 感谢原作者打造了功能极为完善的 Antigravity 2.x 顶栏监控全家桶（`tok/s` 测速、上下文与附件拆解、用量热力图、汉化、免 TUN 代理、上下文解锁、CLI 启动与在线升级）；其开放式 Shadow DOM `#panel-quota` 架构、静态配额入参直通机制与成对标记保留式 `cleanPreloadSource` 安装器，让 `agy-quota` 得以在不拷贝或篡改上游任何源码的情况下优雅完成伴生融合。
- **[N2NS Lab (`@n2ns`)](https://github.com/n2ns)** 与 **[n2ns/antigravity-panel](https://github.com/n2ns/antigravity-panel)**（`Datafrog LLC`, Apache-2.0）—— 感谢在 Antigravity 配额可视化、本地 Language Server RPC（`GetUserStatus`、`RetrieveUserQuotaSummary`）探测、配额池聚合模型与 210° 半圆弧 SVG 几何设计上的开创性探索，以及社区贡献者 **[`@HH-Tips`](https://github.com/HH-Tips)**、**[`@AMDphreak`](https://github.com/AMDphreak)**、**[`@chonkydonkers`](https://github.com/chonkydonkers)**、**[`@iskisraell`](https://github.com/iskisraell)** 的重要贡献。

---

## 📄 开源协议 (License)

本项目基于 [Apache License, Version 2.0](./LICENSE) 开源；上游归属说明详见 [NOTICE](./NOTICE)。
