'use strict';

/**
 * Antigravity SessionStart auto-self-heal guard hook for agy-quota.
 * Always writes `{}` to stdout and exits 0 in every branch (fail-open).
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const { homedir } = require('node:os');
const path = require('node:path');

const OVERLAY_START_MARKER = '/* === AGY_QUOTA_OVERLAY_START === */';
const OVERLAY_END_MARKER = '/* === AGY_QUOTA_OVERLAY_END === */';
const LOCK_TTL_MS = 60_000;

function resolveSharedQuotaDir() {
  return path.join(homedir(), '.gemini', 'antigravity', 'agy-quota');
}

function resolveContextMeterStateDir() {
  const home = homedir();
  if (process.platform === 'win32') {
    const localApp = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return path.join(localApp, 'AntigravityContextMeter');
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'AntigravityContextMeter');
  }
  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  const primary = path.join(xdgConfig, 'AntigravityContextMeter');
  if (fs.existsSync(primary)) {
    return primary;
  }
  const altShare = path.join(home, '.local', 'share', 'AntigravityContextMeter');
  if (fs.existsSync(altShare)) {
    return altShare;
  }
  return primary;
}

function resolveAsarFallback(explicitAsarPath, stateDir) {
  if (explicitAsarPath && fs.existsSync(explicitAsarPath)) {
    return explicitAsarPath;
  }
  const candidates = [];
  const installJsonPath = path.join(stateDir, 'installation.json');
  if (fs.existsSync(installJsonPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(installJsonPath, 'utf8'));
      for (const key of ['asarPath', 'targetAsar', 'appAsarPath']) {
        if (typeof meta?.[key] === 'string' && meta[key].trim()) {
          candidates.push(meta[key].trim());
        }
      }
    } catch (_) {}
  }

  const home = homedir();
  if (process.platform === 'win32') {
    const localApp = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const progFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    candidates.push(
      path.join(localApp, 'Programs', 'Antigravity', 'resources', 'app.asar'),
      path.join(localApp, 'Programs', 'antigravity', 'resources', 'app.asar'),
      path.join(localApp, 'Antigravity', 'resources', 'app.asar'),
      path.join(progFiles, 'Antigravity', 'resources', 'app.asar'),
      path.join(progFilesX86, 'Antigravity', 'resources', 'app.asar'),
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Antigravity.app/Contents/Resources/app.asar',
      path.join(home, 'Applications', 'Antigravity.app', 'Contents', 'Resources', 'app.asar'),
    );
  } else {
    candidates.push(
      '/opt/Antigravity/resources/app.asar',
      '/opt/antigravity/resources/app.asar',
      '/usr/share/antigravity/resources/app.asar',
      '/usr/lib/antigravity/resources/app.asar',
      path.join(home, '.local', 'share', 'Antigravity', 'resources', 'app.asar'),
      path.join(home, '.local', 'share', 'antigravity', 'resources', 'app.asar'),
    );
  }

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function inspectAsarSliceFast(asarPath) {
  const fileStat = fs.statSync(asarPath);
  const fd = fs.openSync(asarPath, 'r');
  try {
    const hdr16 = Buffer.alloc(16);
    if (fs.readSync(fd, hdr16, 0, 16, 0) !== 16) {
      return null;
    }
    const headerSizeField = hdr16.readUInt32LE(0);
    const picklePayloadSize = hdr16.readUInt32LE(4);
    const jsonByteLen = hdr16.readUInt32LE(12);
    const dataOffset = 8 + picklePayloadSize;
    if (headerSizeField !== 4 || jsonByteLen < 2 || dataOffset > fileStat.size) {
      return null;
    }

    const jsonBuf = Buffer.alloc(jsonByteLen);
    fs.readSync(fd, jsonBuf, 0, jsonByteLen, 16);
    const header = JSON.parse(jsonBuf.toString('utf8'));
    const distFiles = header?.files?.dist?.files || {};
    const hasMeterManifest = Boolean(
      distFiles['meter-manifest.json'] || header?.files?.['meter-manifest.json'],
    );
    const preloadMeta = distFiles['preload.js'] || null;

    let hasOverlayMarker = false;
    if (preloadMeta && !preloadMeta.unpacked && Number.isFinite(Number(preloadMeta.size))) {
      const pSize = Number(preloadMeta.size);
      const pOffset = dataOffset + Number(preloadMeta.offset);
      if (pOffset + pSize <= fileStat.size) {
        const pBuf = Buffer.alloc(pSize);
        fs.readSync(fd, pBuf, 0, pSize, pOffset);
        const preloadSource = pBuf.toString('utf8');
        hasOverlayMarker =
          preloadSource.includes(OVERLAY_START_MARKER) &&
          preloadSource.includes(OVERLAY_END_MARKER);
      }
    }

    return { hasOverlayMarker, hasMeterManifest };
  } finally {
    fs.closeSync(fd);
  }
}

function isCompanionExpected(stateDir) {
  const cliPath = path.join(stateDir, 'live-runtime', 'cli.js');
  if (!fs.existsSync(cliPath)) {
    return false;
  }
  if (fs.existsSync(path.join(stateDir, 'installation.json'))) {
    return true;
  }
  const modulesPath = path.join(stateDir, 'modules.json');
  if (!fs.existsSync(modulesPath)) {
    return false;
  }
  try {
    const mods = JSON.parse(fs.readFileSync(modulesPath, 'utf8'));
    return mods?.modules?.meter?.enabled !== false;
  } catch (_) {
    return false;
  }
}

function runGuard() {
  const sharedDataDir = resolveSharedQuotaDir();
  const metaPath = path.join(sharedDataDir, 'overlay-install-meta.json');
  if (!fs.existsSync(metaPath)) {
    return;
  }

  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch (_) {
    return;
  }
  if (!meta || meta.enabled !== true) {
    return;
  }

  const stateDir = resolveContextMeterStateDir();
  const asarPath = resolveAsarFallback(meta.asarPath, stateDir);
  if (!asarPath) {
    return;
  }

  const inspection = inspectAsarSliceFast(asarPath);
  if (!inspection) {
    return;
  }

  const companionExpected = isCompanionExpected(stateDir);
  if (inspection.hasOverlayMarker && (!companionExpected || inspection.hasMeterManifest)) {
    return;
  }

  const lockPath = path.join(sharedDataDir, 'ensure.lock');
  if (fs.existsSync(lockPath)) {
    try {
      const lockStat = fs.statSync(lockPath);
      if (Date.now() - lockStat.mtimeMs < LOCK_TTL_MS) {
        return;
      }
    } catch (_) {}
  }

  fs.mkdirSync(sharedDataDir, { recursive: true });
  fs.writeFileSync(
    lockPath,
    JSON.stringify({ pid: process.pid, ts: Date.now() }),
    'utf8',
  );

  if (typeof meta.installerPath === 'string' && fs.existsSync(meta.installerPath)) {
    const args = [meta.installerPath, '--ensure', '--quiet'];
    if (meta.keepSidecar) {
      args.push('--keep-sidecar');
    }
    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  }
}

try {
  process.stdin.resume();
  process.stdin.on('error', () => {});
  if (typeof process.stdin.unref === 'function') {
    process.stdin.unref();
  }
} catch (_) {}

try {
  runGuard();
} catch (_) {
  // Always fail-open
}

process.stdout.write('{}\n');
process.exitCode = 0;
