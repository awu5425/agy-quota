#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_DIR_NAME = 'agy-quota';
const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename));
export const DEFAULT_SIDECAR_TARGET = join(homedir(), '.gemini', 'config', 'plugins', PLUGIN_DIR_NAME);
export const DEFAULT_SKILL_TARGET = join(homedir(), '.gemini', 'config', 'skills', PLUGIN_DIR_NAME);

export const CANONICAL_BUNDLE_FILES = Object.freeze([
  'package.json',
  'plugin.json',
  'cli.mjs',
  'install.mjs',
  'SKILL.md',
  'README.md',
  'README.zh-CN.md',
  'LICENSE',
  'NOTICE',
  'assets/logo.svg',
  'scripts/agy-quota.mjs',
  'skills/agy-quota/SKILL.md',
  'skills/agy-quota/scripts/agy-quota.mjs',
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
]);

export const SIDECAR_COPY_ENTRIES = CANONICAL_BUNDLE_FILES;
export const SKILL_RUNTIME_ENTRIES = CANONICAL_BUNDLE_FILES;

function readRepoVersion(sourceRoot = REPO_ROOT) {
  try {
    const pkg = JSON.parse(readFileSync(join(sourceRoot, 'package.json'), 'utf8'));
    return pkg.version || '1.3.3';
  } catch {
    return '1.3.3';
  }
}

