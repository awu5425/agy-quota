import { exec } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { homedir, platform } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const USER_STATUS_PATH = '/exa.language_server_pb.LanguageServerService/GetUserStatus';
const QUOTA_SUMMARY_PATH = '/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary';
const REQUEST_METADATA = {
  metadata: {
    ideName: 'antigravity',
    extensionName: 'antigravity',
    locale: 'en',
  },
};

const HTTP_TIMEOUT_MS = 10_000;
const SNAPSHOT_CACHE_TTL_MS = 2_000;
const HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const HISTORY_RAW_MS = 24 * 60 * 60 * 1000;
const HISTORY_DOWNSAMPLE_MS = 5 * 60 * 1000;
const HISTORY_MIN_RECORD_INTERVAL_MS = 60 * 1000;
const RESET_THRESHOLD_PP = 0.1;
const CHART_WINDOW_MINUTES = 90;
const CHART_MAX_BUCKETS = 18;

const QUOTA_POOLS = [
  {
    id: 'gemini',
    label: 'Gemini',
    shortLabel: 'Gemini',
    themeColor: '#40C4FF',
    fiveHourBucketId: 'gemini-5h',
    weeklyBucketId: 'gemini-weekly',
    hideWhenEmpty: false,
  },
  {
    id: 'argon',
    label: 'Argon',
    shortLabel: 'Argon',
    themeColor: '#B388FF',
    fiveHourBucketId: null,
    weeklyBucketId: 'gemini-argon-wtu-weekly',
    hideWhenEmpty: true,
  },
  {
    id: 'non-google',
    label: 'Claude / GPT',
    shortLabel: 'Claude',
    themeColor: '#FFAB40',
    fiveHourBucketId: '3p-5h',
    weeklyBucketId: '3p-weekly',
    hideWhenEmpty: false,
  },
];

const MODEL_GROUPS = [
  { id: 'gemini-argon', poolId: 'argon', label: 'Gemini Argon', color: '#B388FF' },
  { id: 'gemini-flash', poolId: 'gemini', label: 'Gemini Flash', color: '#40C4FF' },
  { id: 'gemini-pro', poolId: 'gemini', label: 'Gemini Hydrogen / Pro', color: '#69F0AE' },
  { id: 'claude', poolId: 'non-google', label: 'Claude', color: '#FFAB40' },
  { id: 'gpt', poolId: 'non-google', label: 'GPT', color: '#FF5252' },
  { id: 'other', poolId: 'non-google', label: 'Other', color: '#FFAB40' },
];

const KNOWN_MODEL_MAP = {
  MODEL_PLACEHOLDER_M417: 'gemini-argon',
  MODEL_PLACEHOLDER_M418: 'gemini-argon',
  MODEL_PLACEHOLDER_M419: 'gemini-argon',
  MODEL_PLACEHOLDER_M668: 'gemini-argon',
  MODEL_PLACEHOLDER_M318: 'gemini-flash',
  MODEL_PLACEHOLDER_M319: 'gemini-flash',
  MODEL_PLACEHOLDER_M320: 'gemini-flash',
  MODEL_PLACEHOLDER_M47: 'gemini-flash',
  MODEL_PLACEHOLDER_M525: 'gemini-pro',
  MODEL_PLACEHOLDER_M526: 'gemini-pro',
  MODEL_PLACEHOLDER_M527: 'gemini-pro',
  MODEL_PLACEHOLDER_M528: 'gemini-pro',
  MODEL_PLACEHOLDER_M36: 'gemini-pro',
  MODEL_PLACEHOLDER_M37: 'gemini-pro',
  MODEL_PLACEHOLDER_M400: 'claude',
  MODEL_PLACEHOLDER_M401: 'claude',
  MODEL_PLACEHOLDER_M402: 'claude',
  MODEL_PLACEHOLDER_M403: 'claude',
  MODEL_PLACEHOLDER_M404: 'claude',
  MODEL_PLACEHOLDER_M405: 'claude',
  MODEL_PLACEHOLDER_M26: 'claude',
  MODEL_PLACEHOLDER_M35: 'claude',
  MODEL_OPENAI_GPT_OSS_120B_MEDIUM: 'gpt',
};

function groupById(id) {
  return MODEL_GROUPS.find((g) => g.id === id) || MODEL_GROUPS[MODEL_GROUPS.length - 1];
}

function classifyModel(modelId = '', label = '') {
  const exact = KNOWN_MODEL_MAP[String(modelId).trim()];
  if (exact) return groupById(exact);

  const hay = `${modelId} ${label}`.toLowerCase();
  if (hay.includes('argon')) return groupById('gemini-argon');
  if (hay.includes('flash')) return groupById('gemini-flash');
  if (hay.includes('hydrogen') || hay.includes('gemini')) return groupById('gemini-pro');
  if (hay.includes('claude')) return groupById('claude');
  if (hay.includes('gpt') || hay.includes('openai')) return groupById('gpt');
  return groupById('other');
}

