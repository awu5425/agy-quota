import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  DEFAULT_SIDECAR_TARGET,
  installSidecarPlugin,
  uninstallSidecarPlugin,
} from '../install.mjs';

const __filename = fileURLToPath(import.meta.url);
const SRC_DIR = resolve(dirname(__filename));
const REPO_ROOT = resolve(SRC_DIR, '..');

const OVERLAY_START_MARKER = '/* === AGY_QUOTA_OVERLAY_START === */';
const OVERLAY_END_MARKER = '/* === AGY_QUOTA_OVERLAY_END === */';
const SANDBOX_BOOT_MARKER = '/* AGY_QUOTA_SANDBOX_BOOT_V2 */';
const METER_PRELOAD_START_MARKER = '// --- Antigravity Context Meter preload Injection Start ---';

const CAPSULE_BLOCK_RE =
  /\r?\n?\/\* === AGY_CONTEXT_CAPSULE_START === \*\/[\s\S]*?\/\* === AGY_CONTEXT_CAPSULE_END === \*\/\r?\n?/g;
const OVERLAY_BLOCK_RE =
  /\r?\n?\/\* === AGY_QUOTA_OVERLAY_START === \*\/[\s\S]*?\/\* === AGY_QUOTA_OVERLAY_END === \*\/\r?\n?/g;

const CAPSULE_SILENT_STUB = 'window.__AGY_CTX_CAPSULE_ACTIVE__ = true;\n';
const ASAR_INTEGRITY_BLOCK_SIZE = 4 * 1024 * 1024;

const COMPANION_FILES = ['quota-core.cjs', 'overlay-preload.cjs', 'meter-overlay-ui.js'];

function readRepoVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
    return pkg.version || '1.3.3';
  } catch {
    return '1.3.3';
  }
}

export function resolveSharedQuotaDir() {
  return join(homedir(), '.gemini', 'antigravity', 'agy-quota');
}

export function resolveOverlayBackupsDir(sharedDataDir = resolveSharedQuotaDir()) {
  return join(sharedDataDir, 'backups');
}

export function resolveContextMeterStateDir() {
  const home = homedir();
  if (process.platform === 'win32') {
    const localApp = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    return join(localApp, 'AntigravityContextMeter');
  }
  if (process.platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'AntigravityContextMeter');
  }
  const xdgConfig = process.env.XDG_CONFIG_HOME || join(home, '.config');
  const primary = join(xdgConfig, 'AntigravityContextMeter');
  if (existsSync(primary)) {
    return primary;
  }
  const altShare = join(home, '.local', 'share', 'AntigravityContextMeter');
  if (existsSync(altShare)) {
    return altShare;
  }
  return primary;
}

function discoverAsarFromRunningProcess() {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "(Get-Process -Name 'Antigravity' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path -First 3) -join \"`n\"",
        ],
        { encoding: 'utf8', windowsHide: true, timeout: 2500 },
      );
      for (const line of out.split(/\r?\n/)) {
        const exePath = line.trim();
        if (exePath) {
          const candidate = join(dirname(exePath), 'resources', 'app.asar');
          if (existsSync(candidate)) {
            return resolve(candidate);
          }
        }
      }
    }
  } catch {
    // ignore process probe failure
  }
  return null;
}

export function discoverAsarPath(explicitPath = null) {
  if (explicitPath) {
    const resolved = resolve(explicitPath);
    if (!existsSync(resolved)) {
      throw new Error(`Specified app.asar not found: ${resolved}`);
    }
    return resolved;
  }
  if (process.env.AGY_ASAR_PATH && existsSync(process.env.AGY_ASAR_PATH)) {
    return resolve(process.env.AGY_ASAR_PATH);
  }

  const home = homedir();
  const stateDir = resolveContextMeterStateDir();
  const candidates = [];

  const installJsonPath = join(stateDir, 'installation.json');
  if (existsSync(installJsonPath)) {
    try {
      const meta = JSON.parse(readFileSync(installJsonPath, 'utf8'));
      for (const key of ['asarPath', 'targetAsar', 'appAsarPath']) {
        if (typeof meta?.[key] === 'string' && meta[key].trim()) {
          candidates.push(meta[key].trim());
        }
      }
    } catch {
      // ignore malformed installation.json
    }
  }

  if (process.platform === 'win32') {
    const localApp = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    const progFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    candidates.push(
      join(localApp, 'Programs', 'Antigravity', 'resources', 'app.asar'),
      join(localApp, 'Programs', 'antigravity', 'resources', 'app.asar'),
      join(localApp, 'Antigravity', 'resources', 'app.asar'),
      join(progFiles, 'Antigravity', 'resources', 'app.asar'),
      join(progFilesX86, 'Antigravity', 'resources', 'app.asar'),
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Antigravity.app/Contents/Resources/app.asar',
      join(home, 'Applications', 'Antigravity.app', 'Contents', 'Resources', 'app.asar'),
    );
  } else {
    candidates.push(
      '/opt/Antigravity/resources/app.asar',
      '/opt/antigravity/resources/app.asar',
      '/usr/share/antigravity/resources/app.asar',
      '/usr/lib/antigravity/resources/app.asar',
      join(home, '.local', 'share', 'Antigravity', 'resources', 'app.asar'),
      join(home, '.local', 'share', 'antigravity', 'resources', 'app.asar'),
    );
  }

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return resolve(candidate);
    }
  }

  const fromProcess = discoverAsarFromRunningProcess();
  if (fromProcess) {
    return fromProcess;
  }

  throw new Error(
    'Unable to locate Antigravity resources/app.asar automatically. Pass --asar <path> to specify it.',
  );
}

export function discoverDevToolsPortFiles() {
  const home = homedir();
  const candidates = [];
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || join(home, 'AppData', 'Roaming');
    const localApp = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    candidates.push(
      join(appData, 'Antigravity', 'DevToolsActivePort'),
      join(localApp, 'Antigravity', 'User Data', 'DevToolsActivePort'),
    );
  } else if (process.platform === 'darwin') {
    candidates.push(join(home, 'Library', 'Application Support', 'Antigravity', 'DevToolsActivePort'));
  } else {
    const xdgConfig = process.env.XDG_CONFIG_HOME || join(home, '.config');
    candidates.push(join(xdgConfig, 'Antigravity', 'DevToolsActivePort'));
  }
  return candidates.filter((p) => existsSync(p));
}

export function buildOverlayPreloadSnippet(uiSourceCode = null, embedVersion = null) {
  const resolvedUiSource =
    typeof uiSourceCode === 'string' && uiSourceCode.trim()
      ? uiSourceCode
      : readFileSync(join(SRC_DIR, 'meter-overlay-ui.js'), 'utf8');
  const resolvedVer = String(embedVersion || readRepoVersion()).trim();
  const encodedUi = JSON.stringify(resolvedUiSource);

  return [
    OVERLAY_START_MARKER,
    SANDBOX_BOOT_MARKER,
    `/* AGY_QUOTA_EMBED_VER:${resolvedVer} */`,
    '(function () {',
    '  var loadedFromDisk = false;',
    '  try {',
    '    if (typeof require === "function") {',
    '      var fs = require("node:fs");',
    '      var path = require("node:path");',
    '      var os = require("node:os");',
    '      var home = os.homedir();',
    '      var stateDir =',
    '        process.platform === "win32"',
    '          ? path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "AntigravityContextMeter")',
    '          : process.platform === "darwin"',
    '            ? path.join(home, "Library", "Application Support", "AntigravityContextMeter")',
    '            : path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "AntigravityContextMeter");',
    '      var primary = path.join(stateDir, "agy-quota-overlay", "overlay-preload.cjs");',
    '      var fallback = path.join(home, ".gemini", "antigravity", "agy-quota", "overlay", "overlay-preload.cjs");',
    '      if (fs.existsSync(primary)) {',
    '        require(primary);',
    '        loadedFromDisk = Boolean(globalThis.__AGY_QUOTA_OVERLAY_PRELOAD__);',
    '      } else if (fs.existsSync(fallback)) {',
    '        require(fallback);',
    '        loadedFromDisk = Boolean(globalThis.__AGY_QUOTA_OVERLAY_PRELOAD__);',
    '      }',
    '    }',
    '  } catch (_diskErr) {}',
    '  if (loadedFromDisk) return;',
    '  try {',
    '    var el = typeof electron_1 !== "undefined" ? electron_1 : (typeof require === "function" ? require("electron") : null);',
    '    var wf = el && el.webFrame;',
    '    if (!wf || typeof wf.executeJavaScript !== "function") return;',
    '    var injected = false;',
    `    var uiCode = ${encodedUi};`,
    '    var boot = function () {',
    '      if (injected) return;',
    '      try {',
    '        if (typeof window !== "undefined" && window.top && window !== window.top) return;',
    '        if (typeof location !== "undefined" && location && typeof location.protocol === "string") {',
    '          var proto = location.protocol;',
    '          if (proto !== "http:" && proto !== "https:" && proto !== "file:") return;',
    '        }',
    '        injected = true;',
    '        Promise.resolve(wf.executeJavaScript(uiCode)).catch(function () {});',
    '      } catch (_bootErr) {}',
    '    };',
    '    if (typeof document !== "undefined" && document && (document.readyState === "interactive" || document.readyState === "complete")) {',
    '      boot();',
    '    }',
    '    if (!injected && typeof window !== "undefined" && window && typeof window.addEventListener === "function") {',
    '      window.addEventListener("DOMContentLoaded", boot, { once: true });',
    '      window.addEventListener("load", boot, { once: true });',
    '    }',
    '  } catch (_sbxErr) {}',
    '})();',
    OVERLAY_END_MARKER,
  ].join('\n');
}

