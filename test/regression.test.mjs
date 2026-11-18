import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CANONICAL_BUNDLE_FILES,
  SIDECAR_COPY_ENTRIES,
  SKILL_RUNTIME_ENTRIES,
  installSidecarPlugin,
  installSkillBundle,
} from '../install.mjs';
import {
  BOOTSTRAP_FILES,
  bootstrapRuntimeIntoSkillDir,
  moveDirectorySafe,
} from '../scripts/agy-quota.mjs';
import {
  computeAsarIntegrity,
  getOverlayStatus,
  inspectAsarFast,
  installMeterOverlay,
  uninstallMeterOverlay,
} from '../src/overlay-installer.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const require = createRequire(import.meta.url);
const quotaCore = require('../src/quota-core.cjs');

function makeTempDir(prefix) {
  return mkdtempSync(join(tmpdir(), `agy-quota-test-${prefix}-`));
}

function buildMinimalAsarBuffer(filesByRelPath) {
  const headerRoot = { files: {} };
  const payloadChunks = [];
  let offset = 0;

  for (const [relPath, content] of Object.entries(filesByRelPath)) {
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
    const parts = relPath.split('/');
    let node = headerRoot;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const seg = parts[i];
      if (!node.files[seg]) node.files[seg] = { files: {} };
      node = node.files[seg];
    }
    const leaf = parts[parts.length - 1];
    node.files[leaf] = {
      size: buf.length,
      offset: String(offset),
      integrity: computeAsarIntegrity(buf),
    };
    payloadChunks.push(buf);
    offset += buf.length;
  }

  const jsonBuf = Buffer.from(JSON.stringify(headerRoot), 'utf8');
  const jsonByteLen = jsonBuf.length;
  const alignedJsonLen = Math.ceil(jsonByteLen / 4) * 4;
  const stringPickleSize = 4 + alignedJsonLen;
  const picklePayloadSize = 4 + stringPickleSize;

  const hdr = Buffer.alloc(16 + alignedJsonLen, 0);
  hdr.writeUInt32LE(4, 0);
  hdr.writeUInt32LE(picklePayloadSize, 4);
  hdr.writeUInt32LE(stringPickleSize, 8);
  hdr.writeUInt32LE(jsonByteLen, 12);
  jsonBuf.copy(hdr, 16);

  return Buffer.concat([hdr, ...payloadChunks]);
}

function createVersionedUpdateFixture(dir, versionStr) {
  for (const relPath of quotaCore.RUNTIME_UPDATE_MANIFEST) {
    let content = readFileSync(join(REPO_ROOT, ...relPath.split('/')), 'utf8');
    if (relPath === 'package.json' || relPath === 'plugin.json') {
      const parsed = JSON.parse(content);
      parsed.version = versionStr;
      content = `${JSON.stringify(parsed, null, 2)}\n`;
    } else if (relPath === 'src/quota-core.cjs') {
      content = content.replace(
        /const\s+QUOTA_CORE_VERSION\s*=\s*['"][^'"]+['"]/,
        `const QUOTA_CORE_VERSION = '${versionStr}'`,
      );
    } else if (relPath === 'src/meter-overlay-ui.js') {
      content = content.replace(
        /const\s+OVERLAY_VERSION\s*=\s*['"][^'"]+['"]/,
        `const OVERLAY_VERSION = '${versionStr}'`,
      );
    } else if (relPath === 'sidecars/quota_panel/app.js') {
      content = content.replace(
        /const\s+APP_VERSION\s*=\s*['"][^'"]+['"]/,
        `const APP_VERSION = '${versionStr}'`,
      );
    }
    const dst = join(dir, ...relPath.split('/'));
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, content, 'utf8');
  }
}