function clamp(num, min, max) {
  const n = Number(num);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function formatTimeUntilReset(ms) {
  if (!Number.isFinite(ms)) return 'N/A';
  if (ms <= 0) return 'Ready';
  const mins = Math.ceil(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    if (days >= 7) {
      const weeks = Math.floor(days / 7);
      const remDays = days % 7;
      if (remDays === 0 && remHours === 0) return `${weeks}w`;
      if (remDays === 0) return `${weeks}w ${remHours}h`;
      if (remHours === 0) return `${weeks}w ${remDays}d`;
      return `${weeks}w ${remDays}d ${remHours}h`;
    }
    return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
  }
  const remMins = mins % 60;
  return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
}

function formatRunwayDuration(hours) {
  if (!Number.isFinite(hours) || hours <= 0) return 'Stable';
  if (hours < 1) return `~${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 24) return `~${Math.round(hours)}h`;
  const days = hours / 24;
  if (days < 7) return `~${Math.round(days)}d`;
  const weeks = Math.floor(days / 7);
  const remDays = Math.round(days - weeks * 7);
  return remDays <= 0 ? `~${weeks}w` : `~${weeks}w ${remDays}d`;
}

// ---------------------------------------------------------------------------
// Language Server Connection & Discovery
// ---------------------------------------------------------------------------

function resolveDataDir() {
  return process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR
    || join(homedir(), '.gemini', 'antigravity', 'sidecar_data', 'agy-quota', 'quota_panel');
}

const DATA_DIR = resolveDataDir();
const HISTORY_PATH = join(DATA_DIR, 'quota_history.json');
const LS_CONN_CACHE_PATH = join(DATA_DIR, 'last_ls_conn.json');
const PROBE_TIMEOUT_MS = 2_000;

const protocolCache = new Map();
let cachedConn = null;

function loadLastLsConn() {
  try {
    if (!existsSync(LS_CONN_CACHE_PATH)) return null;
    const raw = JSON.parse(readFileSync(LS_CONN_CACHE_PATH, 'utf8'));
    if (!raw?.host || !raw?.port || !raw?.csrfToken) return null;
    return {
      protocol: raw.protocol || null,
      host: String(raw.host),
      port: Number(raw.port),
      csrfToken: String(raw.csrfToken),
    };
  } catch {
    return null;
  }
}

function saveLastLsConn(conn) {
  if (!conn?.host || !conn?.port || !conn?.csrfToken) return;
  try {
    mkdirSync(dirname(LS_CONN_CACHE_PATH), { recursive: true });
    const key = `${conn.host}:${conn.port}`;
    const payload = {
      protocol: conn.protocol || protocolCache.get(key) || null,
      host: conn.host,
      port: Number(conn.port),
      csrfToken: conn.csrfToken,
      updatedAt: Date.now(),
    };
    writeFileSync(LS_CONN_CACHE_PATH, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 });
    try {
      chmodSync(LS_CONN_CACHE_PATH, 0o600);
    } catch {
      // Ignore chmod error on Windows filesystems
    }
  } catch {
    // Non-fatal if cache cannot be written
  }
}

function parseAddress(rawAddress) {
  if (!rawAddress) return null;
  const trimmed = String(rawAddress).trim();
  if (/^https?:\/\//i.test(trimmed)) {
    const url = new URL(trimmed);
    return {
      protocol: url.protocol.replace(':', ''),
      host: url.hostname,
      port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
    };
  }
  const lastColon = trimmed.lastIndexOf(':');
  if (lastColon <= 0) return null;
  const host = trimmed.slice(0, lastColon).replace(/^\[|\]$/g, '');
  const port = Number(trimmed.slice(lastColon + 1));
  if (!host || !Number.isFinite(port) || port <= 0) return null;
  return { protocol: null, host, port };
}

function sendRpcRequest({ protocol, host, port, path, csrfToken, body, timeoutMs = HTTP_TIMEOUT_MS }) {
  return new Promise((resolvePromise, reject) => {
    const payload = JSON.stringify(body);
    const client = protocol === 'https' ? https : http;
    const req = client.request(
      {
        hostname: host,
        port,
        path,
        method: 'POST',
        ...(protocol === 'https' ? { rejectUnauthorized: false } : {}),
        headers: {
          'Content-Type': 'application/json',
          'Connect-Protocol-Version': '1',
          'x-codeium-csrf-token': csrfToken,
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: timeoutMs,
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let json = null;
          try {
            json = raw.trim() ? JSON.parse(raw) : null;
          } catch {
            json = null;
          }
          resolvePromise({ statusCode: res.statusCode || 0, json, raw });
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error(`Request timeout (${timeoutMs}ms)`));
    });
    req.end(payload);
  });
}

async function rpcPost(conn, path, body) {
  const key = `${conn.host}:${conn.port}`;
  const preferred = conn.protocol || protocolCache.get(key);
  const protocols = preferred
    ? [preferred, preferred === 'http' ? 'https' : 'http']
    : ['http', 'https'];

  let lastErr = null;
  for (const proto of protocols) {
    try {
      const res = await sendRpcRequest({
        protocol: proto,
        host: conn.host,
        port: conn.port,
        path,
        csrfToken: conn.csrfToken,
        body,
      });
      protocolCache.set(key, proto);
      return res;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error(`Unable to reach Language Server at ${key}`);
}

function runShell(cmd, timeout = 5000) {
  return new Promise((resolve) => {
    exec(cmd, { timeout, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ error, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

function extractArg(commandLine, name) {
  const escName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`--${escName}(?:=|\\s+)(?:"([^"]*)"|'([^']*)'|([^\\s]+))`, 'i');
  const m = String(commandLine || '').match(re);
  return m ? (m[1] ?? m[2] ?? m[3] ?? null) : null;
}

async function discoverWindowsCandidates() {
  const psCmd = [
    'powershell -NoProfile -Command',
    '"Get-CimInstance Win32_Process -Filter \\"name like \'language_server%\' or name = \'agy.exe\'\\"',
    '| Select-Object ProcessId,CommandLine | ConvertTo-Json -Depth 2"',
  ].join(' ');
  const procRes = await runShell(psCmd);
  if (!procRes.stdout.trim()) return [];
  let rows = JSON.parse(procRes.stdout);
  if (!Array.isArray(rows)) rows = [rows];

  const netRes = await runShell('netstat -ano');
  const netLines = netRes.stdout.split(/\r?\n/);

  const candidates = [];
  for (const row of rows) {
    const pid = Number(row?.ProcessId);
    const cmdLine = row?.CommandLine || '';
    const csrfToken = extractArg(cmdLine, 'csrf_token');
    if (!pid || !csrfToken) continue;

    const ports = [];
    const hubPort = Number(extractArg(cmdLine, 'hub-port')) || null;
    const extPort = Number(extractArg(cmdLine, 'extension_server_port')) || null;
    if (hubPort) ports.push(hubPort);

    const pidRe = new RegExp(`\\s${pid}\\s*$`);
    for (const line of netLines) {
      if (!/LISTENING/i.test(line) || !pidRe.test(line)) continue;
      for (const m of line.matchAll(/(?:127\.0\.0\.1|\[?::1\]?):(\d{2,5})/g)) {
        const p = Number(m[1]);
        if (p > 0 && p < 65536 && p !== extPort && !ports.includes(p)) ports.push(p);
      }
    }
    candidates.push({ pid, csrfToken, ports });
  }
  return candidates;
}