export function transformPreloadSource(
  source,
  { mode = 'install', migrateCapsule = false, restoreCapsuleBlock = '', uiSource = null } = {},
) {
  if (typeof source !== 'string' || !source.length) {
    throw new Error('dist/preload.js source is empty or invalid');
  }
  let code = source;
  if (mode === 'install') {
    // Non-destructive default: leave third-party/legacy tools untouched unless --migrate-capsule is explicitly requested
    if (migrateCapsule) {
      code = code.replace(CAPSULE_BLOCK_RE, '\n');
    }
    code = code.replace(OVERLAY_BLOCK_RE, '\n');
    const snippet = buildOverlayPreloadSnippet(uiSource);
    const meterIdx = code.indexOf(METER_PRELOAD_START_MARKER);
    if (meterIdx >= 0) {
      const before = code.slice(0, meterIdx).replace(/\s*$/, '');
      const after = code.slice(meterIdx);
      code = `${before}\n\n${snippet}\n\n${after}`;
    } else {
      code = `${code.replace(/\s*$/, '')}\n\n${snippet}\n`;
    }
  } else if (mode === 'uninstall') {
    code = code.replace(OVERLAY_BLOCK_RE, '\n');
    if (
      typeof restoreCapsuleBlock === 'string' &&
      restoreCapsuleBlock.trim() &&
      !code.includes('AGY_CONTEXT_CAPSULE_START')
    ) {
      code = `${code.replace(/\s*$/, '')}\n\n${restoreCapsuleBlock.trim()}\n`;
    }
  } else {
    throw new Error(`Unsupported preload transform mode: ${mode}`);
  }

  // Mandatory syntax check prior to touching app.asar
  new vm.Script(code, { filename: 'dist/preload.js' });
  return code;
}

export function computeAsarIntegrity(buf) {
  const hash = createHash('sha256').update(buf).digest('hex');
  const blocks = [];
  for (let offset = 0; offset < buf.length; offset += ASAR_INTEGRITY_BLOCK_SIZE) {
    const slice = buf.subarray(offset, Math.min(offset + ASAR_INTEGRITY_BLOCK_SIZE, buf.length));
    blocks.push(createHash('sha256').update(slice).digest('hex'));
  }
  return {
    algorithm: 'SHA256',
    hash,
    blockSize: ASAR_INTEGRITY_BLOCK_SIZE,
    blocks,
  };
}

function computeFileSha256(filePath) {
  const buf = readFileSync(filePath);
  return createHash('sha256').update(buf).digest('hex');
}

export function inspectAsarFast(asarPath) {
  const fileStat = statSync(asarPath);
  const fd = openSync(asarPath, 'r');
  try {
    const hdr16 = Buffer.alloc(16);
    const bytesRead = readSync(fd, hdr16, 0, 16, 0);
    if (bytesRead !== 16) {
      throw new Error(`Truncated ASAR header in ${asarPath}`);
    }
    const headerSizeField = hdr16.readUInt32LE(0);
    const picklePayloadSize = hdr16.readUInt32LE(4);
    const stringPickleSize = hdr16.readUInt32LE(8);
    const jsonByteLen = hdr16.readUInt32LE(12);
    const dataOffset = 8 + picklePayloadSize;

    if (headerSizeField !== 4 || jsonByteLen < 2 || dataOffset > fileStat.size) {
      throw new Error(`Invalid Chromium Pickle ASAR header in ${asarPath}`);
    }

    const jsonBuf = Buffer.alloc(jsonByteLen);
    readSync(fd, jsonBuf, 0, jsonByteLen, 16);
    const header = JSON.parse(jsonBuf.toString('utf8'));

    const distFiles = header?.files?.dist?.files || {};
    const hasMeterManifest = Boolean(
      distFiles['meter-manifest.json'] || header?.files?.['meter-manifest.json'],
    );
    const preloadMeta = distFiles['preload.js'] || null;

    let hostVersion = 'unknown';
    const pkgMeta = header?.files?.['package.json'] || null;
    if (pkgMeta && !pkgMeta.unpacked && Number.isFinite(Number(pkgMeta.size))) {
      const pkgSize = Number(pkgMeta.size);
      const pkgOffset = dataOffset + Number(pkgMeta.offset);
      if (pkgOffset + pkgSize <= fileStat.size) {
        try {
          const pkgBuf = Buffer.alloc(pkgSize);
          readSync(fd, pkgBuf, 0, pkgSize, pkgOffset);
          const pkgJson = JSON.parse(pkgBuf.toString('utf8'));
          if (typeof pkgJson?.version === 'string' && pkgJson.version.trim()) {
            hostVersion = pkgJson.version.trim();
          }
        } catch {
          hostVersion = 'unknown';
        }
      }
    }

    let preloadSource = null;
    let preloadSha256 = null;
    if (preloadMeta && !preloadMeta.unpacked && Number.isFinite(Number(preloadMeta.size))) {
      const pSize = Number(preloadMeta.size);
      const pOffset = dataOffset + Number(preloadMeta.offset);
      if (pOffset + pSize > fileStat.size) {
        throw new Error(`ASAR dist/preload.js slice out of bounds in ${asarPath}`);
      }
      const pBuf = Buffer.alloc(pSize);
      readSync(fd, pBuf, 0, pSize, pOffset);
      preloadSha256 = createHash('sha256').update(pBuf).digest('hex');
      preloadSource = pBuf.toString('utf8');
    }

    return {
      asarPath,
      fileSize: fileStat.size,
      dataOffset,
      picklePayloadSize,
      stringPickleSize,
      jsonByteLen,
      hostVersion,
      hasMeterManifest,
      preloadMeta,
      preloadSha256,
      preloadSource,
      hasOverlayMarker: Boolean(
        preloadSource &&
          preloadSource.includes(OVERLAY_START_MARKER) &&
          preloadSource.includes(OVERLAY_END_MARKER),
      ),
      hasSandboxBootMarker: Boolean(
        preloadSource && preloadSource.includes(SANDBOX_BOOT_MARKER),
      ),
      hasCapsuleMarker: Boolean(
        preloadSource && preloadSource.includes('AGY_CONTEXT_CAPSULE_START'),
      ),
    };
  } finally {
    closeSync(fd);
  }
}

function writeBufferFull(fd, buffer, position = 0) {
  let written = 0;
  while (written < buffer.length) {
    const n = writeSync(fd, buffer, written, buffer.length - written, position + written);
    if (n <= 0) {
      throw new Error('Short write while updating app.asar');
    }
    written += n;
  }
}

