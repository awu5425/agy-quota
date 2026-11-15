#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename));
const MAIN_SCRIPT = join(REPO_ROOT, 'sidecars', 'quota_panel', 'main.mjs');
const INSTALL_SCRIPT = join(REPO_ROOT, 'install.mjs');

const HELP_TEXT = `agy-quota - Antigravity 2.x account quota CLI & sidepanel installer

Usage:
  agy-quota [options]              Show colored quota dashboard in terminal (default)
  agy-quota --models, -m           Include per-model quota breakdown
  agy-quota --mask                 Mask account email (e.g. bi***@gmail.com)
  agy-quota --no-color             Disable ANSI colors (also honors NO_COLOR)
  agy-quota --oauth                Force Cloud Code OAuth API fallback
  agy-quota --profile-dir <dir>    Target profile home for OAuth fallback
  agy-quota --json | --dump        Output full quota snapshot as JSON
  agy-quota --standalone [--host <addr>] [--port <n>]
                                   Start standalone local HTTP preview server
  agy-quota --install              Install native Antigravity 2.x sidepanel plugin
  agy-quota --uninstall            Uninstall native sidepanel plugin
  agy-quota --help, -h             Show this help message`;

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
    console.log(HELP_TEXT);
    return;
  }

  if (args.includes('--install')) {
    const forward = args.filter((a) => a !== '--install');
    process.exitCode = await runChild(INSTALL_SCRIPT, forward);
    return;
  }

  if (args.includes('--uninstall')) {
    process.exitCode = await runChild(INSTALL_SCRIPT, args);
    return;
  }

  const hasExplicitMode = args.some((a) =>
    a === '--cli' || a === '--dump' || a === '--json' || a === '--standalone' || a === '--help' || a === '-h',
  );
  const forwardArgs = hasExplicitMode ? args : ['--cli', ...args];
  process.exitCode = await runChild(MAIN_SCRIPT, forwardArgs);
}

run().catch((err) => {
  console.error(`[agy-quota] ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
