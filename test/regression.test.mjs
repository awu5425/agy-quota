import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import {
  CANONICAL_BUNDLE_FILES,
  SIDECAR_COPY_ENTRIES,
  SKILL_RUNTIME_ENTRIES,
  installSidecarPlugin,
  installSkillBundle,
} from '../install.mjs';
import {
  BOOTSTRAP_FILES,
  SKILL_BUNDLE_VERSION,
  atomicReplaceDirectory,
  bootstrapRuntimeIntoSkillDir,
  moveDirectorySafe,
} from '../scripts/agy-quota.mjs';
import {
  buildOverlayPreloadSnippet,
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

test('1. Standalone web server blocks DNS rebinding, cross-site <script>, unauthenticated /api/quota, and non-loopback exposure', async (t) => {
  const assetsDir = join(REPO_ROOT, 'sidecars', 'quota_panel');

  // 1A. CLI refuses to bind 0.0.0.0 without --admin-token
  const noTokenProc = spawnSync(
    process.execPath,
    [join(assetsDir, 'main.mjs'), '--standalone', '--host', '0.0.0.0', '--port', '0'],
    { encoding: 'utf8', env: { ...process.env, AGY_QUOTA_ADMIN_TOKEN: '' } },
  );
  assert.notEqual(noTokenProc.status, 0, 'binding 0.0.0.0 without --admin-token must fail closed');
  assert.match(noTokenProc.stderr, /Refusing to bind standalone server to non-loopback host/);

  // 1B. Programmatic 0.0.0.0 without adminToken -> blocks /api/quota (403) AND /api/update/* (403), leaks no token in / or /preload.js
  const publicHandler = quotaCore.createStandaloneHandler(assetsDir, { listenHost: '0.0.0.0' });
  const publicServer = http.createServer((req, res) => publicHandler(req, res));
  await new Promise((r) => publicServer.listen(0, '127.0.0.1', r));
  t.after(() => publicServer.close());
  const pubPort = publicServer.address().port;

  const pubRoot = await httpJsonRequest({ port: pubPort, path: '/' });
  assert.equal(pubRoot.statusCode, 200);
  assert.equal(pubRoot.raw.includes('agy-quota-csrf'), false);

  const pubQuota = await httpJsonRequest({ port: pubPort, path: '/api/quota' });
  assert.equal(pubQuota.statusCode, 403, 'unauthenticated remote /api/quota must be 403');

  const pubApply = await httpJsonRequest({
    port: pubPort,
    method: 'POST',
    path: '/api/update/apply',
    body: { repo: 'https://evil.example/payload', targetRef: 'evil' },
  });
  assert.equal(pubApply.statusCode, 403);

  // 1C. 0.0.0.0 WITH --admin-token -> blocks wrong token (401), DNS rebinding Host (403), and cross-origin (403)
  const adminTokenHandler = quotaCore.createStandaloneHandler(assetsDir, {
    listenHost: '0.0.0.0',
    adminToken: 'super-secret-admin-token-123',
  });
  const adminServer = http.createServer((req, res) => adminTokenHandler(req, res));
  await new Promise((r) => adminServer.listen(0, '127.0.0.1', r));
  t.after(() => adminServer.close());
  const admPort = adminServer.address().port;

  const wrongTokQuota = await httpJsonRequest({
    port: admPort,
    path: '/api/quota',
    headers: { Authorization: 'Bearer wrong-token' },
  });
  assert.equal(wrongTokQuota.statusCode, 401);

  const rebindOnWildcard = await httpJsonRequest({
    port: admPort,
    path: '/api/update/status',
    headers: {
      Host: `evil.rebind.example:${admPort}`,
      Authorization: 'Bearer super-secret-admin-token-123',
    },
  });
  assert.equal(rebindOnWildcard.statusCode, 403, 'unallowlisted DNS domain Host on 0.0.0.0 must be 403');

  const validAdminStatus = await httpJsonRequest({
    port: admPort,
    path: '/api/update/status',
    headers: { Authorization: 'Bearer super-secret-admin-token-123' },
  });
  assert.equal(validAdminStatus.statusCode, 200);

  // 1D. Loopback 127.0.0.1 -> blocks DNS rebinding Host & Origin even when Origin === Host!
  const localHandler = quotaCore.createStandaloneHandler(assetsDir, { listenHost: '127.0.0.1' });
  const localServer = http.createServer((req, res) => localHandler(req, res));
  await new Promise((r) => localServer.listen(0, '127.0.0.1', r));
  t.after(() => localServer.close());
  const locPort = localServer.address().port;

  const dnsRebindRoot = await httpJsonRequest({
    port: locPort,
    path: '/',
    headers: {
      Host: `attacker-rebind.invalid:${locPort}`,
      Origin: `http://attacker-rebind.invalid:${locPort}`,
    },
  });
  assert.equal(dnsRebindRoot.statusCode, 403, 'DNS rebinding Host must be rejected even when Origin matches Host');
  assert.equal(dnsRebindRoot.raw.includes('agy-quota-csrf'), false);

  const locPreload = await httpJsonRequest({ port: locPort, path: '/preload.js' });
  assert.equal(locPreload.statusCode, 200);
  assert.equal(
    /[0-9a-f]{64}/.test(locPreload.raw),
    false,
    '/preload.js must never embed raw CSRF tokens (prevents cross-site <script src> theft)',
  );

  const unauthLocalQuota = await httpJsonRequest({ port: locPort, path: '/api/quota' });
  assert.equal(unauthLocalQuota.statusCode, 401, 'loopback /api/quota without X-AGY-Quota-Token must be 401');

  const locRoot = await httpJsonRequest({ port: locPort, path: '/' });
  assert.equal(locRoot.statusCode, 200);
  const metaMatch = locRoot.raw.match(/<meta\s+name="agy-quota-csrf"\s+content="([0-9a-f]{64})">/);
  assert.ok(metaMatch, 'trusted loopback GET / must inject <meta name="agy-quota-csrf">');
  const csrfToken = metaMatch[1];

  const authedStatus = await httpJsonRequest({
    port: locPort,
    path: '/api/update/status',
    headers: {
      'X-AGY-Quota-Token': csrfToken,
      Origin: `http://127.0.0.1:${locPort}`,
    },
  });
  assert.equal(authedStatus.statusCode, 200);
  assert.equal(authedStatus.json.ok, true);
});

test('2. Commit SHA lock fails closed when GitHub commit API fails or rate-limits (never falls back to main)', async (t) => {
  const workDir = makeTempDir('sha-fail-closed');
  t.after(() => rmSync(workDir, { recursive: true, force: true }));

  // 2A. Skill bootstrap: if /commits/... fails (429 rate limit), must STOP before any raw file download
  let rawFetchCount = 0;
  const unbootstrappedDir = join(workDir, 'skill-no-sha');
  await assert.rejects(
    () =>
      bootstrapRuntimeIntoSkillDir({
        skillDir: unbootstrappedDir,
        fetchText: async (url) => {
          if (url.includes('/commits/') || url.includes('/info/refs')) {
            throw new Error('HTTP 429 rate limit exceeded');
          }
          rawFetchCount += 1;
          return '{}';
        },
      }),
    /Refusing to bootstrap runtime without an immutable 40-char commit SHA/,
  );
  assert.equal(rawFetchCount, 0, 'must download 0 files when commit SHA cannot be locked');
  assert.equal(existsSync(unbootstrappedDir), false, 'must not create skill staging dir when SHA lock fails');

  // 2B. quota-core checkSelfUpdate & applySelfUpdate: mock server where /commits/main returns 429
  // while /main/package.json would return 200 -> must STILL fail closed!
  let servedUnlockedMain = false;
  const mockRemote = http.createServer((req, res) => {
    if (req.url.includes('/releases/latest')) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    if (req.url.includes('/commits/')) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'API rate limit exceeded' }));
      return;
    }
    if (req.url.includes('/main/')) {
      servedUnlockedMain = true;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ version: '9.9.9' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => mockRemote.listen(0, '127.0.0.1', r));
  t.after(() => mockRemote.close());
  const mockUrl = `http://127.0.0.1:${mockRemote.address().port}`;

  const checkFail = await quotaCore.checkSelfUpdate({
    [quotaCore.TEST_SOURCE_OVERRIDE_SYM]: { apiBaseUrl: mockUrl, rawBaseUrl: mockUrl },
    force: true,
    noPersist: true,
    currentVersion: SKILL_BUNDLE_VERSION,
  });
  assert.equal(checkFail.ok, false);
  assert.match(checkFail.error, /immutable 40-char commit SHA/);
  assert.equal(servedUnlockedMain, false, 'must never query mutable /main/package.json when SHA lock fails');

  const applyFail = await quotaCore.applySelfUpdate({
    [quotaCore.TEST_SOURCE_OVERRIDE_SYM]: { apiBaseUrl: mockUrl, rawBaseUrl: mockUrl },
    targetRef: 'main',
    dryRun: true,
    noPersist: true,
    currentVersion: SKILL_BUNDLE_VERSION,
  });
  assert.equal(applyFail.ok, false);
  assert.match(applyFail.error, /immutable 40-char commit SHA/);
});