export function rewriteAsarPreloadSurgical(asarPath, newPreloadSource, fsOps = {}) {
  const renameImpl = typeof fsOps?.renameImpl === 'function' ? fsOps.renameImpl : renameSync;
  const openImpl = typeof fsOps?.openImpl === 'function' ? fsOps.openImpl : openSync;
  new vm.Script(newPreloadSource, { filename: 'dist/preload.js' });

  const origAsar = readFileSync(asarPath);
  if (origAsar.length < 20 || origAsar.readUInt32LE(0) !== 4) {
    throw new Error(`Invalid ASAR binary header: ${asarPath}`);
  }

  const origPicklePayloadSize = origAsar.readUInt32LE(4);
  const origJsonLen = origAsar.readUInt32LE(12);
  const origDataOffset = 8 + origPicklePayloadSize;
  const header = JSON.parse(origAsar.subarray(16, 16 + origJsonLen).toString('utf8'));

  const preloadMeta = header?.files?.dist?.files?.['preload.js'];
  if (!preloadMeta || preloadMeta.unpacked) {
    throw new Error('dist/preload.js entry missing or unpacked in ASAR header');
  }

  const oldOffset = Number(preloadMeta.offset);
  const oldSize = Number(preloadMeta.size);
  const origPayload = origAsar.subarray(origDataOffset);
  const newPreloadBuf = Buffer.from(newPreloadSource, 'utf8');

  let newPayload;
  if (newPreloadBuf.length <= oldSize) {
    // Overwrite preload slot in-place and fill slack bytes with ASCII spaces so
    // all other file offsets and even in-memory cached Archive sizes remain valid.
    newPayload = Buffer.from(origPayload);
    newPayload.fill(0x20, oldOffset, oldOffset + oldSize);
    newPreloadBuf.copy(newPayload, oldOffset);
    preloadMeta.offset = String(oldOffset);
    preloadMeta.size = newPreloadBuf.length;
  } else {
    // Keep entire existing payload untouched so every other file's byte offset is preserved.
    const appendOffset = origPayload.length;
    newPayload = Buffer.concat([origPayload, newPreloadBuf]);
    preloadMeta.offset = String(appendOffset);
    preloadMeta.size = newPreloadBuf.length;
  }

  preloadMeta.integrity = computeAsarIntegrity(newPreloadBuf);

  let jsonStr = JSON.stringify(header);
  let jsonBuf = Buffer.from(jsonStr, 'utf8');
  if (jsonBuf.length < origJsonLen) {
    // Pad trailing JSON whitespace to keep header pickle size & dataOffset identical
    jsonStr += ' '.repeat(origJsonLen - jsonBuf.length);
    jsonBuf = Buffer.from(jsonStr, 'utf8');
  }

  const jsonByteLen = jsonBuf.length;
  const alignedJsonLen = Math.ceil(jsonByteLen / 4) * 4;
  const stringPickleSize = 4 + alignedJsonLen;
  const picklePayloadSize = 4 + stringPickleSize;

  const newHdr = Buffer.alloc(16 + alignedJsonLen, 0);
  newHdr.writeUInt32LE(4, 0);
  newHdr.writeUInt32LE(picklePayloadSize, 4);
  newHdr.writeUInt32LE(stringPickleSize, 8);
  newHdr.writeUInt32LE(jsonByteLen, 12);
  jsonBuf.copy(newHdr, 16);

  const finalBuf = Buffer.concat([newHdr, newPayload]);
  const tmpPath = `${asarPath}.agy-quota-${process.pid}.tmp`;

  writeFileSync(tmpPath, finalBuf);
  try {
    const tmpVerify = inspectAsarFast(tmpPath);
    if (tmpVerify.preloadSource !== newPreloadSource) {
      throw new Error('Temporary ASAR verification mismatch');
    }
    new vm.Script(tmpVerify.preloadSource, { filename: 'dist/preload.js' });
  } catch (err) {
    rmSync(tmpPath, { force: true });
    throw err;
  }

  let writeStrategy = 'atomic-rename';
  try {
    renameImpl(tmpPath, asarPath);
  } catch (renameErr) {
    const code = renameErr && renameErr.code;
    if (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') {
      writeStrategy = 'inplace-rplus';
      let fd = null;
      try {
        fd = openImpl(asarPath, 'r+');
        writeBufferFull(fd, finalBuf, 0);
        ftruncateSync(fd, finalBuf.length);
        fsyncSync(fd);
      } finally {
        if (fd !== null) {
          try {
            closeSync(fd);
          } catch {
            // ignore close error
          }
        }
        rmSync(tmpPath, { force: true });
      }
    } else {
      rmSync(tmpPath, { force: true });
      throw renameErr;
    }
  }

  const reread = inspectAsarFast(asarPath);
  if (reread.preloadSource !== newPreloadSource) {
    throw new Error('Post-write ASAR preload slice verification failed');
  }
  if (
    reread.preloadMeta?.integrity?.hash &&
    reread.preloadSha256 !== reread.preloadMeta.integrity.hash
  ) {
    throw new Error('Post-write ASAR preload SHA-256 integrity mismatch');
  }
  new vm.Script(reread.preloadSource, { filename: 'dist/preload.js' });

  return {
    writeStrategy,
    previousSize: origAsar.length,
    newSize: reread.fileSize,
    preloadBytes: newPreloadBuf.length,
    preloadSha256: reread.preloadSha256,
  };
}

function encodeWsTextFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  const maskKey = randomBytes(4);

  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = 0x80 | len;
  } else if (len <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  const masked = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i += 1) {
    masked[i] = payload[i] ^ maskKey[i & 3];
  }
  return Buffer.concat([header, maskKey, masked]);
}

function encodeWsControlFrame(opcode, payload = Buffer.alloc(0)) {
  const maskKey = randomBytes(4);
  const len = Math.min(payload.length, 125);
  const header = Buffer.from([0x80 | (opcode & 0x0f), 0x80 | len]);
  const masked = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i += 1) {
    masked[i] = payload[i] ^ maskKey[i & 3];
  }
  return Buffer.concat([header, maskKey, masked]);
}

function openCdpWebSocket(wsUrl, timeoutMs = 4000) {
  return new Promise((resolveConn, rejectConn) => {
    const parsed = new URL(wsUrl);
    const key = randomBytes(16).toString('base64');
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        req.destroy();
        rejectConn(new Error(`CDP WebSocket connection timed out (${wsUrl})`));
      }
    }, timeoutMs);

    const req = http.request({
      hostname: parsed.hostname || '127.0.0.1',
      port: Number(parsed.port),
      path: `${parsed.pathname}${parsed.search}`,
      method: 'GET',
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': key,
      },
    });

    req.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        rejectConn(err);
      }
    });

    req.on('response', (res) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        rejectConn(new Error(`CDP WebSocket upgrade rejected with HTTP ${res.statusCode}`));
      }
    });

    req.on('upgrade', (_res, socket, head) => {
      if (settled) {
        socket.destroy();
        return;
      }
      settled = true;
      clearTimeout(timer);

      let recvBuf = head && head.length ? Buffer.from(head) : Buffer.alloc(0);
      let fragChunks = [];
      let fragOpcode = 0;
      let nextId = 1;
      const pending = new Map();

      function rejectAll(err) {
        for (const entry of pending.values()) {
          clearTimeout(entry.timer);
          entry.reject(err);
        }
        pending.clear();
      }

      function processFrames() {
        while (recvBuf.length >= 2) {
          const b0 = recvBuf[0];
          const b1 = recvBuf[1];
          const fin = (b0 & 0x80) !== 0;
          const opcode = b0 & 0x0f;
          const isMasked = (b1 & 0x80) !== 0;
          let payloadLen = b1 & 0x7f;
          let headerLen = 2;

          if (payloadLen === 126) {
            if (recvBuf.length < 4) return;
            payloadLen = recvBuf.readUInt16BE(2);
            headerLen = 4;
          } else if (payloadLen === 127) {
            if (recvBuf.length < 10) return;
            payloadLen = Number(recvBuf.readBigUInt64BE(2));
            headerLen = 10;
          }

          const maskLen = isMasked ? 4 : 0;
          const totalFrameLen = headerLen + maskLen + payloadLen;
          if (recvBuf.length < totalFrameLen) {
            return;
          }

          let payload = recvBuf.subarray(headerLen + maskLen, totalFrameLen);
          if (isMasked) {
            const mKey = recvBuf.subarray(headerLen, headerLen + 4);
            const unmasked = Buffer.allocUnsafe(payloadLen);
            for (let i = 0; i < payloadLen; i += 1) {
              unmasked[i] = payload[i] ^ mKey[i & 3];
            }
            payload = unmasked;
          }
          recvBuf = recvBuf.subarray(totalFrameLen);

          if (opcode === 0x08) {
            socket.end();
            rejectAll(new Error('CDP WebSocket closed by peer'));
            return;
          }
          if (opcode === 0x09) {
            socket.write(encodeWsControlFrame(0x0a, payload));
            continue;
          }
          if (opcode === 0x0a) {
            continue;
          }

          if (opcode === 0x01 || opcode === 0x02) {
            fragOpcode = opcode;
            fragChunks = [Buffer.from(payload)];
          } else if (opcode === 0x00 && fragChunks.length > 0) {
            fragChunks.push(Buffer.from(payload));
          }

          if (fin && fragOpcode === 0x01) {
            const fullText = Buffer.concat(fragChunks).toString('utf8');
            fragChunks = [];
            fragOpcode = 0;
            try {
              const msg = JSON.parse(fullText);
              if (msg && msg.id && pending.has(msg.id)) {
                const entry = pending.get(msg.id);
                pending.delete(msg.id);
                clearTimeout(entry.timer);
                if (msg.error) {
                  entry.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
                } else {
                  entry.resolve(msg.result);
                }
              }
            } catch {
              // ignore non-JSON events
            }
          }
        }
      }

      socket.on('data', (chunk) => {
        recvBuf = recvBuf.length ? Buffer.concat([recvBuf, chunk]) : chunk;
        processFrames();
      });

      socket.on('error', (err) => {
        rejectAll(err);
      });

      socket.on('close', () => {
        rejectAll(new Error('CDP WebSocket closed'));
      });

      if (recvBuf.length > 0) {
        processFrames();
      }

      resolveConn({
        call(method, params = {}, sessionId = undefined, callTimeoutMs = 6000) {
          return new Promise((resCall, rejCall) => {
            const id = nextId++;
            const callTimer = setTimeout(() => {
              pending.delete(id);
              rejCall(new Error(`CDP ${method} timed out`));
            }, callTimeoutMs);
            pending.set(id, { resolve: resCall, reject: rejCall, timer: callTimer });
            const payload = sessionId ? { id, method, params, sessionId } : { id, method, params };
            socket.write(encodeWsTextFrame(JSON.stringify(payload)));
          });
        },
        close() {
          try {
            socket.write(encodeWsControlFrame(0x08));
            socket.end();
          } catch {
            socket.destroy();
          }
        },
      });
    });

    req.end();
  });
}

function fetchJsonHttp(port, pathName, timeoutMs = 2500) {
  return new Promise((resolveJson, rejectJson) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: pathName, timeout: timeoutMs },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          rejectJson(new Error(`HTTP ${res.statusCode} on ${pathName}`));
          return;
        }
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          try {
            resolveJson(JSON.parse(raw));
          } catch (err) {
            rejectJson(err);
          }
        });
      },
    );
    req.on('timeout', () => {
      req.destroy(new Error(`Timeout requesting ${pathName}`));
    });
    req.on('error', rejectJson);
  });
}

