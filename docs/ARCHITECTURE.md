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
        ├── main.mjs                 # Node ESM 后端（SidecarApp / Standalone / Dump 三模式）
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

在独立调试模式（`--standalone` / `--dump`）下，如果环境变量不存在，`sidecars/quota_panel/main.mjs` 也会尝试从本机 Antigravity Language Server 进程参数中自动探测地址与 `csrf_token`。

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