function httpJsonRequest({ port, method = 'GET', path = '/', headers = {}, body = null }) {
  return new Promise((resolveRes, rejectRes) => {
    const payload = body !== null ? JSON.stringify(body) : '';
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          ...(body !== null
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
              }
            : {}),
          ...headers,
        },
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (c) => {
          raw += c;
        });
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(raw);
          } catch {
            json = null;
          }
          resolveRes({ statusCode: res.statusCode, raw, json });
        });
      },
    );
    req.on('error', rejectRes);
    if (body !== null) req.write(payload);
    req.end();
  });
}

test('1. Standalone web server blocks unauthenticated & non-loopback update mutations and pins trusted source', async (t) => {
  const assetsDir = join(REPO_ROOT, 'sidecars', 'quota_panel');

  // 1A. Bound to 0.0.0.0 without --admin-token -> update endpoints strictly 403, /preload.js leaks no token
  const publicHandler = quotaCore.createStandaloneHandler(assetsDir, { listenHost: '0.0.0.0' });
  const publicServer = http.createServer((req, res) => publicHandler(req, res));
  await new Promise((r) => publicServer.listen(0, '127.0.0.1', r));
  t.after(() => publicServer.close());
  const pubPort = publicServer.address().port;

  const pubPreload = await httpJsonRequest({ port: pubPort, path: '/preload.js' });
  assert.equal(pubPreload.statusCode, 200);
  assert.equal(pubPreload.raw.includes('__AGY_QUOTA_CSRF_TOKEN__'), false);

  const pubApply = await httpJsonRequest({
    port: pubPort,
    method: 'POST',
    path: '/api/update/apply',
    body: { repo: 'https://evil.example/payload', targetRef: 'evil' },
  });
  assert.equal(pubApply.statusCode, 403);

  const pubPrefs = await httpJsonRequest({
    port: pubPort,
    method: 'POST',
    path: '/api/update/prefs',
    body: { autoUpdate: false },
  });
  assert.equal(pubPrefs.statusCode, 403);

  // 1B. Bound to 0.0.0.0 WITH --admin-token -> rejects wrong token (401) & cross-origin (403)
  const adminTokenHandler = quotaCore.createStandaloneHandler(assetsDir, {
    listenHost: '0.0.0.0',
    adminToken: 'super-secret-admin-token-123',
  });
  const adminServer = http.createServer((req, res) => adminTokenHandler(req, res));
  await new Promise((r) => adminServer.listen(0, '127.0.0.1', r));
  t.after(() => adminServer.close());
  const admPort = adminServer.address().port;

  const wrongTok = await httpJsonRequest({
    port: admPort,
    method: 'POST',
    path: '/api/update/apply',
    headers: { Authorization: 'Bearer wrong-token' },
    body: { dryRun: true },
  });
  assert.equal(wrongTok.statusCode, 401);

  const crossOrigin = await httpJsonRequest({
    port: admPort,
    method: 'POST',
    path: '/api/update/prefs',
    headers: {
      Authorization: 'Bearer super-secret-admin-token-123',
      Origin: 'https://evil.attacker.example',
    },
    body: { autoUpdate: true },
  });
  assert.equal(crossOrigin.statusCode, 403);

  // 1C. Bound to 127.0.0.1 -> requires CSRF token from local /preload.js
  const localHandler = quotaCore.createStandaloneHandler(assetsDir, { listenHost: '127.0.0.1' });
  const localServer = http.createServer((req, res) => localHandler(req, res));
  await new Promise((r) => localServer.listen(0, '127.0.0.1', r));
  t.after(() => localServer.close());
  const locPort = localServer.address().port;

  const missingCsrf = await httpJsonRequest({
    port: locPort,
    method: 'POST',
    path: '/api/update/apply',
    body: { dryRun: true },
  });
  assert.equal(missingCsrf.statusCode, 403);

  const locPreload = await httpJsonRequest({ port: locPort, path: '/preload.js' });
  const tokenMatch = locPreload.raw.match(/__AGY_QUOTA_CSRF_TOKEN__\s*=\s*"([0-9a-f]{64})"/);
  assert.ok(tokenMatch, 'loopback /preload.js should inject 64-hex CSRF token');

  // 1D. Untrusted options/env cannot override update source without TEST_SOURCE_OVERRIDE_SYM
  const prevEnvRepo = process.env.AGY_QUOTA_UPDATE_REPO;
  process.env.AGY_QUOTA_UPDATE_REPO = 'https://evil.invalid/repo';
  try {
    const tempDir = makeTempDir('untrusted-src');
    t.after(() => rmSync(tempDir, { recursive: true, force: true }));
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ version: '99.0.0' }));

    const cachedSettingsPath = join(tempDir, 'settings.json');
    writeFileSync(
      cachedSettingsPath,
      JSON.stringify({
        autoUpdate: true,
        lastCheckedAt: Date.now(),
        cachedUpdateResult: {
          sourceKey: 'github:awu5425/agy-quota',
          latestVersion: '1.3.1',
          targetRef: 'main',
          source: 'github-raw',
          releaseUrl: 'https://github.com/awu5425/agy-quota',
          checkedAt: Date.now(),
        },
      }),
    );

    const checkRes = await quotaCore.checkSelfUpdate({
      force: false,
      sourceDir: tempDir,
      repo: 'evil/repo',
      rawBaseUrl: 'https://evil.invalid',
      settingsPath: cachedSettingsPath,
      currentVersion: '1.3.1',
    });
    assert.equal(checkRes.ok, true);
    assert.equal(checkRes.cached, true, 'must hit github:awu5425/agy-quota cache key, ignoring evil repo/sourceDir');
    assert.equal(checkRes.latestVersion, '1.3.1');
  } finally {
    if (prevEnvRepo === undefined) delete process.env.AGY_QUOTA_UPDATE_REPO;
    else process.env.AGY_QUOTA_UPDATE_REPO = prevEnvRepo;
  }
});