export function verifyManifestComplete(sourceRoot = REPO_ROOT, entries = CANONICAL_BUNDLE_FILES) {
  const root = resolve(sourceRoot);
  const missing = [];
  for (const relPath of entries) {
    const full = join(root, ...String(relPath).split(/[\\/]+/));
    if (!existsSync(full)) {
      missing.push(relPath);
      continue;
    }
    const st = statSync(full);
    if (st.isFile() && st.size === 0) {
      missing.push(`${relPath} (empty)`);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Bundle integrity check failed in ${root}; missing required files: ${missing.join(', ')}`,
    );
  }
}

export function moveDirectorySafe(
  srcDir,
  dstDir,
  { renameImpl = renameSync, cpImpl = cpSync } = {},
) {
  mkdirSync(dirname(dstDir), { recursive: true });
  try {
    renameImpl(srcDir, dstDir);
  } catch (err) {
    const code = err && err.code;
    if (code === 'EXDEV' || code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') {
      try {
        cpImpl(srcDir, dstDir, { recursive: true, force: true });
      } catch (copyErr) {
        // Immediately clean up any half-copied destination so partial state never lingers
        rmSync(dstDir, { recursive: true, force: true });
        throw copyErr;
      }
      rmSync(srcDir, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
}

export function atomicCommitStagedDirectory(
  stageDir,
  resolvedTarget,
  { renameImpl = renameSync, cpImpl = cpSync, verifyTarget = null } = {},
) {
  const parentDir = dirname(resolvedTarget);
  mkdirSync(parentDir, { recursive: true });
  const backupDir = `${resolvedTarget}.bak-${process.pid}-${Date.now()}`;
  let hadExisting = false;

  if (existsSync(resolvedTarget)) {
    hadExisting = true;
    moveDirectorySafe(resolvedTarget, backupDir);
  }

  try {
    moveDirectorySafe(stageDir, resolvedTarget, { renameImpl, cpImpl });
    if (typeof verifyTarget === 'function') {
      verifyTarget(resolvedTarget);
    }
  } catch (err) {
    // Always remove any partial/corrupted target directory before restoring the previous installation
    if (existsSync(resolvedTarget)) {
      rmSync(resolvedTarget, { recursive: true, force: true });
    }
    if (hadExisting && existsSync(backupDir)) {
      try {
        moveDirectorySafe(backupDir, resolvedTarget);
      } catch {
        // preserve backupDir on disk if restore also failed
      }
    }
    throw err;
  }

  if (hadExisting && existsSync(backupDir)) {
    rmSync(backupDir, { recursive: true, force: true });
  }
}

function deleteFilesOnlyRecursive(dirPath) {
  if (!existsSync(dirPath)) return;
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const full = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      deleteFilesOnlyRecursive(full);
    } else {
      try {
        rmSync(full, { force: true });
      } catch {
        // ignore locked file during initial pass
      }
    }
  }
}

function probeIsQuotaPanelSidecar(port, timeoutMs = 450) {
  return new Promise((resolveMatch) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/styles.css', timeout: timeoutMs },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          if (body.length < 4096) body += chunk;
        });
        res.on('end', () => {
          resolveMatch(body.includes('--qp-') || body.includes('quota_panel'));
        });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolveMatch(false);
    });
    req.on('error', () => resolveMatch(false));
  });
}

export async function stopOrphanedQuotaPanelSidecars() {
  if (process.platform !== 'win32') {
    return;
  }
  try {
    const out = execFileSync('netstat', ['-ano', '-p', 'tcp'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000,
    });
    const candidates = [];
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^\s*TCP\s+127\.0\.0\.1:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
      if (m) {
        const port = Number(m[1]);
        const pid = Number(m[2]);
        if (port > 1024 && pid > 0 && pid !== process.pid) {
          candidates.push({ port, pid });
        }
      }
    }
    const probes = await Promise.all(
      candidates.map(async (c) => ({
        ...c,
        matched: await probeIsQuotaPanelSidecar(c.port),
      })),
    );
    for (const item of probes) {
      if (item.matched) {
        try {
          process.kill(item.pid);
        } catch {
          // ignore if already exited
        }
      }
    }
  } catch {
    // ignore discovery errors
  }
}

export function installSidecarPlugin({
  target = DEFAULT_SIDECAR_TARGET,
  sourceRoot = REPO_ROOT,
  renameImpl = renameSync,
  cpImpl = cpSync,
} = {}) {
  const resolvedSource = resolve(sourceRoot);
  const resolvedTarget = resolve(target);

  // Pre-flight completeness check BEFORE touching target directory
  verifyManifestComplete(resolvedSource, SIDECAR_COPY_ENTRIES);

  const parentDir = dirname(resolvedTarget);
  mkdirSync(parentDir, { recursive: true });
  const stageDir = join(parentDir, `.agy-quota-sidecar-stage-${process.pid}-${Date.now()}`);
  mkdirSync(stageDir, { recursive: true });

  try {
    for (const relPath of SIDECAR_COPY_ENTRIES) {
      const segments = String(relPath).split(/[\\/]+/);
      const src = join(resolvedSource, ...segments);
      const dest = join(stageDir, ...segments);
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(src, dest, { recursive: true, force: true });
    }

    const version = readRepoVersion(resolvedSource);
    writeFileSync(
      join(stageDir, 'installed-version.json'),
      JSON.stringify(
        {
          version,
          mode: 'sidecar',
          installedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf8',
    );

    verifyManifestComplete(stageDir, SIDECAR_COPY_ENTRIES);
    atomicCommitStagedDirectory(stageDir, resolvedTarget, {
      renameImpl,
      cpImpl,
      verifyTarget: (dir) => verifyManifestComplete(dir, SIDECAR_COPY_ENTRIES),
    });

    return {
      ok: true,
      version,
      target: resolvedTarget,
    };
  } catch (err) {
    rmSync(stageDir, { recursive: true, force: true });
    throw err;
  }
}

export async function uninstallSidecarPlugin({ target = DEFAULT_SIDECAR_TARGET } = {}) {
  const resolvedTarget = resolve(target);
  if (!existsSync(resolvedTarget)) {
    return { ok: true, removed: false, target: resolvedTarget };
  }

  // Delete files first so Antigravity's plugin watcher stops active sidecars cleanly
  deleteFilesOnlyRecursive(resolvedTarget);

  let lastErr = null;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      rmSync(resolvedTarget, { recursive: true, force: true });
      if (!existsSync(resolvedTarget)) {
        return { ok: true, removed: true, target: resolvedTarget };
      }
    } catch (err) {
      lastErr = err;
      if (attempt === 2) {
        await stopOrphanedQuotaPanelSidecars();
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  if (existsSync(resolvedTarget) && lastErr) {
    throw lastErr;
  }
  return { ok: true, removed: !existsSync(resolvedTarget), target: resolvedTarget };
}

export function getSidecarPluginStatus({ target = DEFAULT_SIDECAR_TARGET } = {}) {
  const resolvedTarget = resolve(target);
  const installed = existsSync(join(resolvedTarget, 'plugin.json'));
  let version = null;
  if (installed) {
    try {
      const metaPath = join(resolvedTarget, 'installed-version.json');
      const pkgPath = join(resolvedTarget, 'package.json');
      if (existsSync(metaPath)) {
        version = JSON.parse(readFileSync(metaPath, 'utf8')).version || null;
      } else if (existsSync(pkgPath)) {
        version = JSON.parse(readFileSync(pkgPath, 'utf8')).version || null;
      }
    } catch {
      version = null;
    }
  }
  return {
    installed,
    version,
    target: resolvedTarget,
  };
}

export function installSkillBundle({
  target = DEFAULT_SKILL_TARGET,
  sourceRoot = REPO_ROOT,
  renameImpl = renameSync,
  cpImpl = cpSync,
} = {}) {
  const resolvedSource = resolve(sourceRoot);
  const resolvedTarget = resolve(target);

  // Pre-flight completeness check BEFORE touching target directory
  verifyManifestComplete(resolvedSource, SKILL_RUNTIME_ENTRIES);

  const parentDir = dirname(resolvedTarget);
  mkdirSync(parentDir, { recursive: true });
  const stageDir = join(parentDir, `.agy-quota-skill-stage-${process.pid}-${Date.now()}`);
  mkdirSync(stageDir, { recursive: true });

  try {
    const skillMdSrc = join(resolvedSource, 'skills', 'agy-quota', 'SKILL.md');
    const runnerSrc = join(resolvedSource, 'skills', 'agy-quota', 'scripts', 'agy-quota.mjs');
    cpSync(skillMdSrc, join(stageDir, 'SKILL.md'), { force: true });
    mkdirSync(join(stageDir, 'scripts'), { recursive: true });
    cpSync(runnerSrc, join(stageDir, 'scripts', 'agy-quota.mjs'), { force: true });

    const stageRuntimeRoot = join(stageDir, 'runtime');
    mkdirSync(stageRuntimeRoot, { recursive: true });
    for (const relPath of SKILL_RUNTIME_ENTRIES) {
      const segments = String(relPath).split(/[\\/]+/);
      const src = join(resolvedSource, ...segments);
      const dest = join(stageRuntimeRoot, ...segments);
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(src, dest, { recursive: true, force: true });
    }

    const version = readRepoVersion(resolvedSource);
    const versionMeta = JSON.stringify(
      {
        version,
        mode: 'skill',
        installedAt: new Date().toISOString(),
      },
      null,
      2,
    );
    writeFileSync(join(stageDir, 'installed-version.json'), versionMeta, 'utf8');
    writeFileSync(join(stageRuntimeRoot, 'installed-version.json'), versionMeta, 'utf8');

    verifyManifestComplete(stageRuntimeRoot, SKILL_RUNTIME_ENTRIES);
    atomicCommitStagedDirectory(stageDir, resolvedTarget, {
      renameImpl,
      cpImpl,
      verifyTarget: (dir) => verifyManifestComplete(join(dir, 'runtime'), SKILL_RUNTIME_ENTRIES),
    });

    return {
      ok: true,
      version,
      target: resolvedTarget,
      runtimeRoot: join(resolvedTarget, 'runtime'),
    };
  } catch (err) {
    rmSync(stageDir, { recursive: true, force: true });
    throw err;
  }
}

export function uninstallSkillBundle({ target = DEFAULT_SKILL_TARGET } = {}) {
  const resolvedTarget = resolve(target);
  if (!existsSync(resolvedTarget)) {
    return { ok: true, removed: false, target: resolvedTarget };
  }
  rmSync(resolvedTarget, { recursive: true, force: true });
  return { ok: true, removed: !existsSync(resolvedTarget), target: resolvedTarget };
}

export function getSkillStatus({ target = DEFAULT_SKILL_TARGET } = {}) {
  const resolvedTarget = resolve(target);
  const hasSkillMd = existsSync(join(resolvedTarget, 'SKILL.md'));
  const hasRunner = existsSync(join(resolvedTarget, 'scripts', 'agy-quota.mjs'));
  const hasEmbeddedRuntime = existsSync(join(resolvedTarget, 'runtime', 'cli.mjs'));
  const hasDirectCli = existsSync(join(resolvedTarget, 'cli.mjs'));
  const installed = hasSkillMd && hasRunner;
  let version = null;
  if (installed) {
    for (const candidate of [
      join(resolvedTarget, 'installed-version.json'),
      join(resolvedTarget, 'runtime', 'installed-version.json'),
      join(resolvedTarget, 'runtime', 'package.json'),
      join(resolvedTarget, 'package.json'),
    ]) {
      if (existsSync(candidate)) {
        try {
          version = JSON.parse(readFileSync(candidate, 'utf8')).version || null;
          if (version) break;
        } catch {
          // ignore malformed version file
        }
      }
    }
  }
  return {
    installed,
    selfContained: hasEmbeddedRuntime || hasDirectCli,
    version,
    target: resolvedTarget,
  };
}

function parseArgs(argv) {
  let mode = 'install';
  let target = null;
  let json = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--uninstall' || arg === '-u' || arg === '--uninstall-sidecar' || arg === 'uninstall') {
      mode = 'uninstall';
    } else if (arg === '--sidecar' || arg === '--install' || arg === 'install') {
      mode = 'install';
    } else if (arg === '--status' || arg === '--sidecar-status') {
      mode = 'status';
    } else if (arg === '--skill' || arg === '--install-skill') {
      mode = 'install-skill';
    } else if (arg === '--uninstall-skill') {
      mode = 'uninstall-skill';
    } else if (arg === '--skill-status') {
      mode = 'skill-status';
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--target' && argv[i + 1]) {
      target = resolve(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--target=')) {
      target = resolve(arg.slice('--target='.length));
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node install.mjs [options]

Installs or removes the AGY Quota Native Sidecar plugin or Standalone Agent Skill (/agy-quota).
(Tip: For the top-right semi-ring quota overlay, run: node cli.mjs --top-right)

Options:
  --sidecar              Install native right-pane plugin to ${DEFAULT_SIDECAR_TARGET} (default)
  --uninstall, -u        Remove native sidecar plugin
  --status               Show native sidecar plugin status
  --skill                Install self-contained /agy-quota skill to ${DEFAULT_SKILL_TARGET}
  --uninstall-skill      Remove standalone /agy-quota skill
  --skill-status         Show standalone /agy-quota skill status
  --target <dir>         Override target installation directory
  --json                 Print machine-readable JSON output
  --help, -h             Show this help message`);
      process.exit(0);
    }
  }

  const defaultTarget = mode.includes('skill') ? DEFAULT_SKILL_TARGET : DEFAULT_SIDECAR_TARGET;
  return { mode, target: target || defaultTarget, json };
}