function discoverProcEnvCandidates() {
  if (!existsSync('/proc')) return [];
  const candidates = [];
  const seen = new Set();
  let entries = [];
  try {
    entries = readdirSync('/proc');
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const buf = readFileSync(`/proc/${entry}/environ`);
      if (!buf || buf.length === 0) continue;
      let lsAddr = '';
      let csrf = '';
      for (const pair of buf.toString('utf8').split('\0')) {
        if (pair.startsWith('ANTIGRAVITY_LS_ADDRESS=')) {
          lsAddr = pair.slice('ANTIGRAVITY_LS_ADDRESS='.length).trim();
        } else if (pair.startsWith('ANTIGRAVITY_CSRF_TOKEN=')) {
          csrf = pair.slice('ANTIGRAVITY_CSRF_TOKEN='.length).trim();
        }
        if (lsAddr && csrf) break;
      }
      if (!lsAddr || !csrf) continue;
      const parsed = parseAddress(lsAddr);
      if (!parsed) continue;
      const dedupeKey = `${parsed.host}:${parsed.port}:${csrf}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      candidates.push({
        pid: Number(entry),
        protocol: parsed.protocol || null,
        host: parsed.host || '127.0.0.1',
        csrfToken: csrf,
        ports: [parsed.port],
        source: 'proc-env',
      });
    } catch {
      // Ignore unreadable PIDs (EACCES/ENOENT)
    }
  }
  return candidates;
}

async function discoverUnixCandidates() {
  const candidates = discoverProcEnvCandidates();
  const psRes = await runShell('ps -A -ww -o pid=,args=');
  if (!psRes.stdout.trim()) return candidates;

  for (const line of psRes.stdout.split(/\r?\n/)) {
    const m = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    const cmdLine = m[2];
    if (!/language_server|(^|\/)agy(\s|$)/i.test(cmdLine)) continue;
    const csrfToken = extractArg(cmdLine, 'csrf_token');
    if (!csrfToken) continue;

    const ports = [];
    const hubPort = Number(extractArg(cmdLine, 'hub-port')) || null;
    const extPort = Number(extractArg(cmdLine, 'extension_server_port')) || null;
    if (hubPort) ports.push(hubPort);

    const portCmd = platform() === 'darwin' ? `lsof -nP -a -p ${pid} -iTCP -sTCP:LISTEN` : `ss -tlnp`;
    const netRes = await runShell(portCmd);
    for (const netLine of netRes.stdout.split(/\r?\n/)) {
      if (platform() !== 'darwin' && !new RegExp(`pid=${pid}[,)]|\\s${pid}/`).test(netLine)) continue;
      for (const pm of netLine.matchAll(/(?:127\.0\.0\.1|\[?::1\]?):(\d{2,5})/g)) {
        const p = Number(pm[1]);
        if (p > 0 && p < 65536 && p !== extPort && !ports.includes(p)) ports.push(p);
      }
    }
    candidates.push({ pid, csrfToken, ports, source: 'process-discovery' });
  }
  return candidates;
}

async function probeLsCandidate({ protocol = null, host = '127.0.0.1', port, csrfToken, source, pid }) {
  const protos = protocol ? [protocol, protocol === 'http' ? 'https' : 'http'] : ['http', 'https'];
  for (const proto of protos) {
    try {
      const probe = await sendRpcRequest({
        protocol: proto,
        host,
        port,
        path: USER_STATUS_PATH,
        csrfToken,
        body: REQUEST_METADATA,
        timeoutMs: PROBE_TIMEOUT_MS,
      });
      if (probe.statusCode === 200 && probe.json?.userStatus) {
        return {
          protocol: proto,
          host,
          port,
          csrfToken,
          source,
          ...(pid ? { pid } : {}),
        };
      }
    } catch {
      // Try next protocol/port
    }
  }
  return null;
}

async function resolveConnection(forceRediscover = false) {
  if (!forceRediscover && process.env.ANTIGRAVITY_LS_ADDRESS && process.env.ANTIGRAVITY_CSRF_TOKEN) {
    const parsed = parseAddress(process.env.ANTIGRAVITY_LS_ADDRESS);
    if (parsed) {
      return {
        ...parsed,
        csrfToken: process.env.ANTIGRAVITY_CSRF_TOKEN,
        source: 'env',
      };
    }
  }

  if (!forceRediscover && cachedConn) return cachedConn;

  const lastConn = loadLastLsConn();
  if (lastConn) {
    const alive = await probeLsCandidate({ ...lastConn, source: 'ls-cache' });
    if (alive) {
      cachedConn = alive;
      return cachedConn;
    }
  }

  const candidates = platform() === 'win32'
    ? await discoverWindowsCandidates()
    : await discoverUnixCandidates();

  for (const cand of candidates) {
    for (const port of cand.ports) {
      const alive = await probeLsCandidate({
        protocol: cand.protocol || null,
        host: cand.host || '127.0.0.1',
        port,
        csrfToken: cand.csrfToken,
        source: cand.source || 'process-discovery',
        pid: cand.pid,
      });
      if (alive) {
        cachedConn = alive;
        saveLastLsConn(alive);
        return cachedConn;
      }
    }
  }

  throw new Error('Could not find a running Antigravity Language Server with --csrf_token.');
}

// ---------------------------------------------------------------------------
// Quota History Persistence & Consumption Analytics
// ---------------------------------------------------------------------------

function loadHistory() {
  try {
    if (!existsSync(HISTORY_PATH)) return [];
    const parsed = JSON.parse(readFileSync(HISTORY_PATH, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - HISTORY_RETENTION_MS;
    return parsed.filter((pt) => pt && typeof pt.ts === 'number' && pt.ts >= cutoff && pt.pools);
  } catch {
    return [];
  }
}

function pruneHistory(points, now) {
  const cutoff = now - HISTORY_RETENTION_MS;
  const rawCutoff = now - HISTORY_RAW_MS;
  const filtered = points.filter((p) => p.ts >= cutoff);

  const older = [];
  const recent = [];
  for (const pt of filtered) {
    if (pt.ts >= rawCutoff) recent.push(pt);
    else older.push(pt);
  }

  const downsampled = [];
  let lastBucketTs = -Infinity;
  for (const pt of older) {
    const hasReset = Array.isArray(pt.resets) && pt.resets.length > 0;
    if (hasReset || pt.ts - lastBucketTs >= HISTORY_DOWNSAMPLE_MS) {
      downsampled.push(pt);
      lastBucketTs = pt.ts;
    }
  }

  return [...downsampled, ...recent].slice(-4000);
}

function saveHistory(points) {
  try {
    mkdirSync(dirname(HISTORY_PATH), { recursive: true });
    writeFileSync(HISTORY_PATH, JSON.stringify(points), 'utf8');
  } catch {
    // Non-fatal if storage directory is read-only
  }
}

let historyPoints = loadHistory();

function recordAndAnalyzeHistory(pools, now) {
  const prev = historyPoints.length > 0 ? historyPoints[historyPoints.length - 1] : null;
  const currentMap = {};
  const resets = [];
  let changed = false;

  for (const pool of pools) {
    if (!pool.hasData || pool.rawRemaining === null) continue;
    currentMap[pool.id] = pool.rawRemaining;
    const prevVal = prev?.pools?.[pool.id];
    if (prevVal === undefined) {
      changed = true;
    } else {
      if (pool.rawRemaining > prevVal + RESET_THRESHOLD_PP) {
        resets.push(pool.id);
        changed = true;
      } else if (Math.abs(pool.rawRemaining - prevVal) >= 0.05) {
        changed = true;
      }
    }
  }

  const elapsed = prev ? now - prev.ts : Infinity;
  if (Object.keys(currentMap).length > 0 && (changed || elapsed >= HISTORY_MIN_RECORD_INTERVAL_MS)) {
    historyPoints.push({ ts: now, pools: currentMap, resets });
    historyPoints = pruneHistory(historyPoints, now);
    saveHistory(historyPoints);
  }

  // Build 90-minute stacked usage buckets (pp consumed per pool)
  const bucketMinutes = Math.max(5, Math.ceil(CHART_WINDOW_MINUTES / CHART_MAX_BUCKETS));
  const bucketMs = bucketMinutes * 60_000;
  const windowStart = now - CHART_WINDOW_MINUTES * 60_000;
  const bucketCount = Math.ceil(CHART_WINDOW_MINUTES / bucketMinutes);
  const buckets = Array.from({ length: bucketCount }, (_, i) => ({
    startTime: windowStart + i * bucketMs,
    endTime: windowStart + (i + 1) * bucketMs,
    items: {},
  }));

  const latestResetByPool = {};
  for (const pt of historyPoints) {
    if (Array.isArray(pt.resets)) {
      for (const pid of pt.resets) {
        latestResetByPool[pid] = pt.ts;
      }
    }
  }

  for (let i = 1; i < historyPoints.length; i++) {
    const a = historyPoints[i - 1];
    const b = historyPoints[i];
    if (b.ts < windowStart) continue;
    if (b.ts - a.ts > 15 * 60_000) continue; // Ignore offline gaps > 15m

    const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor((b.ts - windowStart) / bucketMs)));
    for (const [pid, currVal] of Object.entries(b.pools)) {
      if (Array.isArray(b.resets) && b.resets.includes(pid)) continue;
      const prevVal = a.pools?.[pid];
      if (prevVal === undefined) continue;
      const drop = prevVal - currVal;
      if (drop > 0.01) {
        buckets[idx].items[pid] = (buckets[idx].items[pid] || 0) + drop;
      }
    }
  }

  const predictions = {};
  for (const pool of pools) {
    if (!pool.hasData) continue;
    const latestReset = latestResetByPool[pool.id] ?? null;
    const rateStart = latestReset ? Math.max(windowStart, latestReset) : windowStart;
    let totalDrop = 0;
    for (const b of buckets) {
      if (latestReset && b.endTime <= latestReset) continue;
      totalDrop += b.items[pool.id] || 0;
    }
    const elapsedHours = Math.max(now - rateStart, bucketMs) / 3_600_000;
    const usageRate = elapsedHours > 0 ? totalDrop / elapsedHours : 0;
    let runway = 'Stable';
    if (usageRate > 0.05 && pool.remaining > 0) {
      const hoursUntilEmpty = pool.remaining / usageRate;
      const hoursUntilReset = pool.resetDate ? (pool.resetDate - now) / 3_600_000 : 5;
      if (!Number.isFinite(hoursUntilReset) || hoursUntilReset <= 0 || hoursUntilEmpty < hoursUntilReset) {
        runway = formatRunwayDuration(hoursUntilEmpty);
      }
    }
    predictions[pool.id] = {
      usageRate: Number(usageRate.toFixed(2)),
      runway,
    };
  }

  const formattedBuckets = buckets.map((b) => ({
    endTime: b.endTime,
    items: Object.entries(b.items)
      .filter(([, usage]) => usage > 0.01)
      .map(([poolId, usage]) => {
        const poolCfg = QUOTA_POOLS.find((p) => p.id === poolId);
        return {
          poolId,
          usage: Number(usage.toFixed(2)),
          color: poolCfg?.themeColor || '#888',
        };
      }),
  }));

  const hasUsage = formattedBuckets.some((b) => b.items.length > 0);
  return {
    windowMinutes: CHART_WINDOW_MINUTES,
    bucketMinutes,
    hasUsage,
    buckets: formattedBuckets,
    predictions,
    pointCount: historyPoints.length,
  };
}

// ---------------------------------------------------------------------------
// Response Transformation
// ---------------------------------------------------------------------------

function parseSnapshot(userStatusData, summaryData, connInfo) {
  const now = Date.now();
  const userStatus = userStatusData?.userStatus || {};
  const planStatus = userStatus.planStatus || {};
  const planInfo = planStatus.planInfo || {};
  const userTier = userStatus.userTier || {};

  const userInfo = {
    name: userStatus.name || '',
    email: userStatus.email || '',
    tier: userTier.name || planInfo.teamsTier || '',
    tierId: userTier.id || '',
    tierDescription: userTier.description || '',
    planName: planInfo.planName || '',
    teamsTier: planInfo.teamsTier || '',
    upgradeUri: userTier.upgradeSubscriptionUri || '',
    upgradeText: userTier.upgradeSubscriptionText || '',
  };

  // Credits
  let promptCredits = null;
  const monthlyPrompt = toFiniteNumber(planInfo.monthlyPromptCredits);
  const availPrompt = planStatus ? toFiniteNumber(planStatus.availablePromptCredits ?? 0) : null;
  if (monthlyPrompt !== null && monthlyPrompt > 0 && availPrompt !== null) {
    const avail = Math.max(0, availPrompt);
    promptCredits = {
      available: avail,
      monthly: monthlyPrompt,
      remainingPercentage: clamp((avail / monthlyPrompt) * 100, 0, 100),
      usedPercentage: clamp(((monthlyPrompt - avail) / monthlyPrompt) * 100, 0, 100),
    };
  }

  let flowCredits = null;
  const monthlyFlow = toFiniteNumber(planInfo.monthlyFlowCredits);
  const availFlow = planStatus && monthlyFlow !== null ? toFiniteNumber(planStatus.availableFlowCredits ?? 0) : null;
  if (monthlyFlow !== null && monthlyFlow > 0 && availFlow !== null) {
    const avail = Math.max(0, availFlow);
    flowCredits = {
      available: avail,
      monthly: monthlyFlow,
      remainingPercentage: clamp((avail / monthlyFlow) * 100, 0, 100),
      usedPercentage: clamp(((monthlyFlow - avail) / monthlyFlow) * 100, 0, 100),
    };
  }

  const userCredits = (userTier.availableCredits || []).map((c) => ({
    creditType: typeof c.creditType === 'string' && c.creditType.trim() ? c.creditType : 'UNKNOWN',
    creditAmount: c.creditAmount !== undefined && c.creditAmount !== null ? String(c.creditAmount) : null,
    minimumCreditAmountForUsage: c.minimumCreditAmountForUsage !== undefined && c.minimumCreditAmountForUsage !== null
      ? String(c.minimumCreditAmountForUsage)
      : null,
  }));

  // Models
  const rawModels = userStatus.cascadeModelConfigData?.clientModelConfigs || [];
  const models = [];
  const disabledModels = [];

  for (const m of rawModels) {
    const modelId = m.modelOrAlias?.model || 'unknown';
    const label = m.label || modelId;
    const grp = classifyModel(modelId, label);

    if (m.disabled || !m.quotaInfo) {
      disabledModels.push({
        label,
        modelId,
        groupId: grp.id,
        groupLabel: grp.label,
        poolId: grp.poolId,
        color: grp.color,
        disabled: true,
      });
      continue;
    }

    const rawFraction = clamp(m.quotaInfo.remainingFraction ?? 0, 0, 1);
    const parsedReset = m.quotaInfo.resetTime ? Date.parse(m.quotaInfo.resetTime) : NaN;
    const hasReset = Number.isFinite(parsedReset);
    const timeUntilReset = hasReset ? formatTimeUntilReset(parsedReset - now) : 'N/A';
    const remainingPercentage = timeUntilReset === 'Ready' ? 100 : rawFraction * 100;

    models.push({
      label,
      modelId,
      groupId: grp.id,
      groupLabel: grp.label,
      poolId: grp.poolId,
      color: grp.color,
      remainingPercentage: Number(remainingPercentage.toFixed(2)),
      rawRemainingPercentage: Number((rawFraction * 100).toFixed(2)),
      isExhausted: rawFraction === 0 && timeUntilReset !== 'Ready',
      resetDate: hasReset ? parsedReset : null,
      resetIso: hasReset ? m.quotaInfo.resetTime : null,
      timeUntilReset,
    });
  }

  // Summary buckets from RetrieveUserQuotaSummary
  const rawGroups = summaryData?.response?.groups || summaryData?.groups || [];
  const summaryBucketsById = new Map();
  const summaryGroups = [];

  for (const g of rawGroups) {
    const buckets = [];
    for (const b of g.buckets || []) {
      if (typeof b.bucketId !== 'string') continue;
      if (b.window !== 'weekly' && b.window !== '5h') continue;
      if (b.remainingFraction === undefined && b.remainingAmount !== undefined) continue;
      const frac = clamp(b.remainingFraction ?? 0, 0, 1);
      const parsedReset = b.resetTime ? Date.parse(b.resetTime) : NaN;
      const hasReset = Number.isFinite(parsedReset);
      const timeUntilReset = hasReset ? formatTimeUntilReset(parsedReset - now) : 'N/A';
      const remainingPercentage = timeUntilReset === 'Ready' ? 100 : frac * 100;

      const bucketObj = {
        bucketId: b.bucketId,
        displayName: b.displayName || b.bucketId,
        description: b.description || '',
        window: b.window,
        remainingPercentage: Number(remainingPercentage.toFixed(2)),
        rawRemainingPercentage: Number((frac * 100).toFixed(2)),
        resetDate: hasReset ? parsedReset : null,
        resetIso: hasReset ? b.resetTime : null,
        timeUntilReset,
      };
      buckets.push(bucketObj);
      summaryBucketsById.set(b.bucketId, bucketObj);
    }
    summaryGroups.push({
      displayName: g.displayName || '',
      description: g.description || '',
      buckets,
    });
  }

  // Aggregate Quota Pools
  const pools = [];
  for (const cfg of QUOTA_POOLS) {
    const poolModels = models.filter((m) => m.poolId === cfg.id);
    const minModel = poolModels.length > 0
      ? poolModels.reduce((min, cur) => (cur.rawRemainingPercentage < min.rawRemainingPercentage ? cur : min))
      : null;

    const fiveHourBucket = cfg.fiveHourBucketId ? summaryBucketsById.get(cfg.fiveHourBucketId) || null : null;
    const weeklyBucket = cfg.weeklyBucketId ? summaryBucketsById.get(cfg.weeklyBucketId) || null : null;

    let hasData = false;
    let remaining = 0;
    let rawRemaining = null;
    let resetDate = null;
    let resetIso = null;
    let resetTime = 'N/A';
    let source = 'none';

    if (fiveHourBucket) {
      hasData = true;
      remaining = fiveHourBucket.remainingPercentage;
      rawRemaining = fiveHourBucket.rawRemainingPercentage;
      resetDate = fiveHourBucket.resetDate;
      resetIso = fiveHourBucket.resetIso;
      resetTime = fiveHourBucket.timeUntilReset;
      source = '5h-bucket';
    } else if (minModel) {
      hasData = true;
      remaining = minModel.remainingPercentage;
      rawRemaining = minModel.rawRemainingPercentage;
      resetDate = minModel.resetDate;
      resetIso = minModel.resetIso;
      resetTime = minModel.timeUntilReset;
      source = 'model';
    } else if (weeklyBucket) {
      hasData = true;
      remaining = weeklyBucket.remainingPercentage;
      rawRemaining = weeklyBucket.rawRemainingPercentage;
      resetDate = weeklyBucket.resetDate;
      resetIso = weeklyBucket.resetIso;
      resetTime = weeklyBucket.timeUntilReset;
      source = 'weekly-bucket';
    }

    if (cfg.hideWhenEmpty && !hasData && !weeklyBucket) continue;

    pools.push({
      id: cfg.id,
      label: cfg.label,
      shortLabel: cfg.shortLabel,
      themeColor: cfg.themeColor,
      hasData,
      remaining,
      rawRemaining,
      resetDate,
      resetIso,
      resetTime,
      source,
      modelCount: poolModels.length,
      weekly: weeklyBucket
        ? {
            bucketId: weeklyBucket.bucketId,
            remaining: weeklyBucket.remainingPercentage,
            resetDate: weeklyBucket.resetDate,
            resetIso: weeklyBucket.resetIso,
            resetTime: weeklyBucket.timeUntilReset,
          }
        : null,
    });
  }

  const history = recordAndAnalyzeHistory(pools, now);
  for (const pool of pools) {
    pool.prediction = history.predictions[pool.id] || { usageRate: 0, runway: 'Stable' };
  }

  return {
    ok: true,
    timestamp: now,
    connection: {
      host: connInfo.host,
      port: connInfo.port,
      source: connInfo.source,
    },
    userInfo,
    credits: {
      prompt: promptCredits,
      flow: flowCredits,
      userCredits,
    },
    pools,
    summaryDescription: summaryData?.response?.description || summaryData?.description || '',
    summaryGroups,
    models,
    disabledModels,
    history,
  };
}

// ---------------------------------------------------------------------------
// Direct Cloud Code OAuth Fallback (Standalone CLI without running LS)
// ---------------------------------------------------------------------------

const CLOUDCODE_HOSTS = ['daily-cloudcode-pa.googleapis.com', 'cloudcode-pa.googleapis.com'];

function httpsPostRequest({ hostname, path, headers = {}, body = '', timeoutMs = HTTP_TIMEOUT_MS }) {
  return new Promise((resolvePromise, reject) => {
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    const req = https.request(
      {
        hostname,
        port: 443,
        path,
        method: 'POST',
        headers: {
          ...headers,
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: timeoutMs,
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let json = null;
          try {
            json = raw.trim() ? JSON.parse(raw) : null;
          } catch {
            json = null;
          }
          resolvePromise({ statusCode: res.statusCode || 0, json, raw });
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error(`HTTPS request timeout (${timeoutMs}ms)`));
    });
    req.end(payload);
  });
}

function parseJwtPayload(token) {
  if (!token || typeof token !== 'string') return {};
  const parts = token.split('.');
  if (parts.length < 2) return {};
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/')
      + '='.repeat((4 - (parts[1].length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return {};
  }
}

function getSearchHomes() {
  const homes = [];
  const addHome = (p) => {
    if (!p) return;
    const abs = resolve(p);
    if (!homes.includes(abs)) homes.push(abs);
  };
  addHome(homedir());
  addHome(process.env.AGY_REAL_HOME);
  return homes;
}

function parseOAuthTokenEntry(tokenPath) {
  try {
    const authData = JSON.parse(readFileSync(tokenPath, 'utf8'));
    const tokenObj = authData?.token || {};
    if (!tokenObj.access_token && !tokenObj.refresh_token) return null;
    const expMs = tokenObj.expiry ? Date.parse(String(tokenObj.expiry)) : NaN;
    const isFresh = Boolean(tokenObj.access_token) && (!Number.isFinite(expMs) || expMs > Date.now() + 60_000);
    let mtimeMs = 0;
    try {
      mtimeMs = statSync(tokenPath).mtimeMs || 0;
    } catch {
      mtimeMs = 0;
    }
    return { tokenPath, authData, tokenObj, isFresh, mtimeMs };
  } catch {
    return null;
  }
}

function findOAuthTokenFiles(profileDirOption = null) {
  const seen = new Set();
  const direct = [];
  const profileCandidates = [];

  const pushPath = (baseDir, bucket) => {
    if (!baseDir) return;
    const tokenPath = join(resolve(baseDir), '.gemini', 'antigravity-cli', 'antigravity-oauth-token');
    if (seen.has(tokenPath) || !existsSync(tokenPath)) return;
    seen.add(tokenPath);
    const parsed = parseOAuthTokenEntry(tokenPath);
    if (parsed) bucket.push(parsed);
  };

  if (profileDirOption) pushPath(profileDirOption, direct);
  if (process.env.GEMINI_CLI_PROFILE_DIR) pushPath(process.env.GEMINI_CLI_PROFILE_DIR, direct);

  const homes = getSearchHomes();
  for (const h of homes) pushPath(h, direct);

  for (const h of homes) {
    for (const profilesFolder of ['.gemini-profiles', '.agy-profiles']) {
      const root = join(h, profilesFolder);
      if (!existsSync(root)) continue;
      try {
        for (const entry of readdirSync(root)) {
          pushPath(join(root, entry), profileCandidates);
        }
      } catch {
        // Ignore unreadable profile folders
      }
    }
  }

  profileCandidates.sort((a, b) => {
    if (a.isFresh !== b.isFresh) return a.isFresh ? -1 : 1;
    return b.mtimeMs - a.mtimeMs;
  });

  return [...direct, ...profileCandidates];
}

function readEnvFileIntoMap(filePath) {
  const out = {};
  if (!existsSync(filePath)) return out;
  try {
    for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      let line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      if (line.startsWith('export ')) line = line.slice(7).trim();
      const eqIdx = line.indexOf('=');
      if (eqIdx <= 0) continue;
      const k = line.slice(0, eqIdx).trim();
      const v = line.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
      if (k && v) out[k] = v;
    }
  } catch {
    // Ignore unreadable env file
  }
  return out;
}

function findLocalAgyBinaries() {
  const bins = [];
  const addBin = (p) => {
    if (!p || !existsSync(p)) return;
    const abs = resolve(p);
    if (!bins.includes(abs)) bins.push(abs);
  };

  const pathDirs = (process.env.PATH || '').split(delimiter).filter(Boolean);
  const names = platform() === 'win32'
    ? ['agy.exe', 'antigravity.exe', 'jetski.exe']
    : ['agy', 'antigravity', 'jetski'];

  for (const dir of pathDirs) {
    for (const name of names) {
      const p = join(dir, name);
      if (!p.toLowerCase().endsWith('.cmd') && !p.toLowerCase().endsWith('.bat')) {
        addBin(p);
      }
    }
  }

  for (const h of getSearchHomes()) {
    addBin(join(h, '.local', 'bin', platform() === 'win32' ? 'agy.exe' : 'agy'));
  }
  if (platform() === 'win32' && process.env.LOCALAPPDATA) {
    addBin(join(process.env.LOCALAPPDATA, 'agy', 'bin', 'agy.exe'));
  } else {
    addBin('/usr/local/bin/agy');
  }
  return bins;
}

function resolveOAuthClientCredentials() {
  const envCid = (process.env.AGY_OAUTH_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
  const envSec = (process.env.AGY_OAUTH_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
  if (envCid && envSec) return { clientId: envCid, clientSecret: envSec };

  for (const h of getSearchHomes()) {
    for (const fileName of ['env', 'oauth.env']) {
      const vars = readEnvFileIntoMap(join(h, '.config', 'agy-multi', fileName));
      const cid = vars.AGY_OAUTH_CLIENT_ID || vars.GOOGLE_OAUTH_CLIENT_ID || '';
      const sec = vars.AGY_OAUTH_CLIENT_SECRET || vars.GOOGLE_OAUTH_CLIENT_SECRET || '';
      if (cid && sec) return { clientId: cid, clientSecret: sec };
    }
  }

  for (const binPath of findLocalAgyBinaries()) {
    try {
      const text = readFileSync(binPath).toString('latin1');
      const cidMatch = text.match(/107[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com/);
      const secMatch = text.match(/GOCSPX-[A-Za-z0-9_-]{28}/);
      if (cidMatch && secMatch) {
        return { clientId: cidMatch[0], clientSecret: secMatch[0] };
      }
    } catch {
      // Ignore unreadable binary
    }
  }
  return { clientId: '', clientSecret: '' };
}

async function refreshOAuthAccessToken(tokenFile, authData, tokenObj) {
  const refreshToken = tokenObj?.refresh_token;
  if (!refreshToken) return null;

  const { clientId, clientSecret } = resolveOAuthClientCredentials();
  if (!clientId || !clientSecret) return null;

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  }).toString();

  const res = await httpsPostRequest({
    hostname: 'oauth2.googleapis.com',
    path: '/token',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (res.statusCode !== 200 || !res.json?.access_token) {
    return null;
  }

  tokenObj.access_token = res.json.access_token;
  if (Number.isFinite(Number(res.json.expires_in))) {
    tokenObj.expiry = new Date(Date.now() + Number(res.json.expires_in) * 1000).toISOString();
  }
  authData.token = tokenObj;
  try {
    writeFileSync(tokenFile, JSON.stringify(authData, null, 2), { encoding: 'utf8', mode: 0o600 });
    try {
      chmodSync(tokenFile, 0o600);
    } catch {
      // Ignore chmod error on Windows
    }
  } catch {
    // Non-fatal
  }
  return tokenObj.access_token;
}

async function callCloudCodeEndpoint(accessToken, endpointPath, body) {
  for (const host of CLOUDCODE_HOSTS) {
    try {
      const res = await httpsPostRequest({
        hostname: host,
        path: endpointPath,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'antigravity-cli',
        },
        body,
      });
      if (res.statusCode === 200 && res.json) {
        return { ok: true, host, json: res.json };
      }
      if (res.statusCode === 401) {
        return { ok: false, unauthorized: true, host, statusCode: 401 };
      }
    } catch {
      // Try next Cloud Code host
    }
  }
  return { ok: false, unauthorized: false, host: CLOUDCODE_HOSTS[0], statusCode: 0 };
}

function buildClientModelConfigsFromCloud(availableModelsData) {
  const rawMap = availableModelsData?.models;
  if (!rawMap || typeof rawMap !== 'object') return [];
  const seenLabels = new Set();
  const configs = [];

  for (const entry of Object.values(rawMap)) {
    if (!entry || !entry.displayName || !entry.quotaInfo) continue;
    if (seenLabels.has(entry.displayName)) continue;
    seenLabels.add(entry.displayName);
    configs.push({
      label: entry.displayName,
      modelOrAlias: { model: entry.model || entry.vertexModelId || entry.displayName },
      disabled: Boolean(entry.disabled),
      quotaInfo: entry.quotaInfo,
    });
  }
  return configs;
}

function buildUserStatusFromOAuth(email, name, loadCodeAssistData, availableModelsData = null) {
  let tierObj = loadCodeAssistData?.paidTier || loadCodeAssistData?.currentTier || null;
  if (!tierObj && Array.isArray(loadCodeAssistData?.allowedTiers)) {
    tierObj = loadCodeAssistData.allowedTiers.find((t) => t?.id === 'free-tier' || t?.isDefault === true) || null;
  }
  const tierId = tierObj?.id || '';
  const rawTierName = tierObj?.name || tierId || '';
  const lower = rawTierName.toLowerCase();
  let planName = rawTierName;
  if (lower.includes('ultra') || lower.includes('helium')) planName = 'Ultra';
  else if (lower.includes('pro') || lower.includes('premium') || lower.includes('advanced')) planName = 'Pro';
  else if (lower.includes('free') || lower.includes('starter')) planName = 'Free';

  return {
    userStatus: {
      name: name || '',
      email: email || '',
      userTier: {
        id: tierId,
        name: rawTierName || (planName ? `Google AI ${planName}` : ''),
        description: tierObj?.description || '',
      },
      planStatus: {
        planInfo: {
          planName,
          teamsTier: tierId,
        },
      },
      cascadeModelConfigData: {
        clientModelConfigs: buildClientModelConfigsFromCloud(availableModelsData),
      },
    },
  };
}

async function fetchViaOAuthToken(options = {}) {
  const tokenEntries = findOAuthTokenFiles(options.profileDir || null);
  const selected = tokenEntries[0] || null;
  if (!selected) {
    throw new Error('No antigravity-oauth-token file found for OAuth fallback.');
  }

  const { tokenPath, authData, tokenObj } = selected;
  const idToken = authData.id_token || tokenObj.id_token || '';
  const claims = parseJwtPayload(idToken);
  const email = claims.email || authData.email || authData.id_token_email || '';
  const name = claims.name || '';

  let accessToken = tokenObj.access_token || '';
  const expMs = tokenObj.expiry ? Date.parse(String(tokenObj.expiry)) : NaN;
  const isExpired = !accessToken || (Number.isFinite(expMs) && expMs <= Date.now() + 60_000);

  if (isExpired && tokenObj.refresh_token) {
    accessToken = (await refreshOAuthAccessToken(tokenPath, authData, tokenObj)) || accessToken;
  }
  if (!accessToken) {
    throw new Error(`OAuth token in ${tokenPath} is missing/expired and could not be refreshed.`);
  }

  let subRes = await callCloudCodeEndpoint(
    accessToken,
    '/v1internal:loadCodeAssist',
    { metadata: { ideType: 'ANTIGRAVITY' } },
  );
  if (subRes.unauthorized && tokenObj.refresh_token) {
    const refreshed = await refreshOAuthAccessToken(tokenPath, authData, tokenObj);
    if (refreshed) {
      accessToken = refreshed;
      subRes = await callCloudCodeEndpoint(
        accessToken,
        '/v1internal:loadCodeAssist',
        { metadata: { ideType: 'ANTIGRAVITY' } },
      );
    }
  }

  const projectId = subRes.ok ? subRes.json?.cloudaicompanionProject : null;
  const quotaReqBody = projectId ? { project: projectId } : {};

  let quotaRes = await callCloudCodeEndpoint(accessToken, '/v1internal:retrieveUserQuotaSummary', quotaReqBody);
  if (quotaRes.unauthorized && tokenObj.refresh_token) {
    const refreshed = await refreshOAuthAccessToken(tokenPath, authData, tokenObj);
    if (refreshed) {
      accessToken = refreshed;
      quotaRes = await callCloudCodeEndpoint(accessToken, '/v1internal:retrieveUserQuotaSummary', quotaReqBody);
    }
  }

  const modelsRes = await callCloudCodeEndpoint(accessToken, '/v1internal:fetchAvailableModels', quotaReqBody);

  if ((!quotaRes.ok || !quotaRes.json) && (!modelsRes.ok || !modelsRes.json)) {
    throw new Error('Cloud Code retrieveUserQuotaSummary and fetchAvailableModels failed with OAuth token.');
  }

  const userStatusData = buildUserStatusFromOAuth(
    email,
    name,
    subRes.ok ? subRes.json : null,
    modelsRes.ok ? modelsRes.json : null,
  );
  return parseSnapshot(userStatusData, quotaRes.ok ? quotaRes.json : { groups: [] }, {
    host: quotaRes.ok ? quotaRes.host : modelsRes.host,
    port: 443,
    source: 'oauth-token',
  });
}

let cachedSnapshot = null;
let cachedSnapshotAt = 0;

async function fetchQuotaSnapshot(force = false, options = {}) {
  const effectiveOptions = { ...runtimeOptions, ...options };
  const now = Date.now();
  if (!force && !effectiveOptions.forceOAuth && cachedSnapshot && now - cachedSnapshotAt < SNAPSHOT_CACHE_TTL_MS) {
    return cachedSnapshot;
  }

  if (effectiveOptions.forceOAuth) {
    const snapshot = await fetchViaOAuthToken(effectiveOptions);
    cachedSnapshot = snapshot;
    cachedSnapshotAt = Date.now();
    return snapshot;
  }

  let lsError = null;
  try {
    let conn = await resolveConnection(false);
    let statusRes;
    try {
      statusRes = await rpcPost(conn, USER_STATUS_PATH, REQUEST_METADATA);
    } catch (err) {
      if (conn.source !== 'env') {
        cachedConn = null;
        conn = await resolveConnection(true);
        statusRes = await rpcPost(conn, USER_STATUS_PATH, REQUEST_METADATA);
      } else {
        throw err;
      }
    }

    if (statusRes.statusCode === 401 || statusRes.statusCode === 403) {
      throw new Error(`Language Server authentication failed (HTTP ${statusRes.statusCode}).`);
    }
    if (statusRes.statusCode !== 200 || !statusRes.json?.userStatus) {
      throw new Error(`GetUserStatus failed (HTTP ${statusRes.statusCode}).`);
    }

    saveLastLsConn(conn);

    let summaryJson = null;
    try {
      const summaryRes = await rpcPost(conn, QUOTA_SUMMARY_PATH, REQUEST_METADATA);
      if (summaryRes.statusCode === 200 && summaryRes.json?.response) {
        summaryJson = summaryRes.json;
      }
    } catch {
      // Optional RPC on older servers
    }

    const snapshot = parseSnapshot(statusRes.json, summaryJson, conn);
    cachedSnapshot = snapshot;
    cachedSnapshotAt = Date.now();
    return snapshot;
  } catch (err) {
    lsError = err;
  }

  try {
    const snapshot = await fetchViaOAuthToken(effectiveOptions);
    cachedSnapshot = snapshot;
    cachedSnapshotAt = Date.now();
    return snapshot;
  } catch (oauthErr) {
    const lsMsg = lsError instanceof Error ? lsError.message : String(lsError);
    const oauthMsg = oauthErr instanceof Error ? oauthErr.message : String(oauthErr);
    throw new Error(`${lsMsg} (OAuth fallback failed: ${oauthMsg})`);
  }
}

// ---------------------------------------------------------------------------
// Static Asset Helpers & Modes (--dump / --standalone / SidecarApp)
// ---------------------------------------------------------------------------

function readAsset(filename) {
  return readFileSync(join(__dirname, filename), 'utf8');
}

const STANDALONE_PRELOAD_JS = `(function () {
  if (window.sidecar) return;
  const params = new URLSearchParams(window.location.search);
  window.sidecar = {
    conversationId: params.get('conversationId') || '',
    fetch: (url, options = {}) => fetch(url, options),
    getWorkspaceUris: async () => [],
    onWorkspaceChange: () => () => {},
    ui: { toggleAuxPane() {}, toggleConversation() {} }
  };
})();`;

async function importSidecarSdk() {
  const candidates = [
    'sidecar_sdk',
    pathToFileURL(join(homedir(), '.gemini', 'config', 'node_modules', 'sidecar_sdk', 'index.mjs')).href,
    pathToFileURL(join(homedir(), '.gemini', 'antigravity', 'lib', 'node_modules', 'sidecar_sdk', 'index.mjs')).href,
  ];
  let lastErr = null;
  for (const spec of candidates) {
    try {
      return await import(spec);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

async function runDumpMode() {
  const snap = await fetchQuotaSnapshot(true);
  console.log(JSON.stringify(snap, null, 2));
}

function maskEmailAddress(email) {
  if (!email || !email.includes('@')) return email || '-';
  const [local, domain] = email.split('@');
  if (local.length <= 2) return `${local[0] || ''}***@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}