test('2. HUD installer leaves third-party context-capsule untouched by default, and restores on opt-in migration', async (t) => {
  const workDir = makeTempDir('asar-capsule');
  t.after(() => rmSync(workDir, { recursive: true, force: true }));

  const capsuleSnippet = [
    '/* === AGY_CONTEXT_CAPSULE_START === */',
    'globalThis.__USER_CUSTOM_CAPSULE__ = "keep-me-alive";',
    '/* === AGY_CONTEXT_CAPSULE_END === */',
  ].join('\n');
  const initialPreload = `"use strict";\nconst hostInit = 1;\n${capsuleSnippet}\n`;
  const initialPayload = 'console.log("user capsule payload v1");\n';

  const asarPath = join(workDir, 'app.asar');
  const stateDir = join(workDir, 'state');
  const sharedDataDir = join(workDir, 'shared');
  const capsulePayloadPath = join(workDir, 'context-capsule-payload.js');

  writeFileSync(
    asarPath,
    buildMinimalAsarBuffer({
      'package.json': JSON.stringify({ name: 'antigravity', version: '2.32.2' }),
      'dist/preload.js': initialPreload,
    }),
  );
  writeFileSync(capsulePayloadPath, initialPayload, 'utf8');

  // 2A. Default install: capsule preload + payload MUST remain completely untouched
  const defaultRes = await installMeterOverlay({
    asarPath,
    stateDir,
    sharedDataDir,
    capsulePayloadPath,
    skipCdp: true,
    skipCompanionRestore: true,
  });
  assert.equal(defaultRes.ok, true);
  assert.equal(defaultRes.capsuleStubbed, false);

  const afterDefaultInspect = inspectAsarFast(asarPath);
  assert.equal(afterDefaultInspect.hasOverlayMarker, true);
  assert.equal(afterDefaultInspect.hasCapsuleMarker, true);
  assert.equal(readFileSync(capsulePayloadPath, 'utf8'), initialPayload);

  const statusAfterDefault = getOverlayStatus({ asarPath, stateDir, sharedDataDir });
  assert.equal(statusAfterDefault.ok, true, 'overlay must report healthy alongside existing capsule');

  // 2B. Opt-in --migrate-capsule + --uninstall-overlay -> backs up & restores 100%
  const migrateRes = await installMeterOverlay({
    asarPath,
    stateDir,
    sharedDataDir,
    capsulePayloadPath,
    migrateCapsule: true,
    skipCdp: true,
    skipCompanionRestore: true,
  });
  assert.equal(migrateRes.ok, true);
  assert.equal(migrateRes.capsuleStubbed, true);
  assert.equal(inspectAsarFast(asarPath).hasCapsuleMarker, false);
  assert.notEqual(readFileSync(capsulePayloadPath, 'utf8'), initialPayload);

  const uninstallRes = await uninstallMeterOverlay({
    asarPath,
    stateDir,
    sharedDataDir,
    capsulePayloadPath,
    skipCdp: true,
  });
  assert.equal(uninstallRes.ok, true);
  assert.equal(uninstallRes.restoredCapsule, true);

  const afterRestoreInspect = inspectAsarFast(asarPath);
  assert.equal(afterRestoreInspect.hasOverlayMarker, false);
  assert.equal(afterRestoreInspect.hasCapsuleMarker, true);
  assert.ok(afterRestoreInspect.preloadSource.includes('__USER_CUSTOM_CAPSULE__'));
  assert.equal(readFileSync(capsulePayloadPath, 'utf8'), initialPayload);
});

