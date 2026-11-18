#!/usr/bin/env node

/**
 * Self-contained AGY Quota Skill Runner (v1.3.2).
 * Resolves the local agy-quota CLI across repo, plugin, and standalone skill
 * layouts, and auto-bootstraps the verified, commit-locked runtime into
 * ./runtime/ on first run when installed as a standalone subfolder
 * (e.g. via `npx skills add awu5425/agy-quota`).
 */

import { execFileSync, spawn } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
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

export const SKILL_BUNDLE_VERSION = '1.3.2';
export const TRUSTED_BOOTSTRAP_REPO = 'awu5425/agy-quota';
const IMMUTABLE_SHA_RE = /^[0-9a-f]{40}$/;

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

function parseGitSmartRefsSha(body, candidateRefs) {
  if (typeof body !== 'string' || !body) return '';
  const map = new Map();
  for (const rawLine of body.split(/\r?\n/)) {
    const line = /^[0-9a-f]{4}[0-9a-f]{40}\s/i.test(rawLine) ? rawLine.slice(4) : rawLine;
    const nulIdx = line.indexOf('\0');
    const clean = (nulIdx >= 0 ? line.slice(0, nulIdx) : line).trim();
    const m = clean.match(/^([0-9a-f]{40})\s+(\S+)$/i);
    if (m) {
      map.set(m[2], m[1].toLowerCase());
    }
  }
  for (const ref of candidateRefs) {
    const sha = map.get(ref);
    if (sha && IMMUTABLE_SHA_RE.test(sha)) return sha;
  }
  return '';
}

async function resolveLockedCommitRef(fetchText, apiBase, repoSlug, gitOriginBase = 'https://github.com') {
  let lastError = null;
  for (const candidateRef of [`v${SKILL_BUNDLE_VERSION}`, 'main']) {
    try {
      const raw = await fetchText(
        `${apiBase}/repos/${repoSlug}/commits/${encodeURIComponent(candidateRef)}`,
        { Accept: 'application/vnd.github+json' },
      );
      const parsed = JSON.parse(raw);
      const sha = typeof parsed?.sha === 'string' ? parsed.sha.trim().toLowerCase() : '';
      if (IMMUTABLE_SHA_RE.test(sha)) {
        return sha;
      }
    } catch (err) {
      lastError = err;
    }
  }

  // Fallback to Git Smart HTTP info/refs on github.com (not subject to api.github.com 60/hr limit)
  try {
    const refsBody = await fetchText(
      `${gitOriginBase}/${repoSlug}.git/info/refs?service=git-upload-pack`,
      { Accept: 'application/x-git-upload-pack-advertisement' },
    );
    const smartSha = parseGitSmartRefsSha(refsBody, [
      `refs/tags/v${SKILL_BUNDLE_VERSION}^{}`,
      `refs/tags/v${SKILL_BUNDLE_VERSION}`,
      'refs/heads/main',
      'HEAD',
    ]);
    if (IMMUTABLE_SHA_RE.test(smartSha)) {
      return smartSha;
    }
  } catch (err) {
    if (!lastError) lastError = err;
  }

  // Fail closed: never fall back to mutable branch names (`main`) where sequential
  // file fetches could mix versions across concurrent commits.
  const detail = lastError ? ` (${lastError.message || String(lastError)})` : '';
  throw new Error(
    `Refusing to bootstrap runtime without an immutable 40-char commit SHA${detail}. Retry later or install offline via "git clone" + "node cli.mjs --skill".`,
  );
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

export function moveDirectorySafe(
  srcDir,
  dstDir,
  renameImpl = renameSync,
  cpImpl = cpSync,
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
        rmSync(dstDir, { recursive: true, force: true });
        throw copyErr;
      }
      rmSync(srcDir, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
}

export function atomicReplaceDirectory(
  stageDir,
  targetDir,
  { renameImpl = renameSync, cpImpl = cpSync } = {},
) {
  const backupDir = `${targetDir}.bak-${process.pid}-${Date.now()}`;
  let hadExisting = false;
  if (existsSync(targetDir)) {
    hadExisting = true;
    moveDirectorySafe(targetDir, backupDir);
  }
  try {
    moveDirectorySafe(stageDir, targetDir, renameImpl, cpImpl);
    if (hadExisting && existsSync(backupDir)) {
      rmSync(backupDir, { recursive: true, force: true });
    }
  } catch (swapErr) {
    if (existsSync(targetDir)) {
      rmSync(targetDir, { recursive: true, force: true });
    }
    if (hadExisting && existsSync(backupDir)) {
      moveDirectorySafe(backupDir, targetDir);
    }
    throw swapErr;
  }
}

export async function bootstrapRuntimeIntoSkillDir({
  skillDir = SKILL_DIR,
  fetchText = defaultFetchText,
  apiBase = 'https://api.github.com',
  rawBase = 'https://raw.githubusercontent.com',
  renameImpl = renameSync,
  cpImpl = cpSync,
} = {}) {
  // Resolve immutable 40-char commit SHA BEFORE creating any staging directory or writing files
  const lockedRef = await resolveLockedCommitRef(fetchText, apiBase, TRUSTED_BOOTSTRAP_REPO);
  if (!IMMUTABLE_SHA_RE.test(lockedRef)) {
    throw new Error('Refusing bootstrap without verified 40-char commit SHA');
  }

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
    console.error(
      `[agy-quota] Bootstrapping runtime from ${TRUSTED_BOOTSTRAP_REPO}@${lockedRef.slice(0, 12)}...`,
    );

    for (const relPath of BOOTSTRAP_FILES) {
      const url = `${rawBase}/${TRUSTED_BOOTSTRAP_REPO}/${lockedRef}/${relPath}`;
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

    atomicReplaceDirectory(stageDir, runtimeDir, { renameImpl, cpImpl });
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
  const args = process.argv.slice(2);
  let cliPath = resolveLocalCliPath();
  if (!cliPath) {
    if (args.includes('--read-only') || args.includes('--no-save-history')) {
      throw new Error(
        'Cannot run in --read-only mode before ./runtime/ is installed locally (online bootstrap would write to disk). Run once without --read-only or install offline via "node cli.mjs --skill".',
      );
    }
    cliPath = await bootstrapRuntimeIntoSkillDir();
  }
  process.exitCode = await runForward(cliPath, args);
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
  main().catch((err) => {
    console.error(`[agy-quota] skill runner error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