function renderProgressBar(pct, width = 20) {
  const safe = Number.isFinite(pct) ? clamp(pct, 0, 100) : 0;
  const filled = Math.round((safe / 100) * width);
  return `${'█'.repeat(filled)}${'░'.repeat(Math.max(0, width - filled))}`;
}

function createAnsiHelpers(enabled) {
  const wrap = (code) => (text) => (enabled ? `\x1b[${code}m${text}\x1b[0m` : String(text));
  return {
    bold: wrap('1'),
    dim: wrap('2'),
    cyan: wrap('36'),
    green: wrap('32'),
    yellow: wrap('33'),
    red: wrap('31'),
    byPct(pct, text) {
      const safe = Number(pct);
      if (!Number.isFinite(safe)) return wrap('2')(text);
      if (safe >= 60) return wrap('32')(text);
      if (safe >= 20) return wrap('33')(text);
      return wrap('31')(text);
    },
  };
}

function formatPctLabel(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '  N/A ';
  const rounded = Number.isInteger(num) ? String(num) : num.toFixed(1).replace(/\.0$/, '');
  return `${rounded}%`.padStart(6);
}

const CLI_HELP_TEXT = `AGY Quota Sidecar & CLI

Usage:
  node main.mjs --cli [options]       Render colored quota dashboard in terminal
  node main.mjs --dump                Print full quota snapshot as JSON
  node main.mjs --json                Alias for --dump
  node main.mjs --standalone [--host <addr>] [--port <n>]
                                      Start standalone local Web UI server
  node main.mjs --help, -h            Show this help message

CLI Options:
  --models, -m          Include per-model quota breakdown and disabled models
  --mask                Mask account email (e.g. bi***@gmail.com)
  --no-color            Disable ANSI terminal colors (also honors NO_COLOR)
  --oauth               Force Cloud Code OAuth API fallback (~/.gemini/antigravity-cli)
  --profile-dir <dir>   Target profile home containing .gemini/antigravity-cli
  --host <addr>         Bind address for --standalone (default: 127.0.0.1)`;