test('3. Self-contained skill bundle includes unified manifest, switches to Sidecar cleanly, and prevents partial installs', (t) => {
  assert.deepEqual([...SIDECAR_COPY_ENTRIES], [...CANONICAL_BUNDLE_FILES]);
  assert.deepEqual([...SKILL_RUNTIME_ENTRIES], [...CANONICAL_BUNDLE_FILES]);
  assert.deepEqual([...BOOTSTRAP_FILES], [...CANONICAL_BUNDLE_FILES]);

  const workDir = makeTempDir('skill-sidecar');
  t.after(() => rmSync(workDir, { recursive: true, force: true }));

  const skillTarget = join(workDir, 'installed-skill');
  const sidecarTarget = join(workDir, 'installed-sidecar');

  const skillRes = installSkillBundle({ target: skillTarget });
  assert.equal(skillRes.ok, true);
  assert.equal(existsSync(join(skillTarget, 'runtime', 'README.md')), true);
  assert.equal(existsSync(join(skillTarget, 'runtime', 'README.zh-CN.md')), true);

  // Execute the installed skill runner outside the repo to switch to --sidecar
  const proc = spawnSync(
    process.execPath,
    [join(skillTarget, 'scripts', 'agy-quota.mjs'), '--sidecar', '--target', sidecarTarget],
    { cwd: workDir, encoding: 'utf8' },
  );
  assert.equal(proc.status, 0, `skill --sidecar failed: ${proc.stderr || proc.stdout}`);
  for (const rel of CANONICAL_BUNDLE_FILES) {
    assert.equal(
      existsSync(join(sidecarTarget, ...rel.split('/'))),
      true,
      `missing ${rel} in sidecar target`,
    );
  }

  // Simulate broken source missing README.md -> must fail pre-flight without leaving half-installed target
  const brokenSource = join(workDir, 'broken-source');
  cpSync(join(skillTarget, 'runtime'), brokenSource, { recursive: true });
  rmSync(join(brokenSource, 'README.md'), { force: true });

  const cleanTarget = join(workDir, 'never-half-installed');
  assert.throws(
    () => installSidecarPlugin({ target: cleanTarget, sourceRoot: brokenSource }),
    /Bundle integrity check failed/,
  );
  assert.equal(existsSync(cleanTarget), false, 'failed install must not leave partial target directory');
});

