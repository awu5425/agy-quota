# 架构说明 (Architecture)

本文档说明 **AGY Quota (`agy-quota`)** 如何适配 **Antigravity 2.x** 的原生插件与 Sidecar 架构，并解析 Antigravity 账号配额数据。

---

## 1. 背景：为什么 `.vsix` 扩展无法在 Antigravity 2.x 中安装

早期的 [antigravity-panel](https://github.com/n2ns/antigravity-panel) 等工具是为 **VS Code** 与 **Antigravity 1.x** 开发的 `.vsix` 扩展：

- 依赖 `"engines": { "vscode": "^1.104.0" }` 与 VS Code Extension Host；
- 插件目录位于 `~/.antigravity/extensions`；
- UI 通过 VS Code 的 `activitybar` 视图容器 + `webview` 渲染。

而在 **Antigravity 2.x**（例如 `v2.32.1`）中，客户端架构发生了根本变化：

1. **移除 VS Code Extension Host**：Antigravity 2.x 是独立构建的 Electron 桌面应用，不再加载 `~/.antigravity/extensions`，也不支持安装 `.vsix` 包。
2. **原生插件目录**：改为从 `~/.gemini/config/plugins/<plugin-name>/` 自动发现本地全局插件。
3. **原生 Sidecar UI 运行时**：带有面板 UI 的插件不再注入 VS Code `activitybar`，而是通过 `sidecars/<sidecar>/sidecar.json` 声明 `SIDECAR_UI_ENTRYPOINT_AUX_PANE`，直接挂载在 Antigravity 2.x 的右侧辅助侧边栏（Auxiliary Side Pane）中，且**无需对 `app.asar` 打补丁**。

---

## 2. 原生 Sidecar 运行机制

### 2.1 目录与清单发现

Antigravity 2.x 启动并连接到本地 Language Server 后，会自动扫描 `~/.gemini/config/plugins/`（可通过 `GetAllPlugins` RPC 验证发现结果）：

```text
~/.gemini/config/plugins/agy-quota/
├── plugin.json                      # 插件元数据（name, displayName, version, logo, suggestedPrompts）
├── assets/
│   └── logo.svg                     # 插件图标
└── sidecars/
    └── quota_panel/
        ├── package.json             # 标记 { "type": "module" }
        ├── sidecar.json             # Sidecar 运行配置与右侧栏入口声明
        ├── main.mjs                 # Node ESM 后端（SidecarApp / CLI / Standalone / Dump 四模式）
        ├── index.html               # 侧边栏 Web UI 壳
        ├── styles.css               # 跟随宿主主题变量的样式表
        └── app.js                   # 前端视图状态、SVG 仪表盘与倒计时渲染
```

其中 `sidecars/quota_panel/sidecar.json` 关键字段：

- `command`: `"node"`，`args`: `["main.mjs"]`
- `restart_policy`: `"always"`
- `has_web_ui`: `true`
- `ui_config.views`: `[{ "path": "/", "entrypoint": "SIDECAR_UI_ENTRYPOINT_AUX_PANE", "title": "Quota" }]`

### 2.2 宿主注入环境与主题同步

当 Antigravity 2.x 启动 Sidecar 进程时，会自动注入以下环境变量（`sidecar_sdk` 位于 `~/.gemini/config/node_modules/sidecar_sdk/index.mjs`，由 Antigravity 运行时提供）：

| 环境变量 | 作用 |
| :--- | :--- |
| `ANTIGRAVITY_LS_ADDRESS` | 本地 Language Server 地址（如 `localhost:50786`） |
| `ANTIGRAVITY_CSRF_TOKEN` | 调用 Language Server 本地 RPC 所需的认证 Token |
| `ANTIGRAVITY_SIDECAR_WEB_PORT` | Sidecar 本地 HTTP 监听端口（绑定 `127.0.0.1`） |
| `ANTIGRAVITY_SIDECAR_UI_TOKEN` | 宿主与 Sidecar 通信的鉴权 Token |
| `ANTIGRAVITY_EXECUTABLE_DATA_DIR` | 应用数据目录（`quota_panel` 用于存放本地 7 天轻量化配额快照） |

在独立终端（未在 `agy` 会话内）或无桌面端环境下，`sidecars/quota_panel/main.mjs` 按以下优先级多级自动发现并获取配额：

1. **宿主环境变量**：读取 `ANTIGRAVITY_LS_ADDRESS` 与 `ANTIGRAVITY_CSRF_TOKEN`（在 `agy` CLI 会话或桌面 Sidecar 内直接命中）。
2. **最近连接缓存 (`last_ls_conn.json`)**：每次成功连接 Language Server 后将其地址与 Token 保存在数据目录的 `last_ls_conn.json`（权限 `0600`），脱离 `agy` 会话后优先以 2s 超时探测该连接是否仍存活。
3. **系统进程与 `/proc` 环境变量探测**：
   - Windows：通过 `Get-CimInstance Win32_Process` + `netstat -ano` 提取 `--csrf_token` 与监听端口；
   - Linux：同时扫描 `/proc/<pid>/environ` 中的 `ANTIGRAVITY_LS_ADDRESS` / `ANTIGRAVITY_CSRF_TOKEN`（适配纯 CLI 版 `agy` 进程），以及 `ps` + `ss -tlnp` 中的 `--csrf_token`；
   - macOS：通过 `ps` + `lsof` 探测。
4. **Cloud Code OAuth API 直连兜底 (`oauth-token`)**：当本机没有任何存活的 Language Server 进程时（或手动传入 `--oauth`），自动读取 `~/.gemini/antigravity-cli/antigravity-oauth-token`（也支持 `--profile-dir` 与 `~/.gemini-profiles/*` 多账号隔离目录，并在 Token 过期时自动读取 `env` / `agy` 二进制中的客户端凭证刷新），直接请求 `https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary` 与 `/v1internal:loadCodeAssist` 构建配额池与 5h/周窗口摘要视图。

前端方面，`sidecar_sdk` 提供的 `/preload.js` 会完成两件事：

1. 提供 `window.sidecar.fetch` 安全请求封装；
2. 监听宿主的 `theme-change` 消息，并将实时 CSS 变量（如 `--background`、`--foreground`、`--card`、`--border`、`--primary`）写入 `:root`，前端通过 `MutationObserver` 自动识别明/暗主题并切换界面配色。

---

## 3. Language Server 配额 RPC 与数据模型

`sidecars/quota_panel/main.mjs` 通过本地 Connect/HTTP JSON RPC 向 Language Server 发起只读请求（请求头携带 `Content-Type: application/json`、`Connect-Protocol-Version: 1` 与 `x-codeium-csrf-token`）：

### 3.1 `GetUserStatus`

`POST /exa.language_server_pb.LanguageServerService/GetUserStatus`

- **账号与订阅等级**：解析 `userStatus.email`、`userStatus.name`、`userStatus.userTier`（如 `Google AI Pro`）以及 `planStatus.planInfo.planName`。
- **订阅积分 (Credits)**：读取 `planStatus.availablePromptCredits` / `monthlyPromptCredits`、`availableFlowCredits` / `monthlyFlowCredits` 与 `userTier.availableCredits`。
- **单模型配额**：遍历 `userStatus.cascadeModelConfigData.clientModelConfigs`，提取各模型的 `quotaInfo.remainingFraction`、`quotaInfo.resetTime` 与 `disabled` 状态。

### 3.2 `RetrieveUserQuotaSummary`

`POST /exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary`

返回按模型系列划分的限额汇总组与窗口配额桶（Buckets），例如：

- **Gemini models**：包含 `gemini-5h`（5 小时平滑限额）与 `gemini-weekly`（周限额）；
- **Claude and GPT models**：包含 `3p-5h` 与 `3p-weekly`；
- **Gemini 4 Argon**：在 Pro 订阅下作为独立配额池返回 `gemini-argon-wtu-weekly` 等周期配额桶。

### 3.3 配额池聚合与本地轻量趋势

- **配额池 (`Pools`) 聚合**：参考上游 `antigravity-panel` 的池化思路，将模型归入 `gemini`（Gemini Hydrogen / Flash）、`argon`（Gemini 4 Argon）与 `non-google`（Claude / GPT）三大配额池：
  - 若存在 `5h` 配额桶，主仪表优先展示对应 `5h` 余量，并附带 `Weekly` 进度条；
  - 若像 Pro 方案下的 Argon 仅返回周配额桶而无独立 5h 桶，则主仪表显示模型余量下限并联动展示 `gemini-argon-wtu-weekly`。
- **消耗速率与 90 分钟趋势**：仅保存各配额池剩余百分比的时间戳快照（不记录会话消息、上下文或 Token 消耗），在本地计算小时消耗率（`%/h`）与预计可用时长（Runway），并保留最多 7 天的轻量历史点用于渲染 90 分钟分桶趋势柱状图。