test('3. Mid-copy EXDEV failure cleans partial target and restores previous installation 100%', (t) => {
  const workDir = makeTempDir('midcopy-rollback');
  t.after(() => rmSync(workDir, { recursive: true, force: true }));

  // 3A. Upgrade over an existing healthy Sidecar installation when rename throws EXDEV and cpSync crashes mid-way
  const sidecarTarget = join(workDir, 'existing-sidecar');
  installSidecarPlugin({ target: sidecarTarget });
  writeFileSync(join(sidecarTarget, 'v1-sentinel.txt'), 'preserve-previous-install', 'utf8');

  const forceExdevRename = () => {
    const err = new Error('EXDEV: cross-device link not permitted');
    err.code = 'EXDEV';
    throw err;
  };
  const crashMidCopy = (_src, dst) => {
    mkdirSync(dst, { recursive: true });
    writeFileSync(join(dst, 'half-written-corrupt.txt'), 'broken-half-install', 'utf8');
    const ioErr = new Error('ENOSPC: simulated disk full mid-copy');
    ioErr.code = 'ENOSPC';
    throw ioErr;
  };

  assert.throws(
    () =>
      installSidecarPlugin({
        target: sidecarTarget,
        renameImpl: forceExdevRename,
        cpImpl: crashMidCopy,
      }),
    /ENOSPC/,
  );

  // Previous installation must be restored completely, without half-written file or orphaned .bak/.stage dirs!
  assert.equal(existsSync(join(sidecarTarget, 'half-written-corrupt.txt')), false);
  assert.equal(readFileSync(join(sidecarTarget, 'v1-sentinel.txt'), 'utf8'), 'preserve-previous-install');
  for (const rel of CANONICAL_BUNDLE_FILES) {
    assert.equal(existsSync(join(sidecarTarget, ...rel.split('/'))), true);
  }
  const leftovers = readdirSync(workDir).filter((n) => n.includes('.bak-') || n.includes('-stage-'));
  assert.deepEqual(leftovers, [], 'no orphaned .bak or .stage directories should remain');

  // 3B. Fresh install mid-copy crash -> must leave target completely absent (not half-created)
  const freshTarget = join(workDir, 'fresh-sidecar');
  assert.throws(
    () =>
      installSidecarPlugin({
        target: freshTarget,
        renameImpl: forceExdevRename,
        cpImpl: crashMidCopy,
      }),
    /ENOSPC/,
  );
  assert.equal(existsSync(freshTarget), false, 'failed fresh install must clean up partial directory');

  // 3C. Skill bootstrap atomicReplaceDirectory mid-copy crash -> restores previous runtime/
  const runtimeTarget = join(workDir, 'skill-runtime');
  mkdirSync(runtimeTarget, { recursive: true });
  writeFileSync(join(runtimeTarget, 'good.js'), 'ok = 1;\n', 'utf8');

  const newStage = join(workDir, 'new-stage');
  mkdirSync(newStage, { recursive: true });
  writeFileSync(join(newStage, 'good.js'), 'ok = 2;\n', 'utf8');

  assert.throws(
    () =>
      atomicReplaceDirectory(newStage, runtimeTarget, {
        renameImpl: forceExdevRename,
        cpImpl: crashMidCopy,
      }),
    /ENOSPC/,
  );
  assert.equal(readFileSync(join(runtimeTarget, 'good.js'), 'utf8'), 'ok = 1;\n');
  assert.equal(existsSync(join(runtimeTarget, 'half-written-corrupt.txt')), false);
});