async function runCliMode(args) {
  const useColor = !args.includes('--no-color') && !process.env.NO_COLOR;
  const maskEmail = args.includes('--mask');
  const showModels = args.includes('--models') || args.includes('-m');
  const c = createAnsiHelpers(useColor);

  const snap = await fetchQuotaSnapshot(true);
  const { userInfo, connection, pools, summaryGroups, credits, models, disabledModels } = snap;
  const displayEmail = maskEmail ? maskEmailAddress(userInfo?.email) : (userInfo?.email || '-');
  const tierLabel = userInfo?.tier || userInfo?.planName || 'Unknown';
  const connLabel = connection?.source === 'oauth-token'
    ? `Cloud Code: ${connection?.host || '-'}`
    : `LS: ${connection?.host || '-'}:${connection?.port || '-'}`;

  const lines = [];
  lines.push(`${c.bold(c.cyan('AGY Quota'))} ${c.dim(`· ${new Date(snap.timestamp).toLocaleString()}`)}`);
  lines.push(
    `${c.dim('Account:')} ${c.bold(displayEmail)} ${c.dim(`(${tierLabel})`)}  ` +
    `${connLabel} ${c.dim(`[${connection?.source || '-'}]`)}`,
  );
  lines.push('');

  lines.push(c.bold(c.cyan('Quota Pools')));
  const visiblePools = (pools || []).filter((p) => p.hasData);
  if (visiblePools.length === 0) {
    lines.push(c.dim('  No pool quota data reported.'));
  } else {
    for (const pool of visiblePools) {
      const label = String(pool.label || pool.id).padEnd(14);
      const bar = c.byPct(pool.remaining, renderProgressBar(pool.remaining));
      const pct = c.byPct(pool.remaining, formatPctLabel(pool.remaining));
      const resetPart = `reset ${pool.resetTime || '-'}`;
      const weeklyPart = pool.weekly
        ? ` | weekly ${pool.weekly.remaining}% (${pool.weekly.resetTime || '-'})`
        : '';
      const predPart = pool.prediction?.usageRate > 0
        ? ` | ${pool.prediction.usageRate}%/h (${pool.prediction.runway})`
        : '';
      lines.push(`  ${label} [${bar}] ${pct}  ${c.dim(`${resetPart}${weeklyPart}${predPart}`)}`);
    }
  }
  lines.push('');

  if (Array.isArray(summaryGroups) && summaryGroups.length > 0) {
    lines.push(c.bold(c.cyan('Quota Windows (Summary)')));
    for (const group of summaryGroups) {
      lines.push(`  ${c.bold(group.displayName || 'Group')}`);
      for (const bucket of group.buckets || []) {
        const winLabel = String(bucket.window || bucket.bucketId || '-').padEnd(12);
        const bar = c.byPct(bucket.remainingPercentage, renderProgressBar(bucket.remainingPercentage));
        const pct = c.byPct(bucket.remainingPercentage, formatPctLabel(bucket.remainingPercentage));
        lines.push(`    ${winLabel} [${bar}] ${pct}  ${c.dim(`reset ${bucket.timeUntilReset || '-'}`)}`);
      }
    }
    lines.push('');
  }

  const hasPrompt = Boolean(credits?.prompt);
  const hasFlow = Boolean(credits?.flow);
  const hasUserCredits = Array.isArray(credits?.userCredits) && credits.userCredits.length > 0;
  if (hasPrompt || hasFlow || hasUserCredits) {
    lines.push(c.bold(c.cyan('Credits')));
    if (hasPrompt) {
      const p = credits.prompt;
      lines.push(
        `  ${'Prompt'.padEnd(14)} [${c.byPct(p.remainingPercentage, renderProgressBar(p.remainingPercentage))}] ` +
        `${c.byPct(p.remainingPercentage, formatPctLabel(p.remainingPercentage))}  ` +
        `${c.dim(`${p.available} / ${p.monthly}`)}`,
      );
    }
    if (hasFlow) {
      const f = credits.flow;
      lines.push(
        `  ${'Flow'.padEnd(14)} [${c.byPct(f.remainingPercentage, renderProgressBar(f.remainingPercentage))}] ` +
        `${c.byPct(f.remainingPercentage, formatPctLabel(f.remainingPercentage))}  ` +
        `${c.dim(`${f.available} / ${f.monthly}`)}`,
      );
    }
    if (hasUserCredits) {
      for (const uc of credits.userCredits) {
        const val = uc.creditAmount != null
          ? `${uc.creditAmount}`
          : (uc.minimumCreditAmountForUsage != null ? `min ${uc.minimumCreditAmountForUsage}` : '-');
        lines.push(`  ${String(uc.creditType || 'Credit').padEnd(14)} ${c.dim(val)}`);
      }
    }
    lines.push('');
  }

  if (showModels) {
    lines.push(c.bold(c.cyan(`Models (${models?.length || 0})`)));
    if ((models?.length || 0) === 0 && connection?.source === 'oauth-token') {
      lines.push(c.dim('  Per-model quotas are only exposed by a live Language Server (OAuth mode shows pools & summary windows).'));
    } else {
      for (const model of models || []) {
        const name = String(model.label || model.modelId).slice(0, 28).padEnd(29);
        const bar = c.byPct(model.remainingPercentage, renderProgressBar(model.remainingPercentage));
        const pct = c.byPct(model.remainingPercentage, formatPctLabel(model.remainingPercentage));
        const suffix = model.isExhausted ? 'EXHAUSTED' : `reset ${model.timeUntilReset || '-'}`;
        lines.push(`  ${name} [${bar}] ${pct}  ${c.dim(`${model.groupLabel || ''} · ${suffix}`)}`);
      }
      if (Array.isArray(disabledModels) && disabledModels.length > 0) {
        lines.push('');
        lines.push(c.dim(`Disabled Models (${disabledModels.length}): ${disabledModels.map((m) => m.label).join(', ')}`));
      }
    }
  } else if (connection?.source !== 'oauth-token') {
    lines.push(c.dim('Tip: pass --models (-m) to view per-model quota breakdown.'));
  }

  console.log(lines.join('\n'));
}

