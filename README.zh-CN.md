# AGY Quota (`agy-quota`)

[English](./README.md) | 简体中文

一个轻量级的 **Antigravity 2.x 原生侧边栏插件**（`SIDECAR_UI_ENTRYPOINT_AUX_PANE`），用于直接在客户端右侧辅助面板查看 Antigravity 账号配额池、5 小时 / 周限额、订阅 Credits 与各模型重置倒计时。

> 本插件**只聚焦账号额度与重置状态查看**，刻意**不包含** Token 热力图、Token 监控与上下文查看功能。

---

## 为什么做原生 Sidecar 插件？

经典的 `antigravity-panel` 等扩展（`"engines": { "vscode": "^1.104.0" }`）面向 VS Code 与旧版 Antigravity 1.x，依赖 VS Code Extension Host（`~/.antigravity/extensions`）与 `activitybar` Webview。

而 **Antigravity 2.x** 是独立构建的 Electron 桌面客户端，已经移除 VS Code Extension Host，不支持 `.vsix` 安装；取而代之的是内置的 **UI Sidecar Plugin** 原生插件体系，直接扫描 `~/.gemini/config/plugins/<name>/` 并挂载到右侧辅助面板：

| 方案 | 是否依赖 VS Code 扩展宿主 | 是否需要修改 `app.asar` | 主题与侧边栏集成 |
| :--- | :--- | :--- | :--- |
| 传统 `.vsix` (`antigravity-panel`) | 是（仅支持 VS Code / AGY 1.x） | 否 | 无法安装到 Antigravity 2.x |
| 客户端注入 / 补丁方案 | 否 | 是（客户端升级易失效） | 强耦合桌面端打包文件 |
| **AGY Quota (`agy-quota` Sidecar)** | **否（Antigravity 2.x 原生）** | **否** | **原生 `SIDECAR_UI_ENTRYPOINT_AUX_PANE` + `/preload.js`** |

想深入了解插件发现机制、RPC 接口与配额池聚合策略，请阅读：[架构说明 (docs/ARCHITECTURE.md)](./docs/ARCHITECTURE.md)。

---

## 功能特性

- **账号与订阅信息**：显示当前登录账号邮箱（支持一键点击打码隐藏隐私）及订阅方案（如 `Google AI Pro`）。
- **配额池视图 (`Pools`)**：
  - 按真实配额策略聚合为 `Gemini`、`Argon`、`Claude / GPT` 配额池
  - 支持 **半圆弧 (`Arc`)** 与 **圆环 (`Ring`)** 两种 SVG 仪表盘样式
  - 联动解析 `RetrieveUserQuotaSummary` 中的 **5 小时限额 (`5h`)** 与 **周限额 (`Weekly`)**
  - 实时显示下次重置倒计时与本地重置时间
  - 仅在本地记录轻量化 7 天剩余额度快照，用于估算近期消耗速率（`%/h`）、预计续航（Runway）及 90 分钟趋势柱图（不抓取任何对话上下文或 Token 日志）
- **单模型明细视图 (`Models`)**：
  - 展示每个模型的剩余比例进度条与重置倒计时
  - 支持折叠/展开查看当前不可用或已禁用的模型
- **Credits 详情**：可折叠展示 Prompt Credits、Flow Credits 及账号附加额度信息（如 `GOOGLE_ONE_AI`）
- **双语切换与宿主主题同步**：支持一键切换 `中文 / EN`（持久化保存在 `localStorage`），并通过 `/preload.js` 自动同步 Antigravity 明/暗主题变量

---

## 项目结构

```text
agy-sidepanel/
├── plugin.json                      # Antigravity 2.x 插件清单
├── install.mjs                      # 安装 / 卸载脚本（同步至 ~/.gemini/config/plugins/agy-quota）
├── README.md                        # English README
├── README.zh-CN.md                  # 简体中文文档
├── LICENSE                          # Apache License 2.0 协议
├── NOTICE                           # 上游项目归属与致谢声明
├── docs/
│   └── ARCHITECTURE.md              # 原生 Sidecar 机制与 Language Server RPC 说明
├── assets/
│   └── logo.svg                     # 插件图标
└── sidecars/
    └── quota_panel/
        ├── package.json             # ESM 模块标记 ("type": "module")
        ├── sidecar.json             # 注册 SIDECAR_UI_ENTRYPOINT_AUX_PANE ("Quota")
        ├── main.mjs                 # SidecarApp 后端、LS RPC 客户端、配额池聚合与 --dump/--standalone
        ├── index.html               # 侧边栏 HTML 入口
        ├── styles.css               # 自适应宿主主题 CSS 样式
        └── app.js                   # 前端视图状态、SVG 仪表、倒计时与交互逻辑
```

---

## 快速安装

### 环境要求

- **Antigravity 2.x** 桌面客户端
- **Node.js**（支持原生 ESM，建议 v18+）

### 安装步骤

克隆仓库并运行安装脚本，将插件复制到 Antigravity 2.x 原生插件目录（`~/.gemini/config/plugins/agy-quota`）：

```bash
git clone https://github.com/awu5425/agy-sidepanel.git
cd agy-sidepanel
node install.mjs
```

如果安装后客户端尚未立即刷新出 **AGY Quota**，重启一次 Antigravity 2.x 即可在右侧辅助面板和插件管理中看到入口。

### 卸载

```bash
node install.mjs --uninstall
```

---

## 命令行调试与独立预览

通过命令行一次性输出当前 Antigravity 账号的实时配额 JSON：

```bash
node sidecars/quota_panel/main.mjs --dump
```

以独立本地 HTTP 服务启动，方便直接在浏览器中预览与调试界面：

```bash
node sidecars/quota_panel/main.mjs --standalone --port 4318
```

---

## 🙏 致谢原作者 (Acknowledgements)

本插件针对 Antigravity 2.x 的配额监控设计与核心数据解析思路参考并致谢以下开源项目与贡献者：

- **[N2NS Lab (`@n2ns`)](https://github.com/n2ns)** 与 **[n2ns/antigravity-panel](https://github.com/n2ns/antigravity-panel)**（`Datafrog LLC`, Apache-2.0 开源协议）——感谢原作者在 Antigravity 配额面板设计、本地 Language Server RPC（`GetUserStatus`、`RetrieveUserQuotaSummary`）逆向调研、配额池聚合逻辑以及半圆弧仪表几何计算方面的开创性工作。
- **`antigravity-panel` 社区贡献者**（其在配额机制上的成果为本插件提供了重要参考）：
  - **[`@HH-Tips`](https://github.com/HH-Tips)** — Antigravity 2.x 后端探测、Gemini 4 Argon 配额解析与 5 小时/周限额分离追踪
  - **[`@AMDphreak`](https://github.com/AMDphreak)** — Gemini 与 Claude / GPT 配额池对齐及重置窗口逻辑
  - **[`@chonkydonkers`](https://github.com/chonkydonkers)** — 订阅等级 Credits 额度读取与展示
  - **[`@iskisraell`](https://github.com/iskisraell)** — Windows 平台下 Language Server 进程与端口发现稳定性改进

---

## 📄 开源协议 (License)

本项目基于 [Apache License, Version 2.0](./LICENSE) 开源；上游归属说明详见 [NOTICE](./NOTICE)。
