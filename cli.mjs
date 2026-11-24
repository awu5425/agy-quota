#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename));
const MAIN_SCRIPT = join(REPO_ROOT, 'sidecars', 'quota_panel', 'main.mjs');
const INSTALL_SCRIPT = join(REPO_ROOT, 'install.mjs');
const OVERLAY_SCRIPT = join(REPO_ROOT, 'src', 'overlay-installer.mjs');

function getPackageVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
    return pkg.version || '1.3.5';
  } catch {
    return '1.3.5';
  }
}

function buildHelpText() {
  const ver = getPackageVersion();
  return `agy-quota v${ver} - Antigravity 2.x Quota Suite (Top-Right HUD, Agent Skill, Sidecar, CLI & Web UI)

Usage:
  agy-quota [options]                    Show colored quota dashboard in terminal (default)
  agy-quota --watch [sec]                Live refresh terminal dashboard (default: 30s)
  agy-quota --models, -m                 Include deduplicated per-model quota breakdown
  agy-quota --mask                       Mask account email (e.g. bi***@gmail.com)
  agy-quota --no-color                   Disable ANSI colors (also honors NO_COLOR)
  agy-quota --read-only                  Stateless query (skip writing cache, history & refreshed OAuth token)
  agy-quota --oauth                      Force Cloud Code OAuth API fallback
  agy-quota --profile-dir <dir>          Target profile home for OAuth fallback
  agy-quota --json | --dump              Output full quota snapshot as JSON
  agy-quota --standalone [--host <addr>] [--port <n>] [--admin-token <tok>]
                                         Start standalone local HTTP dashboard server

1) Desktop Top-Right Semi-Ring Overlay (Standalone HUD or Context Meter Companion):
  agy-quota --top-right [--asar <path>]  Install/update top-right semi-ring board & hot-mount via CDP
                                         (Leaves other third-party tools untouched by default!)
  agy-quota --meter-overlay              Alias for --top-right
  agy-quota --top-right --keep-sidecar   Install top-right HUD while ALSO keeping the native right sidecar
  agy-quota --top-right --migrate-capsule Opt in to backing up & retiring legacy context-capsule (restored on uninstall)
  agy-quota --ensure [--quiet]           Verify ASAR hooks (and companion Context Meter) and self-heal if wiped
  agy-quota --launch [--cdp-port <n>]    Self-heal ASAR if wiped, then launch Antigravity with CDP hot-mount
  agy-quota --relaunch                   Close Antigravity, self-heal plugins, and restart cleanly
  agy-quota --shortcut                   Create Desktop quick-launch & heal-restart shortcuts (Windows)
  agy-quota --overlay-status [--json]    Inspect ASAR hook, runtime bundle, backup & sidecar status
  agy-quota --uninstall-overlay          Remove ASAR preload hook & top-right overlay cleanly

2) Agent Skill (/agy-quota Slash Command & Natural-Language Quota Assistant):
  agy-quota --skill | --install-skill    Install self-contained /agy-quota skill (~/.gemini/config/skills/agy-quota)
  agy-quota --skill-status [--json]      Check installed /agy-quota skill status
  agy-quota --uninstall-skill            Remove standalone /agy-quota skill

3) Desktop Native Right Auxiliary Sidecar (Zero ASAR Patch):
  agy-quota --sidecar | install          Install patch-free native right-pane plugin (same as node install.mjs)
  agy-quota --sidecar-status [--json]    Check native right-pane plugin status
  agy-quota --uninstall-sidecar          Remove native right-pane plugin (same as node install.mjs --uninstall)

Online Self-Update:
  agy-quota --check-update [--force]     Check GitHub for newer agy-quota releases
  agy-quota --update [--dry-run]         Download, syntax-verify, and atomically apply latest update

General:
  agy-quota --version, -v                Print package version
  agy-quota --help, -h                   Show this help message`;
}

function runChild(scriptPath, childArgs) {
  return new Promise((resolveExit, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...childArgs], {
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      resolveExit(code ?? 0);
    });
  });
}

async function run() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(buildHelpText());
    return;
  }

  if (args.includes('--version') || args.includes('-v')) {
    console.log(getPackageVersion());
    return;
  }

  // 1. Top-Right Overlay installer / ensure / status / uninstaller
  if (
    args.includes('--top-right') ||
    args.includes('--meter-overlay') ||
    args.includes('--ensure') ||
    args.includes('--launch') ||
    args.includes('--relaunch') ||
    args.includes('--restart-host') ||
    args.includes('--shortcut') ||
    args.includes('--overlay-status') ||
    args.includes('--uninstall-overlay')
  ) {
    const forward = [...args];
    if (args.includes('--sidecar') && !forward.includes('--keep-sidecar')) {
      forward.push('--keep-sidecar');
    }
    process.exitCode = await runChild(OVERLAY_SCRIPT, forward);
    return;
  }

  // 2. Standalone Agent Skill (/agy-quota) installer / status / uninstaller
  if (
    args.includes('--skill') ||
    args.includes('--install-skill') ||
    args.includes('--uninstall-skill') ||
    args.includes('--skill-status')
  ) {
    process.exitCode = await runChild(INSTALL_SCRIPT, args);
    return;
  }

  // 3. Native Right Auxiliary Sidecar installer / uninstaller / status
  if (
    args.includes('--uninstall-sidecar') ||
    args.includes('--uninstall') ||
    args[0] === 'uninstall'
  ) {
    const forward = args.filter(
      (a, idx) =>
        a !== '--uninstall-sidecar' && a !== '--uninstall' && !(idx === 0 && a === 'uninstall'),
    );
    process.exitCode = await runChild(INSTALL_SCRIPT, ['--uninstall', ...forward]);
    return;
  }

  if (args.includes('--sidecar-status')) {
    const forward = args.filter((a) => a !== '--sidecar-status');
    process.exitCode = await runChild(INSTALL_SCRIPT, ['--status', ...forward]);
    return;
  }

  if (args.includes('--sidecar') || args.includes('--install') || args[0] === 'install') {
    const forward = args.filter(
      (a, idx) => a !== '--sidecar' && a !== '--install' && !(idx === 0 && a === 'install'),
    );
    process.exitCode = await runChild(INSTALL_SCRIPT, forward);
    return;
  }

  // 3. Terminal CLI, Watch, Standalone HTTP, JSON Dump, or Online Update commands
  const hasExplicitMode = args.some(
    (a) =>
      a === '--cli' ||
      a === '--dump' ||
      a === '--json' ||
      a === '--standalone' ||
      a === '--check-update' ||
      a === '--update' ||
      a === '--watch' ||
      a === '-w' ||
      a.startsWith('--watch=') ||
      a === '--help' ||
      a === '-h',
  );
  const forwardArgs = hasExplicitMode ? args : ['--cli', ...args];
  process.exitCode = await runChild(MAIN_SCRIPT, forwardArgs);
}

run().catch((err) => {
  console.error(`[agy-quota] ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