async function runCli() {
  const { mode, target, json } = parseArgs(process.argv.slice(2));
  if (mode === 'skill-status') {
    const status = getSkillStatus({ target });
    if (json) {
      console.log(JSON.stringify(status, null, 2));
    } else {
      console.log(
        `[agy-quota] Agent Skill Status: ${
          status.installed
            ? `INSTALLED (v${status.version || 'unknown'}, self-contained: ${status.selfContained})`
            : 'NOT INSTALLED'
        }`,
      );
      console.log(`  skill dir  : ${status.target}`);
    }
    return;
  }

  if (mode === 'uninstall-skill') {
    const res = uninstallSkillBundle({ target });
    if (json) {
      console.log(JSON.stringify(res, null, 2));
    } else if (res.removed) {
      console.log(`[agy-quota] Removed /agy-quota skill from ${res.target}`);
    } else {
      console.log(`[agy-quota] Nothing to uninstall at ${res.target}`);
    }
    return;
  }

  if (mode === 'install-skill') {
    const res = installSkillBundle({ target });
    if (json) {
      console.log(JSON.stringify(res, null, 2));
    } else {
      console.log(`[agy-quota] Installed self-contained /agy-quota skill (v${res.version}) to ${res.target}`);
      console.log('  slash cmd  : /agy-quota (available from your next agent turn)');
      console.log('  runtime    : embedded offline bundle (zero resident background process)');
    }
    return;
  }

  if (mode === 'status') {
    const status = getSidecarPluginStatus({ target });
    if (json) {
      console.log(JSON.stringify(status, null, 2));
    } else {
      console.log(
        `[agy-quota] Native Sidecar Status: ${status.installed ? `INSTALLED (v${status.version || 'unknown'})` : 'NOT INSTALLED'}`,
      );
      console.log(`  plugin dir : ${status.target}`);
    }
    return;
  }

  if (mode === 'uninstall') {
    const res = await uninstallSidecarPlugin({ target });
    if (json) {
      console.log(JSON.stringify(res, null, 2));
    } else if (res.removed) {
      console.log(`[agy-quota] Removed native right-pane sidecar plugin from ${res.target}`);
    } else {
      console.log(`[agy-quota] Nothing to uninstall at ${res.target}`);
    }
    return;
  }

  const res = installSidecarPlugin({ target });
  if (json) {
    console.log(JSON.stringify(res, null, 2));
  } else {
    console.log(`[agy-quota] Installed native right-pane sidecar plugin (v${res.version}) to ${res.target}`);
    console.log('  mode       : Patch-free Native Auxiliary Side Pane (app.asar untouched)');
    console.log('  coexist tip: Run `node cli.mjs --top-right --keep-sidecar` if you also want the top-right HUD');
  }
}

function safeRealpath(p) {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

const isDirectEntry =
  Boolean(process.argv[1]) &&
  safeRealpath(process.argv[1]).toLowerCase() === safeRealpath(__filename).toLowerCase();

if (isDirectEntry) {
  runCli().catch((err) => {
    console.error(`[agy-quota] sidecar installer error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