test('4. HUD installer keeps capsule untouched by default, and preserves capsule backup on failed uninstall so retry succeeds', async (t) => {
  const workDir = makeTempDir('capsule-restore-order');
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

  // 4A. Default install: leaves capsule 100% untouched
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
  assert.equal(inspectAsarFast(asarPath).hasCapsuleMarker, true);
  assert.equal(readFileSync(capsulePayloadPath, 'utf8'), initialPayload);
  assert.equal(getOverlayStatus({ asarPath, stateDir, sharedDataDir }).ok, true);

  // 4B. Opt-in --migrate-capsule
  await installMeterOverlay({
    asarPath,
    stateDir,
    sharedDataDir,
    capsulePayloadPath,
    migrateCapsule: true,
    skipCdp: true,
    skipCompanionRestore: true,
  });
  const backupsDir = join(sharedDataDir, 'backups');
  assert.equal(existsSync(join(backupsDir, 'capsule-migration.json')), true);
  assert.equal(existsSync(join(backupsDir, 'context-capsule-preload-block.js.bak')), true);
  assert.equal(existsSync(join(backupsDir, 'context-capsule-payload.js.bak')), true);

  // 4C. First uninstall fails at ASAR step -> backup files MUST NOT be deleted prematurely!
  const missingAsarPath = join(workDir, 'temporarily-unavailable.asar');
  writeFileSync(missingAsarPath, 'corrupt-not-an-asar', 'utf8');
  await assert.rejects(() =>
    uninstallMeterOverlay({
      asarPath: missingAsarPath,
      stateDir,
      sharedDataDir,
      capsulePayloadPath,
      skipCdp: true,
    }),
  );
  assert.equal(
    existsSync(join(backupsDir, 'capsule-migration.json')),
    true,
    'migration marker must survive failed ASAR uninstall for safe retry',
  );
  assert.equal(existsSync(join(backupsDir, 'context-capsule-preload-block.js.bak')), true);
  assert.equal(existsSync(join(backupsDir, 'context-capsule-payload.js.bak')), true);

  // 4D. Retry uninstall against real asarPath -> restores both ASAR preload & payload file, then cleans backups!
  const retryRes = await uninstallMeterOverlay({
    asarPath,
    stateDir,
    sharedDataDir,
    capsulePayloadPath,
    skipCdp: true,
  });
  assert.equal(retryRes.ok, true);
  assert.equal(retryRes.restoredCapsule, true);

  const afterInspect = inspectAsarFast(asarPath);
  assert.equal(afterInspect.hasOverlayMarker, false);
  assert.equal(afterInspect.hasCapsuleMarker, true);
  assert.ok(afterInspect.preloadSource.includes('__USER_CUSTOM_CAPSULE__'));
  assert.equal(readFileSync(capsulePayloadPath, 'utf8'), initialPayload);
  assert.equal(existsSync(join(backupsDir, 'capsule-migration.json')), false);
});

test('5. --read-only performs strictly zero disk writes, zero directory creations, and refuses online bootstrap', async (t) => {
  const workDir = makeTempDir('strict-readonly');
  t.after(() => rmSync(workDir, { recursive: true, force: true }));

  const nonExistentSharedDir = join(workDir, 'never-created-shared-dir');
  const prevSharedEnv = process.env.AGY_QUOTA_SHARED_DIR;
  process.env.AGY_QUOTA_SHARED_DIR = nonExistentSharedDir;

  // Spin up a local mock Language Server to serve a live RPC quota query
  const mockLs = http.createServer((req, res) => {
    if (req.headers['x-codeium-csrf-token'] !== 'mock-csrf-123') {
      res.writeHead(403);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url.includes('GetUserStatus')) {
      res.end(
        JSON.stringify({
          userStatus: {
            name: 'ReadOnly Tester',
            email: 'readonly@example.com',
            userTier: { id: 'g1-ultra-tier', name: 'Google AI Ultra' },
            cascadeModelConfigData: { clientModelConfigs: [] },
          },
        }),
      );
      return;
    }
    res.end(
      JSON.stringify({
        response: {
          groups: [
            {
              displayName: 'Gemini Models',
              buckets: [
                {
                  bucketId: 'gemini-5h',
                  window: '5h',
                  remainingFraction: 0.88,
                  resetTime: new Date(Date.now() + 3600_000).toISOString(),
                },
              ],
            },
          ],
        },
      }),
    );
  });
  await new Promise((r) => mockLs.listen(0, '127.0.0.1', r));
  t.after(() => mockLs.close());
  const lsPort = mockLs.address().port;

  try {
    const bundle = await quotaCore.fetchQuotaBundle({
      force: true,
      readOnly: true,
      origin: `http://127.0.0.1:${lsPort}`,
      csrfToken: 'mock-csrf-123',
      disablePricingLedger: true,
      disableModelCalls: true,
    });
    assert.equal(bundle.ok, true);
    assert.equal(bundle.snapshot.pools[0].remaining, 88);
    assert.equal(
      existsSync(nonExistentSharedDir),
      false,
      '--read-only must NOT create shared data dir, migration marker, conn cache, or history file',
    );
  } finally {
    if (prevSharedEnv === undefined) delete process.env.AGY_QUOTA_SHARED_DIR;
    else process.env.AGY_QUOTA_SHARED_DIR = prevSharedEnv;
  }

  // Also verify unbootstrapped skill subfolder refuses to download/write runtime/ under --read-only
  const bareSkillDir = join(workDir, 'bare-skill');
  mkdirSync(join(bareSkillDir, 'scripts'), { recursive: true });
  cpSync(join(REPO_ROOT, 'skills', 'agy-quota', 'SKILL.md'), join(bareSkillDir, 'SKILL.md'));
  cpSync(
    join(REPO_ROOT, 'skills', 'agy-quota', 'scripts', 'agy-quota.mjs'),
    join(bareSkillDir, 'scripts', 'agy-quota.mjs'),
  );

  const roProc = spawnSync(
    process.execPath,
    [join(bareSkillDir, 'scripts', 'agy-quota.mjs'), '--json', '--mask', '--read-only'],
    { cwd: workDir, encoding: 'utf8' },
  );
  assert.notEqual(roProc.status, 0);
  assert.match(roProc.stderr, /Cannot run in --read-only mode before \.\/runtime\/ is installed/);
  assert.equal(existsSync(join(bareSkillDir, 'runtime')), false);
});