test('4. Cross-drive EXDEV staging fallback, commit-locked bootstrap, and mixed-version rejection', async (t) => {
  const workDir = makeTempDir('bootstrap-exdev');
  t.after(() => rmSync(workDir, { recursive: true, force: true }));

  // 4A. EXDEV fallback in moveDirectorySafe
  const srcStage = join(workDir, 'stage-src');
  const dstFinal = join(workDir, 'stage-dst');
  mkdirSync(srcStage, { recursive: true });
  writeFileSync(join(srcStage, 'marker.txt'), 'cross-volume-ok', 'utf8');

  moveDirectorySafe(srcStage, dstFinal, () => {
    const err = new Error('EXDEV: cross-device link not permitted');
    err.code = 'EXDEV';
    throw err;
  });
  assert.equal(existsSync(srcStage), false);
  assert.equal(readFileSync(join(dstFinal, 'marker.txt'), 'utf8'), 'cross-volume-ok');

  // 4B. Commit-locked bootstrap pins all fetches to 40-char SHA
  const fakeSha = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
  const requestedUrls = [];
  const mockFetch = async (url) => {
    requestedUrls.push(url);
    if (url.includes('/commits/')) {
      return JSON.stringify({ sha: fakeSha });
    }
    const prefix = `https://raw.githubusercontent.com/awu5425/agy-quota/${fakeSha}/`;
    assert.ok(url.startsWith(prefix), `raw fetch must lock to immutable SHA, got: ${url}`);
    const relPath = url.slice(prefix.length);
    return readFileSync(join(REPO_ROOT, ...relPath.split('/')), 'utf8');
  };

  const bootstrappedSkillDir = join(workDir, 'bootstrapped-skill');
  const cliPath = await bootstrapRuntimeIntoSkillDir({
    skillDir: bootstrappedSkillDir,
    fetchText: mockFetch,
  });
  assert.equal(existsSync(cliPath), true);
  assert.ok(requestedUrls.some((u) => u.includes('/commits/')));

  // 4C. Mixed-version download is rejected cleanly
  const mixedSkillDir = join(workDir, 'mixed-skill');
  await assert.rejects(
    () =>
      bootstrapRuntimeIntoSkillDir({
        skillDir: mixedSkillDir,
        fetchText: async (url) => {
          if (url.includes('/commits/')) return JSON.stringify({ sha: fakeSha });
          const prefix = `https://raw.githubusercontent.com/awu5425/agy-quota/${fakeSha}/`;
          const relPath = url.slice(prefix.length);
          if (relPath === 'package.json') {
            const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
            pkg.version = '9.9.9';
            return JSON.stringify(pkg);
          }
          return readFileSync(join(REPO_ROOT, ...relPath.split('/')), 'utf8');
        },
      }),
    /Mixed-version bootstrap rejected/,
  );
  assert.equal(existsSync(join(mixedSkillDir, 'runtime')), false);
});

test('5. Quota accuracy: past resetTime never fabricates 100%, and short sampling span computes true burn rate', () => {
  const now = 1_795_000_000_000;
  const expiredIso = new Date(now - 45_000).toISOString();

  const userStatusPayload = {
    userStatus: {
      name: 'Test User',
      email: 'alice@example.com',
      userTier: { id: 'g1-ultra-tier', name: 'Google AI Ultra' },
      cascadeModelConfigData: {
        clientModelConfigs: [
          {
            label: 'Gemini 4 Carbon (High)',
            modelOrAlias: { model: 'MODEL_PLACEHOLDER_M427' },
            quotaInfo: { remainingFraction: 0.37, resetTime: expiredIso },
          },
        ],
      },
    },
  };

  const summaryPayload = {
    response: {
      groups: [
        {
          displayName: 'Gemini Models',
          buckets: [
            {
              bucketId: 'gemini-5h',
              window: '5h',
              remainingFraction: 0.37,
              resetTime: expiredIso,
            },
            {
              bucketId: 'gemini-weekly',
              window: 'weekly',
              remainingFraction: 0.82,
              resetTime: new Date(now + 86_400_000).toISOString(),
            },
          ],
        },
      ],
    },
  };

  // Seed a 10-minute observation window where Gemini dropped from 42% -> 37% (5 pp in 10 minutes = 30 pp/h)
  const snap = quotaCore.parseSnapshot(userStatusPayload, summaryPayload, {
    now,
    source: 'test',
    readOnly: true,
    disablePricingLedger: true,
    disableModelCalls: true,
    seedPoints: [
      { ts: now - 10 * 60_000, pools: { gemini: 42 } },
      { ts: now - 5 * 60_000, pools: { gemini: 39.5 } },
    ],
  });

  const geminiPool = snap.pools.find((p) => p.id === 'gemini');
  assert.ok(geminiPool);
  assert.equal(geminiPool.remaining, 37, 'expired resetTime must NOT clamp remaining quota to 100%');
  assert.equal(snap.models[0].remainingPercentage, 37);
  assert.equal(
    geminiPool.prediction.usageRate,
    30,
    '5 pp drop over a 10m observed sample span must report 30 pp/h, not 5 / 1.5h = 3.33 pp/h',
  );
});

