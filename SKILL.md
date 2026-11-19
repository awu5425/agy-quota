---
name: agy-quota
description: >-
  Check real-time Antigravity account quota pools (Gemini, Argon, Claude/GPT),
  5-hour and weekly reset countdowns, per-model 90-minute burn rates, and
  subscription credits, or install, self-heal, update, and switch the AGY Quota
  desktop semi-ring HUD (--top-right), native right sidecar (--sidecar), and
  standalone web dashboard. Use when the user asks about remaining quota, usage
  rate, model selection budget, reset times, quota panel installation, or runs
  /agy-quota.
argument-hint: "[status | models | top-right | sidecar | ensure | update | standalone]"
license: Apache-2.0
---

# AGY Quota (`agy-quota`)

Inspect real-time Antigravity 2.x account quota pools, 90-minute per-model burn rates, and reset countdowns, or manage the desktop semi-ring quota UI (`--top-right` HUD and `--sidecar` right pane).

## Runner Path

Run all commands via [agy-quota.mjs](./scripts/agy-quota.mjs) relative to this `SKILL.md`'s directory (`<skill_dir>`):

```bash
node "<skill_dir>/scripts/agy-quota.mjs" <args>
```

> **Privacy & Local State Notes**:
> - **Mask emails by default**: Always pass `--mask` when printing or inspecting quota output unless the user explicitly asks to see their full unmasked email address.
> - **Local cache, history & OAuth refresh behavior**: By default, quota queries update local connection cache (`~/.gemini/antigravity/agy-quota/last_ls_conn.json`, `0600`) and 90-minute rolling usage history (`quota_history.json`) to compute accurate burn rates (`pp/h`). When falling back to Cloud Code OAuth (`--oauth` or no local Language Server) and the local access token is expired, it refreshes the token via Google OAuth2 and writes the refreshed token back to `antigravity-oauth-token`.
> - **Strict zero-write mode**: Pass `--read-only` (e.g. `node "<skill_dir>/scripts/agy-quota.mjs" --json --mask --read-only`) if the user requests a strictly stateless check with zero local directory creation, zero cache/history writes, and zero OAuth token writeback (requires `./runtime/` already present locally; refuses online bootstrap while `--read-only` is active).
> - **First-run subfolder bootstrap**: If installed via `npx skills add awu5425/agy-quota` without `./runtime/`, the first non-read-only invocation resolves an immutable 40-char Git commit SHA from `awu5425/agy-quota` on GitHub (failing closed if commit SHA resolution is unavailable) and verifies JS syntax before execution.
> - **Platform verification status**: Verified end-to-end on **Windows**; **macOS and Linux** support is implemented in code (`ps`/`lsof` and `/proc`/`ss` + OAuth fallback) **but has not been verified on physical macOS/Linux hardware** — prefer zero-patch modes (`--json --mask`, `--oauth`, `--sidecar`, `--standalone`) on macOS/Linux unless the user explicitly requests `--top-right`.

## Workflows

### 1. Check Live Quota & Recommend Model Budget (Default)

When the user runs `/agy-quota` with no arguments or asks how much quota remains / which model is burning quota:

1. Run:
   ```bash
   node "<skill_dir>/scripts/agy-quota.mjs" --json --mask
   ```
   *(If no local Language Server is running on a headless machine, retry with `--oauth --json --mask`.)*
