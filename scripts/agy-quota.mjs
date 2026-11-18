#!/usr/bin/env node

/**
 * Self-contained AGY Quota Skill Runner.
 * Resolves the local agy-quota CLI across repo, plugin, and standalone skill
 * layouts, and auto-bootstraps the verified runtime into ./runtime/ on first
 * run when installed as a standalone subfolder (e.g. via `npx skills add`).
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const SCRIPTS_DIR = resolve(dirname(__filename));
const SKILL_DIR = resolve(SCRIPTS_DIR, '..');

const BOOTSTRAP_REPO = process.env.AGY_QUOTA_UPDATE_REPO || 'awu5425/agy-quota';
const BOOTSTRAP_REF = process.env.AGY_QUOTA_UPDATE_REF || 'main';

const BOOTSTRAP_FILES = [
  'package.json',
  'plugin.json',
  'cli.mjs',
  'install.mjs',
  'LICENSE',
  'NOTICE',
  'assets/logo.svg',
  'src/quota-core.cjs',
  'src/overlay-preload.cjs',
  'src/meter-overlay-ui.js',
  'src/overlay-installer.mjs',
  'src/auto-ensure-hook.cjs',
  'sidecars/quota_panel/package.json',
  'sidecars/quota_panel/sidecar.json',
  'sidecars/quota_panel/main.mjs',
  'sidecars/quota_panel/index.html',
  'sidecars/quota_panel/styles.css',
  'sidecars/quota_panel/app.js',
];

function resolveLocalCliPath() {
  const candidates = [
    join(SKILL_DIR, 'runtime', 'cli.mjs'),
    join(SKILL_DIR, 'cli.mjs'),
    resolve(SKILL_DIR, '..', '..', 'cli.mjs'),
  ];
  for (const candidate of candidates) {
    if (
      existsSync(candidate) &&
      existsSync(join(dirname(candidate), 'src', 'quota-core.cjs'))
    ) {
      return candidate;
    }
  }
  return null;
}

function fetchHttpsText(url, redirectsLeft = 4) {
  return new Promise((resolveBody, reject) => {
    const req = https.get(
      url,
      {
        headers: { 'User-Agent': 'agy-quota-skill-bootstrap/1.3.0' },
        timeout: 15_000,
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location && redirectsLeft > 0) {
          res.resume();
          const nextUrl = new URL(res.headers.location, url).toString();
          resolveBody(fetchHttpsText(nextUrl, redirectsLeft - 1));
          return;
        }
        if (status !== 200) {
          res.resume();
          reject(new Error(`HTTP ${status} fetching ${url}`));
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => resolveBody(body));
      },
    );
    req.on('timeout', () => req.destroy(new Error(`Timeout fetching ${url}`)));
    req.on('error', reject);
  });
}

async function bootstrapRuntimeIntoSkillDir() {
  const runtimeDir = join(SKILL_DIR, 'runtime');
  const stageDir = join(tmpdir(), `agy-quota-skill-bootstrap-${process.pid}-${Date.now()}`);
  mkdirSync(stageDir, { recursive: true });

  try {
    console.error(`[agy-quota] Bootstrapping runtime from ${BOOTSTRAP_REPO}@${BOOTSTRAP_REF}...`);
    for (const relPath of BOOTSTRAP_FILES) {
      const url = `https://raw.githubusercontent.com/${BOOTSTRAP_REPO}/${BOOTSTRAP_REF}/${relPath}`;
      const content = await fetchHttpsText(url);
      if (!content || !content.trim()) {
        throw new Error(`Empty response while bootstrapping ${relPath}`);
      }
      const dst = join(stageDir, ...relPath.split('/'));
      mkdirSync(dirname(dst), { recursive: true });
      writeFileSync(dst, content, 'utf8');
    }

    for (const relPath of BOOTSTRAP_FILES) {
      const ext = extname(relPath).toLowerCase();
      if (ext === '.js' || ext === '.cjs' || ext === '.mjs') {
        execFileSync(process.execPath, ['--check', join(stageDir, ...relPath.split('/'))], {
          stdio: 'pipe',
          windowsHide: true,
        });
      }
    }

    rmSync(runtimeDir, { recursive: true, force: true });
    mkdirSync(dirname(runtimeDir), { recursive: true });
    renameSync(stageDir, runtimeDir);
    return join(runtimeDir, 'cli.mjs');
  } catch (err) {
    rmSync(stageDir, { recursive: true, force: true });
    throw err;
  }
}

function runForward(cliPath, args) {
  return new Promise((resolveExit, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
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

async function main() {
  let cliPath = resolveLocalCliPath();
  if (!cliPath) {
    cliPath = await bootstrapRuntimeIntoSkillDir();
  }
  process.exitCode = await runForward(cliPath, process.argv.slice(2));
}

main().catch((err) => {
  console.error(`[agy-quota] skill runner error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