test('6. Unified skill manifest switches to Sidecar cleanly, supports junctions, and blocks broken sources', (t) => {
  assert.deepEqual([...SIDECAR_COPY_ENTRIES], [...CANONICAL_BUNDLE_FILES]);
  assert.deepEqual([...SKILL_RUNTIME_ENTRIES], [...CANONICAL_BUNDLE_FILES]);
  assert.deepEqual([...BOOTSTRAP_FILES], [...CANONICAL_BUNDLE_FILES]);

  const workDir = makeTempDir('skill-sidecar');
  t.after(() => rmSync(workDir, { recursive: true, force: true }));

  const skillTarget = join(workDir, 'installed-skill');
  const sidecarTarget = join(workDir, 'installed-sidecar');

  const skillRes = installSkillBundle({ target: skillTarget });
  assert.equal(skillRes.ok, true);

  const proc = spawnSync(
    process.execPath,
    [join(skillTarget, 'scripts', 'agy-quota.mjs'), '--sidecar', '--target', sidecarTarget],
    { cwd: workDir, encoding: 'utf8' },
  );
  assert.equal(proc.status, 0, `skill --sidecar failed: ${proc.stderr || proc.stdout}`);
  for (const rel of CANONICAL_BUNDLE_FILES) {
    assert.equal(existsSync(join(sidecarTarget, ...rel.split('/'))), true, `missing ${rel}`);
  }

  const junctionDir = join(workDir, 'junction-skill');
  symlinkSync(skillTarget, junctionDir, process.platform === 'win32' ? 'junction' : 'dir');
  const junctionProc = spawnSync(
    process.execPath,
    [join(junctionDir, 'scripts', 'agy-quota.mjs'), '--version'],
    { cwd: workDir, encoding: 'utf8' },
  );
  assert.equal(junctionProc.status, 0);
  assert.equal(junctionProc.stdout.trim(), SKILL_BUNDLE_VERSION);
});

test('7. Commit-locked bootstrap succeeds with valid 40-char SHA and rejects mixed-version files', async (t) => {
  const workDir = makeTempDir('bootstrap-sha-ok');
  t.after(() => rmSync(workDir, { recursive: true, force: true }));

  const fakeSha = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
  const bootstrappedSkillDir = join(workDir, 'bootstrapped-skill');
  const cliPath = await bootstrapRuntimeIntoSkillDir({
    skillDir: bootstrappedSkillDir,
    fetchText: async (url) => {
      if (url.includes('/commits/')) return JSON.stringify({ sha: fakeSha });
      const prefix = `https://raw.githubusercontent.com/awu5425/agy-quota/${fakeSha}/`;
      assert.ok(url.startsWith(prefix));
      const relPath = url.slice(prefix.length);
      return readFileSync(join(REPO_ROOT, ...relPath.split('/')), 'utf8');
    },
  });
  assert.equal(existsSync(cliPath), true);

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

test('8. Quota accuracy: past resetTime never fabricates 100%, and short sampling span computes true burn rate', () => {
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
          ],
        },
      ],
    },
  };

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
  assert.equal(geminiPool.remaining, 37);
  assert.equal(snap.models[0].remainingPercentage, 37);
  assert.equal(geminiPool.prediction.usageRate, 30);
});

test('9. Custom skill directory updates end-to-end, and zero-target updates fail honestly', async (t) => {
  const workDir = makeTempDir('custom-skill-update');
  t.after(() => rmSync(workDir, { recursive: true, force: true }));

  const remoteFixture = join(workDir, 'remote-v140');
  createVersionedUpdateFixture(remoteFixture, '1.4.0');

  const emptyOverlayDir = join(workDir, 'nonexistent-overlay');
  const emptyPluginDir = join(workDir, 'nonexistent-plugin');
  const emptySkillDir = join(workDir, 'nonexistent-skill');
  const settingsPath = join(workDir, 'settings.json');

  const zeroRes = await quotaCore.applySelfUpdate({
    [quotaCore.TEST_SOURCE_OVERRIDE_SYM]: { sourceDir: remoteFixture },
    overlayDir: emptyOverlayDir,
    pluginDir: emptyPluginDir,
    skillDir: emptySkillDir,
    settingsPath,
    currentVersion: SKILL_BUNDLE_VERSION,
  });
  assert.equal(zeroRes.ok, false);
  assert.equal(zeroRes.noTargets, true);

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
      currentVersion: SKILL_BUNDLE_VERSION,
    });
    assert.equal(updateRes.ok, true);
    assert.equal(updateRes.updatedVersion, '1.4.0');
    const updatedRuntimePkg = JSON.parse(
      readFileSync(join(customSkillDir, 'runtime', 'package.json'), 'utf8'),
    );
    assert.equal(updatedRuntimePkg.version, '1.4.0');
  } finally {
    if (prevSkillEnv === undefined) delete process.env.AGY_QUOTA_SKILL_DIR;
    else process.env.AGY_QUOTA_SKILL_DIR = prevSkillEnv;
  }
});

