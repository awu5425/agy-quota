# AGY Quota (`agy-quota`)

English | [简体中文](./README.zh-CN.md)

A lightweight native **Antigravity 2.x sidepanel plugin** (`SIDECAR_UI_ENTRYPOINT_AUX_PANE`) and **terminal CLI** for monitoring Antigravity account quota pools, 5-hour / weekly limits, tier credits, and per-model reset countdowns — **focused purely on quota visibility**, with **no token heatmaps, no token monitoring, and no conversation context viewer**.

---

## Why a Native Sidecar Plugin?

Legacy VS Code extensions such as `antigravity-panel` (`"engines": { "vscode": "^1.104.0" }`) target VS Code / Antigravity 1.x via the VS Code Extension Host (`~/.antigravity/extensions`) and `activitybar` Webviews.

**Antigravity 2.x** is a standalone Electron client without a VS Code Extension Host and does not support `.vsix` extensions. Instead, it provides a built-in **UI Sidecar Plugin** runtime discovered from `~/.gemini/config/plugins/<name>/` and rendered directly inside the Antigravity 2.x Auxiliary Side Pane.

| Approach | Extension Host Required? | `app.asar` Patching? | Native Theme & Aux Pane Integration |
| :--- | :--- | :--- | :--- |
| Legacy `.vsix` (`antigravity-panel`) | Yes (VS Code / AGY 1.x only) | No | Fails on Antigravity 2.x |
| Client ASAR Patching | No | Yes (breaks on updates) | Coupled to app bundle |
| **AGY Quota (`agy-quota` Sidecar + CLI)** | **No (Native AGY 2.x)** | **No** | **Native `SIDECAR_UI_ENTRYPOINT_AUX_PANE` + `/preload.js` + Terminal CLI** |

