#!/usr/bin/env node

/**
 * Self-contained AGY Quota Skill Runner (v1.3.1).
 * Resolves the local agy-quota CLI across repo, plugin, and standalone skill
 * layouts, and auto-bootstraps the verified, commit-pinned runtime into
 * ./runtime/ on first run when installed as a standalone subfolder
 * (e.g. via `npx skills add awu5425/agy-quota`).
 */

import { execFileSync, spawn } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import https from 'node:https';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const SCRIPTS_DIR = resolve(dirname(__filename));
const SKILL_DIR = resolve(SCRIPTS_DIR, '..');

export const SKILL_BUNDLE_VERSION = '1.3.1';
export const TRUSTED_BOOTSTRAP_REPO = 'awu5425/agy-quota';

export const BOOTSTRAP_FILES = Object.freeze([
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

export function resolveLocalCliPath(skillDir = SKILL_DIR) {
  const candidates = [
    join(skillDir, 'runtime', 'cli.mjs'),
    join(skillDir, 'cli.mjs'),
    resolve(skillDir, '..', '..', 'cli.mjs'),
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

function defaultFetchText(url, headers = {}, redirectsLeft = 4) {
  return new Promise((resolveBody, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': `agy-quota-skill-bootstrap/${SKILL_BUNDLE_VERSION}`,
          ...headers,
        },
        timeout: 15_000,
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location && redirectsLeft > 0) {
          res.resume();
          const nextUrl = new URL(res.headers.location, url).toString();
          resolveBody(defaultFetchText(nextUrl, headers, redirectsLeft - 1));
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

async function resolveLockedCommitRef(fetchText, apiBase, repoSlug) {
  for (const candidateRef of [`v${SKILL_BUNDLE_VERSION}`, 'main']) {
    try {
      const raw = await fetchText(
        `${apiBase}/repos/${repoSlug}/commits/${encodeURIComponent(candidateRef)}`,
        { Accept: 'application/vnd.github+json' },
      );
      const parsed = JSON.parse(raw);
      const sha = typeof parsed?.sha === 'string' ? parsed.sha.trim().toLowerCase() : '';
      if (/^[0-9a-f]{40}$/.test(sha)) {
        return sha;
      }
    } catch {
      // Continue to next candidate ref or raw fallback if GitHub API is rate-limited
    }
  }
  return 'main';
}

export function verifyBootstrapConsistency(stageDir) {
  const pkg = JSON.parse(readFileSync(join(stageDir, 'package.json'), 'utf8'));
  const plugin = JSON.parse(readFileSync(join(stageDir, 'plugin.json'), 'utf8'));
  const expectedVer = String(pkg?.version || '').trim();
  if (!expectedVer) {
    throw new Error('Bootstrapped package.json is missing version');
  }
  if (String(plugin?.version || '').trim() !== expectedVer) {
    throw new Error(
      `Mixed-version bootstrap rejected: package.json=${expectedVer} vs plugin.json=${plugin?.version}`,
    );
  }
  const coreText = readFileSync(join(stageDir, 'src', 'quota-core.cjs'), 'utf8');
  const coreMatch = coreText.match(/const\s+QUOTA_CORE_VERSION\s*=\s*['"]([^'"]+)['"]/);
  if (coreMatch && coreMatch[1] !== expectedVer) {
    throw new Error(
      `Mixed-version bootstrap rejected: package.json=${expectedVer} vs quota-core.cjs=${coreMatch[1]}`,
    );
  }
  return expectedVer;
}

export function moveDirectorySafe(srcDir, dstDir, renameImpl = renameSync) {
  mkdirSync(dirname(dstDir), { recursive: true });
  try {
    renameImpl(srcDir, dstDir);
  } catch (err) {
    const code = err && err.code;
    if (code === 'EXDEV' || code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') {
      cpSync(srcDir, dstDir, { recursive: true, force: true });
      rmSync(srcDir, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
}

export async function bootstrapRuntimeIntoSkillDir({
  skillDir = SKILL_DIR,
  fetchText = defaultFetchText,
  apiBase = 'https://api.github.com',
  rawBase = 'https://raw.githubusercontent.com',
} = {}) {
  const resolvedSkillDir = resolve(skillDir);
  mkdirSync(resolvedSkillDir, { recursive: true });
  const runtimeDir = join(resolvedSkillDir, 'runtime');
  // Stage inside resolvedSkillDir so source and destination stay on the exact same volume
  const stageDir = join(
    resolvedSkillDir,
    `.runtime-stage-${process.pid}-${Date.now()}`,
  );
  mkdirSync(stageDir, { recursive: true });

  try {
    const lockedRef = await resolveLockedCommitRef(fetchText, apiBase, TRUSTED_BOOTSTRAP_REPO);
    console.error(
      `[agy-quota] Bootstrapping runtime from ${TRUSTED_BOOTSTRAP_REPO}@${lockedRef.slice(0, 12)}...`,
    );

    for (const relPath of BOOTSTRAP_FILES) {
      const url = `${rawBase}/${TRUSTED_BOOTSTRAP_REPO}/${encodeURIComponent(lockedRef)}/${relPath}`;
      const content = await fetchText(url);
      if (!content || !content.trim()) {
        throw new Error(`Empty response while bootstrapping ${relPath}`);
      }
      const dst = join(stageDir, ...relPath.split('/'));
      mkdirSync(dirname(dst), { recursive: true });
      writeFileSync(dst, content, 'utf8');
    }

    const verifiedVersion = verifyBootstrapConsistency(stageDir);

    for (const relPath of BOOTSTRAP_FILES) {
      const ext = extname(relPath).toLowerCase();
      if (ext === '.js' || ext === '.cjs' || ext === '.mjs') {
        execFileSync(process.execPath, ['--check', join(stageDir, ...relPath.split('/'))], {
          stdio: 'pipe',
          windowsHide: true,
        });
      }
    }

    const versionMeta = JSON.stringify(
      {
        version: verifiedVersion,
        targetRef: lockedRef,
        mode: 'skill-bootstrap',
        installedAt: new Date().toISOString(),
      },
      null,
      2,
    );
    writeFileSync(join(stageDir, 'installed-version.json'), versionMeta, 'utf8');

    const backupDir = `${runtimeDir}.bak-${process.pid}`;
    if (existsSync(runtimeDir)) {
      moveDirectorySafe(runtimeDir, backupDir);
    }
    try {
      moveDirectorySafe(stageDir, runtimeDir);
      if (existsSync(backupDir)) {
        rmSync(backupDir, { recursive: true, force: true });
      }
    } catch (swapErr) {
      if (existsSync(backupDir) && !existsSync(runtimeDir)) {
        moveDirectorySafe(backupDir, runtimeDir);
      }
      throw swapErr;
    }

    writeFileSync(join(resolvedSkillDir, 'installed-version.json'), versionMeta, 'utf8');
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
      env: {
        ...process.env,
        AGY_QUOTA_SKILL_DIR: SKILL_DIR,
      },
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

const isDirectEntry =
  Boolean(process.argv[1]) && resolve(process.argv[1]).toLowerCase() === __filename.toLowerCase();

if (isDirectEntry) {
  main().catch((err) => {
    console.error(`[agy-quota] skill runner error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