function isAntigravityMainPageUrl(urlStr) {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(String(urlStr || ''));
}

function buildCapsuleCleanupScript() {
  return `(function () {
    try {
      globalThis.__AGY_CTX_CAPSULE_ACTIVE__ = true;
      if (!globalThis.__AGY_CAPSULE_DOM_GUARD__) {
        globalThis.__AGY_CAPSULE_DOM_GUARD__ = true;
        const isLegacyCapsuleNode = (node) => {
          if (!node || node.nodeType !== 1) return false;
          const id = node.id || '';
          if (id === '__agy_ctx_capsule_tooltip__' || id === '__agy_ctx_capsule_style__') return true;
          if (typeof node.hasAttribute === 'function' && node.hasAttribute('data-agy-context-capsule')) return true;
          if (typeof node.querySelector === 'function' && node.querySelector('[data-agy-context-capsule]')) return true;
          return false;
        };
        const origInsertBefore = Node.prototype.insertBefore;
        Node.prototype.insertBefore = function agyGuardInsertBefore(newNode, refNode) {
          if (isLegacyCapsuleNode(newNode)) return newNode;
          return origInsertBefore.call(this, newNode, refNode);
        };
        const origAppendChild = Node.prototype.appendChild;
        Node.prototype.appendChild = function agyGuardAppendChild(newNode) {
          if (isLegacyCapsuleNode(newNode)) return newNode;
          return origAppendChild.call(this, newNode);
        };
        if (typeof Element !== 'undefined' && typeof Element.prototype.insertAdjacentElement === 'function') {
          const origInsertAdj = Element.prototype.insertAdjacentElement;
          Element.prototype.insertAdjacentElement = function agyGuardInsertAdj(pos, el) {
            if (isLegacyCapsuleNode(el)) return el;
            return origInsertAdj.call(this, pos, el);
          };
        }
        const emptyNodeList = document.createDocumentFragment().childNodes;
        const origDocQsa = Document.prototype.querySelectorAll;
        Document.prototype.querySelectorAll = function agyGuardQsa(sel) {
          if (
            typeof sel === 'string' &&
            (sel === '.agy-composer-footer' || sel.includes('permissions-selector-trigger'))
          ) {
            const stack = String(new Error().stack || '');
            if (/pollCycle|renderAllFooters|context-capsule/i.test(stack)) {
              return emptyNodeList;
            }
          }
          return origDocQsa.call(this, sel);
        };
      }
      const staleNodes = document.querySelectorAll('[data-agy-context-capsule], #__agy_ctx_capsule_tooltip__, #__agy_ctx_capsule_style__');
      staleNodes.forEach((el) => { try { el.remove(); } catch (_) {} });
      return staleNodes.length;
    } catch (_) {
      return 0;
    }
  })();`;
}

function buildOverlayUnmountScript() {
  return `(function () {
    try {
      if (globalThis.__AGY_QUOTA_OVERLAY_CTL__ && typeof globalThis.__AGY_QUOTA_OVERLAY_CTL__.dispose === 'function') {
        globalThis.__AGY_QUOTA_OVERLAY_CTL__.dispose();
      }
      if (globalThis.__agyQuotaOverlayDispose && typeof globalThis.__agyQuotaOverlayDispose === 'function') {
        globalThis.__agyQuotaOverlayDispose();
      }
      const standaloneHud = document.getElementById('agy-quota-standalone-hud');
      if (standaloneHud) {
        standaloneHud.remove();
      }
      const host = document.getElementById('ag-context-meter');
      const sr = host && host.shadowRoot;
      if (sr) {
        const root = sr.getElementById('agy-quota-overlay-root');
        if (root) root.remove();
        const style = sr.getElementById('agy-quota-overlay-styles');
        if (style) style.remove();
        const hdr = sr.getElementById('agy-quota-header-ctrl');
        if (hdr) hdr.remove();
        sr.querySelectorAll('[data-agy-quota-header-ctrl], .qp-gauge-toggle, .qp-refresh-meta').forEach((el) => {
          try { el.remove(); } catch (_) {}
        });
      }
      return true;
    } catch (_) {
      return false;
    }
  })();`;
}

export async function hotMountViaCdp({
  uiScriptPath,
  quotaCorePath = null,
  mode = 'install',
  migrateCapsule = false,
}) {
  const dtFiles = discoverDevToolsPortFiles();
  if (dtFiles.length === 0) {
    return {
      attempted: false,
      reason: 'DevToolsActivePort not found (Antigravity not running)',
      targets: 0,
      mounted: 0,
      mountModes: [],
    };
  }

  let preseedCode = '';
  if (mode === 'install' && quotaCorePath && existsSync(quotaCorePath)) {
    try {
      const req = createRequire(import.meta.url);
      const quotaCore = req(quotaCorePath);
      if (quotaCore && typeof quotaCore.fetchQuotaBundle === 'function') {
        const bundle = await Promise.race([
          quotaCore.fetchQuotaBundle({ force: false }),
          new Promise((resolveTimeout) => setTimeout(() => resolveTimeout(null), 3500)),
        ]);
        if (bundle?.ok && bundle?.snapshot) {
          preseedCode = `try { globalThis.__AGY_QUOTA_LAST_SNAPSHOT__ = ${JSON.stringify(bundle.snapshot)}; } catch (_) {}\n`;
        }
      }
    } catch {
      // ignore pre-seed failure; UI script still fetches directly via same-origin RPC or bridge
    }
  }

  const uiCode = mode === 'install' ? readFileSync(uiScriptPath, 'utf8') : '';
  const capsuleCleanupPart = migrateCapsule ? `${buildCapsuleCleanupScript()}\n` : '';
  const combinedExpression =
    mode === 'install'
      ? `${buildOverlayUnmountScript()}\n${capsuleCleanupPart}${preseedCode}${uiCode}`
      : buildOverlayUnmountScript();

  const verifyMountExpr = `(async function () {
    for (let i = 0; i < 12; i += 1) {
      const ctl = globalThis.__AGY_QUOTA_OVERLAY_CTL__;
      const ctlMode = ctl && typeof ctl.getMode === 'function' ? ctl.getMode() : '';
      const host = document.getElementById('ag-context-meter');
      const sr = host && host.shadowRoot;
      if (sr && sr.getElementById('agy-quota-overlay-root')) {
        return { mounted: true, mountMode: 'companion', hasMeterHost: true };
      }
      const standaloneHud = document.getElementById('agy-quota-standalone-hud');
      if (standaloneHud && standaloneHud.shadowRoot) {
        return { mounted: true, mountMode: 'standalone', hasMeterHost: false };
      }
      if (ctlMode === 'companion' || ctlMode === 'standalone') {
        return { mounted: true, mountMode: ctlMode, hasMeterHost: Boolean(host && host.shadowRoot) };
      }
      if (i === 5 && !host && ctl && typeof ctl.forceStandaloneCheck === 'function') {
        try { ctl.forceStandaloneCheck(); } catch (_) {}
      }
      await new Promise((r) => setTimeout(r, 80));
    }
    const host = document.getElementById('ag-context-meter');
    return { mounted: false, mountMode: 'unmounted', hasMeterHost: Boolean(host && host.shadowRoot) };
  })();`;

  for (const dtFile of dtFiles) {
    let lines;
    try {
      lines = readFileSync(dtFile, 'utf8').trim().split(/\r?\n/);
    } catch {
      continue;
    }
    const port = Number(lines[0]);
    const browserWsPath = lines[1] || '';
    if (!Number.isFinite(port) || port <= 0) {
      continue;
    }

    // Path A: /json/list per-page WebSocket targets
    try {
      const list = await fetchJsonHttp(port, '/json/list');
      const pages = Array.isArray(list)
        ? list.filter(
            (t) => t && t.type === 'page' && t.webSocketDebuggerUrl && isAntigravityMainPageUrl(t.url),
          )
        : [];
      if (pages.length > 0) {
        let mountedCount = 0;
        const mountModes = [];
        for (const page of pages) {
          const client = await openCdpWebSocket(page.webSocketDebuggerUrl);
          try {
            const evalRes = await client.call('Runtime.evaluate', {
              expression: combinedExpression,
              awaitPromise: true,
              returnByValue: true,
            });
            if (evalRes?.exceptionDetails) {
              throw new Error(
                evalRes.exceptionDetails.text || 'Exception while evaluating meter-overlay-ui.js',
              );
            }
            if (mode === 'install') {
              const checkRes = await client.call('Runtime.evaluate', {
                expression: verifyMountExpr,
                awaitPromise: true,
                returnByValue: true,
              });
              const val = checkRes?.result?.value;
              if (val?.mounted) {
                mountedCount += 1;
                if (val.mountMode) {
                  mountModes.push(val.mountMode);
                }
              }
            } else {
              mountedCount += 1;
            }
          } finally {
            client.close();
          }
        }
        return {
          attempted: true,
          port,
          targets: pages.length,
          mounted: mountedCount,
          mountModes,
        };
      }
    } catch {
      // Fall back to browser-level WebSocket Target attachment if /json/list is unavailable
    }

    // Path B: Browser-level WebSocket via DevToolsActivePort line 2
    if (browserWsPath.startsWith('/')) {
      try {
        const browserClient = await openCdpWebSocket(`ws://127.0.0.1:${port}${browserWsPath}`);
        try {
          const { targetInfos = [] } = await browserClient.call('Target.getTargets');
          const pages = targetInfos.filter(
            (t) => t && t.type === 'page' && isAntigravityMainPageUrl(t.url),
          );
          let mountedCount = 0;
          const mountModes = [];
          for (const page of pages) {
            const { sessionId } = await browserClient.call('Target.attachToTarget', {
              targetId: page.targetId,
              flatten: true,
            });
            await browserClient.call(
              'Runtime.evaluate',
              {
                expression: combinedExpression,
                awaitPromise: true,
                returnByValue: true,
              },
              sessionId,
            );
            if (mode === 'install') {
              const checkRes = await browserClient.call(
                'Runtime.evaluate',
                {
                  expression: verifyMountExpr,
                  awaitPromise: true,
                  returnByValue: true,
                },
                sessionId,
              );
              const val = checkRes?.result?.value;
              if (val?.mounted) {
                mountedCount += 1;
                if (val.mountMode) {
                  mountModes.push(val.mountMode);
                }
              }
            } else {
              mountedCount += 1;
            }
          }
          if (pages.length > 0) {
            return {
              attempted: true,
              port,
              targets: pages.length,
              mounted: mountedCount,
              mountModes,
            };
          }
        } finally {
          browserClient.close();
        }
      } catch {
        // continue checking other DevToolsActivePort candidates
      }
    }
  }

  return {
    attempted: false,
    reason: 'No active Antigravity main BrowserWindow reachable via DevToolsActivePort',
    targets: 0,
    mounted: 0,
    mountModes: [],
  };
}