test('10. Git Smart HTTP info/refs fallback resolves immutable 40-char SHA when GitHub REST API returns 403/429', async (t) => {
  const workDir = makeTempDir('smart-http-fallback');
  t.after(() => rmSync(workDir, { recursive: true, force: true }));

  const smartCommitSha = 'f0e1d2c3b4a5968778695a4b3c2d1e0f9a8b7c6d';
  const annotatedTagObjSha = '1111111111111111111111111111111111111111';
  const fixtureDir = join(workDir, 'remote-v140');
  createVersionedUpdateFixture(fixtureDir, '1.4.0');
  // Ensure remaining bootstrap-only static files (README, LICENSE, NOTICE, logo.svg) also exist
  for (const relPath of BOOTSTRAP_FILES) {
    const p = join(fixtureDir, ...relPath.split('/'));
    if (!existsSync(p)) {
      mkdirSync(dirname(p), { recursive: true });
      cpSync(join(REPO_ROOT, ...relPath.split('/')), p);
    }
  }

  let commitApiCalls = 0;
  let smartHttpRefsCalls = 0;

  // Authentic Git Smart HTTP pkt-line advertisement (with peeled annotated tag ^{} and NUL capabilities)
  const pktLines = [
    '001e# service=git-upload-pack\n0000',
    `004f${smartCommitSha} HEAD\0multi_ack thin-pack side-band ofs-delta\n`,
    `003f${smartCommitSha} refs/heads/main\n`,
    `0042${annotatedTagObjSha} refs/tags/v${SKILL_BUNDLE_VERSION}\n`,
    `0045${smartCommitSha} refs/tags/v${SKILL_BUNDLE_VERSION}^{}\n`,
    '0000',
  ].join('');

  const mockGitServer = http.createServer((req, res) => {
    const reqUrl = req.url || '';
    if (reqUrl.includes('/releases/latest') || reqUrl.includes('/commits/')) {
      commitApiCalls += 1;
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'API rate limit exceeded for shared IP' }));
      return;
    }
    if (reqUrl.includes('/info/refs?service=git-upload-pack')) {
      smartHttpRefsCalls += 1;
      res.writeHead(200, { 'Content-Type': 'application/x-git-upload-pack-advertisement' });
      res.end(pktLines);
      return;
    }
    const rawPrefix = `/awu5425/agy-quota/${smartCommitSha}/`;
    if (reqUrl.startsWith(rawPrefix)) {
      const relPath = decodeURIComponent(reqUrl.slice(rawPrefix.length));
      const fullPath = join(fixtureDir, ...relPath.split('/'));
      if (existsSync(fullPath)) {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(readFileSync(fullPath, 'utf8'));
        return;
      }
    }
    res.writeHead(404);
    res.end('Not Found');
  });

  await new Promise((r) => mockGitServer.listen(0, '127.0.0.1', r));
  t.after(() => mockGitServer.close());
  const baseUrl = `http://127.0.0.1:${mockGitServer.address().port}`;

  // 10A. quotaCore checkSelfUpdate + applySelfUpdate succeeds via Smart HTTP SHA lock
  const targetSkillDir = join(workDir, 'installed-skill');
  installSkillBundle({ target: targetSkillDir });

  const checkRes = await quotaCore.checkSelfUpdate({
    [quotaCore.TEST_SOURCE_OVERRIDE_SYM]: {
      apiBaseUrl: baseUrl,
      rawBaseUrl: baseUrl,
      gitOriginBase: baseUrl,
    },
    force: true,
    noPersist: true,
    currentVersion: SKILL_BUNDLE_VERSION,
  });
  assert.equal(checkRes.ok, true, `Smart HTTP checkSelfUpdate failed: ${checkRes.error}`);
  assert.equal(checkRes.targetRef, smartCommitSha);
  assert.equal(checkRes.latestVersion, '1.4.0');
  assert.ok(commitApiCalls >= 1, 'should attempt REST commits API first');
  assert.ok(smartHttpRefsCalls >= 1, 'should fall back to Smart HTTP info/refs');

  const applyRes = await quotaCore.applySelfUpdate({
    [quotaCore.TEST_SOURCE_OVERRIDE_SYM]: {
      apiBaseUrl: baseUrl,
      rawBaseUrl: baseUrl,
      gitOriginBase: baseUrl,
    },
    overlayDir: join(workDir, 'no-overlay'),
    pluginDir: join(workDir, 'no-plugin'),
    skillDir: targetSkillDir,
    noPersist: true,
    currentVersion: SKILL_BUNDLE_VERSION,
  });
  assert.equal(applyRes.ok, true, `Smart HTTP applySelfUpdate failed: ${applyRes.error}`);
  assert.equal(applyRes.targetRef, smartCommitSha);
  assert.equal(applyRes.updatedVersion, '1.4.0');

  // 10B. Standalone skill runner bootstrap succeeds via Smart HTTP peeled tag SHA lock
  const httpFetchText = (url) =>
    new Promise((resolveBody, rejectBody) => {
      http
        .get(url, (res) => {
          let d = '';
          res.setEncoding('utf8');
          res.on('data', (c) => {
            d += c;
          });
          res.on('end', () => {
            if (res.statusCode === 200) resolveBody(d);
            else rejectBody(new Error(`HTTP ${res.statusCode} fetching ${url}`));
          });
        })
        .on('error', rejectBody);
    });

  const bootstrappedDir = join(workDir, 'bootstrapped-via-smart-http');
  const cliPath = await bootstrapRuntimeIntoSkillDir({
    skillDir: bootstrappedDir,
    fetchText: httpFetchText,
    apiBase: baseUrl,
    rawBase: baseUrl,
    gitOriginBase: baseUrl,
  });
  assert.equal(existsSync(cliPath), true);
  const bootMeta = JSON.parse(readFileSync(join(bootstrappedDir, 'installed-version.json'), 'utf8'));
  assert.equal(bootMeta.targetRef, smartCommitSha, 'peeled ^{} commit SHA must be selected over tag object SHA');
  assert.equal(bootMeta.version, '1.4.0');
});

