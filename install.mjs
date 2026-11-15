#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_DIR_NAME = 'agy-quota';
const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename));
const TARGET_ROOT = join(homedir(), '.gemini', 'config', 'plugins', PLUGIN_DIR_NAME);

const COPY_ENTRIES = [
  'plugin.json',
  'README.md',
  'README.zh-CN.md',
  'LICENSE',
  'NOTICE',
  'assets',
  join('sidecars', 'quota_panel', 'package.json'),
  join('sidecars', 'quota_panel', 'sidecar.json'),
  join('sidecars', 'quota_panel', 'main.mjs'),
  join('sidecars', 'quota_panel', 'index.html'),
  join('sidecars', 'quota_panel', 'styles.css'),
  join('sidecars', 'quota_panel', 'app.js'),
];

function parseArgs(argv) {
  let uninstall = false;
  let target = TARGET_ROOT;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--uninstall' || arg === '-u') {
      uninstall = true;
    } else if (arg === '--target' && argv[i + 1]) {
      target = resolve(argv[i + 1]);
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node install.mjs [--uninstall] [--target <dir>]

Options:
  --uninstall, -u   Remove installed plugin from ${TARGET_ROOT}
  --target <dir>    Override plugin installation directory
  --help, -h        Show this help message`);
      process.exit(0);
    }
  }

  return { uninstall, target };
}

function install(target) {
  mkdirSync(target, { recursive: true });

  for (const relPath of COPY_ENTRIES) {
    const src = join(REPO_ROOT, relPath);
    if (!existsSync(src)) {
      throw new Error(`Missing source file or directory: ${src}`);
    }
    const dest = join(target, relPath);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest, { recursive: true, force: true });
  }

  console.log(`Installed ${PLUGIN_DIR_NAME} to ${target}`);
}

function uninstall(target) {
  if (!existsSync(target)) {
    console.log(`Nothing to uninstall at ${target}`);
    return;
  }
  rmSync(target, { recursive: true, force: true });
  console.log(`Removed ${PLUGIN_DIR_NAME} from ${target}`);
}

const { uninstall: shouldUninstall, target } = parseArgs(process.argv.slice(2));
if (shouldUninstall) {
  uninstall(target);
} else {
  install(target);
}