function triggerSharedDataMigration(quotaCorePath) {
  try {
    const req = createRequire(import.meta.url);
    const quotaCore = req(quotaCorePath);
    if (quotaCore && typeof quotaCore.resolveSharedDataDir === 'function') {
      return quotaCore.resolveSharedDataDir();
    }
  } catch {
    // ignore if optional
  }
  const fallback = resolveSharedQuotaDir();
  mkdirSync(fallback, { recursive: true });
  return fallback;
}

function writeBackupArtifacts(backupsDir, asarSourcePath, hostVersion = 'unknown') {
  mkdirSync(backupsDir, { recursive: true });
  const bakPath = join(backupsDir, 'agy-quota-pre-overlay.asar');
  const shaPath = `${bakPath}.sha256`;
  const metaPath = join(backupsDir, 'agy-quota-backup-meta.json');

  let existingHostVersion = null;
  if (existsSync(metaPath)) {
    try {
      const parsedMeta = JSON.parse(readFileSync(metaPath, 'utf8'));
      existingHostVersion = typeof parsedMeta?.hostVersion === 'string' ? parsedMeta.hostVersion : null;
    } catch {
      existingHostVersion = null;
    }
  }

  const refreshNeeded = !existsSync(bakPath) || existingHostVersion !== hostVersion;
  if (refreshNeeded && resolve(asarSourcePath) !== resolve(bakPath)) {
    copyFileSync(asarSourcePath, bakPath);
  }
  const sha256 = computeFileSha256(bakPath);
  if (refreshNeeded || !existsSync(shaPath)) {
    writeFileSync(shaPath, `${sha256}  agy-quota-pre-overlay.asar\n`, 'utf8');
  }
  if (refreshNeeded || !existsSync(metaPath)) {
    writeFileSync(
      metaPath,
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          hostVersion,
          sourceAsar: asarSourcePath,
          backupAsar: bakPath,
          size: statSync(bakPath).size,
          sha256,
        },
        null,
        2,
      ),
      'utf8',
    );
  }
  return { bakPath, sha256 };
}

function isCompanionExpected(stateDir) {
  const meterCliPath = join(stateDir, 'live-runtime', 'cli.js');
  if (!existsSync(meterCliPath)) {
    return false;
  }
  if (existsSync(join(stateDir, 'installation.json'))) {
    return true;
  }
  const modulesPath = join(stateDir, 'modules.json');
  if (!existsSync(modulesPath)) {
    return false;
  }
  try {
    const parsed = JSON.parse(readFileSync(modulesPath, 'utf8'));
    return parsed?.modules?.meter?.enabled !== false;
  } catch {
    return false;
  }
}

function isPidAlive(pid) {
  const numPid = Number(pid);
  if (!Number.isInteger(numPid) || numPid <= 0) {
    return false;
  }
  try {
    process.kill(numPid, 0);
    return true;
  } catch {
    return false;
  }
}

function restoreCompanionMeterIfExpected(asarPath, stateDir, { quiet = false } = {}) {
  const preInspect = inspectAsarFast(asarPath);
  if (preInspect.hasMeterManifest) {
    return { needed: false, restored: false };
  }
  if (!isCompanionExpected(stateDir)) {
    return { needed: false, restored: false };
  }
  const meterCliPath = join(stateDir, 'live-runtime', 'cli.js');
  const res = spawnSync(process.execPath, [meterCliPath, 'install', '--path', asarPath], {
    stdio: quiet ? 'pipe' : 'inherit',
    windowsHide: true,
    timeout: 60_000,
  });

  const liveSessionPath = join(stateDir, '.live-session.json');
  let liveSessionAlive = false;
  if (existsSync(liveSessionPath)) {
    try {
      const liveMeta = JSON.parse(readFileSync(liveSessionPath, 'utf8'));
      liveSessionAlive = isPidAlive(liveMeta?.pid);
    } catch {
      liveSessionAlive = false;
    }
  }
  if (!liveSessionAlive && discoverDevToolsPortFiles().length > 0) {
    spawnSync(process.execPath, [meterCliPath, 'live'], {
      stdio: quiet ? 'pipe' : 'inherit',
      windowsHide: true,
      timeout: 25_000,
    });
  }

  const afterInspect = inspectAsarFast(asarPath);
  return {
    needed: true,
    restored: Boolean(afterInspect.hasMeterManifest),
    exitCode: typeof res.status === 'number' ? res.status : res.error ? 1 : 0,
  };
}

function resolveHooksJsonPath() {
  return join(homedir(), '.gemini', 'config', 'hooks.json');
}