async function runStandaloneServer(port = 0, host = '127.0.0.1') {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${host === '0.0.0.0' ? '127.0.0.1' : host}`);
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(readAsset('index.html'));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/styles.css') {
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
      res.end(readAsset('styles.css'));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/app.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      res.end(readAsset('app.js'));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/preload.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      res.end(STANDALONE_PRELOAD_JS);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/quota') {
      try {
        const force = url.searchParams.get('force') === '1';
        const data = await fetchQuotaSnapshot(force);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(data));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
      }
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });

  server.listen(port, host, () => {
    const addr = server.address();
    console.log(`[quota_panel] standalone server listening on http://${host}:${addr.port}`);
  });
}

async function runSidecarMode() {
  const { SidecarApp, Response } = await importSidecarSdk();
  const app = new SidecarApp();

  app.page('/', () => readAsset('index.html'));
  app.api('/styles.css', () => new Response(readAsset('styles.css'), { contentType: 'text/css; charset=utf-8' }), 'GET');
  app.api('/app.js', () => new Response(readAsset('app.js'), { contentType: 'application/javascript; charset=utf-8' }), 'GET');
  app.api('/api/quota', async (data) => {
    try {
      const force = data?.force === '1' || data?.force === true;
      return await fetchQuotaSnapshot(force);
    } catch (err) {
      return new Response(
        JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
        { contentType: 'application/json; charset=utf-8', status: 500 },
      );
    }
  }, 'GET');

  await app.run();
}