test('6. Custom skill directory updates end-to-end, and zero-target updates fail honestly', async (t) => {
  const workDir = makeTempDir('custom-skill-update');
  t.after(() => rmSync(workDir, { recursive: true, force: true }));

  const remoteFixture = join(workDir, 'remote-v140');
  createVersionedUpdateFixture(remoteFixture, '1.4.0');

  const emptyOverlayDir = join(workDir, 'nonexistent-overlay');
  const emptyPluginDir = join(workDir, 'nonexistent-plugin');
  const emptySkillDir = join(workDir, 'nonexistent-skill');
  const settingsPath = join(workDir, 'settings.json');

  // 6A. Zero installed targets -> must return ok: false, noTargets: true
  const zeroRes = await quotaCore.applySelfUpdate({
    [quotaCore.TEST_SOURCE_OVERRIDE_SYM]: { sourceDir: remoteFixture },
    overlayDir: emptyOverlayDir,
    pluginDir: emptyPluginDir,
    skillDir: emptySkillDir,
    settingsPath,
    currentVersion: '1.3.1',
  });
  assert.equal(zeroRes.ok, false);
  assert.equal(zeroRes.noTargets, true);
  assert.equal(zeroRes.updatedTargets.length, 0);

  // 6B. Custom skill directory via AGY_QUOTA_SKILL_DIR -> updates both skill wrapper and runtime/
  const customSkillDir = join(workDir, 'my-custom-skill-dir');
  installSkillBundle({ target: customSkillDir });

  const prevSkillEnv = process.env.AGY_QUOTA_SKILL_DIR;
  process.env.AGY_QUOTA_SKILL_DIR = customSkillDir;
  try {
    const updateRes = await quotaCore.applySelfUpdate({
      [quotaCore.TEST_SOURCE_OVERRIDE_SYM]: { sourceDir: remoteFixture },
      overlayDir: emptyOverlayDir,
      pluginDir: emptyPluginDir,
      settingsPath,
      currentVersion: '1.3.1',
    });
    assert.equal(updateRes.ok, true);
    assert.equal(updateRes.updatedVersion, '1.4.0');
    assert.ok(
      updateRes.updatedTargets.some((p) => p.toLowerCase() === customSkillDir.toLowerCase()),
      'custom skill dir from AGY_QUOTA_SKILL_DIR must be in updatedTargets',
    );
    const updatedRuntimePkg = JSON.parse(
      readFileSync(join(customSkillDir, 'runtime', 'package.json'), 'utf8'),
    );
    const updatedSkillMeta = JSON.parse(
      readFileSync(join(customSkillDir, 'installed-version.json'), 'utf8'),
    );
    assert.equal(updatedRuntimePkg.version, '1.4.0');
    assert.equal(updatedSkillMeta.version, '1.4.0');
  } finally {
    if (prevSkillEnv === undefined) delete process.env.AGY_QUOTA_SKILL_DIR;
    else process.env.AGY_QUOTA_SKILL_DIR = prevSkillEnv;
  }
});