For technical details on plugin discovery, RPC endpoints, and pool aggregation, see [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

---

## Features & Platform Support

- **Cross-Platform Design (Windows, macOS, Linux)**:
  - **In Antigravity Side Pane**: Uses `os.homedir()` (`~/.gemini/config/plugins/agy-quota`), host-injected `ANTIGRAVITY_LS_ADDRESS` & `ANTIGRAVITY_CSRF_TOKEN`, and `sidecar_sdk` identically across Windows, macOS, and Linux.
  - **Standalone / CLI Process Discovery**: Automatically detects running Language Server processes via `Get-CimInstance` + `netstat` (Windows, verified), `ps` + `lsof` (macOS), and `ps` + `ss` (Linux). *(Verified on Windows Antigravity 2.x; macOS/Linux discovery branches follow standard OS tooling.)*
- **Account & Tier Summary**: Displays account name/email (with one-click privacy masking / `--mask`) and subscription tier (e.g., `Google AI Pro`).
- **Quota Pools (`Pools` view & CLI)**:
  - Aggregates models into native quota pools (`Gemini`, `Argon`, `Claude / GPT`)
  - Switchable **Semi-Arc** and **Ring** SVG gauges in the side panel
  - Shows **5h** and **Weekly** windows parsed from `RetrieveUserQuotaSummary`
  - Live reset countdowns and local reset timestamps
  - Lightweight local 7-day quota snapshots for burn rate (`%/h`), runway estimation, and 90-minute bucket trends (no token or prompt logging)
- **Per-Model Breakdown (`Models` view & `--models` CLI flag)**:
  - Remaining percentage bar and reset timer per model
  - Collapsible unavailable / disabled models section
- **Tier Credits Breakdown**: Displays Prompt Credits, Flow Credits, and plan credit metadata (`GOOGLE_ONE_AI`, etc.) when present
- **Bilingual UI & Host Theme Sync**: Instant `中文` / `EN` toggle persisted in `localStorage`, plus automatic light/dark theme synchronization via Antigravity `/preload.js`

---

## Project Structure

```text
agy-quota/
├── package.json                     # Package metadata & "bin": { "agy-quota": "./cli.mjs" }
├── cli.mjs                          # Unified CLI entrypoint (terminal view, --json, --standalone, --install)
├── plugin.json                      # Antigravity 2.x plugin manifest
├── install.mjs                      # Installer / uninstaller (~/.gemini/config/plugins/agy-quota)
├── README.md                        # English documentation
├── README.zh-CN.md                  # 简体中文文档
├── LICENSE                          # Apache License 2.0
├── NOTICE                           # Upstream attribution & license notices
├── docs/
│   └── ARCHITECTURE.md              # Sidecar mechanism & RPC architecture notes
├── assets/
│   └── logo.svg                     # Plugin icon
└── sidecars/
    └── quota_panel/
        ├── package.json             # ESM marker ("type": "module")
        ├── sidecar.json             # Registers SIDECAR_UI_ENTRYPOINT_AUX_PANE ("Quota")
        ├── main.mjs                 # SidecarApp server, LS RPC client, pool aggregator, --cli/--dump/--standalone
        ├── index.html               # Sidepanel HTML shell
        ├── styles.css               # Host-theme-reactive CSS
        └── app.js                   # Frontend state, gauges, countdowns, and controls
```

---

## Quick Start & Installation

### Prerequisites

- **Antigravity 2.x** desktop client
- **Node.js** (v18+ ESM support)

### Install the Native Sidepanel Plugin

Clone this repository and install the plugin into Antigravity 2.x's native plugin directory (`~/.gemini/config/plugins/agy-quota`):

```bash
git clone https://github.com/awu5425/agy-quota.git
cd agy-quota
node install.mjs
```

If Antigravity 2.x does not immediately list **AGY Quota** in the Plugins Manager or auxiliary side pane, restart Antigravity once so it reloads `~/.gemini/config/plugins/`.

To uninstall the sidepanel plugin:

```bash
node install.mjs --uninstall
```

---

## Terminal CLI & Standalone Preview

### Direct Invocation (from repo)

```bash
# Colored terminal dashboard (pools, 5h/weekly summary windows, credits)
node cli.mjs

# Include full per-model quota bars and disabled models
node cli.mjs --models

# Mask account email in terminal output
node cli.mjs --mask

# Disable ANSI colors (also honors NO_COLOR=1)
node cli.mjs --no-color

# Output raw JSON snapshot (alias: --dump)
node cli.mjs --json

# Launch standalone Web UI in your browser
node cli.mjs --standalone --port 4318

# Install / uninstall sidepanel plugin via CLI
node cli.mjs --install
node cli.mjs --uninstall
```

### Global `agy-quota` Command (Optional)

Link the package globally with npm so you can run `agy-quota` from any directory:

```bash
npm link
agy-quota
agy-quota --models --mask
```

---

## 🙏 Acknowledgements (致谢)

Special thanks to the original open-source project and contributors whose work made this Antigravity 2.x adaptation possible:

- **[N2NS Lab (`@n2ns`)](https://github.com/n2ns)** and **[n2ns/antigravity-panel](https://github.com/n2ns/antigravity-panel)** (`Datafrog LLC`, Apache-2.0) — for pioneering Antigravity quota visualization, Language Server RPC endpoint discovery (`GetUserStatus`, `RetrieveUserQuotaSummary`), quota pool grouping logic, and SVG gauge geometry.
- **Community contributors to `antigravity-panel`** whose quota-related improvements directly informed the data model in this plugin:
  - **[`@HH-Tips`](https://github.com/HH-Tips)** — Antigravity 2.x backend detection, Gemini 4 Argon quota support, and separate 5-hour & weekly bucket tracking
  - **[`@AMDphreak`](https://github.com/AMDphreak)** — Gemini / Claude + GPT shared pool grouping and API reset window alignment
  - **[`@chonkydonkers`](https://github.com/chonkydonkers)** — User tier available credits display
  - **[`@iskisraell`](https://github.com/iskisraell)** — Windows Language Server process/port discovery stability

---

## 📄 License

Licensed under the [Apache License, Version 2.0](./LICENSE). See [NOTICE](./NOTICE) for upstream attribution details.