function getFlagValue(argv, flag) {
  const prefix = `${flag}=`;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === flag && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      return argv[i + 1];
    }
    if (argv[i].startsWith(prefix)) {
      return argv[i].slice(prefix.length);
    }
  }
  return null;
}

const args = process.argv.slice(2);
var runtimeOptions = {
  forceOAuth: args.includes('--oauth'),
  profileDir: getFlagValue(args, '--profile-dir'),
};

if (args.includes('--help') || args.includes('-h')) {
  console.log(CLI_HELP_TEXT);
} else if (args.includes('--dump') || args.includes('--json')) {
  runDumpMode().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }, null, 2));
    process.exitCode = 1;
  });
} else if (args.includes('--cli')) {
  runCliMode(args).catch((err) => {
    console.error(`[agy-quota] ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
} else if (args.includes('--standalone') || !process.env.ANTIGRAVITY_SIDECAR_WEB_PORT) {
  const requestedPort = Number(getFlagValue(args, '--port')) || Number(process.env.PORT) || 0;
  const requestedHost = getFlagValue(args, '--host') || process.env.HOST || '127.0.0.1';
  runStandaloneServer(requestedPort, requestedHost).catch((err) => {
    console.error('[quota_panel] fatal:', err);
    process.exitCode = 1;
  });
} else {
  runSidecarMode().catch((err) => {
    console.error('[quota_panel] fatal:', err);
    process.exitCode = 1;
  });
}
