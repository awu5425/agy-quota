# AGY Quota (`agy-quota` v1.3.2)

English | [简体中文](./README.zh-CN.md)

A 100% original, zero-dependency **Antigravity 2.x** account quota suite & **Agent Skill (`/agy-quota`)** powered by one shared engine (`src/quota-core.cjs`) and unified local history & settings store (`~/.gemini/antigravity/agy-quota`).

`agy-quota` v1.3.2 gives you **full freedom of UI choice on desktop**, **native Agent Skill (`/agy-quota`) integration**, plus headless CLI & web tools:

1. **Top-Right Semi-Ring Overlay (`--top-right` / `--meter-overlay`)** — Dual-mode adaptive top-right quota board with CDP zero-restart hot-mounting:
   - **Standalone Top-Right HUD Mode (Zero Prerequisites)**: Works out of the box on a clean Antigravity installation **without** `antigravity-context-viewer` — mounts a compact circular SVG progress badge (`#agy-quota-standalone-hud`, safely clearing Windows window controls) that opens the `476px` 4-layer adaptive `1×2` / `1×3` semi-ring popover.
   - **Zero-Copy Companion Mode**: When **[Antigravity Context Meter](https://github.com/elviscjn-cjn/antigravity-context-viewer)** (`#ag-context-meter`) is detected, automatically yields the standalone badge (zero duplicate icons!), upgrades `#panel-quota` in-place, deduplicates Language Server RPC polling into a single fetch, and survives Context Meter in-app online updates.
2. **Native Right Auxiliary Sidecar (`node install.mjs` / `--sidecar`)** — Official Antigravity 2.x `SIDECAR_UI_ENTRYPOINT_AUX_PANE` right-hand side panel requiring **zero `app.asar` hooks** (can be used on its own, or alongside the top-right HUD via `--top-right --keep-sidecar`).
3. **Self-Contained Agent Skill (`/agy-quota` / `node cli.mjs --skill` / `npx skills add`)** — Ask your AI agent in natural language or type `/agy-quota` in chat to inspect live quota pools, advise whether a heavy task/swarm fits your remaining 5h/weekly budget, or install/repair/switch your desktop quota UI on demand.
4. **Terminal CLI & Live Watch (`agy-quota`, `--watch [sec]`, `--models`, `--oauth`)** — Colored quota bars, live periodic terminal refresh, deduplicated base-model breakdown, and headless Cloud Code OAuth API fallback.
5. **Standalone Web Dashboard (`--standalone`)** — Self-contained HTTP server (`127.0.0.1` or `0.0.0.0` for SSH/remote servers) rendering the full 4-layer semi-ring dashboard in any browser.

---

## Operating Modes Comparison

| Mode | Install / Run Command | Requires `context-viewer`? | `app.asar` Hook? | Resident Process? | Best For |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1A. Top-Right Overlay (Standalone HUD)** | `node cli.mjs --top-right` | **No** (auto-mounts top-right badge) | Minimal paired tag in `dist/preload.js` | **No** | Clean Antigravity desktop wanting a sleek top-right semi-ring popover |
| **1B. Top-Right Overlay (Companion)** | `node cli.mjs --top-right` *(or `--meter-overlay`)* | Auto-detected (`#ag-context-meter`) | Minimal paired tag in `dist/preload.js` | **No** | Unified Context Meter `#panel-quota` with single-RPC zero duplicate polling |
| **2. Native Right Sidecar** | `node install.mjs` *(or `node cli.mjs --sidecar`)* | **No** | **No (Zero Patch)** | Yes (`sidecar_sdk`) | Patch-free right auxiliary side pane (`--keep-sidecar` to coexist with Top-Right) |
| **3. Agent Skill (`/agy-quota`)** | `node cli.mjs --skill` *(or `npx skills add awu5425/agy-quota`)* | **No** | **No** | **No** | Conversational quota checks, model/budget planning & one-sentence UI setup |
| **4. Terminal CLI / Watch** | `node cli.mjs` / `node cli.mjs --watch 15` | No | No | No | Terminal quick check, `agy` CLI sessions, headless Linux servers (`--oauth`) |
| **5. Standalone Web UI** | `node cli.mjs --standalone --port 4318` | No | No | On-demand HTTP | Browser preview or SSH port-forwarding on remote machines |

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for deep technical details on Dual-Mode Top-Right mounting, Agent Skill packaging & bootstrap, single-RPC IPC deduplication, ASAR surgical patching, GitHub online hot-update staging, and the L0–L4 discovery chain.

---

## What's New in v1.3.2 & Key Highlights

- **Security & Reliability Hardening (`v1.3.2`)**:
  - **Source-Pinned & Authenticated Self-Updater**: Update endpoints are strictly locked to `awu5425/agy-quota` on GitHub with 40-char commit SHA pinning and cross-file version verification; Standalone Web UI (`/api/update/*`) enforces loopback + same-origin CSRF tokens and automatically disables remote self-update mutations when bound to `0.0.0.0` unless `--admin-token` is explicitly supplied.
  - **Non-Destructive HUD Installer**: `--top-right` leaves third-party and legacy tools (`context-capsule`, etc.) 100% untouched by default (with optional `--migrate-capsule` backup & automatic restore on `--uninstall-overlay`).
  - **Unified Atomic Bundles & Cross-Volume Safe Staging**: Identical 24-file manifest across `--skill`, `--sidecar`, and `npx skills add` bootstrap with pre-flight completeness checks, same-volume atomic staging (`EXDEV`-safe), custom `--skill-dir` / `AGY_QUOTA_SKILL_DIR` self-update support, accurate short-span burn rate (`pp/h`), truthful post-reset quota display, and optional `--read-only` mode.

- **Self-Contained `/agy-quota` Agent Skill (`SKILL.md` + `skills/agy-quota/` + `node cli.mjs --skill`)**:
  - Works seamlessly across `node cli.mjs --skill` (`~/.gemini/config/skills/agy-quota` offline bundle), `npx skills add awu5425/agy-quota` (auto-bootstraps & syntax-verifies `./runtime/` on first run), `git clone ... ~/.gemini/config/skills/agy-quota`, and native Antigravity plugin bundles (`plugin.json`).
  - Lets agents check masked live quota pools, calculate safe model budgets before large coding/swarm runs, and manage Top-Right / Sidecar / Auto-Update workflows directly from `/agy-quota`.
- **Dual-Mode Adaptive Top-Right Mounting (`standalone` ↔ `companion`)**:
  - Automatically switches between Standalone Top-Right HUD (`#agy-quota-standalone-hud`) and Context Meter Companion (`#ag-context-meter` `#panel-quota`) in real time with zero icon duplication.
- **Instant Bilingual Switch (`中 / EN`)**:
  - One-click `中 / EN` language toggle in the header bar across Top-Right Overlay, Native Sidecar, and Standalone Web UI (`localStorage['agy_quota_lang']`, auto-detecting host/browser locale by default).
- **Host & System Theme Sync (`Auto / Dark / Light`)**:
  - Defaults to `Auto` — observes Antigravity host theme attributes/classes/background luminance and OS `prefers-color-scheme: dark` media changes in real time, with manual `Auto / Dark / Light` lock (`localStorage['agy_quota_theme']`).
- **GitHub Online Check & Hot Self-Update (`--check-update` / `--update` + In-Panel Auto-Update)**:
  - Compact footer bar (`.qp-footer-bar`) displays `AGY Quota v1.3.2`, update check/one-click update status, and an **`Auto-update` (`自动更新`)** toggle persisted in `~/.gemini/antigravity/agy-quota/settings.json`.
  - Queries GitHub Releases (`releases/latest` with `raw.../main/package.json` fallback and proxy auto-detection), stages files in a temp directory with mandatory JS syntax verification before atomic replacement across active overlays, plugins, and installed skill runtimes, and hot-swaps the live overlay UI without restarting Antigravity.
- **Streamlined 4-Layer Semi-Ring Quota Board (`476px`)**:
  1. **Compact Header & Account Bar**: `Arc | Ring` (`半弧 | 圆环`) gauge switch, `中 / EN` toggle, `Auto / Dark / Light` theme toggle, live refresh countdown, click-to-blur email privacy mask, and subscription tier badge (`Google AI Pro` / `Google AI Ultra`).
  2. **Adaptive `1×2` (Ultra) / `1×3` (Pro) Semi-Ring Pool Grid + Family Micro-Badges**: Dynamically matches server-returned quota groups (`RetrieveUserQuotaSummary` / `GetUserStatus`) — renders **2 equal-width cards** (`Gemini` · `Claude / GPT`) on Google AI Ultra where Argon shares `gemini-5h` / `gemini-weekly`, or **3 equal-width cards** (`Gemini` · `Argon` · `Claude / GPT`) on Google AI Pro when an independent Argon pool (`gemini-argon-wtu-weekly`) is present. Each card displays a crisp sub-label of included model families (e.g. `Carbon · Argon · Hydrogen · 3.8 Flash`, `Sonnet 4.6 · Opus 4.6 · GPT-OSS`), 210° semi-arc SVG gauge, 5h countdown, active session pool highlight, `pp/h` burn rate, and weekly bar.
  3. **Collapsible 90-Minute Per-Model & Per-Pool Usage Trend (`Models | Pools`)**: Defaults to **`Models`** (`按模型`) — renders `18 × 5m` color-coded per-model stacked bars (attributing pool quota drops by call cost/token weight, with perceptible micro-bars when calls occur before a quota step) and a compact 2-column grid of active model pills (`Carbon`, `Argon`, `Hydrogen`, `3.8 Flash`, `Opus 4.6`, `Sonnet 4.6`, `GPT-OSS`), with one-click toggle to **`Pools`** (`按池`) `1×2` / `1×3` burn-rate summary.
  4. **Collapsible Tier Credits & Update Footer**: `Google One AI` plan credits, `Prompt` / `Flow` monthly credit bars, and the v1.3.2 self-update status bar.
- **5-Tier Connection Discovery (L0–L4)**:
  - **L0** Renderer same-origin Connect-RPC → **L1** `ANTIGRAVITY_LS_*` env vars → **L2** cached `last_ls_conn.json` → **L3** OS process/port probe (Windows/macOS/Linux) → **L4** direct Google Cloud Code OAuth API fallback (`--oauth`, `--profile-dir`).

---

## Project Structure

```text
agy-quota/
├── package.json                     # v1.3.2 metadata (Apache-2.0, zero runtime dependencies)
├── cli.mjs                          # Unified CLI (--top-right, --sidecar, --skill, --watch, --update, --standalone)
├── install.mjs                      # Native Right Sidecar & self-contained Agent Skill installer/uninstaller
├── plugin.json                      # Antigravity 2.x native plugin manifest (Sidecar + /agy-quota Skill)
├── SKILL.md                         # Root Agent Skill definition (for direct git clone into skills/)
├── scripts/
│   └── agy-quota.mjs                # Self-bootstrapping Agent Skill runner
├── skills/
│   └── agy-quota/                   # Standard plugin & `npx skills add` skill bundle
│       ├── SKILL.md
│       └── scripts/
│           └── agy-quota.mjs
├── README.md                        # English documentation
├── README.zh-CN.md                  # 简体中文文档
├── LICENSE                          # Apache License 2.0
├── NOTICE                           # Upstream attribution notices
├── docs/
│   └── ARCHITECTURE.md              # Dual-mode overlay, Agent Skill, ASAR surgical patch & RPC architecture
├── assets/
│   └── logo.svg                     # Plugin icon
├── src/
│   ├── quota-core.cjs               # Shared CommonJS engine (L0-L4 discovery, OAuth, pools, 90m history, GitHub self-updater)
│   ├── overlay-preload.cjs          # Electron Preload bridge (IPC deduplication + quota/update contextBridge + UI injection)
│   ├── meter-overlay-ui.js          # Dual-mode Shadow DOM 4-layer semi-ring UI (EN/ZH, Auto/Dark/Light, hot update)
│   ├── overlay-installer.mjs        # Top-right ASAR preload patcher, --ensure self-healer, backup safety & CDP hot-mount
│   └── auto-ensure-hook.cjs         # Fast (<10ms) Antigravity SessionStart guard hook to auto-restore after host updates
└── sidecars/
    └── quota_panel/
        ├── package.json             # ESM marker ("type": "module")
        ├── sidecar.json             # Registers SIDECAR_UI_ENTRYPOINT_AUX_PANE ("Quota")
        ├── main.mjs                 # CLI / --watch / --check-update / --update / --standalone / Sidecar server
        ├── index.html               # Standalone & Sidecar HTML shell
        ├── styles.css               # Responsive 4-layer semi-ring + light/dark theme variables
        └── app.js                   # Standalone & Sidecar frontend controller (EN/ZH, Auto/Dark/Light, update bar)
```

---

## Quick Start

### 1. Desktop UI Option A — Top-Right Semi-Ring Overlay (Recommended)

Works **both** on a clean Antigravity installation (mounts its own top-right circular badge) **and** alongside Antigravity Context Meter (enhances `#panel-quota` in-place):

```bash
git clone https://github.com/awu5425/agy-quota.git
cd agy-quota

# Install top-right semi-ring overlay & hot-mount immediately via CDP (no restart needed)
# (--meter-overlay is supported as an alias; stops duplicate native sidecar by default)
node cli.mjs --top-right

# Optional: Keep BOTH the top-right overlay AND the native right auxiliary sidecar active
node cli.mjs --top-right --keep-sidecar

# Inspect ASAR hook, adaptive UI mode, auto-heal hook, runtime bundle, backup, and sidecar status
node cli.mjs --overlay-status

# Verify ASAR hooks (including companion Context Meter) and self-heal automatically if wiped by a client update
node cli.mjs --ensure

# Cleanly remove the top-right overlay hook, auto-heal hook, and runtime bundle at any time
node cli.mjs --uninstall-overlay
```

> **Automatic Self-Heal Across Antigravity Updates**: `--top-right` registers a `<10ms` `SessionStart` guard hook (`~/.gemini/config/hooks.json` -> `~/.gemini/antigravity/agy-quota/auto-ensure-hook.cjs`). When an Antigravity desktop auto-update replaces `app.asar`, the next session automatically triggers `node src/overlay-installer.mjs --ensure --quiet` in the background to restore both `antigravity-context-viewer` (when installed) and the `agy-quota` top-right semi-ring overlay cleanly, then hot-mounts active windows via CDP.

### 2. Desktop UI Option B — Native Right Auxiliary Sidecar (Zero `app.asar` Patch)

Prefer an official Antigravity 2.x right-hand auxiliary pane plugin without touching `app.asar`?

```bash
# Install/enable native right-pane sidecar plugin (~/.gemini/config/plugins/agy-quota)
node install.mjs
# (or: node cli.mjs --sidecar  |  node cli.mjs install)

# Uninstall native right-pane sidecar plugin
node install.mjs --uninstall
# (or: node cli.mjs --uninstall-sidecar)
```

### 3. Agent Skill (`/agy-quota`) — Conversational Quota & UI Control

Install `agy-quota` as a self-contained Agent Skill (`~/.gemini/config/skills/agy-quota`, zero resident background process) using any of the 3 methods below:

```bash
# Option A: Install offline self-contained skill from a local clone
node cli.mjs --skill
node cli.mjs --skill-status

# Option B: One-liner via standard `skills` CLI (auto-bootstraps & syntax-checks runtime on first use)
npx skills add awu5425/agy-quota

# Option C: Direct git clone into Antigravity global skills directory
git clone https://github.com/awu5425/agy-quota.git ~/.gemini/config/skills/agy-quota
```

Once installed, type `/agy-quota` or ask naturally in chat:
- `/agy-quota` — *"Show my current quota pools, reset timers, and 90m per-model burn."*
- *"Check my Argon & Claude quota and tell me if I have enough budget to run a 4-agent swarm."*
- *"/agy-quota install the top-right semi-ring HUD (or repair it after an Antigravity update)."*

### 4. Online Check & Hot Self-Update

```bash
# Check GitHub for a newer agy-quota version
node cli.mjs --check-update

# Download, syntax-verify in staging, and atomically update active overlay/sidecar/skill runtimes
node cli.mjs --update
```

*(You can also toggle **Auto-update / 自动更新** or click **Check / Update** directly in the bottom footer of the quota board.)*

### 5. Terminal CLI, Live Watch & Standalone Browser Server

```bash
# Colored terminal dashboard (adaptive 2-pool Ultra / 3-pool Pro, 5h/weekly windows, credits)
node cli.mjs

# Live-refreshing terminal dashboard every 15 seconds (default: 30s)
node cli.mjs --watch 15

# Deduplicated per-model quota breakdown + masked email
node cli.mjs --models --mask

# Headless Cloud Code OAuth API fallback (no running Language Server required)
node cli.mjs --oauth --mask
node cli.mjs --oauth --profile-dir ~/.gemini-profiles/1

# Standalone Web UI server (local or remote SSH port-forwarding)
node cli.mjs --standalone --port 4318
node cli.mjs --standalone --host 0.0.0.0 --port 14318 --admin-token <your-secret>
```

---

## 🤝 Recommended Companion: Antigravity Context Meter (`antigravity-context-viewer`)

If you want the complete Antigravity 2.x desktop monitoring & power-user experience, we strongly recommend pairing `agy-quota` with **[elviscjn-cjn/antigravity-context-viewer](https://github.com/elviscjn-cjn/antigravity-context-viewer)** (*Antigravity Context Meter*, created by **[`@elviscjn-cjn`](https://github.com/elviscjn-cjn)** under the MIT License):

- **What `antigravity-context-viewer` brings**:
  - Top-bar streaming generation speed (`tok/s` & TTFT) and historical per-model speed benchmarks;
  - Fine-grained conversation context segmentation and multi-format attachment (PDF, Office, image) token auditing;
  - 5-view token usage & reference API cost heatmaps (daily, weekly, monthly, yearly, cumulative) plus subscription exchange-rate calculators;
  - Built-in desktop UI localization (`zh-CN` / brand controls), TUN-free local proxy (`ProxyNoTun`), backend context window unlocking (`256K` → `1M+`), one-click workspace `agy` CLI launcher, and GitHub online hot-updates.
- **How `agy-quota` pairs with it (Zero Code Duplication)**:
  - `agy-quota` is intentionally kept **100% original and independent** (`0%` third-party source code copied) and focuses exclusively on **semi-ring quota visualization, tier-adaptive `1×2` / `1×3` pools, per-model 90-minute burn attribution, and headless CLI / Cloud Code OAuth tools**.
  - When both are installed, `node cli.mjs --top-right` automatically detects `#ag-context-meter`, snaps the streamlined semi-ring dashboard cleanly into `#panel-quota`, shares a single Language Server RPC fetch, survives `antigravity-context-viewer`'s in-app online updates, and automatically restores both tools after Antigravity client auto-updates.

---

## 🙏 Acknowledgements

Special heartfelt thanks to the open-source projects, authors, and community contributors whose pioneering work inspired and enabled this suite:

- **[`@elviscjn-cjn`](https://github.com/elviscjn-cjn)** and **[elviscjn-cjn/antigravity-context-viewer](https://github.com/elviscjn-cjn/antigravity-context-viewer)** (*Antigravity Context Meter*, MIT License) — thank you for building the remarkable Antigravity 2.x top-bar Context Meter ecosystem (`tok/s`, context auditing, heatmaps, localization, TUN-free proxy, context unlock, CLI launcher, and online updater), and for designing an open Shadow DOM `#panel-quota` architecture, static quota pass-through hook, and paired-tag `cleanPreloadSource` installer that allow `agy-quota` to integrate cleanly as a zero-copy companion enhancement.
- **[N2NS Lab (`@n2ns`)](https://github.com/n2ns)** and **[n2ns/antigravity-panel](https://github.com/n2ns/antigravity-panel)** (`Datafrog LLC`, Apache-2.0) — for pioneering Antigravity quota visualization, Language Server RPC discovery (`GetUserStatus`, `RetrieveUserQuotaSummary`), pool aggregation concepts, and semi-arc SVG gauge geometry, along with community contributors **[`@HH-Tips`](https://github.com/HH-Tips)**, **[`@AMDphreak`](https://github.com/AMDphreak)**, **[`@chonkydonkers`](https://github.com/chonkydonkers)**, and **[`@iskisraell`](https://github.com/iskisraell)**.

---

## 📄 License

Licensed under the [Apache License, Version 2.0](./LICENSE). See [NOTICE](./NOTICE) for attribution details.