function installAutoHealHook({ sharedDataDir, asarPath, keepSidecar }) {
  const srcHookPath = join(SRC_DIR, 'auto-ensure-hook.cjs');
  const dstHookPath = join(sharedDataDir, 'auto-ensure-hook.cjs');
  mkdirSync(sharedDataDir, { recursive: true });
  if (existsSync(srcHookPath)) {
    copyFileSync(srcHookPath, dstHookPath);
  }

  const metaPath = join(sharedDataDir, 'overlay-install-meta.json');
  writeFileSync(
    metaPath,
    JSON.stringify(
      {
        enabled: true,
        asarPath,
        installerPath: __filename,
        keepSidecar: Boolean(keepSidecar),
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  );

  const hooksPath = resolveHooksJsonPath();
  mkdirSync(dirname(hooksPath), { recursive: true });
  let hooksObj = {};
  if (existsSync(hooksPath)) {
    try {
      const parsed = JSON.parse(readFileSync(hooksPath, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        hooksObj = parsed;
      }
    } catch {
      hooksObj = {};
    }
  }
  hooksObj['agy-quota-auto-heal'] = {
    enabled: true,
    SessionStart: [
      {
        type: 'command',
        command: `node "${dstHookPath}"`,
        timeout: 10,
      },
    ],
  };
  writeFileSync(hooksPath, `${JSON.stringify(hooksObj, null, 2)}\n`, 'utf8');
  return { hookScriptPath: dstHookPath, hooksPath, metaPath };
}

function uninstallAutoHealHook({ sharedDataDir }) {
  const hooksPath = resolveHooksJsonPath();
  if (existsSync(hooksPath)) {
    try {
      const parsed = JSON.parse(readFileSync(hooksPath, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'agy-quota-auto-heal' in parsed) {
        delete parsed['agy-quota-auto-heal'];
        writeFileSync(hooksPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
      }
    } catch {
      // ignore malformed hooks.json
    }
  }
  const metaPath = join(sharedDataDir, 'overlay-install-meta.json');
  if (existsSync(metaPath)) {
    try {
      const parsed = JSON.parse(readFileSync(metaPath, 'utf8'));
      writeFileSync(
        metaPath,
        JSON.stringify(
          {
            ...(parsed && typeof parsed === 'object' ? parsed : {}),
            enabled: false,
            updatedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        'utf8',
      );
    } catch {
      // ignore malformed meta
    }
  }
  const lockPath = join(sharedDataDir, 'ensure.lock');
  if (existsSync(lockPath)) {
    rmSync(lockPath, { force: true });
  }
}

function isAutoHealHookActive(sharedDataDir) {
  const dstHookPath = join(sharedDataDir, 'auto-ensure-hook.cjs');
  const metaPath = join(sharedDataDir, 'overlay-install-meta.json');
  const hooksPath = resolveHooksJsonPath();
  if (!existsSync(dstHookPath) || !existsSync(metaPath) || !existsSync(hooksPath)) {
    return false;
  }
  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    if (!meta || meta.enabled !== true) {
      return false;
    }
    const hooks = JSON.parse(readFileSync(hooksPath, 'utf8'));
    const entry = hooks?.['agy-quota-auto-heal'];
    return Boolean(
      entry &&
        entry.enabled !== false &&
        Array.isArray(entry.SessionStart) &&
        entry.SessionStart.length > 0,
    );
  } catch {
    return false;
  }
}

export async function installMeterOverlay(options = {}) {
  for (const name of COMPANION_FILES) {
    const srcPath = join(SRC_DIR, name);
    if (!existsSync(srcPath)) {
      throw new Error(`Missing required source file: ${srcPath}`);
    }
  }

  const version = readRepoVersion();
  const migrateCapsule = Boolean(options.migrateCapsule);
  const asarPath = discoverAsarPath(options.asarPath);
  const resourcesDir = dirname(asarPath);
  const stateDir = options.stateDir ? resolve(String(options.stateDir)) : resolveContextMeterStateDir();
  const hasContextMeterStateDir = existsSync(stateDir);
  const overlayDir = join(stateDir, 'agy-quota-overlay');

  // Ensure runtime overlay dir exists even on machines that have never installed AntigravityContextMeter
  mkdirSync(overlayDir, { recursive: true });

  // Sync runtime 3-file bundle + installed-version.json into <StateDir>/agy-quota-overlay/
  for (const name of COMPANION_FILES) {
    copyFileSync(join(SRC_DIR, name), join(overlayDir, name));
  }
  writeFileSync(
    join(overlayDir, 'installed-version.json'),
    JSON.stringify(
      {
        version,
        updatedAt: new Date().toISOString(),
        installer: 'agy-quota-overlay-installer',
      },
      null,
      2,
    ),
    'utf8',
  );

  // Ensure unified shared cache & primary backups dir (~/.gemini/antigravity/agy-quota/backups/)
  const sharedDataDir = options.sharedDataDir
    ? resolve(String(options.sharedDataDir))
    : triggerSharedDataMigration(join(overlayDir, 'quota-core.cjs'));
  mkdirSync(sharedDataDir, { recursive: true });

  let companionRestoreResult = { needed: false, restored: false };
  if (!options.asarPath && !options.skipCompanionRestore) {
    companionRestoreResult = restoreCompanionMeterIfExpected(asarPath, stateDir, {
      quiet: Boolean(options.quiet),
    });
  }

  const primaryBackupsDir = resolveOverlayBackupsDir(sharedDataDir);
  const legacyBackupsDir = join(stateDir, 'backups');
  const legacyBakPath = join(legacyBackupsDir, 'agy-quota-pre-overlay.asar');
  const primaryBakPath = join(primaryBackupsDir, 'agy-quota-pre-overlay.asar');

  const currentInspect = inspectAsarFast(asarPath);

  // Safety Rule 1A: Quarantine stale app.asar.orig.bak lacking meter-manifest.json when Context Meter is active
  const origBakPath = join(resourcesDir, 'app.asar.orig.bak');
  const staleBakPath = join(resourcesDir, 'app.asar.20261114.stale.bak');
  let quarantinedStaleBak = null;
  if (existsSync(origBakPath)) {
    let bakHasMeter = false;
    let bakHasCapsule = false;
    try {
      const bakInspect = inspectAsarFast(origBakPath);
      bakHasMeter = bakInspect.hasMeterManifest;
      bakHasCapsule = bakInspect.hasCapsuleMarker;
    } catch {
      bakHasMeter = false;
    }
    if ((currentInspect.hasMeterManifest && !bakHasMeter) || (migrateCapsule && bakHasCapsule)) {
      if (!existsSync(staleBakPath)) {
        renameSync(origBakPath, staleBakPath);
        quarantinedStaleBak = staleBakPath;
      } else {
        const extraStale = join(resourcesDir, `app.asar.${Date.now()}.stale.bak`);
        renameSync(origBakPath, extraStale);
        quarantinedStaleBak = extraStale;
      }
    }
  }

  // Safety Rule 1B: Pre-overlay backup in ~/.gemini/antigravity/agy-quota/backups/ (version-checked)
  let cleanBackupSeed = asarPath;
  if (existsSync(legacyBakPath) && !existsSync(primaryBakPath)) {
    try {
      const legacyInspect = inspectAsarFast(legacyBakPath);
      if (legacyInspect.hostVersion === currentInspect.hostVersion) {
        cleanBackupSeed = legacyBakPath;
      }
    } catch {
      cleanBackupSeed = asarPath;
    }
  }
  const { bakPath: preOverlayBakPath, sha256: backupSha256 } = writeBackupArtifacts(
    primaryBackupsDir,
    cleanBackupSeed,
    currentInspect.hostVersion,
  );
  if (hasContextMeterStateDir) {
    writeBackupArtifacts(legacyBackupsDir, preOverlayBakPath, currentInspect.hostVersion);
  }

  // Opt-in Legacy Migration (--migrate-capsule):
  // By default, external/legacy tools (such as context-capsule) are left 100% untouched.
  // When --migrate-capsule is explicitly passed, back up both preload block & payload so
  // --uninstall-overlay can restore them cleanly.
  const capsulePayloadPath = options.capsulePayloadPath
    ? resolve(String(options.capsulePayloadPath))
    : join(homedir(), '.gemini', 'tools', 'context-capsule-payload.js');
  let capsuleStubbed = false;
  if (migrateCapsule) {
    mkdirSync(primaryBackupsDir, { recursive: true });
    const capsulePreloadBakPath = join(primaryBackupsDir, 'context-capsule-preload-block.js.bak');
    const capsuleMatches = currentInspect.preloadSource
      ? currentInspect.preloadSource.match(CAPSULE_BLOCK_RE)
      : null;
    let hadPreloadBlock = false;
    if (capsuleMatches && capsuleMatches.length > 0) {
      const joinedBlock = capsuleMatches.map((s) => s.trim()).filter(Boolean).join('\n\n');
      if (joinedBlock) {
        writeFileSync(capsulePreloadBakPath, `${joinedBlock}\n`, 'utf8');
        hadPreloadBlock = true;
      }
    }

    let hadPayloadFile = false;
    if (existsSync(capsulePayloadPath)) {
      const existingPayload = readFileSync(capsulePayloadPath, 'utf8');
      const capsuleBakPath = join(primaryBackupsDir, 'context-capsule-payload.js.bak');
      if (existingPayload.trim() !== CAPSULE_SILENT_STUB.trim() && !existsSync(capsuleBakPath)) {
        copyFileSync(capsulePayloadPath, capsuleBakPath);
      }
      if (existingPayload !== CAPSULE_SILENT_STUB) {
        writeFileSync(capsulePayloadPath, CAPSULE_SILENT_STUB, 'utf8');
      }
      hadPayloadFile = true;
      capsuleStubbed = true;
    }

    if (hadPreloadBlock || hadPayloadFile) {
      writeFileSync(
        join(primaryBackupsDir, 'capsule-migration.json'),
        JSON.stringify(
          {
            migratedAt: new Date().toISOString(),
            hadPreloadBlock,
            hadPayloadFile,
            capsulePayloadPath,
          },
          null,
          2,
        ),
        'utf8',
      );
    }
  }

  // Sidecar coexistence control:
  // - Default: stop & remove our own native right-pane sidecar to avoid duplicate background polling
  // - With --keep-sidecar: preserve (or install on real host) native right-pane sidecar alongside top-right HUD
  const sidecarPluginDir = options.sidecarPluginDir
    ? resolve(String(options.sidecarPluginDir))
    : DEFAULT_SIDECAR_TARGET;
  let removedSidecarPlugin = false;
  let keptSidecarPlugin = false;
  if (options.keepSidecar) {
    if (existsSync(sidecarPluginDir) || !options.asarPath) {
      installSidecarPlugin({ target: sidecarPluginDir });
      keptSidecarPlugin = true;
    }
  } else if (!options.asarPath && existsSync(sidecarPluginDir)) {
    const rmRes = await uninstallSidecarPlugin({ target: sidecarPluginDir });
    removedSidecarPlugin = Boolean(rmRes.removed);
  }

  // Surgical ASAR preload.js patch (inject sandbox-compatible AGY_QUOTA_OVERLAY, vm.Script check; preserve other tools by default)
  const uiBundleSource = readFileSync(join(overlayDir, 'meter-overlay-ui.js'), 'utf8');
  const nextPreload = transformPreloadSource(currentInspect.preloadSource, {
    mode: 'install',
    migrateCapsule,
    uiSource: uiBundleSource,
  });
  let asarResult;
  if (nextPreload !== currentInspect.preloadSource) {
    asarResult = rewriteAsarPreloadSurgical(asarPath, nextPreload);
  } else {
    new vm.Script(currentInspect.preloadSource, { filename: 'dist/preload.js' });
    asarResult = {
      writeStrategy: 'unchanged-idempotent',
      previousSize: currentInspect.fileSize,
      newSize: currentInspect.fileSize,
      preloadBytes: Buffer.byteLength(currentInspect.preloadSource, 'utf8'),
      preloadSha256: currentInspect.preloadSha256,
    };
  }

  let autoHealResult = null;
  if (!options.asarPath) {
    autoHealResult = installAutoHealHook({
      sharedDataDir,
      asarPath,
      keepSidecar: Boolean(options.keepSidecar),
    });
  }

  // CDP Zero-Restart instant hot-mount (auto-adapts to Companion or Standalone Top-Right HUD)
  const cdpResult = options.skipCdp
    ? { attempted: false, reason: 'skipCdp requested', targets: 0, mounted: 0, mountModes: [] }
    : await hotMountViaCdp({
        uiScriptPath: join(overlayDir, 'meter-overlay-ui.js'),
        quotaCorePath: join(overlayDir, 'quota-core.cjs'),
        mode: 'install',
        migrateCapsule,
      });

  return {
    ok: true,
    version,
    hostVersion: currentInspect.hostVersion,
    uiMode: currentInspect.hasMeterManifest ? 'companion' : 'standalone-top-right',
    asarPath,
    overlayDir,
    sharedDataDir,
    backupAsar: preOverlayBakPath,
    backupSha256,
    quarantinedStaleBak,
    companionRestoreResult,
    autoHealHookActive: Boolean(autoHealResult),
    capsuleStubbed,
    removedSidecarPlugin,
    keptSidecarPlugin,
    asarResult,
    cdpResult,
  };
}

export const installTopRightOverlay = installMeterOverlay;

export async function uninstallMeterOverlay(options = {}) {
  const asarPath = discoverAsarPath(options.asarPath);
  const stateDir = options.stateDir ? resolve(String(options.stateDir)) : resolveContextMeterStateDir();
  const overlayDir = join(stateDir, 'agy-quota-overlay');
  const sharedDataDir = options.sharedDataDir
    ? resolve(String(options.sharedDataDir))
    : resolveSharedQuotaDir();
  const primaryBackupsDir = resolveOverlayBackupsDir(sharedDataDir);
  const fallbackOverlayDir = join(sharedDataDir, 'overlay');

  // Transactional capsule restore order:
  // 1) Read migration metadata & backup contents into memory WITHOUT deleting any backup files.
  // 2) Rewrite & verify app.asar dist/preload.js FIRST.
  // 3) Restore & verify context-capsule-payload.js SECOND.
  // 4) Delete backup artifacts ONLY after BOTH restore steps succeed cleanly (so any failed
  //    attempt can be safely retried).
  const migrationMarkerPath = join(primaryBackupsDir, 'capsule-migration.json');
  const capsulePreloadBakPath = join(primaryBackupsDir, 'context-capsule-preload-block.js.bak');
  const capsulePayloadBakPath = join(primaryBackupsDir, 'context-capsule-payload.js.bak');
  const hasMigrationMarker = existsSync(migrationMarkerPath);
  let migrationMeta = null;
  let restoreCapsuleBlock = '';
  let targetCapsulePayload = '';
  let expectedPayloadContent = null;
  let restoredCapsule = false;

  if (hasMigrationMarker) {
    try {
      migrationMeta = JSON.parse(readFileSync(migrationMarkerPath, 'utf8'));
    } catch {
      migrationMeta = {};
    }
    if (existsSync(capsulePreloadBakPath)) {
      restoreCapsuleBlock = readFileSync(capsulePreloadBakPath, 'utf8');
    }
    targetCapsulePayload = options.capsulePayloadPath
      ? resolve(String(options.capsulePayloadPath))
      : migrationMeta?.capsulePayloadPath || join(homedir(), '.gemini', 'tools', 'context-capsule-payload.js');
    if (existsSync(capsulePayloadBakPath)) {
      expectedPayloadContent = readFileSync(capsulePayloadBakPath, 'utf8');
    }
  }

  const currentInspect = inspectAsarFast(asarPath);
  const cleanedPreload = transformPreloadSource(currentInspect.preloadSource, {
    mode: 'uninstall',
    restoreCapsuleBlock,
  });
  let asarResult = { writeStrategy: 'unchanged' };
  if (cleanedPreload !== currentInspect.preloadSource) {
    asarResult = rewriteAsarPreloadSurgical(asarPath, cleanedPreload, options.asarFsOps);
  }

  if (hasMigrationMarker) {
    if (expectedPayloadContent !== null && targetCapsulePayload) {
      mkdirSync(dirname(targetCapsulePayload), { recursive: true });
      const tmpRestorePath = `${targetCapsulePayload}.restore-${process.pid}-${Date.now()}.tmp`;
      writeFileSync(tmpRestorePath, expectedPayloadContent, 'utf8');
      try {
        renameSync(tmpRestorePath, targetCapsulePayload);
      } catch {
        try {
          copyFileSync(tmpRestorePath, targetCapsulePayload);
        } finally {
          rmSync(tmpRestorePath, { force: true });
        }
      }
      const verifiedPayload = readFileSync(targetCapsulePayload, 'utf8');
      if (verifiedPayload !== expectedPayloadContent) {
        throw new Error('Post-restore verification failed for context-capsule-payload.js');
      }
      restoredCapsule = true;
    }
    if (restoreCapsuleBlock.trim()) {
      restoredCapsule = true;
    }

    // Both ASAR preload and payload file are now verified restored — safe to remove backups
    if (existsSync(capsulePayloadBakPath)) {
      rmSync(capsulePayloadBakPath, { force: true });
    }
    if (existsSync(capsulePreloadBakPath)) {
      rmSync(capsulePreloadBakPath, { force: true });
    }
    rmSync(migrationMarkerPath, { force: true });
  }

  if (existsSync(overlayDir)) {
    rmSync(overlayDir, { recursive: true, force: true });
  }
  if (existsSync(fallbackOverlayDir)) {
    rmSync(fallbackOverlayDir, { recursive: true, force: true });
  }
  if (!options.asarPath) {
    uninstallAutoHealHook({ sharedDataDir });
  }

  const cdpResult = options.skipCdp
    ? { attempted: false, reason: 'skipCdp requested', targets: 0, mounted: 0, mountModes: [] }
    : await hotMountViaCdp({ uiScriptPath: '', mode: 'uninstall' });

  return {
    ok: true,
    asarPath,
    removedOverlayDir: overlayDir,
    restoredCapsule,
    asarResult,
    cdpResult,
  };
}

export function getOverlayStatus(options = {}) {
  const asarPath = discoverAsarPath(options.asarPath);
  const resourcesDir = dirname(asarPath);
  const stateDir = options.stateDir ? resolve(String(options.stateDir)) : resolveContextMeterStateDir();
  const overlayDir = join(stateDir, 'agy-quota-overlay');
  const sharedDataDir = options.sharedDataDir
    ? resolve(String(options.sharedDataDir))
    : resolveSharedQuotaDir();
  const primaryBackupsDir = resolveOverlayBackupsDir(sharedDataDir);
  const legacyBackupsDir = join(stateDir, 'backups');

  const asarInspect = inspectAsarFast(asarPath);
  let preloadSyntaxValid = false;
  if (asarInspect.preloadSource) {
    try {
      new vm.Script(asarInspect.preloadSource, { filename: 'dist/preload.js' });
      preloadSyntaxValid = true;
    } catch {
      preloadSyntaxValid = false;
    }
  }

  const companionFiles = {};
  for (const name of COMPANION_FILES) {
    const p = join(overlayDir, name);
    companionFiles[name] = existsSync(p) ? statSync(p).size : null;
  }
  const allCompanionPresent = COMPANION_FILES.every((name) => companionFiles[name] !== null);

  let installedVersion = null;
  const installedMetaPath = join(overlayDir, 'installed-version.json');
  if (existsSync(installedMetaPath)) {
    try {
      installedVersion = JSON.parse(readFileSync(installedMetaPath, 'utf8')).version || null;
    } catch {
      installedVersion = null;
    }
  }

  const primaryBakPath = join(primaryBackupsDir, 'agy-quota-pre-overlay.asar');
  const legacyBakPath = join(legacyBackupsDir, 'agy-quota-pre-overlay.asar');
  const activeBackupPath = existsSync(primaryBakPath)
    ? primaryBakPath
    : existsSync(legacyBakPath)
      ? legacyBakPath
      : null;

  const staleBakPath = join(resourcesDir, 'app.asar.20261114.stale.bak');
  const origBakPath = join(resourcesDir, 'app.asar.orig.bak');
  const sidecarPluginDir = DEFAULT_SIDECAR_TARGET;
  const capsulePayloadPath = join(homedir(), '.gemini', 'tools', 'context-capsule-payload.js');

  let capsuleState = 'absent';
  if (existsSync(capsulePayloadPath)) {
    const content = readFileSync(capsulePayloadPath, 'utf8').trim();
    capsuleState = content === CAPSULE_SILENT_STUB.trim() ? 'stubbed' : 'active-file';
  }

  const autoHealHookActive = isAutoHealHookActive(sharedDataDir);

  const healthy =
    asarInspect.hasOverlayMarker &&
    asarInspect.hasSandboxBootMarker &&
    preloadSyntaxValid &&
    allCompanionPresent;

  return {
    ok: healthy,
    installedVersion,
    hostVersion: asarInspect.hostVersion,
    expectedUiMode: asarInspect.hasMeterManifest ? 'companion' : 'standalone-top-right',
    asarPath,
    hasMeterManifest: asarInspect.hasMeterManifest,
    hasOverlayMarker: asarInspect.hasOverlayMarker,
    hasSandboxBootMarker: asarInspect.hasSandboxBootMarker,
    hasCapsuleMarker: asarInspect.hasCapsuleMarker,
    preloadSyntaxValid,
    preloadSha256: asarInspect.preloadSha256,
    overlayDir,
    companionFiles,
    backupExists: Boolean(activeBackupPath),
    backupPath: activeBackupPath,
    staleOrigQuarantined: existsSync(staleBakPath) && !existsSync(origBakPath),
    sidecarInstalled: existsSync(join(sidecarPluginDir, 'plugin.json')),
    autoHealHookActive,
    capsulePayloadState: capsuleState,
    sharedDataDir,
  };
}

function parseInstallerArgs(argv) {
  let mode = 'install';
  let asarPath = null;
  let keepSidecar = false;
  let migrateCapsule = false;
  let json = false;
  let quiet = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--top-right' || arg === '--meter-overlay') {
      mode = 'install';
    } else if (arg === '--ensure') {
      mode = 'ensure';
    } else if (arg === '--overlay-status') {
      mode = 'status';
    } else if (arg === '--uninstall-overlay') {
      mode = 'uninstall';
    } else if (arg === '--keep-sidecar') {
      keepSidecar = true;
    } else if (arg === '--migrate-capsule') {
      migrateCapsule = true;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--quiet' || arg === '-q') {
      quiet = true;
    } else if (arg === '--asar' && argv[i + 1]) {
      asarPath = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--asar=')) {
      asarPath = arg.slice('--asar='.length);
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node src/overlay-installer.mjs [--top-right | --meter-overlay] [options]

Options:
  --top-right, --meter-overlay   Install/update top-right semi-ring quota overlay & hot-mount via CDP
                                 (Auto-adapts to Context Meter companion mode or standalone top-right HUD;
                                  leaves other third-party tools untouched by default)
  --ensure                       Verify ASAR hooks (and companion Context Meter) and self-heal if wiped
  --keep-sidecar                 Preserve/enable the native right auxiliary sidecar alongside top-right HUD
  --migrate-capsule              Explicitly opt in to backing up & retiring legacy context-capsule (restored on uninstall)
  --overlay-status               Inspect ASAR hook, overlay runtime, backup & sidecar status
  --uninstall-overlay            Remove ASAR preload hook & overlay runtime cleanly (restores migrated capsule if any)
  --asar <path>                  Explicit path to Antigravity resources/app.asar
  --quiet, -q                    Suppress non-error status output (used by auto-ensure hook)
  --json                         Print machine-readable JSON output
  --help, -h                     Show this help message`);
      process.exit(0);
    }
  }

  return { mode, asarPath, keepSidecar, migrateCapsule, json, quiet };
}

function printInstallReport(res) {
  console.log(`[agy-quota] Top-Right Semi-Ring Overlay v${res.version} installed successfully`);
  console.log(
    `  adaptive UI mode  : ${
      res.uiMode === 'companion'
        ? 'Companion (#ag-context-meter integration)'
        : 'Standalone Top-Right HUD (no context-viewer required)'
    }`,
  );
  console.log(`  app.asar          : ${res.asarPath} (${res.asarResult.writeStrategy}, host v${res.hostVersion || 'unknown'})`);
  console.log(`  preload SHA-256   : ${res.asarResult.preloadSha256}`);
  console.log(`  overlay bundle    : ${res.overlayDir}`);
  console.log(`  shared cache dir  : ${res.sharedDataDir}`);
  console.log(`  pre-overlay backup: ${res.backupAsar} (sha256: ${res.backupSha256.slice(0, 16)}...)`);
  if (res.companionRestoreResult?.needed) {
    console.log(
      `  companion meter   : ${
        res.companionRestoreResult.restored
          ? `restored into host v${res.hostVersion || 'unknown'}`
          : `restore attempted (exit=${res.companionRestoreResult.exitCode})`
      }`,
    );
  }
  console.log(`  auto-heal hook    : ${res.autoHealHookActive ? 'active' : 'skipped (--asar mode)'}`);
  if (res.quarantinedStaleBak) {
    console.log(`  stale .orig.bak   : quarantined -> ${res.quarantinedStaleBak}`);
  }
  if (res.capsuleStubbed) {
    console.log('  context-capsule   : backed up & neutralized to silent guard stub');
  }
  if (res.keptSidecarPlugin) {
    console.log('  native sidecar    : preserved alongside top-right HUD (--keep-sidecar)');
  } else if (res.removedSidecarPlugin) {
    console.log('  native sidecar    : removed ~/.gemini/config/plugins/agy-quota (avoid duplicate polling)');
  }
  if (res.cdpResult.attempted) {
    const modeNote =
      res.cdpResult.mountModes && res.cdpResult.mountModes.length
        ? ` [${res.cdpResult.mountModes.join(', ')}]`
        : '';
    console.log(
      `  CDP hot-mount     : ${res.cdpResult.mounted}/${res.cdpResult.targets} active window(s) mounted without restart (port ${res.cdpResult.port})${modeNote}`,
    );
  } else {
    console.log(`  CDP hot-mount     : skipped (${res.cdpResult.reason})`);
  }
}

function printStatusReport(status) {
  console.log(
    `[agy-quota] Top-Right Overlay Status: ${
      status.ok ? `ACTIVE (HEALTHY${status.installedVersion ? `, v${status.installedVersion}` : ''})` : 'INCOMPLETE / NOT INSTALLED'
    }`,
  );
  console.log(`  app.asar          : ${status.asarPath} (host v${status.hostVersion || 'unknown'})`);
  console.log(
    `  Context Meter     : ${
      status.hasMeterManifest
        ? 'detected -> Companion Mode (#panel-quota)'
        : 'not installed -> Standalone Top-Right HUD Mode (#agy-quota-standalone-hud)'
    }`,
  );
  console.log(`  overlay hook      : ${status.hasOverlayMarker ? 'present' : 'absent'} (syntax valid: ${status.preloadSyntaxValid})`);
  console.log(`  auto-heal hook    : ${status.autoHealHookActive ? 'active' : 'inactive'}`);
  console.log(`  legacy capsule    : preload=${status.hasCapsuleMarker ? 'PRESENT' : 'clean'}, payload=${status.capsulePayloadState}`);
  console.log(`  overlay dir       : ${status.overlayDir}`);
  for (const [name, size] of Object.entries(status.companionFiles)) {
    console.log(`    - ${name.padEnd(20)}: ${size !== null ? `${size} B` : 'MISSING'}`);
  }
  console.log(
    `  pre-overlay backup: ${status.backupExists ? `present (${status.backupPath})` : 'absent'}`,
  );
  console.log(
    `  native sidecar    : ${status.sidecarInstalled ? 'installed (coexisting)' : 'uninstalled (zero resident process)'}`,
  );
  console.log(`  shared cache dir  : ${status.sharedDataDir}`);
}

async function runCli() {
  const opts = parseInstallerArgs(process.argv.slice(2));
  if (opts.mode === 'status') {
    const status = getOverlayStatus(opts);
    if (opts.json) {
      console.log(JSON.stringify(status, null, 2));
    } else {
      printStatusReport(status);
    }
    process.exitCode = status.ok ? 0 : 1;
    return;
  }

  if (opts.mode === 'uninstall') {
    const res = await uninstallMeterOverlay(opts);
    if (opts.json) {
      console.log(JSON.stringify(res, null, 2));
    } else {
      console.log(`[agy-quota] Top-Right Overlay uninstalled from ${res.asarPath}`);
      console.log(`  removed bundle : ${res.removedOverlayDir}`);
      if (res.cdpResult.attempted) {
        console.log(`  CDP unmount    : ${res.cdpResult.mounted}/${res.cdpResult.targets} window(s) cleaned`);
      }
    }
    return;
  }

  if (opts.mode === 'ensure') {
    const sharedDataDir = resolveSharedQuotaDir();
    const lockPath = join(sharedDataDir, 'ensure.lock');
    try {
      const status = getOverlayStatus(opts);
      const stateDir = resolveContextMeterStateDir();
      const companionMissing =
        !opts.asarPath && isCompanionExpected(stateDir) && !status.hasMeterManifest;
      if (status.ok && !companionMissing) {
        if (opts.json) {
          console.log(JSON.stringify({ ok: true, healed: false, status }, null, 2));
        } else if (!opts.quiet) {
          console.log(
            `[agy-quota] Ensure check: healthy (host v${status.hostVersion || 'unknown'}, mode=${status.expectedUiMode}).`,
          );
        }
        return;
      }
      const res = await installMeterOverlay(opts);
      if (opts.json) {
        console.log(JSON.stringify({ ok: true, healed: true, result: res }, null, 2));
      } else if (!opts.quiet) {
        printInstallReport(res);
      }
    } finally {
      if (existsSync(lockPath)) {
        rmSync(lockPath, { force: true });
      }
    }
    return;
  }

  const res = await installMeterOverlay(opts);
  if (opts.json) {
    console.log(JSON.stringify(res, null, 2));
  } else if (!opts.quiet) {
    printInstallReport(res);
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
    console.error(`[agy-quota] overlay error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