2. Summarize concisely from the JSON output:
   - **Account & Mode**: `userInfo.tier` (e.g. `Google AI Ultra` / `Google AI Pro`), masked `userInfo.email`, and `poolMode` (`2-pool` on Ultra where Neon/Carbon/Argon/Hydrogen/Flash share `Gemini`, vs `3-pool` on Pro where `Argon` has an independent weekly bucket).
   - **Quota Pools (`pools[]`)**: `5h` remaining `%` & `resetTime`, `weekly.remaining` `%` & `weekly.resetTime`, burn rate `prediction.usageRate` (`pp/h`, computed over actual observed elapsed span) & `prediction.runway`, and `familySummary`.
   - **90m Per-Model Burn (`history.modelSummaries[]`)**: Which base models (`Neon`, `Carbon`, `Argon`, `Hydrogen`, `3.8 Flash`, `Opus`, `Sonnet`, `GPT-OSS`) actively consumed quota (`totalPp`, `usageRatePp`, `calls`).
   - **Credits (`credits`)**: `prompt`, `flow`, and `userCredits` (`Google One AI`).
   - **Budget Tip**: If any pool is below `30%` and its runway is shorter than `resetTime`, suggest switching heavy subtasks to a healthier pool (e.g. `Claude / GPT`) or lighter family (`3.8 Flash`) until reset.

For a quick terminal table including deduplicated base models (`/agy-quota models`), run:

```bash
node "<skill_dir>/scripts/agy-quota.mjs" --models --mask --no-color
```

### 2. Install, Verify, or Switch Desktop Quota UI

> **Non-destructive guarantee**: `--top-right` leaves other third-party or legacy tools untouched by default. Only pass `--migrate-capsule` if the user explicitly asks to retire an older `context-capsule` prototype (which is backed up and automatically restored upon `--uninstall-overlay`).

| User Intent | Command | Verification |
| :--- | :--- | :--- |
| **Install / repair Top-Right Semi-Ring HUD** (`/agy-quota top-right`) — auto-adapts to standalone top-right badge or `antigravity-context-viewer` companion, and registers the `<10ms` `SessionStart` self-heal hook | `node "<skill_dir>/scripts/agy-quota.mjs" --top-right` | Run `--overlay-status` and confirm `ACTIVE (HEALTHY)` and `auto-heal hook: active`. |
| **Keep both Top-Right HUD & Native Right Sidecar** | `node "<skill_dir>/scripts/agy-quota.mjs" --top-right --keep-sidecar` | Confirm `sidecarInstalled: true` in `--overlay-status --json`. |
| **Self-heal after an Antigravity client update** (`/agy-quota ensure`) | `node "<skill_dir>/scripts/agy-quota.mjs" --ensure` | Confirm exit code `0` and `ACTIVE (HEALTHY)`. |
| **Switch to patch-free Native Right Auxiliary Sidecar** (`/agy-quota sidecar`) | `node "<skill_dir>/scripts/agy-quota.mjs" --uninstall-overlay` then `node "<skill_dir>/scripts/agy-quota.mjs" --sidecar` | Run `--sidecar-status` and confirm `INSTALLED`; surface `[Quota](sidecar://agy-quota/quota_panel/)` once enabled. |
| **Uninstall Top-Right Overlay or Sidecar** | `node "<skill_dir>/scripts/agy-quota.mjs" --uninstall-overlay` or `--uninstall-sidecar` | Confirm exit code `0`. |

### 3. Online Check & Hot Self-Update (`/agy-quota update`)

Updates are pinned exclusively to `awu5425/agy-quota` on GitHub and commit-locked before download:

```bash
node "<skill_dir>/scripts/agy-quota.mjs" --check-update --force
node "<skill_dir>/scripts/agy-quota.mjs" --update
```

Verify exit code `0` and report the updated version and synced runtime targets (including custom `<skill_dir>` installations).

### 4. Standalone Browser Dashboard (`/agy-quota standalone`)

For local browser preview or headless Linux / SSH port-forwarding:

```bash
node "<skill_dir>/scripts/agy-quota.mjs" --standalone --host 127.0.0.1 --port 4318
```

Pass `--host 0.0.0.0 --admin-token <secret>` only when the user explicitly wants LAN/remote access (binding to non-loopback interfaces requires `--admin-token`, enforces trusted `Host`/`Origin` headers against DNS rebinding, and protects `/api/quota` and `/api/update/*` with token authentication).