test('11. True ASAR write-back failure inside rewriteAsarPreloadSurgical cleans .tmp, preserves ASAR & capsule backups, and recovers on retry', async (t) => {
  const workDir = makeTempDir('asar-writeback-fail');
  t.after(() => rmSync(workDir, { recursive: true, force: true }));

  const capsuleSnippet = [
    '/* === AGY_CONTEXT_CAPSULE_START === */',
    'globalThis.__CAPSULE_WRITEBACK_TEST__ = 42;',
    '/* === AGY_CONTEXT_CAPSULE_END === */',
  ].join('\n');
  const initialPreload = `"use strict";\nconst basePreload = true;\n${capsuleSnippet}\n`;
  const initialPayload = 'console.log("capsule writeback recovery test");\n';

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

  await installMeterOverlay({
    asarPath,
    stateDir,
    sharedDataDir,
    capsulePayloadPath,
    migrateCapsule: true,
    skipCdp: true,
    skipCompanionRestore: true,
  });

  const installedAsarBytes = readFileSync(asarPath);
  const backupsDir = join(sharedDataDir, 'backups');

  // Simulate a true OS file-lock failure right at the ASAR write-back stage:
  // inspectAsarFast(asarPath) SUCCEEDS, temporary ASAR build & verification SUCCEED,
  // renameImpl throws EPERM AND fallback openImpl('r+') throws EBUSY!
  let renameAttempted = false;
  let rplusOpenAttempted = false;
  await assert.rejects(
    () =>
      uninstallMeterOverlay({
        asarPath,
        stateDir,
        sharedDataDir,
        capsulePayloadPath,
        skipCdp: true,
        asarFsOps: {
          renameImpl: () => {
            renameAttempted = true;
            const e = new Error('EPERM: app.asar locked by running Electron process');
            e.code = 'EPERM';
            throw e;
          },
          openImpl: () => {
            rplusOpenAttempted = true;
            const e = new Error('EBUSY: exclusive lock held on app.asar');
            e.code = 'EBUSY';
            throw e;
          },
        },
      }),
    /EBUSY/,
  );

  assert.equal(renameAttempted, true, 'must reach atomic rename step inside rewriteAsarPreloadSurgical');
  assert.equal(rplusOpenAttempted, true, 'must reach inplace r+ fallback step inside rewriteAsarPreloadSurgical');

  // Verify zero leaked .tmp files, intact ASAR bytes, and intact capsule recovery backups!
  const tmpLeaks = readdirSync(workDir).filter((n) => n.endsWith('.tmp'));
  assert.deepEqual(tmpLeaks, [], 'failed ASAR write-back must not leak temporary .tmp files');
  assert.equal(Buffer.compare(readFileSync(asarPath), installedAsarBytes), 0, 'original ASAR bytes must remain uncorrupted');
  assert.equal(existsSync(join(backupsDir, 'capsule-migration.json')), true);
  assert.equal(existsSync(join(backupsDir, 'context-capsule-preload-block.js.bak')), true);
  assert.equal(existsSync(join(backupsDir, 'context-capsule-payload.js.bak')), true);

  // Once the lock clears, retrying uninstallMeterOverlay restores everything 100%!
  const recovered = await uninstallMeterOverlay({
    asarPath,
    stateDir,
    sharedDataDir,
    capsulePayloadPath,
    skipCdp: true,
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.restoredCapsule, true);

  const finalInspect = inspectAsarFast(asarPath);
  assert.equal(finalInspect.hasOverlayMarker, false);
  assert.equal(finalInspect.hasCapsuleMarker, true);
  assert.ok(finalInspect.preloadSource.includes('__CAPSULE_WRITEBACK_TEST__'));
  assert.equal(readFileSync(capsulePayloadPath, 'utf8'), initialPayload);
  assert.equal(existsSync(join(backupsDir, 'capsule-migration.json')), false);
});

test('12. Sandboxed Electron preload (sandbox: true, no node:fs) boots embedded UI on workbench cold-start and upgrades legacy preload', async (t) => {
  const snippet = buildOverlayPreloadSnippet();
  assert.ok(snippet.includes('/* AGY_QUOTA_SANDBOX_BOOT_V2 */'));
  assert.ok(snippet.includes(`/* AGY_QUOTA_EMBED_VER:${SKILL_BUNDLE_VERSION} */`));

  function runInSandboxedPreload({ protocol = 'https:', isIframe = false, readyState = 'loading' } = {}) {
    const executedScripts = [];
    const listeners = new Map();
    const winObj = {
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
    };
    winObj.top = isIframe ? {} : winObj;

    const sandboxRequire = (modId) => {
      if (modId === 'electron') {
        return {
          webFrame: {
            executeJavaScript(code) {
              executedScripts.push(code);
              return Promise.resolve(true);
            },
          },
        };
      }
      throw new Error(`module not found: ${modId}`);
    };

    const ctx = vm.createContext({
      require: sandboxRequire,
      window: winObj,
      location: { protocol },
      document: { readyState },
      Promise,
    });
    ctx.globalThis = ctx;

    vm.runInContext(snippet, ctx, { filename: 'dist/preload.js' });
    return {
      executedScripts,
      fire(type) {
        for (const fn of listeners.get(type) || []) fn();
      },
    };
  }

  // 12A. Splash screen (data: protocol) must NOT inject overlay UI
  const splash = runInSandboxedPreload({ protocol: 'data:', readyState: 'complete' });
  splash.fire('DOMContentLoaded');
  splash.fire('load');
  assert.equal(splash.executedScripts.length, 0, 'splash data: window must be skipped');

  // 12B. Subframe / iframe must NOT inject overlay UI
  const frame = runInSandboxedPreload({ protocol: 'https:', isIframe: true, readyState: 'complete' });
  frame.fire('DOMContentLoaded');
  assert.equal(frame.executedScripts.length, 0, 'iframes must be skipped');

  // 12C. Top-level workbench window cold-start (readyState=loading -> DOMContentLoaded + load) injects exactly once
  const workbench = runInSandboxedPreload({ protocol: 'https:', isIframe: false, readyState: 'loading' });
  assert.equal(workbench.executedScripts.length, 0, 'waits for DOMContentLoaded when loading');
  workbench.fire('DOMContentLoaded');
  workbench.fire('load');
  assert.equal(workbench.executedScripts.length, 1, 'must inject exactly once across DOMContentLoaded and load');
  assert.ok(
    workbench.executedScripts[0].includes(`OVERLAY_VERSION = '${SKILL_BUNDLE_VERSION}'`),
    'injected UI code must carry current OVERLAY_VERSION',
  );
  // Injected UI bundle must be valid JS
  new vm.Script(workbench.executedScripts[0], { filename: 'meter-overlay-ui.js' });

  // 12D. Legacy v1.3.2 preload block (without AGY_QUOTA_SANDBOX_BOOT_V2) is detected as outdated and upgraded
  const workDir = makeTempDir('legacy-preload-upgrade');
  t.after(() => rmSync(workDir, { recursive: true, force: true }));
  const asarPath = join(workDir, 'app.asar');
  const legacyPreload = [
    '"use strict";',
    'const electron_1 = require("electron");',
    '/* === AGY_QUOTA_OVERLAY_START === */',
    '(function(){ try { require("node:fs"); } catch (_e) {} })();',
    '/* === AGY_QUOTA_OVERLAY_END === */',
  ].join('\n');
  writeFileSync(
    asarPath,
    buildMinimalAsarBuffer({
      'package.json': JSON.stringify({ name: 'antigravity', version: '2.32.2' }),
      'dist/preload.js': legacyPreload,
    }),
  );

  const beforeStatus = getOverlayStatus({ asarPath, stateDir: join(workDir, 'state') });
  assert.equal(beforeStatus.ok, false, 'legacy preload without sandbox boot marker must report ok=false');
  assert.equal(beforeStatus.hasSandboxBootMarker, false);

  await installMeterOverlay({
    asarPath,
    stateDir: join(workDir, 'state'),
    sharedDataDir: join(workDir, 'shared'),
    skipCdp: true,
    skipCompanionRestore: true,
  });

  const afterStatus = getOverlayStatus({ asarPath, stateDir: join(workDir, 'state') });
  assert.equal(afterStatus.ok, true);
  assert.equal(afterStatus.hasSandboxBootMarker, true);
});

test('13. Gemini 4 Neon & Orchestrator (Neon) map to Gemini pool, attribute 90m trend accurately, and highlight active pool in core & overlay UI', async (t) => {
  const now = 1_795_050_000_000;
  const reset5hIso = new Date(now + 4 * 3_600_000).toISOString();
  const reset3pIso = new Date(now + 4.5 * 3_600_000).toISOString();
  const resetWeeklyIso = new Date(now + 6 * 86_400_000).toISOString();

  const userStatusPayload = {
    userStatus: {
      name: 'Neon Tester',
      email: 'neon@example.com',
      userTier: { id: 'g1-pro-tier', name: 'Google AI Pro' },
      cascadeModelConfigData: {
        defaultOverrideModelConfig: { modelOrAlias: { model: 'MODEL_PLACEHOLDER_M537' } },
        clientModelConfigs: [
          {
            label: 'Gemini 4 Neon (High)',
            modelOrAlias: { model: 'MODEL_PLACEHOLDER_M532' },
            quotaInfo: { remainingFraction: 0.79, resetTime: reset5hIso },
          },
          {
            label: 'Gemini 4 Neon (Medium)',
            modelOrAlias: { model: 'MODEL_PLACEHOLDER_M533' },
            quotaInfo: { remainingFraction: 0.79, resetTime: reset5hIso },
          },
          {
            label: 'Gemini 4 Neon (Low)',
            modelOrAlias: { model: 'MODEL_PLACEHOLDER_M534' },
            quotaInfo: { remainingFraction: 0.79, resetTime: reset5hIso },
          },
          {
            label: 'Gemini 4 Neon (XHigh)',
            modelOrAlias: { model: 'MODEL_PLACEHOLDER_M535' },
            quotaInfo: { remainingFraction: 0.79, resetTime: reset5hIso },
          },
          {
            label: 'Orchestrator (Neon)',
            modelOrAlias: { model: 'MODEL_PLACEHOLDER_M537' },
            quotaInfo: { remainingFraction: 0.79, resetTime: reset5hIso },
          },
          {
            label: 'Gemini 4 Hydrogen (Medium)',
            modelOrAlias: { model: 'MODEL_PLACEHOLDER_M526' },
            quotaInfo: { remainingFraction: 0.79, resetTime: reset5hIso },
          },
          {
            label: 'Gemini 3.8 Flash (High)',
            modelOrAlias: { model: 'MODEL_PLACEHOLDER_M318' },
            quotaInfo: { remainingFraction: 0.79, resetTime: reset5hIso },
          },
          {
            label: 'Claude Opus 5.5 (Low)',
            modelOrAlias: { model: 'MODEL_PLACEHOLDER_M400' },
            quotaInfo: { remainingFraction: 1, resetTime: reset3pIso },
          },
          {
            label: 'Claude Opus 5.5 (Medium)',
            modelOrAlias: { model: 'MODEL_PLACEHOLDER_M401' },
            quotaInfo: { remainingFraction: 1, resetTime: reset3pIso },
          },
          {
            label: 'Claude Opus 5.5 (High)',
            modelOrAlias: { model: 'MODEL_PLACEHOLDER_M402' },
            quotaInfo: { remainingFraction: 1, resetTime: reset3pIso },
          },
          {
            label: 'Claude Sonnet 5.5 (Low)',
            modelOrAlias: { model: 'MODEL_PLACEHOLDER_M403' },
            quotaInfo: { remainingFraction: 1, resetTime: reset3pIso },
          },
          {
            label: 'Claude Sonnet 5.5 (Medium)',
            modelOrAlias: { model: 'MODEL_PLACEHOLDER_M404' },
            quotaInfo: { remainingFraction: 1, resetTime: reset3pIso },
          },
          {
            label: 'Claude Sonnet 5.5 (High)',
            modelOrAlias: { model: 'MODEL_PLACEHOLDER_M405' },
            quotaInfo: { remainingFraction: 1, resetTime: reset3pIso },
          },
          {
            label: 'Gemini 4 Carbon',
            modelOrAlias: { model: 'MODEL_PLACEHOLDER_M670' },
            disabled: true,
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
          description:
            'Models within this group: Gemini 4 Neon, Gemini 4 Hydrogen, Orchestrator (Neon), Gemini 3.8 Flash',
          buckets: [
            { bucketId: 'gemini-5h', window: '5h', remainingFraction: 0.86, resetTime: reset5hIso },
            { bucketId: 'gemini-weekly', window: 'weekly', remainingFraction: 0.92, resetTime: resetWeeklyIso },
          ],
        },
        {
          displayName: 'Claude and GPT models',
          description: 'Models within this group: Claude Opus 5.5, Claude Sonnet 5.5, GPT-OSS 120B',
          buckets: [
            { bucketId: '3p-5h', window: '5h', remainingFraction: 1, resetTime: reset3pIso },
            { bucketId: '3p-weekly', window: 'weekly', remainingFraction: 1, resetTime: resetWeeklyIso },
          ],
        },
      ],
    },
  };

  // 13A. Core quota-core.cjs classification, trend attribution & Opus M400-M402 mapping
  const snap = quotaCore.parseSnapshot(userStatusPayload, summaryPayload, {
    now,
    source: 'test',
    readOnly: true,
    disablePricingLedger: true,
    seedPoints: [{ ts: now - 5 * 60_000, pools: { gemini: 90, 'non-google': 100 } }],
    modelCalls: [
      {
        model: 'Orchestrator (Neon)',
        modelKey: null,
        modelExactId: 'model_placeholder_m537',
        inputTokens: 120_000,
        outputTokens: 1200,
        costUSD: 0,
        ts: now - 30_000,
      },
      {
        model: '',
        modelKey: '',
        modelExactId: 'MODEL_PLACEHOLDER_M400',
        inputTokens: 50_000,
        outputTokens: 800,
        costUSD: 0.05,
        ts: now - 20_000,
      },
    ],
  });

  const orchNeon = snap.models.find((m) => m.label === 'Orchestrator (Neon)');
  assert.ok(orchNeon, 'Orchestrator (Neon) should be present in models');
  assert.equal(orchNeon.poolId, 'gemini');
  assert.equal(orchNeon.groupId, 'gemini-pro');

  const geminiPool = snap.pools.find((p) => p.id === 'gemini');
  const nonGooglePool = snap.pools.find((p) => p.id === 'non-google');
  assert.ok(geminiPool.familySummary.startsWith('Neon'), `expected Gemini familySummary to start with Neon, got: ${geminiPool.familySummary}`);
  assert.equal(nonGooglePool.modelLabels.includes('Orchestrator (Neon)'), false, 'Orchestrator (Neon) must not leak into non-google pool');

  assert.equal(snap.activeModelHint?.modelId, 'neon');
  assert.equal(snap.activeModelHint?.label, 'Neon');
  assert.equal(snap.activeModelHint?.poolId, 'gemini');

  const neonTrend = snap.history.modelSummaries.find((s) => s.modelId === 'neon');
  const opusTrend = snap.history.modelSummaries.find((s) => s.modelId === 'claude-opus');
  assert.ok(neonTrend, 'Neon should appear in 90m modelSummaries');
  assert.equal(neonTrend.label, 'Neon');
  assert.equal(neonTrend.poolId, 'gemini');
  assert.equal(neonTrend.calls, 1);
  assert.ok(opusTrend, 'MODEL_PLACEHOLDER_M400 should classify as claude-opus');
  assert.equal(opusTrend.poolId, 'non-google');
  assert.equal(opusTrend.calls, 1);

  // 13B. Overlay UI (src/meter-overlay-ui.js) direct parser & active pool highlighting in mocked DOM
  const uiCode = readFileSync(join(REPO_ROOT, 'src', 'meter-overlay-ui.js'), 'utf8');
  const noop = () => {};
  const makeStubEl = () => ({
    style: {},
    classList: { toggle: noop, add: noop, remove: noop, contains: () => false },
    setAttribute: noop,
    getAttribute: () => '',
    addEventListener: noop,
    removeEventListener: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
  });
  const docEl = makeStubEl();
  const bodyEl = makeStubEl();
  const storage = new Map();
  let nextTimerId = 1;
  const activeTimers = new Set();

  class FakeMutationObserver {
    observe() {}
    disconnect() {}
  }

  const uiCtx = vm.createContext({
    document: {
      documentElement: docEl,
      body: bodyEl,
      hidden: false,
      readyState: 'complete',
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: noop,
      removeEventListener: noop,
    },
    window: {
      addEventListener: noop,
      removeEventListener: noop,
      matchMedia: () => ({ matches: true, addEventListener: noop, removeEventListener: noop }),
    },
    location: { origin: '', protocol: 'https:' },
    navigator: { language: 'zh-CN' },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    MutationObserver: FakeMutationObserver,
    fetch: () => Promise.resolve({ ok: false, status: 404, json: async () => ({}) }),
    queueMicrotask,
    setTimeout: (fn) => {
      const id = nextTimerId++;
      activeTimers.add(id);
      return id;
    },
    clearTimeout: (id) => {
      activeTimers.delete(id);
    },
    setInterval: () => {
      const id = nextTimerId++;
      activeTimers.add(id);
      return id;
    },
    clearInterval: (id) => {
      activeTimers.delete(id);
    },
    URL,
    Promise,
  });
  uiCtx.globalThis = uiCtx;
  uiCtx.window.top = uiCtx.window;

  vm.runInContext(uiCode, uiCtx, { filename: 'src/meter-overlay-ui.js' });
  const ctl = uiCtx.__AGY_QUOTA_OVERLAY_CTL__;
  t.after(() => ctl?.dispose?.());
  assert.ok(ctl, 'meter-overlay-ui.js must register __AGY_QUOTA_OVERLAY_CTL__');

  const overlaySnap = ctl.parseDirectLsSnapshotForTest(userStatusPayload, summaryPayload, {
    recentCalls: [{ ts: Date.now() - 30_000, model: 'Orchestrator (Neon)', inputTokens: 100_000, outputTokens: 1000, calls: 1 }],
  });
  const overlayGemini = overlaySnap.pools.find((p) => p.id === 'gemini');
  const overlay3p = overlaySnap.pools.find((p) => p.id === 'non-google');
  assert.equal(overlay3p.modelLabels.includes('Orchestrator (Neon)'), false);
  assert.ok(overlayGemini.familySummary.startsWith('Neon'));

  const overlayNeonSummary = overlaySnap.history.modelSummaries.find((s) => s.modelId === 'neon');
  assert.ok(overlayNeonSummary, 'overlay UI should record Neon in modelSummaries');
  assert.equal(overlayNeonSummary.label, 'Neon');
  assert.equal(overlayNeonSummary.poolId, 'gemini');

  ctl.setSnapshotForTest(overlaySnap);
  assert.equal(ctl.setActiveModelForTest('Orchestrator (Neon)'), 'gemini');
  assert.equal(ctl.setActiveModelForTest('model_placeholder_m537'), 'gemini');
  ctl.dispose();
});
