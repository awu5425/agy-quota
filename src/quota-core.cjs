'use strict';

const { exec, execFileSync } = require('node:child_process');
const { createHash, randomBytes } = require('node:crypto');
const {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { homedir, platform, tmpdir } = require('node:os');
const { delimiter, dirname, extname, join, resolve } = require('node:path');
const tls = require('node:tls');
const { fileURLToPath } = require('node:url');
const vm = require('node:vm');

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
const PROBE_TIMEOUT_MS = 2_000;
const BUNDLE_CACHE_TTL_MS = 15_000;
const HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const HISTORY_RAW_MS = 24 * 60 * 60 * 1000;
const HISTORY_DOWNSAMPLE_MS = 5 * 60 * 1000;
const HISTORY_MIN_RECORD_INTERVAL_MS = 60 * 1000;
const RESET_THRESHOLD_PP = 0.1;
const CHART_WINDOW_MINUTES = 90;
const CHART_MAX_BUCKETS = 18;

const QUOTA_POOLS = Object.freeze([
  Object.freeze({
    id: 'gemini',
    label: 'Gemini',
    shortLabel: 'Gemini',
    themeColor: '#40C4FF',
    fiveHourBucketIds: Object.freeze(['gemini-5h']),
    weeklyBucketIds: Object.freeze(['gemini-weekly']),
  }),
  Object.freeze({
    id: 'argon',
    label: 'Argon',
    shortLabel: 'Argon',
    themeColor: '#B388FF',
    fiveHourBucketIds: Object.freeze(['gemini-argon-5h', 'argon-5h']),
    weeklyBucketIds: Object.freeze(['gemini-argon-wtu-weekly', 'argon-weekly']),
  }),
  Object.freeze({
    id: 'non-google',
    label: 'Claude / GPT',
    shortLabel: 'Claude',
    themeColor: '#FFAB40',
    fiveHourBucketIds: Object.freeze(['3p-5h']),
    weeklyBucketIds: Object.freeze(['3p-weekly']),
  }),
]);

const MODEL_GROUPS = Object.freeze([
  Object.freeze({ id: 'gemini-argon', poolId: 'argon', label: 'Gemini Argon', color: '#B388FF' }),
  Object.freeze({ id: 'gemini-flash', poolId: 'gemini', label: 'Gemini Flash', color: '#40C4FF' }),
  Object.freeze({ id: 'gemini-pro', poolId: 'gemini', label: 'Gemini Hydrogen / Pro', color: '#69F0AE' }),
  Object.freeze({ id: 'claude', poolId: 'non-google', label: 'Claude', color: '#FFAB40' }),
  Object.freeze({ id: 'gpt', poolId: 'non-google', label: 'GPT', color: '#FF5252' }),
  Object.freeze({ id: 'other', poolId: 'non-google', label: 'Other', color: '#FFAB40' }),
]);

const KNOWN_MODEL_MAP = Object.freeze({
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
});

const EFFORT_SUFFIX_RE = /\s*\((?:low|medium|med|high|xhigh|x-high|extra\s+high|minimal|min|thinking|non-thinking|standard|max)\)\s*$/i;

function groupById(id) {
  return MODEL_GROUPS.find((g) => g.id === id) || MODEL_GROUPS[MODEL_GROUPS.length - 1];
}

function classifyModel(modelId = '', label = '') {
  const exact = KNOWN_MODEL_MAP[String(modelId).trim()];
  if (exact) return groupById(exact);

  const hay = `${modelId} ${label}`.toLowerCase();
  if (hay.includes('argon')) return groupById('gemini-argon');
  if (hay.includes('flash')) return groupById('gemini-flash');
  if (hay.includes('hydrogen') || hay.includes('carbon') || hay.includes('gemini')) {
    return groupById('gemini-pro');
  }
  if (hay.includes('claude')) return groupById('claude');
  if (hay.includes('gpt') || hay.includes('openai')) return groupById('gpt');
  return groupById('other');
}

function normalizeModelLabel(label = '') {
  let out = String(label || '').trim();
  while (EFFORT_SUFFIX_RE.test(out)) {
    out = out.replace(EFFORT_SUFFIX_RE, '').trim();
  }
  return out || String(label || '').trim();
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

function formatTimeUntilReset(ms) {
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

function hashAccountKey(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return '';
  return createHash('sha256').update(normalized).digest('hex').slice(0, 10);
}

function cleanTierLabel(value) {
  if (!value || typeof value !== 'string') return '';
  return value
    .replace(/子档未知/g, '')
    .replace(/\b(?:sub-?tier\s+)?unknown\b/gi, '')
    .replace(/^[·|/\-–—\s]+|[·|/\-–—\s]+$/g, '')
    .trim();
}

function isRawEnumOrSlug(value) {
  if (!value) return false;
  return /^[A-Z0-9_]+$/.test(value) || (/^[a-z0-9_.-]+$/i.test(value) && /[_-]/.test(value));
}

function detectTierFamily(text) {
  const lower = String(text || '').toLowerCase();
  if (!lower) return '';
  if (lower.includes('ultra') || lower.includes('helium')) return 'Ultra';
  if (lower.includes('enterprise')) return 'Enterprise';
  if (lower.includes('team') && !lower.includes('teams_tier_')) return 'Teams';
  if (lower.includes('pro') || lower.includes('premium') || lower.includes('advanced')) return 'Pro';
  if (lower.includes('free') || lower.includes('starter') || lower.includes('basic')) return 'Free';
  return '';
}

function normalizeTierAndPlan(userTier = {}, planInfo = {}) {
  const rawTierName = cleanTierLabel(userTier?.name || '');
  const rawTierId = String(userTier?.id || '').trim();
  const rawTierDesc = cleanTierLabel(userTier?.description || '');
  const rawPlanName = cleanTierLabel(planInfo?.planName || '');
  const rawTeamsTier = cleanTierLabel(planInfo?.teamsTier || '');

  // Prefer userTier signals over legacy Exa planInfo (which often marks Ultra accounts as "Pro" / "TEAMS_TIER_PRO")
  const primaryFamily = detectTierFamily(`${rawTierName} ${rawTierId} ${rawTierDesc}`);
  const fallbackFamily = detectTierFamily(`${rawPlanName} ${rawTeamsTier}`);
  const family = primaryFamily || fallbackFamily;

  let tier = !isRawEnumOrSlug(rawTierName) ? rawTierName : '';
  if (!tier) {
    if (family) {
      tier = `Google AI ${family}`;
    } else if (rawPlanName && !isRawEnumOrSlug(rawPlanName)) {
      tier = /^google\b/i.test(rawPlanName) ? rawPlanName : `Google AI ${rawPlanName}`;
    } else if (rawTeamsTier && !isRawEnumOrSlug(rawTeamsTier)) {
      tier = rawTeamsTier;
    } else {
      tier = 'Google AI';
    }
  }

  let planName = '';
  if (primaryFamily) {
    planName = primaryFamily;
  } else if (rawPlanName && !isRawEnumOrSlug(rawPlanName)) {
    planName = rawPlanName;
  } else if (fallbackFamily) {
    planName = fallbackFamily;
  } else {
    planName = detectTierFamily(tier) || tier;
  }

  return { tier, planName };
}

// ---------------------------------------------------------------------------
// Unified Shared Data Directory & Legacy Cache Migration
// ---------------------------------------------------------------------------

let initializedSharedDir = null;

function isValidHistoryPoint(pt) {
  return Boolean(
    pt
    && typeof pt === 'object'
    && typeof pt.ts === 'number'
    && Number.isFinite(pt.ts)
    && pt.pools
    && typeof pt.pools === 'object',
  );
}

function mergeHistoryPointArrays(arrays, now = Date.now()) {
  const cutoff = now - HISTORY_RETENTION_MS;
  const byTs = new Map();

  for (const list of arrays) {
    if (!Array.isArray(list)) continue;
    for (const pt of list) {
      if (!isValidHistoryPoint(pt) || pt.ts < cutoff) continue;
      const existing = byTs.get(pt.ts);
      if (!existing) {
        const cleanPools = {};
        for (const [k, v] of Object.entries(pt.pools)) {
          if (typeof v === 'number' && Number.isFinite(v)) cleanPools[k] = v;
        }
        const entry = {
          ts: pt.ts,
          pools: cleanPools,
          resets: Array.isArray(pt.resets) ? Array.from(new Set(pt.resets.map(String))) : [],
        };
        if (typeof pt.acct === 'string' && pt.acct) entry.acct = pt.acct;
        if (typeof pt.activeModel === 'string' && pt.activeModel) entry.activeModel = pt.activeModel;
        byTs.set(pt.ts, entry);
      } else {
        for (const [k, v] of Object.entries(pt.pools)) {
          if (typeof v === 'number' && Number.isFinite(v)) existing.pools[k] = v;
        }
        if (Array.isArray(pt.resets) && pt.resets.length > 0) {
          existing.resets = Array.from(new Set([...(existing.resets || []), ...pt.resets.map(String)]));
        }
        if (!existing.acct && typeof pt.acct === 'string' && pt.acct) {
          existing.acct = pt.acct;
        }
        if (!existing.activeModel && typeof pt.activeModel === 'string' && pt.activeModel) {
          existing.activeModel = pt.activeModel;
        }
      }
    }
  }

  const sorted = Array.from(byTs.values()).sort((a, b) => a.ts - b.ts);
  return pruneHistory(sorted, now);
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

function readJsonSafe(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeSecureJson(filePath, data, pretty = false) {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    const text = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
    writeFileSync(filePath, text, { encoding: 'utf8', mode: 0o600 });
    try {
      chmodSync(filePath, 0o600);
    } catch {
      // Ignore chmod error on Windows filesystems
    }
  } catch {
    // Non-fatal if filesystem is read-only
  }
}

function resolveSharedDataDir() {
  const targetDir = process.env.AGY_QUOTA_SHARED_DIR
    ? resolve(process.env.AGY_QUOTA_SHARED_DIR)
    : join(homedir(), '.gemini', 'antigravity', 'agy-quota');

  if (initializedSharedDir === targetDir) {
    return targetDir;
  }

  try {
    mkdirSync(targetDir, { recursive: true });
  } catch {
    // Ignore mkdir error if read-only
  }

  const markerPath = join(targetDir, '.migrated_v1.json');
  if (!existsSync(markerPath)) {
    const legacyBase = join(homedir(), '.gemini', 'antigravity', 'sidecar_data', 'agy-quota', 'quota_panel');
    const legacyDirs = [legacyBase, join(legacyBase, 'data')];

    const targetHistoryPath = join(targetDir, 'quota_history.json');
    const historyArrays = [];
    const existingHistory = readJsonSafe(targetHistoryPath);
    if (Array.isArray(existingHistory)) historyArrays.push(existingHistory);

    const migratedFrom = [];
    for (const dir of legacyDirs) {
      const legacyHistPath = join(dir, 'quota_history.json');
      const legacyHist = readJsonSafe(legacyHistPath);
      if (Array.isArray(legacyHist) && legacyHist.length > 0) {
        historyArrays.push(legacyHist);
        migratedFrom.push(legacyHistPath);
      }
    }

    if (historyArrays.length > 0) {
      const mergedHistory = mergeHistoryPointArrays(historyArrays, Date.now());
      if (mergedHistory.length > 0) {
        try {
          writeFileSync(targetHistoryPath, JSON.stringify(mergedHistory), 'utf8');
        } catch {
          // Non-fatal
        }
      }
    }

    const targetConnPath = join(targetDir, 'last_ls_conn.json');
    const connCandidates = [];
    const existingConn = readJsonSafe(targetConnPath);
    if (existingConn?.host && existingConn?.port && existingConn?.csrfToken) {
      connCandidates.push(existingConn);
    }
    for (const dir of legacyDirs) {
      const legacyConn = readJsonSafe(join(dir, 'last_ls_conn.json'));
      if (legacyConn?.host && legacyConn?.port && legacyConn?.csrfToken) {
        connCandidates.push(legacyConn);
      }
    }
    if (connCandidates.length > 0) {
      connCandidates.sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
      const best = connCandidates[0];
      writeSecureJson(
        targetConnPath,
        {
          protocol: best.protocol || null,
          host: String(best.host),
          port: Number(best.port),
          csrfToken: String(best.csrfToken),
          updatedAt: Number(best.updatedAt) || Date.now(),
        },
        true,
      );
    }

    writeSecureJson(
      markerPath,
      {
        version: 1,
        migratedAt: Date.now(),
        migratedSourcesCount: migratedFrom.length,
      },
      true,
    );
  }

  initializedSharedDir = targetDir;
  return targetDir;
}

function getHistoryPath() {
  return join(resolveSharedDataDir(), 'quota_history.json');
}

function getLsConnCachePath() {
  return join(resolveSharedDataDir(), 'last_ls_conn.json');
}

// ---------------------------------------------------------------------------
// Language Server Connection & 5-Tier Discovery (L0 -> L4)
// ---------------------------------------------------------------------------

const protocolCache = new Map();
let cachedConn = null;

function loadLastLsConn() {
  const raw = readJsonSafe(getLsConnCachePath());
  if (!raw?.host || !raw?.port || !raw?.csrfToken) return null;
  const port = Number(raw.port);
  if (!Number.isFinite(port) || port <= 0) return null;
  return {
    protocol: raw.protocol || null,
    host: String(raw.host),
    port,
    csrfToken: String(raw.csrfToken),
  };
}

function saveLastLsConn(conn) {
  if (!conn?.host || !conn?.port || !conn?.csrfToken) return;
  const key = `${conn.host}:${conn.port}`;
  writeSecureJson(
    getLsConnCachePath(),
    {
      protocol: conn.protocol || protocolCache.get(key) || null,
      host: String(conn.host),
      port: Number(conn.port),
      csrfToken: String(conn.csrfToken),
      updatedAt: Date.now(),
    },
    true,
  );
}

function parseAddress(rawAddress) {
  if (!rawAddress) return null;
  const trimmed = String(rawAddress).trim();
  if (!trimmed || trimmed === 'null') return null;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    if (!/^https?:\/\//i.test(trimmed)) return null;
    try {
      const url = new URL(trimmed);
      const port = Number(url.port) || (url.protocol === 'https:' ? 443 : 80);
      if (!url.hostname || !Number.isFinite(port) || port <= 0) return null;
      return {
        protocol: url.protocol.replace(':', '').toLowerCase(),
        host: url.hostname,
        port,
      };
    } catch {
      return null;
    }
  }

  const lastColon = trimmed.lastIndexOf(':');
  if (lastColon <= 0) return null;
  const host = trimmed.slice(0, lastColon).replace(/^\[|\]$/g, '');
  const port = Number(trimmed.slice(lastColon + 1));
  if (!host || !Number.isFinite(port) || port <= 0 || port >= 65536) return null;
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
          resolvePromise({ statusCode: res.statusCode || 0, json, raw, protocol });
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

async function rpcPost(conn, path, body, timeoutMs = HTTP_TIMEOUT_MS) {
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
        timeoutMs,
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
  return new Promise((resolvePromise) => {
    exec(
      cmd,
      { timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        resolvePromise({ error, stdout: stdout || '', stderr: stderr || '' });
      },
    );
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
    'powershell.exe -NoProfile -NonInteractive -Command',
    '"Get-CimInstance Win32_Process -Filter \\"name like \'language_server%\' or name = \'agy.exe\'\\"',
    '| Select-Object ProcessId,CommandLine | ConvertTo-Json -Depth 2"',
  ].join(' ');
  const procRes = await runShell(psCmd);
  if (!procRes.stdout.trim()) return [];

  let rows = [];
  try {
    const parsed = JSON.parse(procRes.stdout);
    rows = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
  } catch {
    return [];
  }

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
      for (const m of line.matchAll(/(?:127\.0\.0\.1|0\.0\.0\.0|\[?::1?\]?):(\d{2,5})/g)) {
        const p = Number(m[1]);
        if (p > 0 && p < 65536 && p !== extPort && !ports.includes(p)) ports.push(p);
      }
    }
    candidates.push({ pid, host: '127.0.0.1', csrfToken, ports, source: 'process-discovery' });
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

    const portCmd = platform() === 'darwin'
      ? `lsof -nP -a -p ${pid} -iTCP -sTCP:LISTEN`
      : 'ss -tlnp';
    const netRes = await runShell(portCmd);
    for (const netLine of netRes.stdout.split(/\r?\n/)) {
      if (platform() !== 'darwin' && !new RegExp(`pid=${pid}[,)]|\\s${pid}/`).test(netLine)) continue;
      for (const pm of netLine.matchAll(/(?:127\.0\.0\.1|0\.0\.0\.0|\[?::1?\]?):(\d{2,5})/g)) {
        const p = Number(pm[1]);
        if (p > 0 && p < 65536 && p !== extPort && !ports.includes(p)) ports.push(p);
      }
    }
    candidates.push({ pid, host: '127.0.0.1', csrfToken, ports, source: 'process-discovery' });
  }
  return candidates;
}

async function tryFetchViaCandidate(cand, timeoutMs = PROBE_TIMEOUT_MS) {
  if (!cand?.host || !cand?.port || !cand?.csrfToken) return null;
  try {
    const statusRes = await rpcPost(cand, USER_STATUS_PATH, REQUEST_METADATA, timeoutMs);
    if (statusRes.statusCode !== 200 || !statusRes.json?.userStatus) {
      return null;
    }

    const activeConn = {
      protocol: statusRes.protocol || cand.protocol || null,
      host: cand.host,
      port: Number(cand.port),
      csrfToken: String(cand.csrfToken),
      source: cand.source || 'ls-cache',
      ...(cand.pid ? { pid: cand.pid } : {}),
    };

    cachedConn = activeConn;
    saveLastLsConn(activeConn);

    let quotaSummaryRes = null;
    try {
      const summaryRes = await rpcPost(activeConn, QUOTA_SUMMARY_PATH, REQUEST_METADATA, HTTP_TIMEOUT_MS);
      if (summaryRes.statusCode === 200 && (summaryRes.json?.response || summaryRes.json?.groups)) {
        quotaSummaryRes = summaryRes.json;
      }
    } catch {
      // Optional RPC on older Language Servers
    }

    return {
      conn: activeConn,
      userStatusRes: statusRes.json,
      quotaSummaryRes,
    };
  } catch {
    return null;
  }
}

async function fetchViaLanguageServer(opts = {}) {
  const pageOrigin = opts.origin ? parseAddress(opts.origin) : null;
  const pageCsrf = opts.csrfToken ? String(opts.csrfToken).trim() : '';

  // L0: Direct same-origin page connection (origin + csrfToken)
  if (pageOrigin && pageCsrf) {
    const l0 = await tryFetchViaCandidate(
      {
        protocol: pageOrigin.protocol,
        host: pageOrigin.host,
        port: pageOrigin.port,
        csrfToken: pageCsrf,
        source: 'page-origin',
      },
      PROBE_TIMEOUT_MS,
    );
    if (l0) return l0;
  }

  // L1: Host environment variables (ANTIGRAVITY_LS_ADDRESS + ANTIGRAVITY_CSRF_TOKEN)
  if (process.env.ANTIGRAVITY_LS_ADDRESS && process.env.ANTIGRAVITY_CSRF_TOKEN) {
    const envParsed = parseAddress(process.env.ANTIGRAVITY_LS_ADDRESS);
    if (envParsed) {
      const l1 = await tryFetchViaCandidate(
        {
          protocol: envParsed.protocol,
          host: envParsed.host,
          port: envParsed.port,
          csrfToken: process.env.ANTIGRAVITY_CSRF_TOKEN,
          source: 'env',
        },
        HTTP_TIMEOUT_MS,
      );
      if (l1) return l1;
    }
  }

  // L2: In-memory active connection & persisted last_ls_conn.json cache
  if (cachedConn) {
    const memHit = await tryFetchViaCandidate({ ...cachedConn, source: 'ls-cache' }, PROBE_TIMEOUT_MS);
    if (memHit) return memHit;
    cachedConn = null;
  }

  const diskConn = loadLastLsConn();
  if (diskConn) {
    const diskHit = await tryFetchViaCandidate({ ...diskConn, source: 'ls-cache' }, PROBE_TIMEOUT_MS);
    if (diskHit) return diskHit;

    if (pageCsrf && pageCsrf !== diskConn.csrfToken) {
      const diskWithPageCsrf = await tryFetchViaCandidate(
        { ...diskConn, csrfToken: pageCsrf, source: 'ls-cache' },
        PROBE_TIMEOUT_MS,
      );
      if (diskWithPageCsrf) return diskWithPageCsrf;
    }
  }

  // L3: Cross-platform process / /proc discovery
  const candidates = platform() === 'win32'
    ? await discoverWindowsCandidates()
    : await discoverUnixCandidates();

  for (const cand of candidates) {
    for (const port of cand.ports || []) {
      const hit = await tryFetchViaCandidate(
        {
          protocol: cand.protocol || null,
          host: cand.host || '127.0.0.1',
          port,
          csrfToken: cand.csrfToken,
          source: cand.source || 'process-discovery',
          pid: cand.pid,
        },
        PROBE_TIMEOUT_MS,
      );
      if (hit) return hit;
    }
  }

  throw new Error('Could not find a running Antigravity Language Server with --csrf_token.');
}

// ---------------------------------------------------------------------------
// Quota History Persistence & Consumption Analytics
// ---------------------------------------------------------------------------

let historyPoints = null;
let lastHistoryMtimeMs = 0;

function syncHistoryFromDisk(now) {
  const histPath = getHistoryPath();
  let diskMtime = 0;
  try {
    if (existsSync(histPath)) {
      diskMtime = statSync(histPath).mtimeMs || 0;
    }
  } catch {
    diskMtime = 0;
  }

  if (historyPoints === null || (diskMtime > 0 && diskMtime !== lastHistoryMtimeMs)) {
    const parsed = readJsonSafe(histPath);
    const diskList = Array.isArray(parsed) ? parsed : [];
    historyPoints = mergeHistoryPointArrays(
      historyPoints ? [historyPoints, diskList] : [diskList],
      now,
    );
    lastHistoryMtimeMs = diskMtime;
  }
}

function saveHistory(points) {
  const histPath = getHistoryPath();
  try {
    mkdirSync(dirname(histPath), { recursive: true });
    writeFileSync(histPath, JSON.stringify(points), 'utf8');
    try {
      lastHistoryMtimeMs = statSync(histPath).mtimeMs || Date.now();
    } catch {
      lastHistoryMtimeMs = Date.now();
    }
  } catch {
    // Non-fatal if storage directory is read-only
  }
}

function filterAccountHistory(points, accountKey, activeHasArgon) {
  if (!Array.isArray(points) || points.length === 0) return [];
  return points.filter((pt) => {
    if (pt.acct && accountKey) {
      return pt.acct === accountKey;
    }
    if (!pt.acct && activeHasArgon && pt.pools && pt.pools.argon === undefined && pt.pools.gemini === 100) {
      return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Per-Model Call Series Collector & Unified Base Family Attribution
// ---------------------------------------------------------------------------

const MODEL_CALL_RETENTION_MS = 95 * 60 * 1000;
const MODEL_CALL_CACHE_HORIZON_MS = 24 * 60 * 60 * 1000;
const MODEL_LOOKBACK_MS = 90 * 1000;
const TRANSCRIPT_TAIL_BYTES = 196_608;

const TREND_MODEL_PALETTE = Object.freeze({
  carbon: Object.freeze({ modelId: 'carbon', defaultLabel: 'Carbon', color: '#38BDF8', order: 1 }),
  argon: Object.freeze({ modelId: 'argon', defaultLabel: 'Argon', color: '#A78BFA', order: 2 }),
  hydrogen: Object.freeze({ modelId: 'hydrogen', defaultLabel: 'Hydrogen', color: '#34D399', order: 3 }),
  flash: Object.freeze({ modelId: 'flash', defaultLabel: 'Flash', color: '#2DD4BF', order: 4 }),
  'claude-opus': Object.freeze({ modelId: 'claude-opus', defaultLabel: 'Opus', color: '#FB923C', order: 5 }),
  'claude-sonnet': Object.freeze({ modelId: 'claude-sonnet', defaultLabel: 'Sonnet', color: '#FBBF24', order: 6 }),
  'claude-haiku': Object.freeze({ modelId: 'claude-haiku', defaultLabel: 'Haiku', color: '#FDE047', order: 7 }),
  gpt: Object.freeze({ modelId: 'gpt', defaultLabel: 'GPT-OSS', color: '#F472B6', order: 8 }),
  'gemini-pro': Object.freeze({ modelId: 'gemini-pro', defaultLabel: 'Gemini', color: '#60A5FA', order: 9 }),
});

const KNOWN_TREND_EXACT_MAP = Object.freeze({
  MODEL_PLACEHOLDER_M427: 'carbon',
  MODEL_PLACEHOLDER_M437: 'carbon',
  MODEL_PLACEHOLDER_M667: 'carbon',
  MODEL_PLACEHOLDER_M417: 'argon',
  MODEL_PLACEHOLDER_M418: 'argon',
  MODEL_PLACEHOLDER_M419: 'argon',
  MODEL_PLACEHOLDER_M668: 'argon',
  MODEL_PLACEHOLDER_M681: 'argon',
  MODEL_PLACEHOLDER_M525: 'hydrogen',
  MODEL_PLACEHOLDER_M526: 'hydrogen',
  MODEL_PLACEHOLDER_M527: 'hydrogen',
  MODEL_PLACEHOLDER_M528: 'hydrogen',
  MODEL_PLACEHOLDER_M318: 'flash',
  MODEL_PLACEHOLDER_M319: 'flash',
  MODEL_PLACEHOLDER_M320: 'flash',
  MODEL_PLACEHOLDER_M47: 'flash',
  MODEL_PLACEHOLDER_M36: 'gemini-pro',
  MODEL_PLACEHOLDER_M37: 'gemini-pro',
  MODEL_PLACEHOLDER_M26: 'claude-opus',
  MODEL_PLACEHOLDER_M35: 'claude-sonnet',
  MODEL_PLACEHOLDER_M400: 'claude-sonnet',
  MODEL_PLACEHOLDER_M401: 'claude-sonnet',
  MODEL_PLACEHOLDER_M402: 'claude-sonnet',
  MODEL_PLACEHOLDER_M403: 'claude-sonnet',
  MODEL_PLACEHOLDER_M404: 'claude-sonnet',
  MODEL_PLACEHOLDER_M405: 'claude-sonnet',
  MODEL_OPENAI_GPT_OSS_120B_MEDIUM: 'gpt',
});

const SLUG_EFFORT_SUFFIX_RE = /(?:[-_\s]+|\s*\()(?:low|medium|med|high|xhigh|x-high|extra[-\s]+high|minimal|min|thinking|non-thinking|standard|max|orchestrator)\)?\s*$/i;

function stripModelEffortNoise(raw = '') {
  let out = normalizeModelLabel(String(raw || ''));
  while (SLUG_EFFORT_SUFFIX_RE.test(out)) {
    out = out.replace(SLUG_EFFORT_SUFFIX_RE, '').trim();
  }
  return out;
}

function detectTrendFamilyFromText(text = '') {
  const lower = String(text || '').toLowerCase();
  if (!lower) return '';
  if (lower.includes('carbon')) return 'carbon';
  if (lower.includes('argon')) return 'argon';
  if (lower.includes('hydrogen')) return 'hydrogen';
  if (lower.includes('flash')) return 'flash';
  if (lower.includes('opus')) return 'claude-opus';
  if (lower.includes('sonnet')) return 'claude-sonnet';
  if (lower.includes('haiku')) return 'claude-haiku';
  if (lower.includes('gpt') || lower.includes('openai') || /\bo[134](?:-[a-z0-9]+)?\b/.test(lower)) return 'gpt';
  if (lower.includes('claude')) return 'claude-sonnet';
  if (lower.includes('gemini')) return 'gemini-pro';
  return '';
}

function extractDynamicTrendLabel(familyId, rawModel = '', modelKey = '', preferredLabels = null) {
  if (familyId === 'carbon') return 'Carbon';
  if (familyId === 'argon') return 'Argon';
  if (familyId === 'hydrogen') return 'Hydrogen';

  const combined = `${stripModelEffortNoise(rawModel)} ${stripModelEffortNoise(modelKey)}`.trim();

  if (familyId === 'flash') {
    const m = combined.match(/(\d+(?:\.\d+)?)[-\s]*flash\b/i);
    if (m) return `${m[1]} Flash`;
    if (preferredLabels?.has('flash')) return preferredLabels.get('flash');
    return 'Flash';
  }

  if (familyId === 'claude-opus' || familyId === 'claude-sonnet' || familyId === 'claude-haiku') {
    const tierWord = familyId === 'claude-opus' ? 'Opus' : (familyId === 'claude-sonnet' ? 'Sonnet' : 'Haiku');
    const reAfter = new RegExp(`${tierWord}[-\\s]*(\\d+(?:[.-]\\d+)?)`, 'i');
    const reBefore = new RegExp(`(\\d+(?:[.-]\\d+)?)[-\\s]*${tierWord}`, 'i');
    const mAfter = combined.match(reAfter);
    if (mAfter) return `${tierWord} ${mAfter[1].replace(/-/g, '.')}`;
    const mBefore = combined.match(reBefore);
    if (mBefore) return `${tierWord} ${mBefore[1].replace(/-/g, '.')}`;
    if (preferredLabels?.has(familyId)) return preferredLabels.get(familyId);
    return tierWord;
  }

  if (familyId === 'gpt') {
    if (/gpt[-\s]*oss\b/i.test(combined)) return 'GPT-OSS';
    const gptVer = combined.match(/\bgpt[-\s]*([0-9]+(?:\.[0-9]+)?[a-z]*)\b/i);
    if (gptVer) return `GPT-${gptVer[1]}`;
    const oSeries = combined.match(/\b(o[134](?:-[a-z0-9]+)?)\b/i);
    if (oSeries) return oSeries[1];
    if (preferredLabels?.has('gpt')) return preferredLabels.get('gpt');
    return 'GPT-OSS';
  }

  if (preferredLabels?.has(familyId)) return preferredLabels.get(familyId);
  return TREND_MODEL_PALETTE[familyId]?.defaultLabel || 'Gemini';
}

function buildPreferredTrendLabels(models = []) {
  const map = new Map();
  for (const m of models || []) {
    const fam = classifyTrendModel(m.label || '', '', m.modelId || '', false, null);
    if (!fam) continue;
    if (!map.has(fam.modelId)) {
      const targetPool = fam.modelId.startsWith('claude') || fam.modelId === 'gpt' ? 'non-google' : 'gemini';
      const shortLbl = shortenModelFamily(m.label || '', targetPool);
      if (shortLbl) map.set(fam.modelId, shortLbl);
    }
  }
  return map;
}

function classifyTrendModel(
  rawModel = '',
  modelKey = '',
  modelExactId = '',
  hasIndependentArgonPool = false,
  preferredLabels = null,
) {
  const primaryText = `${stripModelEffortNoise(rawModel)} ${stripModelEffortNoise(modelKey)}`.trim();
  let familyId = detectTrendFamilyFromText(primaryText);

  if (!familyId && modelExactId) {
    const exactUpper = String(modelExactId).trim().toUpperCase();
    familyId = KNOWN_TREND_EXACT_MAP[exactUpper] || detectTrendFamilyFromText(modelExactId);
  }
  if (!familyId && rawModel) {
    const rawUpper = String(rawModel).trim().toUpperCase();
    familyId = KNOWN_TREND_EXACT_MAP[rawUpper] || '';
  }
  if (!familyId) return null;

  const palette = TREND_MODEL_PALETTE[familyId] || TREND_MODEL_PALETTE['gemini-pro'];
  let poolId = 'gemini';
  if (familyId === 'argon') {
    poolId = hasIndependentArgonPool ? 'argon' : 'gemini';
  } else if (
    familyId === 'claude-opus' ||
    familyId === 'claude-sonnet' ||
    familyId === 'claude-haiku' ||
    familyId === 'gpt'
  ) {
    poolId = 'non-google';
  }

  const label = extractDynamicTrendLabel(familyId, rawModel, modelKey, preferredLabels);
  return {
    modelId: palette.modelId,
    label,
    poolId,
    color: palette.color,
    order: palette.order,
  };
}

function computeCallWeight({ costUSD = 0, inputTokens = 0, outputTokens = 0, cacheReadTokens = 0 } = {}) {
  const cost = Number(costUSD) || 0;
  if (cost > 0) return cost;
  const inTok = Math.max(0, Number(inputTokens) || 0);
  const outTok = Math.max(0, Number(outputTokens) || 0);
  const cacheTok = Math.max(0, Number(cacheReadTokens) || 0);
  const tokenWeight = (inTok + 4 * outTok + 0.1 * cacheTok) / 1_000_000;
  return tokenWeight > 0 ? tokenWeight : 0.001;
}

let pricingLedgerCache = {
  path: '',
  mtimeMs: -1,
  size: -1,
  calls: [],
};

const transcriptTailCache = new Map();

function normalizeCallRecord(raw, now) {
  if (!raw || typeof raw !== 'object') return null;
  let ts = toFiniteNumber(raw.timestamp ?? raw.ts);
  if (ts === null || ts <= 0) {
    const parsedCreated = raw.created_at ? Date.parse(String(raw.created_at)) : NaN;
    if (Number.isFinite(parsedCreated)) ts = parsedCreated;
  }
  if ((ts === null || ts <= 0) && raw.updatedAt) {
    const parsedUpd = toFiniteNumber(raw.updatedAt);
    if (parsedUpd !== null && parsedUpd > 0) ts = parsedUpd;
  }
  if (ts === null || !Number.isFinite(ts) || ts < now - MODEL_CALL_CACHE_HORIZON_MS || ts > now + 5 * 60_000) {
    return null;
  }
  const cascadeId = String(raw.cascadeId || raw.conversationId || raw.convId || '').trim();
  const stepIndex = toFiniteNumber(raw.stepIndex ?? raw.step_index);
  return {
    ts,
    cascadeId,
    stepIndex,
    stepDedupeKey: cascadeId && stepIndex !== null ? `${cascadeId}:${stepIndex}` : '',
    rawModel: String(raw.model || raw.model_name || raw.label || ''),
    modelKey: String(raw.modelKey || raw.model_key || ''),
    modelExactId: String(raw.modelExactId || raw.modelId || raw.model_id || ''),
    costUSD: Math.max(0, toFiniteNumber(raw.costUSD ?? raw.cost_usd) ?? 0),
    inputTokens: Math.max(0, toFiniteNumber(raw.inputTokens ?? raw.input_tokens) ?? 0),
    outputTokens: Math.max(0, toFiniteNumber(raw.outputTokens ?? raw.output_tokens) ?? 0),
    cacheReadTokens: Math.max(
      0,
      toFiniteNumber(raw.cacheReadTokens ?? raw.cacheTokens ?? raw.cache_read_tokens) ?? 0,
    ),
  };
}

function readPricingLedgerCalls(ledgerPath, now) {
  if (!ledgerPath || !existsSync(ledgerPath)) return [];
  let st;
  try {
    st = statSync(ledgerPath);
  } catch {
    return [];
  }
  const mtimeMs = st.mtimeMs || 0;
  const size = st.size || 0;

  if (
    pricingLedgerCache.path !== ledgerPath ||
    pricingLedgerCache.mtimeMs !== mtimeMs ||
    pricingLedgerCache.size !== size
  ) {
    const parsed = readJsonSafe(ledgerPath);
    const rawCalls = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.calls)
        ? parsed.calls
        : parsed?.calls && typeof parsed.calls === 'object'
          ? Object.values(parsed.calls)
          : [];
    const normalized = [];
    for (const item of rawCalls) {
      const rec = normalizeCallRecord(item, now);
      if (rec) normalized.push(rec);
    }
    normalized.sort((a, b) => a.ts - b.ts);
    pricingLedgerCache = {
      path: ledgerPath,
      mtimeMs,
      size,
      calls: normalized,
    };
  }

  const cutoff = now - MODEL_CALL_RETENTION_MS;
  return pricingLedgerCache.calls.filter((c) => c.ts >= cutoff && c.ts <= now + 5 * 60_000);
}

function readTailUtf8(filePath, fileSize, maxBytes = TRANSCRIPT_TAIL_BYTES) {
  if (fileSize <= 0) return '';
  const readLen = Math.min(fileSize, maxBytes);
  const startOffset = Math.max(0, fileSize - readLen);
  let fd = null;
  try {
    fd = openSync(filePath, 'r');
    const buf = Buffer.alloc(readLen);
    const bytesRead = readSync(fd, buf, 0, readLen, startOffset);
    let text = buf.subarray(0, bytesRead).toString('utf8');
    if (startOffset > 0) {
      const nl = text.indexOf('\n');
      text = nl >= 0 ? text.slice(nl + 1) : '';
    }
    return text;
  } catch {
    return '';
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // ignore close error
      }
    }
  }
}

function readTranscriptFallbackCalls(brainDir, now) {
  if (!brainDir || !existsSync(brainDir)) return [];
  const cutoff = now - MODEL_CALL_RETENTION_MS;
  let convEntries = [];
  try {
    convEntries = readdirSync(brainDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const results = [];
  for (const entry of convEntries) {
    if (!entry.isDirectory()) continue;
    const transcriptPath = join(brainDir, entry.name, '.system_generated', 'logs', 'transcript.jsonl');
    let st;
    try {
      if (!existsSync(transcriptPath)) continue;
      st = statSync(transcriptPath);
    } catch {
      continue;
    }
    if ((st.mtimeMs || 0) < cutoff || (st.size || 0) <= 0) continue;

    const cached = transcriptTailCache.get(transcriptPath);
    let convCalls;
    if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
      convCalls = cached.calls;
    } else {
      const tailText = readTailUtf8(transcriptPath, st.size, TRANSCRIPT_TAIL_BYTES);
      convCalls = [];
      let lastSeenModelInConv = '';
      for (const rawLine of tailText.split(/\r?\n/)) {
        const trimmed = rawLine.trim();
        if (!trimmed) continue;
        let obj;
        try {
          obj = JSON.parse(trimmed);
        } catch {
          continue;
        }
        const explicitModel = String(
          obj?.model || obj?.model_name || obj?.modelKey || obj?.modelId || obj?.metadata?.model || '',
        ).trim();
        if (explicitModel) {
          lastSeenModelInConv = explicitModel;
        }
        const isModelStep =
          obj?.type === 'PLANNER_RESPONSE' ||
          (obj?.source === 'MODEL' &&
            (obj?.input_tokens !== undefined ||
              obj?.output_tokens !== undefined ||
              obj?.inputTokens !== undefined ||
              obj?.outputTokens !== undefined ||
              Boolean(explicitModel)));
        if (!isModelStep) continue;

        const rec = normalizeCallRecord(
          {
            cascadeId: entry.name,
            step_index: obj.step_index,
            timestamp: obj.timestamp,
            created_at: obj.created_at,
            model: explicitModel || lastSeenModelInConv,
            input_tokens: obj.input_tokens ?? obj.inputTokens ?? obj.usage?.input_tokens ?? 0,
            output_tokens: obj.output_tokens ?? obj.outputTokens ?? obj.usage?.output_tokens ?? 0,
            cache_read_tokens:
              obj.cache_read_tokens ?? obj.cacheReadTokens ?? obj.usage?.cache_read_tokens ?? 0,
            costUSD: obj.costUSD ?? obj.cost_usd ?? 0,
          },
          now,
        );
        if (rec) convCalls.push(rec);
      }
      transcriptTailCache.set(transcriptPath, {
        mtimeMs: st.mtimeMs,
        size: st.size,
        calls: convCalls,
      });
    }

    for (const c of convCalls) {
      if (c.ts >= cutoff && c.ts <= now + 5 * 60_000) {
        results.push(c);
      }
    }
  }

  results.sort((a, b) => a.ts - b.ts);
  return results;
}

function collectRecentModelCalls(now = Date.now(), options = {}) {
  if (options?.disableModelCalls === true || options?.modelCalls === false) {
    return { source: 'none', calls: [] };
  }

  if (Array.isArray(options?.modelCalls)) {
    const cutoff = now - MODEL_CALL_RETENTION_MS;
    const inlineCalls = options.modelCalls
      .map((c) => normalizeCallRecord(c, now))
      .filter((c) => c && c.ts >= cutoff && c.ts <= now + 5 * 60_000)
      .sort((a, b) => a.ts - b.ts);
    return { source: 'inline', calls: inlineCalls };
  }

  const ledgerDisabled =
    options?.disablePricingLedger === true ||
    options?.pricingLedgerPath === false ||
    options?.pricingLedgerPath === null ||
    process.env.AGY_QUOTA_PRICING_LEDGER_PATH === '__none__';

  const hasCustomLedgerOnly =
    typeof options?.pricingLedgerPath === 'string' &&
    options.pricingLedgerPath.trim() &&
    options?.brainDir === undefined;

  let ledgerCalls = [];
  if (!ledgerDisabled) {
    const ledgerPath =
      typeof options?.pricingLedgerPath === 'string' && options.pricingLedgerPath.trim()
        ? resolve(options.pricingLedgerPath)
        : process.env.AGY_QUOTA_PRICING_LEDGER_PATH
          ? resolve(process.env.AGY_QUOTA_PRICING_LEDGER_PATH)
          : join(homedir(), '.gemini', 'antigravity', 'pricing_ledger_v1.json');
    ledgerCalls = readPricingLedgerCalls(ledgerPath, now);
    if (ledgerCalls.length > 0 && hasCustomLedgerOnly) {
      return { source: 'pricing-ledger', calls: ledgerCalls };
    }
  }

  const brainDisabled =
    options?.brainDir === false ||
    options?.brainDir === null ||
    process.env.AGY_QUOTA_BRAIN_DIR === '__none__';

  let transcriptCalls = [];
  if (!brainDisabled) {
    const brainDir =
      typeof options?.brainDir === 'string' && options.brainDir.trim()
        ? resolve(options.brainDir)
        : process.env.AGY_QUOTA_BRAIN_DIR
          ? resolve(process.env.AGY_QUOTA_BRAIN_DIR)
          : join(homedir(), '.gemini', 'antigravity', 'brain');
    transcriptCalls = readTranscriptFallbackCalls(brainDir, now);
  }

  if (ledgerCalls.length > 0) {
    if (transcriptCalls.length === 0) {
      return { source: 'pricing-ledger', calls: ledgerCalls };
    }
    const seenStepKeys = new Set();
    const maxTsByCascade = new Map();
    for (const lc of ledgerCalls) {
      if (lc.stepDedupeKey) seenStepKeys.add(lc.stepDedupeKey);
      if (lc.cascadeId) {
        const prevMax = maxTsByCascade.get(lc.cascadeId) || 0;
        if (lc.ts > prevMax) maxTsByCascade.set(lc.cascadeId, lc.ts);
      }
    }
    const supplemental = transcriptCalls.filter((tc) => {
      if (tc.stepDedupeKey && seenStepKeys.has(tc.stepDedupeKey)) return false;
      if (tc.cascadeId && maxTsByCascade.has(tc.cascadeId) && tc.ts <= maxTsByCascade.get(tc.cascadeId)) {
        return false;
      }
      return true;
    });
    if (supplemental.length === 0) {
      return { source: 'pricing-ledger', calls: ledgerCalls };
    }
    const merged = [...ledgerCalls, ...supplemental].sort((a, b) => a.ts - b.ts);
    return { source: 'pricing-ledger', calls: merged };
  }

  if (transcriptCalls.length > 0) {
    return { source: 'transcript', calls: transcriptCalls };
  }

  return { source: 'none', calls: [] };
}

function inferModelIdAtTimestamp(ts, scopedPoints, activeModelFamilyId, models, hasIndependentArgonPool) {
  let nearestFamily = '';
  let nearestDist = Infinity;
  for (const pt of scopedPoints || []) {
    if (!pt?.activeModel) continue;
    const dist = Math.abs(pt.ts - ts);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestFamily = pt.activeModel;
    }
  }
  if (nearestFamily) return nearestFamily;
  if (activeModelFamilyId) return activeModelFamilyId;

  const consumed = (models || [])
    .filter((m) => Number(m.rawRemainingPercentage) < 100)
    .sort((a, b) => a.rawRemainingPercentage - b.rawRemainingPercentage);
  if (consumed.length > 0) {
    const spec = classifyTrendModel(consumed[0].label, '', consumed[0].modelId, hasIndependentArgonPool, null);
    if (spec) return spec.modelId;
  }
  return 'carbon';
}

function computeActivityScore(usagePp, calls, weight) {
  if (usagePp > 0) {
    return Number(Math.max(usagePp, 0.05).toFixed(3));
  }
  if (calls > 0) {
    const raw = 0.08 + Math.min(0.22, (Number(weight) || 0) * 1.5 + Math.log2(calls + 1) * 0.04);
    return Number(clamp(raw, 0.08, 0.3).toFixed(3));
  }
  return 0;
}

function recordAndAnalyzeHistory(pools, now, accountKey = '', options = {}) {
  const persist = options?.persist !== false;
  const hasIndependentArgonPool = Boolean(options?.hasIndependentArgonPool);
  const models = Array.isArray(options?.models) ? options.models : [];
  const activeModelFamilyId = typeof options?.activeModelFamilyId === 'string' ? options.activeModelFamilyId : '';

  syncHistoryFromDisk(now);

  const activePoolIds = new Set(pools.map((p) => p.id));
  const activeHasArgon = pools.some((p) => p.id === 'argon' && p.hasData);
  const workingPoints = persist ? historyPoints : [...historyPoints];
  const scopedBefore = filterAccountHistory(workingPoints, accountKey, activeHasArgon);
  const prev = scopedBefore.length > 0 ? scopedBefore[scopedBefore.length - 1] : null;

  const currentMap = {};
  const resets = [];
  let changed = false;

  for (const pool of pools) {
    if (!pool.hasData || pool.rawRemaining === null) continue;
    currentMap[pool.id] = pool.rawRemaining;
    const prevVal = prev?.pools?.[pool.id];
    if (prevVal === undefined) {
      changed = true;
    } else if (pool.rawRemaining > prevVal + RESET_THRESHOLD_PP) {
      resets.push(pool.id);
      changed = true;
    } else if (Math.abs(pool.rawRemaining - prevVal) >= 0.05) {
      changed = true;
    }
  }

  if (activeModelFamilyId && prev?.activeModel && prev.activeModel !== activeModelFamilyId) {
    changed = true;
  }

  const elapsed = prev ? now - prev.ts : Infinity;
  if (Object.keys(currentMap).length > 0 && (changed || elapsed >= HISTORY_MIN_RECORD_INTERVAL_MS)) {
    const newPoint = { ts: now, pools: currentMap, resets };
    if (accountKey) newPoint.acct = accountKey;
    if (activeModelFamilyId) newPoint.activeModel = activeModelFamilyId;
    workingPoints.push(newPoint);
    if (persist) {
      historyPoints = pruneHistory(workingPoints, now);
      saveHistory(historyPoints);
    }
  }

  const effectivePoints = persist ? historyPoints : pruneHistory(workingPoints, now);
  const scopedPoints = filterAccountHistory(effectivePoints, accountKey, activeHasArgon);

  // Build 90-minute stacked usage buckets (pp consumed per active pool)
  const bucketMinutes = Math.max(5, Math.ceil(CHART_WINDOW_MINUTES / CHART_MAX_BUCKETS));
  const bucketMs = bucketMinutes * 60_000;
  const windowStart = now - CHART_WINDOW_MINUTES * 60_000;
  const bucketCount = Math.ceil(CHART_WINDOW_MINUTES / bucketMinutes);
  const buckets = Array.from({ length: bucketCount }, (_, i) => ({
    startTime: windowStart + i * bucketMs,
    endTime: windowStart + (i + 1) * bucketMs,
    items: {},
    intervalStarts: {},
  }));

  const latestResetByPool = {};
  for (const pt of scopedPoints) {
    if (Array.isArray(pt.resets)) {
      for (const pid of pt.resets) {
        if (activePoolIds.has(pid)) {
          latestResetByPool[pid] = pt.ts;
        }
      }
    }
  }

  for (let i = 1; i < scopedPoints.length; i += 1) {
    const a = scopedPoints[i - 1];
    const b = scopedPoints[i];
    if (b.ts < windowStart) continue;
    if (b.ts - a.ts > 15 * 60_000) continue; // Ignore offline gaps > 15m

    const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor((b.ts - windowStart) / bucketMs)));
    for (const [pid, currVal] of Object.entries(b.pools)) {
      if (!activePoolIds.has(pid)) continue;
      if (Array.isArray(b.resets) && b.resets.includes(pid)) continue;
      const prevVal = a.pools?.[pid];
      if (prevVal === undefined) continue;
      const drop = prevVal - currVal;
      if (drop > 0.01) {
        buckets[idx].items[pid] = (buckets[idx].items[pid] || 0) + drop;
        const prevStart = buckets[idx].intervalStarts[pid];
        buckets[idx].intervalStarts[pid] = prevStart === undefined ? a.ts : Math.min(prevStart, a.ts);
      }
    }
  }

  const predictions = {};
  for (const pool of pools) {
    if (!pool.hasData) {
      predictions[pool.id] = { usageRate: 0, runway: 'Stable' };
      continue;
    }
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
      .filter(([poolId, usage]) => activePoolIds.has(poolId) && usage > 0.01)
      .map(([poolId, usage]) => {
        const poolCfg = QUOTA_POOLS.find((p) => p.id === poolId);
        return {
          poolId,
          usage: Number(usage.toFixed(2)),
          color: poolCfg?.themeColor || '#888',
        };
      }),
  }));

  // Build 18 x 5m per-model buckets & 90m active model summaries
  const preferredLabels = buildPreferredTrendLabels(models);
  const { source: modelCallSource, calls: rawRecentCalls } = collectRecentModelCalls(now, options);

  const classifiedCalls = [];
  for (const call of rawRecentCalls) {
    let spec = classifyTrendModel(
      call.rawModel,
      call.modelKey,
      call.modelExactId,
      hasIndependentArgonPool,
      preferredLabels,
    );
    if (!spec) {
      const inferredFamily = inferModelIdAtTimestamp(
        call.ts,
        scopedPoints,
        activeModelFamilyId,
        models,
        hasIndependentArgonPool,
      );
      spec = classifyTrendModel(inferredFamily, '', '', hasIndependentArgonPool, preferredLabels);
    }
    if (!spec || !activePoolIds.has(spec.poolId)) continue;
    classifiedCalls.push({
      ts: call.ts,
      weight: computeCallWeight(call),
      spec,
    });
  }

  const perBucketModelMaps = Array.from({ length: bucketCount }, () => new Map());
  for (const c of classifiedCalls) {
    if (c.ts < windowStart) continue;
    const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor((c.ts - windowStart) / bucketMs)));
    const map = perBucketModelMaps[idx];
    let entry = map.get(c.spec.modelId);
    if (!entry) {
      entry = {
        modelId: c.spec.modelId,
        label: c.spec.label,
        poolId: c.spec.poolId,
        color: c.spec.color,
        order: c.spec.order,
        calls: 0,
        weight: 0,
        rawUsagePp: 0,
      };
      map.set(c.spec.modelId, entry);
    }
    entry.calls += 1;
    entry.weight += c.weight;
  }

  for (let idx = 0; idx < bucketCount; idx += 1) {
    const b = buckets[idx];
    const modelMap = perBucketModelMaps[idx];

    for (const pool of pools) {
      const rawPoolDrop = b.items[pool.id] || 0;
      if (rawPoolDrop <= 0.01) continue;

      const inBucketEntries = Array.from(modelMap.values()).filter(
        (e) => e.poolId === pool.id && e.calls > 0,
      );

      if (inBucketEntries.length > 0) {
        const sumW = inBucketEntries.reduce((acc, e) => acc + e.weight, 0);
        for (const e of inBucketEntries) {
          const ratio = sumW > 0 ? e.weight / sumW : 1 / inBucketEntries.length;
          e.rawUsagePp += rawPoolDrop * ratio;
        }
        continue;
      }

      // Polling-latency lookback: first check preceding 90s, then sampling interval start if needed
      let lookbackCalls = classifiedCalls.filter(
        (c) => c.spec.poolId === pool.id && c.ts >= b.startTime - MODEL_LOOKBACK_MS && c.ts < b.startTime,
      );
      if (lookbackCalls.length === 0 && b.intervalStarts[pool.id] !== undefined) {
        const earliestFrom = Math.max(
          now - MODEL_CALL_RETENTION_MS,
          b.intervalStarts[pool.id] - MODEL_LOOKBACK_MS,
        );
        lookbackCalls = classifiedCalls.filter(
          (c) => c.spec.poolId === pool.id && c.ts >= earliestFrom && c.ts < b.startTime,
        );
      }

      if (lookbackCalls.length > 0) {
        const byModelW = new Map();
        for (const lc of lookbackCalls) {
          const existing = byModelW.get(lc.spec.modelId);
          if (!existing) {
            byModelW.set(lc.spec.modelId, { spec: lc.spec, weight: lc.weight });
          } else {
            existing.weight += lc.weight;
          }
        }
        const lbList = Array.from(byModelW.values());
        const sumW = lbList.reduce((acc, x) => acc + x.weight, 0);
        for (const { spec, weight } of lbList) {
          let entry = modelMap.get(spec.modelId);
          if (!entry) {
            entry = {
              modelId: spec.modelId,
              label: spec.label,
              poolId: spec.poolId,
              color: spec.color,
              order: spec.order,
              calls: 0,
              weight: 0,
              rawUsagePp: 0,
            };
            modelMap.set(spec.modelId, entry);
          }
          const ratio = sumW > 0 ? weight / sumW : 1 / lbList.length;
          entry.rawUsagePp += rawPoolDrop * ratio;
        }
        continue;
      }

      // Pool default fallback so total pp is strictly conserved even without local call logs
      const defaultSpec =
        pool.id === 'argon'
          ? classifyTrendModel('argon', '', '', true, preferredLabels)
          : {
              modelId: pool.id,
              label: pool.label || pool.id,
              poolId: pool.id,
              color: pool.themeColor || '#40C4FF',
              order: 50,
            };
      let fallbackEntry = modelMap.get(defaultSpec.modelId);
      if (!fallbackEntry) {
        fallbackEntry = {
          modelId: defaultSpec.modelId,
          label: defaultSpec.label,
          poolId: defaultSpec.poolId,
          color: defaultSpec.color,
          order: defaultSpec.order,
          calls: 0,
          weight: 0,
          rawUsagePp: 0,
        };
        modelMap.set(defaultSpec.modelId, fallbackEntry);
      }
      fallbackEntry.rawUsagePp += rawPoolDrop;
    }
  }

  const modelBuckets = buckets.map((b, idx) => {
    const entries = Array.from(perBucketModelMaps[idx].values())
      .filter((e) => e.rawUsagePp > 0.005 || e.calls > 0)
      .sort((a, bItem) => a.order - bItem.order || a.modelId.localeCompare(bItem.modelId));

    const items = entries.map((e) => {
      const usagePp = Number(e.rawUsagePp.toFixed(2));
      return {
        modelId: e.modelId,
        label: e.label,
        poolId: e.poolId,
        color: e.color,
        usagePp,
        calls: e.calls,
        activityScore: computeActivityScore(usagePp, e.calls, e.weight),
      };
    });

    // Conserve exact rounded pool drop sum per active pool within each bucket
    for (const pool of pools) {
      const rawPoolDrop = b.items[pool.id] || 0;
      if (rawPoolDrop <= 0.01) continue;
      const targetPoolPp = Number(rawPoolDrop.toFixed(2));
      const poolItems = items.filter((it) => it.poolId === pool.id && it.usagePp > 0);
      if (poolItems.length > 0) {
        const currentSum = Number(poolItems.reduce((acc, it) => acc + it.usagePp, 0).toFixed(2));
        const diff = Number((targetPoolPp - currentSum).toFixed(2));
        if (Math.abs(diff) >= 0.01) {
          let largest = poolItems[0];
          for (const candidate of poolItems) {
            if (candidate.usagePp > largest.usagePp) largest = candidate;
          }
          largest.usagePp = Number(Math.max(0, largest.usagePp + diff).toFixed(2));
          largest.activityScore = computeActivityScore(largest.usagePp, largest.calls, 0);
        }
      }
    }

    const totalPp = Number(items.reduce((acc, it) => acc + it.usagePp, 0).toFixed(2));
    const totalCalls = items.reduce((acc, it) => acc + it.calls, 0);

    return {
      startTime: b.startTime,
      endTime: b.endTime,
      totalPp,
      totalCalls,
      items,
    };
  });

  const summaryAccMap = new Map();
  for (const mb of modelBuckets) {
    for (const it of mb.items) {
      let acc = summaryAccMap.get(it.modelId);
      if (!acc) {
        acc = {
          modelId: it.modelId,
          label: it.label,
          poolId: it.poolId,
          color: it.color,
          rawTotalPp: 0,
          postResetPp: 0,
          calls: 0,
        };
        summaryAccMap.set(it.modelId, acc);
      }
      acc.rawTotalPp += it.usagePp;
      acc.calls += it.calls;
      const latestReset = latestResetByPool[it.poolId] ?? null;
      if (!latestReset || mb.endTime > latestReset) {
        acc.postResetPp += it.usagePp;
      }
    }
  }

  const modelSummaries = Array.from(summaryAccMap.values())
    .map((acc) => {
      const totalPp = Number(acc.rawTotalPp.toFixed(2));
      const latestReset = latestResetByPool[acc.poolId] ?? null;
      const rateStart = latestReset ? Math.max(windowStart, latestReset) : windowStart;
      const elapsedHours = Math.max(now - rateStart, bucketMs) / 3_600_000;
      const usageRatePp = elapsedHours > 0 ? Number((acc.postResetPp / elapsedHours).toFixed(2)) : 0;
      return {
        modelId: acc.modelId,
        label: acc.label,
        poolId: acc.poolId,
        color: acc.color,
        totalPp,
        usageRatePp,
        calls: acc.calls,
      };
    })
    .filter((s) => s.totalPp > 0 || s.calls > 0)
    .sort((a, bItem) => bItem.totalPp - a.totalPp || bItem.calls - a.calls || a.label.localeCompare(bItem.label));

  const hasUsage = formattedBuckets.some((b) => b.items.length > 0);
  const hasModelUsage = modelSummaries.length > 0;

  return {
    windowMinutes: CHART_WINDOW_MINUTES,
    bucketMinutes,
    hasUsage,
    hasModelUsage,
    modelCallSource,
    buckets: formattedBuckets,
    modelBuckets,
    modelSummaries,
    predictions,
    pointCount: scopedPoints.length,
  };
}

// ---------------------------------------------------------------------------
// Response Transformation (Adaptive 2-Pool Ultra / 3-Pool Pro Aggregation)
// ---------------------------------------------------------------------------

function pickNearestReset(existing, candidate, now) {
  const aFuture = existing.resetDate !== null && existing.resetDate > now;
  const bFuture = candidate.resetDate !== null && candidate.resetDate > now;

  if (aFuture && bFuture) {
    return candidate.resetDate < existing.resetDate ? candidate : existing;
  }
  if (bFuture && !aFuture) return candidate;
  if (aFuture && !bFuture) return existing;
  if (existing.resetDate === null && candidate.resetDate !== null) return candidate;
  return existing;
}

function mergeAndDedupeModels(rawModels, now) {
  const mergedMap = new Map();
  const rawDisabled = [];

  for (const m of rawModels || []) {
    const modelId = m?.modelOrAlias?.model || 'unknown';
    const rawLabel = m?.label || modelId;
    const baseLabel = normalizeModelLabel(rawLabel);
    const grp = classifyModel(modelId, baseLabel);
    const dedupeKey = `${grp.poolId}::${baseLabel.toLowerCase()}`;

    if (m?.disabled || !m?.quotaInfo) {
      rawDisabled.push({
        dedupeKey,
        item: {
          label: baseLabel,
          modelId,
          groupId: grp.id,
          groupLabel: grp.label,
          poolId: grp.poolId,
          color: grp.color,
          disabled: true,
        },
      });
      continue;
    }

    const rawFraction = clamp(m.quotaInfo.remainingFraction ?? 0, 0, 1);
    const parsedReset = m.quotaInfo.resetTime ? Date.parse(m.quotaInfo.resetTime) : NaN;
    const hasReset = Number.isFinite(parsedReset);
    const timeUntilReset = hasReset ? formatTimeUntilReset(parsedReset - now) : 'N/A';
    const remainingPercentage = timeUntilReset === 'Ready' ? 100 : rawFraction * 100;

    const entry = {
      label: baseLabel,
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
    };

    const existing = mergedMap.get(dedupeKey);
    if (!existing) {
      mergedMap.set(dedupeKey, entry);
    } else {
      const resetWinner = pickNearestReset(existing, entry, now);
      const minRem = Math.min(existing.remainingPercentage, entry.remainingPercentage);
      const minRaw = Math.min(existing.rawRemainingPercentage, entry.rawRemainingPercentage);
      const chosenResetDate = resetWinner.resetDate;
      const chosenTimeUntil = chosenResetDate !== null
        ? formatTimeUntilReset(chosenResetDate - now)
        : 'N/A';

      existing.remainingPercentage = Number(minRem.toFixed(2));
      existing.rawRemainingPercentage = Number(minRaw.toFixed(2));
      existing.isExhausted = existing.isExhausted || entry.isExhausted;
      existing.resetDate = chosenResetDate;
      existing.resetIso = resetWinner.resetIso;
      existing.timeUntilReset = chosenTimeUntil;
    }
  }

  const models = Array.from(mergedMap.values());
  const seenDisabled = new Set();
  const disabledModels = [];
  for (const { dedupeKey, item } of rawDisabled) {
    if (mergedMap.has(dedupeKey) || seenDisabled.has(dedupeKey)) continue;
    seenDisabled.add(dedupeKey);
    disabledModels.push(item);
  }

  return { models, disabledModels };
}

function findFirstBucket(bucketMap, ids) {
  for (const id of ids || []) {
    const found = bucketMap.get(id);
    if (found) return found;
  }
  return null;
}

function findArgonBucketFallback(summaryGroups, summaryBucketsById, windowType) {
  for (const [, bucket] of summaryBucketsById.entries()) {
    if (bucket.window === windowType && /argon/i.test(bucket.bucketId)) {
      return bucket;
    }
  }
  for (const group of summaryGroups || []) {
    if (!/argon/i.test(String(group?.displayName || ''))) continue;
    for (const bucket of group.buckets || []) {
      if (bucket.window === windowType) return bucket;
    }
  }
  return null;
}

function pickMinPoolModel(modelList, now) {
  if (!Array.isArray(modelList) || modelList.length === 0) return null;
  return modelList.reduce((min, cur) => {
    if (cur.rawRemainingPercentage < min.rawRemainingPercentage) return cur;
    if (cur.rawRemainingPercentage > min.rawRemainingPercentage) return min;
    return pickNearestReset(min, cur, now) === cur ? cur : min;
  });
}

function hasResetDateMismatch(resetA, resetB) {
  const aValid = typeof resetA === 'number' && Number.isFinite(resetA);
  const bValid = typeof resetB === 'number' && Number.isFinite(resetB);
  if (!aValid && !bValid) return false;
  if (aValid !== bValid) return true;
  return Math.abs(resetA - resetB) > 60_000;
}

function detectIndependentArgonPool({
  rawGroups = [],
  summaryGroups = [],
  summaryBucketsById = new Map(),
  models = [],
  now = Date.now(),
} = {}) {
  for (const bucketId of summaryBucketsById.keys()) {
    if (/argon/i.test(String(bucketId))) {
      return true;
    }
  }

  for (const g of summaryGroups) {
    if (/argon/i.test(String(g?.displayName || ''))) {
      return true;
    }
    for (const b of g?.buckets || []) {
      if (/argon/i.test(String(b?.bucketId || '')) || /argon/i.test(String(b?.displayName || ''))) {
        return true;
      }
    }
  }

  for (const g of rawGroups) {
    if (/argon/i.test(String(g?.displayName || ''))) {
      return true;
    }
    for (const b of g?.buckets || []) {
      if (/argon/i.test(String(b?.bucketId || '')) || /argon/i.test(String(b?.displayName || ''))) {
        return true;
      }
    }
  }

  const hasSummaryBuckets =
    summaryBucketsById.size > 0 || summaryGroups.some((g) => (g?.buckets?.length || 0) > 0);
  if (!hasSummaryBuckets) {
    const argonModels = models.filter((m) => m.groupId === 'gemini-argon' || m.poolId === 'argon');
    const regularGeminiModels = models.filter(
      (m) => m.poolId === 'gemini' && m.groupId !== 'gemini-argon',
    );
    if (argonModels.length > 0 && regularGeminiModels.length > 0) {
      const minArgon = pickMinPoolModel(argonModels, now);
      const minGemini = pickMinPoolModel(regularGeminiModels, now);
      if (minArgon && minGemini) {
        const remDiff = Math.abs(minArgon.remainingPercentage - minGemini.remainingPercentage);
        const rawDiff = Math.abs(minArgon.rawRemainingPercentage - minGemini.rawRemainingPercentage);
        if (
          remDiff > 0.05 ||
          rawDiff > 0.05 ||
          hasResetDateMismatch(minArgon.resetDate, minGemini.resetDate)
        ) {
          return true;
        }
      }
    }
  }

  return false;
}

const GEMINI_GENERIC_TIER_RE = /^(?:flash|pro|ultra|nano|lite)\b/i;
const ORCHESTRATOR_LABEL_RE = /\borchestrator\b/i;

function parseGroupDescriptionModels(description = '') {
  const text = String(description || '').trim();
  if (!text) return [];
  const colonIdx = text.indexOf(':');
  const listPart = colonIdx >= 0 ? text.slice(colonIdx + 1) : '';
  if (!listPart) return [];
  return listPart
    .split(',')
    .map((item) => normalizeModelLabel(item))
    .filter(Boolean);
}

function shortenModelFamily(label = '', poolId = '') {
  const clean = normalizeModelLabel(label);
  if (!clean) return '';

  if (poolId === 'argon') {
    return clean;
  }

  const geminiVerMatch = clean.match(/^Gemini\s+(\d+(?:\.\d+)?)\s+(.+)$/i);
  if (geminiVerMatch) {
    const ver = geminiVerMatch[1];
    const rest = geminiVerMatch[2].trim();
    if (GEMINI_GENERIC_TIER_RE.test(rest)) {
      return `${ver} ${rest}`;
    }
    return rest;
  }
  if (/^Gemini\s+/i.test(clean)) {
    return clean.replace(/^Gemini\s+/i, '').trim() || clean;
  }

  const claudeVerFirst = clean.match(/^Claude\s+(\d+(?:\.\d+)?)\s+(Sonnet|Opus|Haiku)\b(.*)$/i);
  if (claudeVerFirst) {
    const suffix = claudeVerFirst[3] ? ` ${claudeVerFirst[3].trim()}` : '';
    return `${claudeVerFirst[2]} ${claudeVerFirst[1]}${suffix}`.trim();
  }
  if (/^Claude\s+/i.test(clean)) {
    return clean.replace(/^Claude\s+/i, '').trim() || clean;
  }

  let gptClean = clean.replace(/^OpenAI\s+/i, '').trim();
  gptClean = gptClean.replace(/\s+\d+(?:\.\d+)?[BM]\b.*$/i, '').trim();
  return gptClean || clean;
}

function summaryGroupMatchesPool(group, poolId, hasIndependentArgonPool) {
  const name = String(group?.displayName || '').toLowerCase();
  const bucketIds = (group?.buckets || []).map((b) => String(b?.bucketId || '').toLowerCase());
  const isArgonGroup = name.includes('argon') || bucketIds.some((id) => id.includes('argon'));
  if (poolId === 'argon') {
    return isArgonGroup;
  }
  if (poolId === 'gemini') {
    if (isArgonGroup) return !hasIndependentArgonPool;
    return name.includes('gemini') || bucketIds.some((id) => id.startsWith('gemini'));
  }
  if (poolId === 'non-google') {
    return name.includes('claude') || name.includes('gpt') || bucketIds.some((id) => id.startsWith('3p'));
  }
  return false;
}

function extractPoolFamilies(poolId, poolModels = [], summaryGroups = [], hasIndependentArgonPool = false) {
  const seenLabels = new Set();
  const modelLabels = [];
  const pushLabel = (raw) => {
    const clean = normalizeModelLabel(raw);
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seenLabels.has(key)) return;
    seenLabels.add(key);
    modelLabels.push(clean);
  };

  for (const m of poolModels || []) {
    pushLabel(m?.label || m?.modelId || '');
  }

  if (modelLabels.length === 0 && Array.isArray(summaryGroups)) {
    for (const g of summaryGroups) {
      if (!summaryGroupMatchesPool(g, poolId, hasIndependentArgonPool)) continue;
      const parsed = parseGroupDescriptionModels(g.description);
      for (const item of parsed) {
        if (poolId === 'gemini' && hasIndependentArgonPool && /argon/i.test(item)) {
          continue;
        }
        if (poolId === 'argon' && !/argon/i.test(item)) {
          continue;
        }
        pushLabel(item);
      }
      if (modelLabels.length === 0 && poolId === 'argon' && /argon/i.test(String(g.displayName || ''))) {
        pushLabel(g.displayName);
      }
    }
  }

  const primaryLabels = modelLabels.filter((lbl) => !ORCHESTRATOR_LABEL_RE.test(lbl));
  const sourceLabels = primaryLabels.length > 0 ? primaryLabels : modelLabels;

  const seenFamilies = new Set();
  const families = [];
  for (const lbl of sourceLabels) {
    const shortName = shortenModelFamily(lbl, poolId);
    if (!shortName) continue;
    const key = shortName.toLowerCase();
    if (seenFamilies.has(key)) continue;
    seenFamilies.add(key);
    families.push(shortName);
  }

  return {
    modelLabels,
    families,
    familySummary: families.join(' · '),
  };
}

function parseSnapshot(userStatusData, summaryData, connInfo = {}) {
  const now = Date.now();
  const userStatus = userStatusData?.userStatus || userStatusData || {};
  const planStatus = userStatus.planStatus || {};
  const planInfo = planStatus.planInfo || {};
  const userTier = userStatus.userTier || {};
  const { tier, planName } = normalizeTierAndPlan(userTier, planInfo);

  const userInfo = {
    name: userStatus.name || '',
    email: userStatus.email || '',
    tier,
    tierId: userTier.id || '',
    tierDescription: cleanTierLabel(userTier.description || ''),
    planName,
    teamsTier: isRawEnumOrSlug(planInfo.teamsTier || '') ? '' : cleanTierLabel(planInfo.teamsTier || ''),
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

  // Deduplicated base models
  const rawModels = userStatus.cascadeModelConfigData?.clientModelConfigs || [];
  const { models, disabledModels } = mergeAndDedupeModels(rawModels, now);

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

  // Detect whether Argon has an independent server-side quota pool (Pro = 3-pool, Ultra = 2-pool)
  const hasIndependentArgonPool = detectIndependentArgonPool({
    rawGroups,
    summaryGroups,
    summaryBucketsById,
    models,
    now,
  });
  const poolMode = hasIndependentArgonPool ? '3-pool' : '2-pool';

  if (!hasIndependentArgonPool) {
    for (const m of models) {
      if (m.poolId === 'argon') {
        m.poolId = 'gemini';
      }
    }
    for (const dm of disabledModels) {
      if (dm.poolId === 'argon') {
        dm.poolId = 'gemini';
      }
    }
  }

  const activePoolConfigs = hasIndependentArgonPool
    ? QUOTA_POOLS
    : QUOTA_POOLS.filter((cfg) => cfg.id !== 'argon');

  const pools = [];
  for (const cfg of activePoolConfigs) {
    const poolModels = models.filter((m) => m.poolId === cfg.id);
    const minModel = pickMinPoolModel(poolModels, now);

    let fiveHourBucket = findFirstBucket(summaryBucketsById, cfg.fiveHourBucketIds);
    let weeklyBucket = findFirstBucket(summaryBucketsById, cfg.weeklyBucketIds);
    if (cfg.id === 'argon') {
      if (!fiveHourBucket) {
        fiveHourBucket = findArgonBucketFallback(summaryGroups, summaryBucketsById, '5h');
      }
      if (!weeklyBucket) {
        weeklyBucket = findArgonBucketFallback(summaryGroups, summaryBucketsById, 'weekly');
      }
    }

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

    const { modelLabels, families, familySummary } = extractPoolFamilies(
      cfg.id,
      poolModels,
      summaryGroups,
      hasIndependentArgonPool,
    );

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
      families,
      familySummary,
      modelLabels,
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

  const accountKey = hashAccountKey(userInfo.email);
  const shouldPersistHistory =
    connInfo?.persistHistory === true ||
    (connInfo?.persistHistory !== false &&
      connInfo?.noPersist !== true &&
      Boolean(connInfo?.source) &&
      connInfo.source !== 'mock' &&
      connInfo.source !== 'test');

  const defaultOverrideModelId = String(
    userStatus.cascadeModelConfigData?.defaultOverrideModelConfig?.modelOrAlias?.model || '',
  ).trim();
  let activeModelHint = null;
  if (defaultOverrideModelId) {
    const matchedRaw = rawModels.find((m) => String(m?.modelOrAlias?.model || '').trim() === defaultOverrideModelId);
    const preferredLabels = buildPreferredTrendLabels(models);
    const trendSpec = classifyTrendModel(
      matchedRaw?.label || '',
      '',
      defaultOverrideModelId,
      hasIndependentArgonPool,
      preferredLabels,
    );
    if (trendSpec) {
      activeModelHint = {
        modelId: trendSpec.modelId,
        label: trendSpec.label,
        poolId: trendSpec.poolId,
        color: trendSpec.color,
        rawModelId: defaultOverrideModelId,
        rawLabel: matchedRaw?.label ? normalizeModelLabel(matchedRaw.label) : trendSpec.label,
      };
    }
  }

  const history = recordAndAnalyzeHistory(pools, now, accountKey, {
    persist: shouldPersistHistory,
    hasIndependentArgonPool,
    models,
    activeModelFamilyId: activeModelHint?.modelId || '',
    pricingLedgerPath: connInfo?.pricingLedgerPath,
    brainDir: connInfo?.brainDir,
    disablePricingLedger: connInfo?.disablePricingLedger,
    disableModelCalls: connInfo?.disableModelCalls,
    modelCalls: connInfo?.modelCalls,
  });
  for (const pool of pools) {
    pool.prediction = history.predictions[pool.id] || { usageRate: 0, runway: 'Stable' };
  }

  return {
    ok: true,
    timestamp: now,
    poolMode,
    hasIndependentArgonPool,
    activeModelHint,
    connection: {
      host: connInfo.host || '127.0.0.1',
      port: connInfo.port || 0,
      source: connInfo.source || 'unknown',
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
// L4: Direct Cloud Code OAuth Fallback & Token Refresh
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
  writeSecureJson(tokenFile, authData, true);
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
  const rawTierName = cleanTierLabel(tierObj?.name || '') || tierId || '';
  const { tier, planName } = normalizeTierAndPlan(
    { id: tierId, name: rawTierName, description: tierObj?.description || '' },
    {},
  );

  return {
    userStatus: {
      name: name || '',
      email: email || '',
      userTier: {
        id: tierId,
        name: tier,
        description: cleanTierLabel(tierObj?.description || ''),
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
    throw new Error('OAuth token is missing or expired and could not be refreshed.');
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

  const userStatusRes = buildUserStatusFromOAuth(
    email,
    name,
    subRes.ok ? subRes.json : null,
    modelsRes.ok ? modelsRes.json : null,
  );
  const rawSummary = quotaRes.ok && quotaRes.json ? quotaRes.json : { groups: [] };
  const quotaSummaryRes = rawSummary.response ? rawSummary : { response: rawSummary, ...rawSummary };

  return {
    conn: {
      host: quotaRes.ok ? quotaRes.host : modelsRes.host,
      port: 443,
      source: 'oauth-token',
    },
    userStatusRes,
    quotaSummaryRes,
  };
}

// ---------------------------------------------------------------------------
// Unified fetchQuotaBundle (15s Memory Cache + Singleflight + L0~L4)
// ---------------------------------------------------------------------------

let cachedBundle = null;
let cachedBundleAt = 0;
let cachedBundleKey = '';
let inFlightBundlePromise = null;
let inFlightBundleKey = '';

async function executeBundleFetch(opts = {}) {
  resolveSharedDataDir();

  const useOAuthOnly = Boolean(opts.oauthOnly || opts.forceOAuth);
  const profileDir = opts.profileDir ? resolve(String(opts.profileDir)) : null;

  try {
    let fetched = null;
    if (useOAuthOnly) {
      fetched = await fetchViaOAuthToken({ profileDir });
    } else {
      let lsError = null;
      try {
        fetched = await fetchViaLanguageServer(opts);
      } catch (err) {
        lsError = err;
      }

      if (!fetched) {
        try {
          fetched = await fetchViaOAuthToken({ profileDir });
        } catch (oauthErr) {
          const lsMsg = lsError instanceof Error ? lsError.message : String(lsError);
          const oauthMsg = oauthErr instanceof Error ? oauthErr.message : String(oauthErr);
          throw new Error(`${lsMsg} (OAuth fallback failed: ${oauthMsg})`);
        }
      }
    }

    const snapshot = parseSnapshot(fetched.userStatusRes, fetched.quotaSummaryRes, {
      ...fetched.conn,
      pricingLedgerPath: opts.pricingLedgerPath,
      brainDir: opts.brainDir,
      disablePricingLedger: opts.disablePricingLedger,
      disableModelCalls: opts.disableModelCalls,
      modelCalls: opts.modelCalls,
    });
    return {
      ok: true,
      timestamp: snapshot.timestamp,
      error: null,
      connection: snapshot.connection,
      raw: {
        userStatusRes: fetched.userStatusRes,
        quotaSummaryRes: fetched.quotaSummaryRes,
      },
      snapshot,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      timestamp: Date.now(),
      error: message,
      connection: null,
      raw: {
        userStatusRes: undefined,
        quotaSummaryRes: undefined,
      },
      snapshot: null,
    };
  }
}

async function fetchQuotaBundle(opts = {}) {
  const options = opts && typeof opts === 'object' ? opts : {};
  const force = Boolean(options.force);
  const useOAuthOnly = Boolean(options.oauthOnly || options.forceOAuth);
  const profileKey = options.profileDir ? resolve(String(options.profileDir)) : '';
  const cacheKey = `${useOAuthOnly ? 'oauth' : 'auto'}:${profileKey}`;
  const now = Date.now();

  if (
    !force
    && cachedBundle
    && cachedBundle.ok
    && cachedBundleKey === cacheKey
    && now - cachedBundleAt < BUNDLE_CACHE_TTL_MS
  ) {
    return cachedBundle;
  }

  if (!force && inFlightBundlePromise && inFlightBundleKey === cacheKey) {
    return inFlightBundlePromise;
  }

  const runPromise = executeBundleFetch(options).then((bundle) => {
    if (bundle.ok) {
      cachedBundle = bundle;
      cachedBundleAt = Date.now();
      cachedBundleKey = cacheKey;
    }
    return bundle;
  }).finally(() => {
    if (inFlightBundlePromise === runPromise) {
      inFlightBundlePromise = null;
      inFlightBundleKey = '';
    }
  });

  if (!force) {
    inFlightBundlePromise = runPromise;
    inFlightBundleKey = cacheKey;
  }

  return runPromise;
}

async function fetchQuotaSnapshot(force = false, options = {}) {
  const bundle = await fetchQuotaBundle({ ...options, force: Boolean(force) });
  if (!bundle.ok || !bundle.snapshot) {
    throw new Error(bundle.error || 'Failed to fetch quota snapshot.');
  }
  return bundle.snapshot;
}

// ---------------------------------------------------------------------------
// Terminal Formatting & Standalone Handler Helpers
// ---------------------------------------------------------------------------

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
  if (value === null || value === undefined || value === '') return '  N/A ';
  const num = Number(value);
  if (!Number.isFinite(num)) return '  N/A ';
  const rounded = Number.isInteger(num) ? String(num) : num.toFixed(1).replace(/\.0$/, '');
  return `${rounded}%`.padStart(6);
}

function formatCliReport(snap, options = {}) {
  const {
    useColor = false,
    maskEmail = false,
    showModels = false,
    watchIntervalSec = 0,
  } = options;
  const c = createAnsiHelpers(Boolean(useColor));
  const { userInfo, connection, pools, summaryGroups, credits, models, disabledModels } = snap;
  const displayEmail = maskEmail ? maskEmailAddress(userInfo?.email) : (userInfo?.email || '-');
  const tierLabel = userInfo?.tier || userInfo?.planName || 'Google AI';
  const connLabel = connection?.source === 'oauth-token'
    ? `Cloud Code: ${connection?.host || '-'}`
    : `LS: ${connection?.host || '-'}:${connection?.port || '-'}`;
  const watchBadge = watchIntervalSec > 0 ? ` ${c.dim(`[watch ${watchIntervalSec}s]`)}` : '';

  const lines = [];
  lines.push(`${c.bold(c.cyan('AGY Quota'))} ${c.dim(`· ${new Date(snap.timestamp).toLocaleString()}`)}${watchBadge}`);
  lines.push(
    `${c.dim('Account:')} ${c.bold(displayEmail)} ${c.dim(`(${tierLabel})`)}  ` +
    `${connLabel} ${c.dim(`[${connection?.source || '-'}]`)}`,
  );
  lines.push('');

  lines.push(c.bold(c.cyan('Quota Pools')));
  const poolList = Array.isArray(pools) ? pools : [];
  if (poolList.length === 0) {
    lines.push(c.dim('  No pool quota data reported.'));
  } else {
    for (const pool of poolList) {
      const label = String(pool.label || pool.id).padEnd(14);
      if (!pool.hasData) {
        const emptyBar = c.dim('░'.repeat(20));
        const emptyPct = c.dim(formatPctLabel(null));
        lines.push(`  ${label} [${emptyBar}] ${emptyPct}  ${c.dim('unavailable on current plan')}`);
        continue;
      }
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

  return lines.join('\n');
}

function getFlagValue(argv, flag) {
  const prefix = `${flag}=`;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === flag && argv[i + 1] && !argv[i + 1].startsWith('-')) {
      return argv[i + 1];
    }
    if (argv[i].startsWith(prefix)) {
      return argv[i].slice(prefix.length);
    }
  }
  return null;
}

function parseWatchOptions(argv, defaultSec = 30) {
  let enabled = false;
  let intervalSec = defaultSec;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--watch' || arg === '-w') {
      enabled = true;
      const next = argv[i + 1];
      if (next && /^\d+(?:\.\d+)?$/.test(next)) {
        intervalSec = Math.max(1, Number(next));
      }
    } else if (arg.startsWith('--watch=')) {
      enabled = true;
      const num = Number(arg.slice('--watch='.length));
      if (Number.isFinite(num) && num > 0) {
        intervalSec = Math.max(1, num);
      }
    }
  }

  const rawIter = getFlagValue(argv, '--iterations');
  const parsedIter = rawIter !== null ? Number(rawIter) : NaN;
  const maxIterations = Number.isFinite(parsedIter) && parsedIter >= 1
    ? Math.floor(parsedIter)
    : Infinity;

  return { enabled, intervalSec, maxIterations };
}

function waitAbortableMs(ms) {
  return new Promise((resolvePromise) => {
    let timer = null;
    const onStop = () => {
      if (timer) clearTimeout(timer);
      cleanup();
      resolvePromise(true);
    };
    const cleanup = () => {
      process.removeListener('SIGINT', onStop);
      process.removeListener('SIGTERM', onStop);
    };
    process.once('SIGINT', onStop);
    process.once('SIGTERM', onStop);
    timer = setTimeout(() => {
      cleanup();
      resolvePromise(false);
    }, ms);
  });
}

async function runCliReport(argv = []) {
  const useColor = !argv.includes('--no-color') && !process.env.NO_COLOR;
  const maskEmail = argv.includes('--mask');
  const showModels = argv.includes('--models') || argv.includes('-m');
  const oauthOnly = argv.includes('--oauth');
  const profileDir = getFlagValue(argv, '--profile-dir');
  const watch = parseWatchOptions(argv, 30);

  if (!watch.enabled) {
    const snap = await fetchQuotaSnapshot(true, { oauthOnly, profileDir });
    console.log(formatCliReport(snap, { useColor, maskEmail, showModels }));
    return;
  }

  let iteration = 0;
  while (iteration < watch.maxIterations) {
    iteration += 1;
    try {
      const snap = await fetchQuotaSnapshot(true, { oauthOnly, profileDir });
      if (useColor && process.stdout.isTTY && (iteration > 1 || watch.maxIterations === Infinity)) {
        process.stdout.write('\x1b[2J\x1b[H');
      } else if (iteration > 1) {
        console.log('');
      }
      console.log(
        formatCliReport(snap, {
          useColor,
          maskEmail,
          showModels,
          watchIntervalSec: watch.intervalSec,
        }),
      );
    } catch (err) {
      if (!Number.isFinite(watch.maxIterations) && iteration > 1) {
        console.error(`[agy-quota] refresh error: ${err instanceof Error ? err.message : String(err)}`);
      } else {
        throw err;
      }
    }

    if (iteration >= watch.maxIterations) break;
    const aborted = await waitAbortableMs(watch.intervalSec * 1000);
    if (aborted) break;
  }
}

// ---------------------------------------------------------------------------
// Self-Update & Online Hot-Upgrade Engine (v1.2.0)
// ---------------------------------------------------------------------------

const QUOTA_CORE_VERSION = '1.2.0';
const DEFAULT_UPDATE_REPO = 'awu5425/agy-quota';
const UPDATE_CHECK_TTL_MS = 6 * 60 * 60 * 1000;
const UPDATE_HTTP_TIMEOUT_MS = 12_000;

const RUNTIME_UPDATE_MANIFEST = Object.freeze([
  'package.json',
  'src/quota-core.cjs',
  'src/overlay-preload.cjs',
  'src/meter-overlay-ui.js',
  'sidecars/quota_panel/main.mjs',
  'sidecars/quota_panel/app.js',
  'sidecars/quota_panel/index.html',
  'sidecars/quota_panel/styles.css',
]);

const OVERLAY_RUNTIME_FILES = Object.freeze([
  'quota-core.cjs',
  'overlay-preload.cjs',
  'meter-overlay-ui.js',
]);

const SIDECAR_PLUGIN_SYNC_FILES = Object.freeze([
  'package.json',
  'src/quota-core.cjs',
  'sidecars/quota_panel/main.mjs',
  'sidecars/quota_panel/app.js',
  'sidecars/quota_panel/index.html',
  'sidecars/quota_panel/styles.css',
]);

function parseSemver(versionInput) {
  if (typeof versionInput !== 'string' && typeof versionInput !== 'number') {
    return null;
  }
  const cleaned = String(versionInput).trim().replace(/^[vV]\s*/, '');
  if (!cleaned) return null;
  const match = cleaned.match(
    /^(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/,
  );
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = match[3] !== undefined ? Number(match[3]) : 0;
  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) {
    return null;
  }
  const prerelease = match[4] ? match[4].split('.').filter(Boolean) : [];
  const normalized = `${major}.${minor}.${patch}${prerelease.length ? `-${prerelease.join('.')}` : ''}`;
  return { major, minor, patch, prerelease, normalized };
}

function normalizeVersionString(versionInput) {
  const parsed = parseSemver(versionInput);
  return parsed ? parsed.normalized : '';
}

function compareSemver(verA, verB) {
  const a = parseSemver(verA);
  const b = parseSemver(verB);
  if (!a || !b) return 0;
  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;

  const aPre = a.prerelease;
  const bPre = b.prerelease;
  if (aPre.length === 0 && bPre.length === 0) return 0;
  if (aPre.length === 0) return 1;
  if (bPre.length === 0) return -1;

  const maxLen = Math.max(aPre.length, bPre.length);
  for (let i = 0; i < maxLen; i += 1) {
    if (i >= aPre.length) return -1;
    if (i >= bPre.length) return 1;
    const idA = aPre[i];
    const idB = bPre[i];
    if (idA === idB) continue;
    const numA = /^\d+$/.test(idA) ? Number(idA) : null;
    const numB = /^\d+$/.test(idB) ? Number(idB) : null;
    if (numA !== null && numB !== null) {
      return numA > numB ? 1 : -1;
    }
    if (numA !== null) return -1;
    if (numB !== null) return 1;
    return idA > idB ? 1 : -1;
  }
  return 0;
}

function resolveContextMeterStateDir() {
  if (process.env.AGY_CONTEXT_METER_STATE_DIR) {
    return resolve(process.env.AGY_CONTEXT_METER_STATE_DIR);
  }
  const home = homedir();
  if (platform() === 'win32') {
    const localApp = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    return join(localApp, 'AntigravityContextMeter');
  }
  if (platform() === 'darwin') {
    return join(home, 'Library', 'Application Support', 'AntigravityContextMeter');
  }
  const xdgConfig = process.env.XDG_CONFIG_HOME || join(home, '.config');
  const primary = join(xdgConfig, 'AntigravityContextMeter');
  if (existsSync(primary)) return primary;
  const altShare = join(home, '.local', 'share', 'AntigravityContextMeter');
  if (existsSync(altShare)) return altShare;
  return primary;
}

function resolveCurrentVersion(opts = {}) {
  if (opts && typeof opts.currentVersion === 'string') {
    const explicit = normalizeVersionString(opts.currentVersion);
    if (explicit) return explicit;
  }

  const installedCandidates = [
    join(__dirname, 'installed-version.json'),
    join(__dirname, '..', 'installed-version.json'),
  ];
  for (const candidate of installedCandidates) {
    const meta = readJsonSafe(candidate);
    const v = normalizeVersionString(meta?.version);
    if (v) return v;
  }

  const pkgMeta = readJsonSafe(join(__dirname, '..', 'package.json'));
  const pkgVer = normalizeVersionString(pkgMeta?.version);
  if (pkgVer && compareSemver(pkgVer, QUOTA_CORE_VERSION) >= 0) {
    return pkgVer;
  }

  return QUOTA_CORE_VERSION;
}

function getSettingsPath(opts = {}) {
  if (opts && typeof opts.settingsPath === 'string' && opts.settingsPath.trim()) {
    return resolve(opts.settingsPath);
  }
  return join(resolveSharedDataDir(), 'settings.json');
}

function normalizeUpdatePrefsObject(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    autoUpdate: src.autoUpdate !== undefined ? Boolean(src.autoUpdate) : true,
    lastCheckedAt:
      typeof src.lastCheckedAt === 'number' && Number.isFinite(src.lastCheckedAt) && src.lastCheckedAt >= 0
        ? Math.floor(src.lastCheckedAt)
        : 0,
    skippedVersion: typeof src.skippedVersion === 'string' ? src.skippedVersion.trim() : '',
    channel: typeof src.channel === 'string' && src.channel.trim() ? src.channel.trim() : 'stable',
  };
}

function getUpdatePrefs(opts = {}) {
  const raw = readJsonSafe(getSettingsPath(opts));
  return normalizeUpdatePrefsObject(raw || {});
}

function setUpdatePrefs(patch = {}, opts = {}) {
  const settingsPath = getSettingsPath(opts);
  const existing = readJsonSafe(settingsPath);
  const base = existing && typeof existing === 'object' && !Array.isArray(existing) ? { ...existing } : {};
  const current = normalizeUpdatePrefsObject(base);
  const input = patch && typeof patch === 'object' ? patch : {};

  const nextPrefs = {
    autoUpdate: input.autoUpdate !== undefined ? Boolean(input.autoUpdate) : current.autoUpdate,
    lastCheckedAt:
      input.lastCheckedAt !== undefined
        ? Math.max(0, Math.floor(Number(input.lastCheckedAt) || 0))
        : current.lastCheckedAt,
    skippedVersion:
      input.skippedVersion !== undefined ? String(input.skippedVersion || '').trim() : current.skippedVersion,
    channel:
      input.channel !== undefined && String(input.channel || '').trim()
        ? String(input.channel).trim()
        : current.channel,
  };

  writeSecureJson(settingsPath, { ...base, ...nextPrefs }, true);
  return nextPrefs;
}

function buildCachedCheckResponse(cached, currentVersion, prefs) {
  if (!cached || typeof cached !== 'object') return null;
  const latestVersion = normalizeVersionString(cached.latestVersion);
  if (!latestVersion) return null;
  const hasUpdate = compareSemver(latestVersion, currentVersion) > 0;
  return {
    ok: true,
    currentVersion,
    latestVersion,
    hasUpdate,
    targetRef: cached.targetRef || 'main',
    source: cached.source || 'cache',
    releaseUrl: cached.releaseUrl || '',
    publishedAt: cached.publishedAt ?? null,
    notes: typeof cached.notes === 'string' ? cached.notes : '',
    checkedAt: Number(cached.checkedAt) || prefs.lastCheckedAt || 0,
    cached: true,
    skippedVersion: prefs.skippedVersion || '',
  };
}

function getUpdateStatus(opts = {}) {
  const currentVersion = resolveCurrentVersion(opts);
  const raw = readJsonSafe(getSettingsPath(opts)) || {};
  const prefs = normalizeUpdatePrefsObject(raw);
  const lastCheck = buildCachedCheckResponse(raw.cachedUpdateResult, currentVersion, prefs);
  return {
    ok: true,
    currentVersion,
    version: currentVersion,
    prefs,
    autoUpdate: prefs.autoUpdate,
    lastCheck,
    cachedCheck: lastCheck,
    latestVersion: lastCheck ? lastCheck.latestVersion : null,
    hasUpdate: lastCheck ? Boolean(lastCheck.hasUpdate) : false,
  };
}

function isLoopbackHostname(hostname) {
  const h = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

function matchesProxyBypass(hostname, port, bypassRaw) {
  if (!bypassRaw || typeof bypassRaw !== 'string') return false;
  const host = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return false;

  const entries = bypassRaw
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  for (const rule of entries) {
    if (rule === '*') return true;
    if (rule === '<local>' && !host.includes('.')) return true;
    if (rule.includes('/')) {
      if (rule === '127.0.0.0/8' && host.startsWith('127.')) return true;
      continue;
    }
    let ruleHost = rule;
    let rulePort = null;
    const colonIdx = rule.lastIndexOf(':');
    if (colonIdx > 0 && /^\d+$/.test(rule.slice(colonIdx + 1))) {
      ruleHost = rule.slice(0, colonIdx);
      rulePort = Number(rule.slice(colonIdx + 1));
    }
    if (rulePort !== null && Number(port) && rulePort !== Number(port)) {
      continue;
    }
    if (ruleHost.startsWith('.')) {
      const suffix = ruleHost.slice(1);
      if (host === suffix || host.endsWith(ruleHost)) return true;
    } else if (host === ruleHost || host.endsWith(`.${ruleHost}`)) {
      return true;
    }
  }
  return false;
}

function normalizeHttpProxyUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (!parsed.hostname) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function resolveUpdateProxy(targetUrlStr, opts = {}) {
  if (opts && (opts.proxyUrl === false || opts.proxyUrl === 'none' || opts.proxyUrl === '')) {
    return null;
  }
  if (opts && typeof opts.proxyUrl === 'string' && opts.proxyUrl.trim()) {
    return normalizeHttpProxyUrl(opts.proxyUrl);
  }

  let targetUrl;
  try {
    targetUrl = new URL(targetUrlStr);
  } catch {
    return null;
  }
  if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
    return null;
  }

  const targetPort = Number(targetUrl.port) || (targetUrl.protocol === 'https:' ? 443 : 80);
  if (isLoopbackHostname(targetUrl.hostname)) {
    return null;
  }

  const noProxyEnv = process.env.NO_PROXY || process.env.no_proxy || '';
  if (!matchesProxyBypass(targetUrl.hostname, targetPort, noProxyEnv)) {
    const envCandidates =
      targetUrl.protocol === 'https:'
        ? [
            process.env.HTTPS_PROXY,
            process.env.https_proxy,
            process.env.ALL_PROXY,
            process.env.all_proxy,
            process.env.HTTP_PROXY,
            process.env.http_proxy,
          ]
        : [
            process.env.HTTP_PROXY,
            process.env.http_proxy,
            process.env.ALL_PROXY,
            process.env.all_proxy,
          ];
    for (const cand of envCandidates) {
      const normalized = normalizeHttpProxyUrl(cand);
      if (normalized) return normalized;
    }
  }

  const modulesPath =
    opts && typeof opts.modulesJsonPath === 'string' && opts.modulesJsonPath.trim()
      ? resolve(opts.modulesJsonPath)
      : join(resolveContextMeterStateDir(), 'modules.json');
  const modulesData = readJsonSafe(modulesPath);
  const proxyModule = modulesData?.modules?.proxy || modulesData?.proxy || null;
  if (proxyModule && proxyModule.enabled === true && typeof proxyModule.proxyUrl === 'string') {
    const bypassList = typeof proxyModule.bypassList === 'string' ? proxyModule.bypassList : '';
    if (!matchesProxyBypass(targetUrl.hostname, targetPort, bypassList)) {
      const normalized = normalizeHttpProxyUrl(proxyModule.proxyUrl);
      if (normalized) return normalized;
    }
  }

  return null;
}

function buildProxyAuthHeader(proxyUrlObj) {
  if (!proxyUrlObj.username && !proxyUrlObj.password) return null;
  const raw = `${decodeURIComponent(proxyUrlObj.username || '')}:${decodeURIComponent(proxyUrlObj.password || '')}`;
  return `Basic ${Buffer.from(raw, 'utf8').toString('base64')}`;
}

function openHttpConnectTunnel(proxyUrlObj, targetHost, targetPort, timeoutMs) {
  return new Promise((resolveTunnel, rejectTunnel) => {
    const proxyPort = Number(proxyUrlObj.port) || (proxyUrlObj.protocol === 'https:' ? 443 : 80);
    const socket =
      proxyUrlObj.protocol === 'https:'
        ? tls.connect({ host: proxyUrlObj.hostname, port: proxyPort, servername: proxyUrlObj.hostname })
        : net.connect({ host: proxyUrlObj.hostname, port: proxyPort });

    let settled = false;
    let headerBuf = Buffer.alloc(0);

    const finishErr = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      rejectTunnel(err);
    };

    const timer = setTimeout(() => {
      finishErr(new Error(`Proxy CONNECT timeout (${timeoutMs}ms)`));
    }, timeoutMs);

    const authHeader = buildProxyAuthHeader(proxyUrlObj);
    const connectLines = [
      `CONNECT ${targetHost}:${targetPort} HTTP/1.1`,
      `Host: ${targetHost}:${targetPort}`,
      'Proxy-Connection: Keep-Alive',
    ];
    if (authHeader) {
      connectLines.push(`Proxy-Authorization: ${authHeader}`);
    }
    const connectPayload = `${connectLines.join('\r\n')}\r\n\r\n`;

    const onData = (chunk) => {
      headerBuf = headerBuf.length ? Buffer.concat([headerBuf, chunk]) : chunk;
      const sepIdx = headerBuf.indexOf('\r\n\r\n');
      if (sepIdx < 0) {
        if (headerBuf.length > 65536) {
          finishErr(new Error('Proxy CONNECT response header too large'));
        }
        return;
      }

      socket.removeListener('data', onData);
      socket.removeListener('error', finishErr);
      clearTimeout(timer);

      const headerText = headerBuf.subarray(0, sepIdx).toString('latin1');
      const remainder = headerBuf.subarray(sepIdx + 4);
      const statusLine = headerText.split('\r\n')[0] || '';
      const statusMatch = statusLine.match(/^HTTP\/1\.[01]\s+(\d{3})/i);
      const statusCode = statusMatch ? Number(statusMatch[1]) : 0;

      if (statusCode !== 200) {
        settled = true;
        socket.destroy();
        rejectTunnel(new Error(`Proxy CONNECT failed with HTTP ${statusCode || 'unknown'}`));
        return;
      }

      if (remainder.length > 0) {
        socket.unshift(remainder);
      }
      settled = true;
      resolveTunnel(socket);
    };

    socket.on('error', finishErr);
    socket.on('data', onData);
    const sendConnect = () => {
      if (!settled) socket.write(connectPayload);
    };
    if (proxyUrlObj.protocol === 'https:') {
      socket.once('secureConnect', sendConnect);
    } else {
      socket.once('connect', sendConnect);
    }
  });
}

function executeSingleHttpGet(targetUrlObj, headers, proxyUrlStr, timeoutMs) {
  return new Promise((resolveRes, rejectRes) => {
    const isTargetHttps = targetUrlObj.protocol === 'https:';
    const targetPort = Number(targetUrlObj.port) || (isTargetHttps ? 443 : 80);
    const targetPath = `${targetUrlObj.pathname}${targetUrlObj.search}`;

    const collectResponse = (res) => {
      const chunks = [];
      let totalBytes = 0;
      res.on('data', (chunk) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += buf.length;
        if (totalBytes > 16 * 1024 * 1024) {
          res.destroy(new Error('Update response exceeded 16MB limit'));
          return;
        }
        chunks.push(buf);
      });
      res.on('error', rejectRes);
      res.on('end', () => {
        resolveRes({
          statusCode: res.statusCode || 0,
          headers: res.headers || {},
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    };

    if (!proxyUrlStr) {
      const client = isTargetHttps ? https : http;
      const req = client.request(
        {
          hostname: targetUrlObj.hostname,
          port: targetPort,
          path: targetPath,
          method: 'GET',
          headers,
          timeout: timeoutMs,
        },
        collectResponse,
      );
      req.on('error', rejectRes);
      req.on('timeout', () => req.destroy(new Error(`Request timeout (${timeoutMs}ms)`)));
      req.end();
      return;
    }

    const proxyUrlObj = new URL(proxyUrlStr);
    const proxyPort = Number(proxyUrlObj.port) || (proxyUrlObj.protocol === 'https:' ? 443 : 80);
    const proxyAuth = buildProxyAuthHeader(proxyUrlObj);

    if (!isTargetHttps) {
      const client = proxyUrlObj.protocol === 'https:' ? https : http;
      const reqHeaders = {
        ...headers,
        Host: targetUrlObj.host,
        ...(proxyAuth ? { 'Proxy-Authorization': proxyAuth } : {}),
      };
      const req = client.request(
        {
          hostname: proxyUrlObj.hostname,
          port: proxyPort,
          path: targetUrlObj.href,
          method: 'GET',
          headers: reqHeaders,
          timeout: timeoutMs,
        },
        collectResponse,
      );
      req.on('error', rejectRes);
      req.on('timeout', () => req.destroy(new Error(`Proxied HTTP timeout (${timeoutMs}ms)`)));
      req.end();
      return;
    }

    openHttpConnectTunnel(proxyUrlObj, targetUrlObj.hostname, targetPort, timeoutMs)
      .then((tunnelSocket) => {
        const tlsSocket = tls.connect({
          socket: tunnelSocket,
          servername: targetUrlObj.hostname,
        });
        const req = https.request(
          {
            hostname: targetUrlObj.hostname,
            port: targetPort,
            path: targetPath,
            method: 'GET',
            headers,
            agent: false,
            createConnection: () => tlsSocket,
            timeout: timeoutMs,
          },
          collectResponse,
        );
        req.on('error', (err) => {
          tlsSocket.destroy();
          rejectRes(err);
        });
        req.on('timeout', () => {
          tlsSocket.destroy();
          req.destroy(new Error(`Proxied HTTPS timeout (${timeoutMs}ms)`));
        });
        req.end();
      })
      .catch(rejectRes);
  });
}

async function requestUrlText(targetUrlStr, opts = {}) {
  if (typeof opts.fetchText === 'function') {
    return opts.fetchText(targetUrlStr, opts);
  }

  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : UPDATE_HTTP_TIMEOUT_MS;
  let currentUrl = String(targetUrlStr || '').trim();

  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    if (/^file:\/\//i.test(currentUrl)) {
      const localPath = fileURLToPath(currentUrl);
      if (!existsSync(localPath)) {
        return { statusCode: 404, headers: {}, body: '' };
      }
      return { statusCode: 200, headers: {}, body: readFileSync(localPath, 'utf8') };
    }

    const parsed = new URL(currentUrl);
    const headers = {
      'User-Agent': `agy-quota/${QUOTA_CORE_VERSION}`,
      Accept: opts.accept || '*/*',
      ...(opts.headers || {}),
    };
    const proxyUrl = resolveUpdateProxy(currentUrl, opts);

    let res;
    try {
      res = await executeSingleHttpGet(parsed, headers, proxyUrl, timeoutMs);
    } catch (err) {
      if (proxyUrl && !opts.strictProxy) {
        res = await executeSingleHttpGet(parsed, headers, null, timeoutMs);
      } else {
        throw err;
      }
    }

    if (
      [301, 302, 303, 307, 308].includes(res.statusCode) &&
      typeof res.headers?.location === 'string' &&
      res.headers.location.trim()
    ) {
      currentUrl = new URL(res.headers.location.trim(), currentUrl).href;
      continue;
    }

    return res;
  }

  throw new Error(`Too many redirects fetching ${targetUrlStr}`);
}

function isLikelyLocalPath(specStr) {
  if (!specStr) return false;
  if (/^file:\/\//i.test(specStr)) return true;
  if (/^[a-zA-Z]:[\\/]/.test(specStr)) return true;
  if (specStr.startsWith('./') || specStr.startsWith('../') || specStr.startsWith('.\\') || specStr.startsWith('..\\')) {
    return true;
  }
  if (specStr.startsWith('/') || specStr.startsWith('\\\\')) return true;
  return existsSync(specStr);
}

function parseUpdateSourceSpec(opts = {}) {
  const explicitDir = opts.sourceDir || opts.mockDir || '';
  if (explicitDir) {
    const dir = /^file:\/\//i.test(explicitDir) ? fileURLToPath(explicitDir) : resolve(String(explicitDir));
    return {
      mode: 'local-dir',
      localDir: dir,
      repoSlug: DEFAULT_UPDATE_REPO,
      apiBaseUrl: '',
      rawBaseUrl: '',
      cacheKey: `dir:${dir}`,
    };
  }

  const rawRepo = String(opts.repo || process.env.AGY_QUOTA_UPDATE_REPO || DEFAULT_UPDATE_REPO).trim();
  const baseOverride = String(opts.baseUrl || process.env.AGY_QUOTA_UPDATE_BASE_URL || '')
    .trim()
    .replace(/\/+$/, '');
  const apiOverride = String(opts.apiBaseUrl || baseOverride || '').trim().replace(/\/+$/, '');
  const rawOverride = String(opts.rawBaseUrl || baseOverride || '').trim().replace(/\/+$/, '');

  if (isLikelyLocalPath(rawRepo)) {
    const dir = /^file:\/\//i.test(rawRepo) ? fileURLToPath(rawRepo) : resolve(rawRepo);
    return {
      mode: 'local-dir',
      localDir: dir,
      repoSlug: DEFAULT_UPDATE_REPO,
      apiBaseUrl: '',
      rawBaseUrl: '',
      cacheKey: `dir:${dir}`,
    };
  }

  if (/^https?:\/\//i.test(rawRepo)) {
    const parsed = new URL(rawRepo);
    const cleanPath = parsed.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
    if (parsed.hostname.toLowerCase() === 'github.com' && cleanPath.split('/').length >= 2) {
      const repoSlug = cleanPath.split('/').slice(0, 2).join('/');
      return {
        mode: apiOverride || rawOverride ? 'custom-http' : 'github',
        localDir: '',
        repoSlug,
        apiBaseUrl: apiOverride || 'https://api.github.com',
        rawBaseUrl: rawOverride || 'https://raw.githubusercontent.com',
        cacheKey: `${apiOverride || 'github'}:${repoSlug}`,
      };
    }

    const originBase = `${parsed.protocol}//${parsed.host}`;
    const slug = cleanPath.split('/').filter(Boolean).length >= 2
      ? cleanPath.split('/').filter(Boolean).slice(0, 2).join('/')
      : DEFAULT_UPDATE_REPO;
    const prefixBase = cleanPath && cleanPath !== slug ? `${originBase}/${cleanPath}` : originBase;
    return {
      mode: 'custom-http',
      localDir: '',
      repoSlug: slug,
      apiBaseUrl: apiOverride || prefixBase,
      rawBaseUrl: rawOverride || prefixBase,
      cacheKey: `http:${apiOverride || prefixBase}:${slug}`,
    };
  }

  const repoSlug = rawRepo.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '') || DEFAULT_UPDATE_REPO;
  return {
    mode: apiOverride || rawOverride ? 'custom-http' : 'github',
    localDir: '',
    repoSlug,
    apiBaseUrl: apiOverride || 'https://api.github.com',
    rawBaseUrl: rawOverride || 'https://raw.githubusercontent.com',
    cacheKey: `${apiOverride || 'github'}:${repoSlug}`,
  };
}

function parseReleaseMetadata(releaseJson, repoSlug) {
  if (!releaseJson || typeof releaseJson !== 'object' || releaseJson.draft === true) {
    return null;
  }
  const rawTag = String(releaseJson.tag_name || releaseJson.version || releaseJson.name || '').trim();
  const latestVersion = normalizeVersionString(rawTag);
  if (!latestVersion) return null;
  const targetRef = String(releaseJson.tag_name || `v${latestVersion}`).trim();
  return {
    latestVersion,
    targetRef,
    source: 'github-release',
    releaseUrl:
      typeof releaseJson.html_url === 'string' && releaseJson.html_url.trim()
        ? releaseJson.html_url.trim()
        : `https://github.com/${repoSlug}/releases/tag/${encodeURIComponent(targetRef)}`,
    publishedAt: releaseJson.published_at || releaseJson.created_at || null,
    notes: typeof releaseJson.body === 'string' ? releaseJson.body : '',
  };
}

function parseRawPackageMetadata(pkgJson, repoSlug, sourceName = 'github-raw') {
  if (!pkgJson || typeof pkgJson !== 'object') return null;
  const latestVersion = normalizeVersionString(pkgJson.version);
  if (!latestVersion) return null;
  return {
    latestVersion,
    targetRef: 'main',
    source: sourceName,
    releaseUrl:
      typeof pkgJson.homepage === 'string' && pkgJson.homepage.trim()
        ? pkgJson.homepage.trim()
        : `https://github.com/${repoSlug}`,
    publishedAt: null,
    notes: typeof pkgJson.description === 'string' ? pkgJson.description : '',
  };
}

async function queryRemoteVersionMetadata(spec, opts = {}) {
  if (spec.mode === 'local-dir') {
    const releaseCandidates = [
      join(spec.localDir, 'releases', 'latest.json'),
      join(spec.localDir, 'release.json'),
    ];
    for (const relPath of releaseCandidates) {
      const relJson = readJsonSafe(relPath);
      const parsed = parseReleaseMetadata(relJson, spec.repoSlug);
      if (parsed) {
        return { ...parsed, source: 'local-release' };
      }
    }
    const pkgJson =
      readJsonSafe(join(spec.localDir, 'package.json')) ||
      readJsonSafe(join(spec.localDir, 'main', 'package.json'));
    const parsedPkg = parseRawPackageMetadata(pkgJson, spec.repoSlug, 'local-raw');
    if (parsedPkg) return parsedPkg;
    throw new Error(`No valid release metadata or package.json found in ${spec.localDir}`);
  }

  const releaseUrls = [`${spec.apiBaseUrl}/repos/${spec.repoSlug}/releases/latest`];
  if (spec.mode === 'custom-http') {
    releaseUrls.push(`${spec.apiBaseUrl}/releases/latest`);
  }

  let firstError = null;
  for (const relUrl of releaseUrls) {
    try {
      const res = await requestUrlText(relUrl, {
        ...opts,
        accept: 'application/vnd.github+json',
      });
      if (res.statusCode === 200 && res.body.trim()) {
        const json = JSON.parse(res.body);
        const parsed = parseReleaseMetadata(json, spec.repoSlug);
        if (parsed) return parsed;
      }
    } catch (err) {
      if (!firstError) firstError = err;
    }
  }

  const rawUrls = [`${spec.rawBaseUrl}/${spec.repoSlug}/main/package.json`];
  if (spec.mode === 'custom-http') {
    rawUrls.push(`${spec.rawBaseUrl}/main/package.json`, `${spec.rawBaseUrl}/package.json`);
  }

  for (const rawUrl of rawUrls) {
    try {
      const res = await requestUrlText(rawUrl, {
        ...opts,
        accept: 'application/json',
      });
      if (res.statusCode === 200 && res.body.trim()) {
        const json = JSON.parse(res.body);
        const parsed = parseRawPackageMetadata(json, spec.repoSlug, 'github-raw');
        if (parsed) return parsed;
      } else if (!firstError && res.statusCode > 0) {
        firstError = new Error(`HTTP ${res.statusCode} querying ${rawUrl}`);
      }
    } catch (err) {
      if (!firstError) firstError = err;
    }
  }

  throw firstError || new Error(`Unable to determine remote version for ${spec.repoSlug}`);
}

async function checkSelfUpdate(opts = {}) {
  const options = opts && typeof opts === 'object' ? opts : {};
  const force = Boolean(options.force);
  const currentVersion = resolveCurrentVersion(options);
  const spec = parseUpdateSourceSpec(options);
  const settingsPath = getSettingsPath(options);
  const rawSettings = readJsonSafe(settingsPath) || {};
  const prefs = normalizeUpdatePrefsObject(rawSettings);
  const now = Date.now();

  if (
    !force &&
    prefs.lastCheckedAt > 0 &&
    now - prefs.lastCheckedAt < UPDATE_CHECK_TTL_MS &&
    rawSettings.cachedUpdateResult &&
    rawSettings.cachedUpdateResult.sourceKey === spec.cacheKey
  ) {
    const cachedHit = buildCachedCheckResponse(rawSettings.cachedUpdateResult, currentVersion, prefs);
    if (cachedHit) {
      return cachedHit;
    }
  }

  try {
    const remote = await queryRemoteVersionMetadata(spec, options);
    const checkedAt = Date.now();
    const hasUpdate = compareSemver(remote.latestVersion, currentVersion) > 0;

    if (!options.noPersist) {
      const latestDisk = readJsonSafe(settingsPath);
      const base = latestDisk && typeof latestDisk === 'object' && !Array.isArray(latestDisk)
        ? { ...latestDisk }
        : {};
      const mergedPrefs = normalizeUpdatePrefsObject(base);
      mergedPrefs.lastCheckedAt = checkedAt;
      writeSecureJson(
        settingsPath,
        {
          ...base,
          ...mergedPrefs,
          cachedUpdateResult: {
            sourceKey: spec.cacheKey,
            latestVersion: remote.latestVersion,
            targetRef: remote.targetRef,
            source: remote.source,
            releaseUrl: remote.releaseUrl,
            publishedAt: remote.publishedAt,
            notes: remote.notes,
            checkedAt,
          },
        },
        true,
      );
    }

    return {
      ok: true,
      currentVersion,
      latestVersion: remote.latestVersion,
      hasUpdate,
      targetRef: remote.targetRef,
      source: remote.source,
      releaseUrl: remote.releaseUrl,
      publishedAt: remote.publishedAt,
      notes: remote.notes,
      checkedAt,
      cached: false,
      skippedVersion: prefs.skippedVersion || '',
    };
  } catch (err) {
    return {
      ok: false,
      currentVersion,
      latestVersion: null,
      hasUpdate: false,
      targetRef: null,
      source: 'none',
      releaseUrl: `https://github.com/${spec.repoSlug}`,
      publishedAt: null,
      notes: '',
      checkedAt: Date.now(),
      cached: false,
      skippedVersion: prefs.skippedVersion || '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function transpileEsmToSyntaxCheckScript(esmSource) {
  let code = String(esmSource || '').replace(/^#![^\r\n]*/, '');
  code = code.replace(
    /^\s*import\s+[\s\S]*?\s+from\s+(['"][^'"]+['"])\s*;?/gm,
    'void ($1);',
  );
  code = code.replace(/^\s*import\s+(['"][^'"]+['"])\s*;?/gm, 'void ($1);');
  code = code.replace(/^\s*export\s+default\s+/gm, 'const __agyDefaultExport = ');
  code = code.replace(/^\s*export\s+\{[^}]*\}\s*(?:from\s+['"][^'"]+['"])?\s*;?/gm, '');
  code = code.replace(/^\s*export\s+(?=(?:async\s+)?function\b|class\b|const\b|let\b|var\b)/gm, '');
  code = code.replace(/\bimport\.meta\b/g, '({ url: "file:///check.mjs" })');
  code = code.replace(/\bimport\s*\(/g, '__agyDynImport(');
  return `(async function __agyEsmSyntaxCheck(__agyDynImport) {\n${code}\n});`;
}

function validateJavaScriptSyntax(stagedFilePath, sourceCode, displayRelPath) {
  if (typeof sourceCode !== 'string' || !sourceCode.trim()) {
    throw new Error(`Staged script is empty: ${displayRelPath}`);
  }
  const ext = extname(stagedFilePath).toLowerCase();

  if (ext === '.js' || ext === '.cjs') {
    new vm.Script(sourceCode, { filename: displayRelPath });
    return;
  }

  if (ext === '.mjs') {
    try {
      execFileSync(process.execPath, ['--check', stagedFilePath], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: 'pipe',
        timeout: 8_000,
        windowsHide: true,
      });
      return;
    } catch (err) {
      const spawnCode = err && err.code;
      if (spawnCode === 'ENOENT' || spawnCode === 'EPERM' || spawnCode === 'EACCES') {
        const wrapped = transpileEsmToSyntaxCheckScript(sourceCode);
        new vm.Script(wrapped, { filename: displayRelPath });
        return;
      }
      const stderr = err && err.stderr ? Buffer.from(err.stderr).toString('utf8').trim() : '';
      const detail = stderr ? stderr.split(/\r?\n/).slice(0, 4).join(' | ') : (err.message || String(err));
      throw new Error(`ESM syntax check failed for ${displayRelPath}: ${detail}`);
    }
  }
}

async function fetchManifestFileContent(spec, targetRef, relPath, opts = {}) {
  const safeSegments = relPath.split('/');
  if (spec.mode === 'local-dir') {
    const candidates = [
      join(spec.localDir, targetRef, ...safeSegments),
      join(spec.localDir, ...safeSegments),
    ];
    for (const fullPath of candidates) {
      if (existsSync(fullPath) && statSync(fullPath).isFile()) {
        return readFileSync(fullPath, 'utf8');
      }
    }
    throw new Error(`Missing runtime file "${relPath}" in local update source ${spec.localDir}`);
  }

  const encodedRef = encodeURIComponent(targetRef);
  const candidateUrls = [`${spec.rawBaseUrl}/${spec.repoSlug}/${encodedRef}/${relPath}`];
  if (spec.mode === 'custom-http') {
    candidateUrls.push(
      `${spec.rawBaseUrl}/${encodedRef}/${relPath}`,
      `${spec.rawBaseUrl}/${relPath}`,
    );
  }

  let lastStatus = 0;
  let lastErr = null;
  for (const url of candidateUrls) {
    try {
      const res = await requestUrlText(url, opts);
      lastStatus = res.statusCode;
      if (res.statusCode === 200 && typeof res.body === 'string' && res.body.length > 0) {
        return res.body;
      }
    } catch (err) {
      lastErr = err;
    }
  }

  if (lastErr) {
    throw new Error(`Failed downloading "${relPath}": ${lastErr.message || String(lastErr)}`);
  }
  throw new Error(`Failed downloading "${relPath}" (HTTP ${lastStatus || 404})`);
}

function atomicWriteFileSync(destPath, content) {
  const dir = dirname(destPath);
  mkdirSync(dir, { recursive: true });
  const tmpPath = `${destPath}.tmp-${process.pid}-${Date.now()}-${randomBytes(3).toString('hex')}`;
  writeFileSync(tmpPath, content, 'utf8');
  try {
    renameSync(tmpPath, destPath);
  } catch (err) {
    const code = err && err.code;
    if (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES' || code === 'EXDEV') {
      try {
        copyFileSync(tmpPath, destPath);
      } finally {
        rmSync(tmpPath, { force: true });
      }
    } else {
      rmSync(tmpPath, { force: true });
      throw err;
    }
  }
}

function isProtectedDevWorkspace(dirPath) {
  if (!dirPath) return true;
  const resolved = resolve(dirPath);
  if (existsSync(join(resolved, '.git'))) {
    return true;
  }
  const ownRepoRoot = resolve(__dirname, '..');
  if (resolved.toLowerCase() === ownRepoRoot.toLowerCase() && existsSync(join(ownRepoRoot, '.git'))) {
    return true;
  }
  return false;
}

function resolveRuntimeUpdateTargets(opts = {}) {
  const overlayDirs = [];
  if (opts.overlayDir) {
    overlayDirs.push(resolve(String(opts.overlayDir)));
  } else {
    const cmOverlay = join(resolveContextMeterStateDir(), 'agy-quota-overlay');
    const sharedOverlay = join(resolveSharedDataDir(), 'agy-quota-overlay');
    overlayDirs.push(cmOverlay);
    if (resolve(sharedOverlay).toLowerCase() !== resolve(cmOverlay).toLowerCase()) {
      overlayDirs.push(sharedOverlay);
    }
  }

  const pluginDir = opts.pluginDir
    ? resolve(String(opts.pluginDir))
    : join(homedir(), '.gemini', 'config', 'plugins', 'agy-quota');

  return { overlayDirs, pluginDir };
}

async function applySelfUpdate(opts = {}) {
  const options = opts && typeof opts === 'object' ? opts : {};
  const dryRun = Boolean(options.dryRun);
  const previousVersion = resolveCurrentVersion(options);
  const spec = parseUpdateSourceSpec(options);

  let resolvedRef = typeof options.targetRef === 'string' && options.targetRef.trim()
    ? options.targetRef.trim()
    : '';

  if (!resolvedRef) {
    const checkRes = await checkSelfUpdate({
      ...options,
      force: options.force !== undefined ? Boolean(options.force) : true,
      noPersist: dryRun || Boolean(options.noPersist),
    });
    resolvedRef = checkRes.ok && checkRes.targetRef ? checkRes.targetRef : 'main';
  }

  const stagingDir = join(
    tmpdir(),
    `agy-quota-stage-${process.pid}-${Date.now()}-${randomBytes(4).toString('hex')}`,
  );
  mkdirSync(stagingDir, { recursive: true });

  try {
    const stagedContents = new Map();

    for (const relPath of RUNTIME_UPDATE_MANIFEST) {
      const content = await fetchManifestFileContent(spec, resolvedRef, relPath, options);
      if (!content || !content.trim()) {
        throw new Error(`Downloaded empty file for "${relPath}"`);
      }
      const stagedPath = join(stagingDir, ...relPath.split('/'));
      mkdirSync(dirname(stagedPath), { recursive: true });
      writeFileSync(stagedPath, content, 'utf8');
      stagedContents.set(relPath, { stagedPath, content });
    }

    let stagedPkg;
    try {
      stagedPkg = JSON.parse(stagedContents.get('package.json').content);
    } catch (err) {
      throw new Error(`Invalid package.json in staged update: ${err.message || String(err)}`);
    }
    const updatedVersion = normalizeVersionString(stagedPkg?.version);
    if (!updatedVersion) {
      throw new Error('Staged package.json is missing a valid semver version');
    }

    for (const relPath of RUNTIME_UPDATE_MANIFEST) {
      const ext = extname(relPath).toLowerCase();
      if (ext === '.js' || ext === '.cjs' || ext === '.mjs') {
        const entry = stagedContents.get(relPath);
        validateJavaScriptSyntax(entry.stagedPath, entry.content, relPath);
      }
    }

    const overlayUiCode = stagedContents.get('src/meter-overlay-ui.js').content;
    const { overlayDirs, pluginDir } = resolveRuntimeUpdateTargets(options);

    const activeOverlayDirs = overlayDirs.filter(
      (dir) => existsSync(dir) && !isProtectedDevWorkspace(dir),
    );
    const activePluginDir =
      existsSync(pluginDir) && !isProtectedDevWorkspace(pluginDir) ? pluginDir : null;

    const wouldUpdateTargets = [
      ...activeOverlayDirs,
      ...(activePluginDir ? [activePluginDir] : []),
    ];

    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        previousVersion,
        updatedVersion,
        targetRef: resolvedRef,
        updatedTargets: [],
        wouldUpdateTargets,
        validatedFiles: [...RUNTIME_UPDATE_MANIFEST],
        overlayUiCode,
      };
    }

    const versionRecord = JSON.stringify(
      {
        version: updatedVersion,
        previousVersion,
        targetRef: resolvedRef,
        repo: spec.repoSlug,
        updatedAt: new Date().toISOString(),
        updatedAtMs: Date.now(),
      },
      null,
      2,
    );

    const updatedTargets = [];

    for (const overlayDir of activeOverlayDirs) {
      for (const fileName of OVERLAY_RUNTIME_FILES) {
        const stagedEntry = stagedContents.get(`src/${fileName}`);
        atomicWriteFileSync(join(overlayDir, fileName), stagedEntry.content);
      }
      atomicWriteFileSync(join(overlayDir, 'installed-version.json'), versionRecord);
      updatedTargets.push(overlayDir);
    }

    if (activePluginDir) {
      for (const relPath of SIDECAR_PLUGIN_SYNC_FILES) {
        const stagedEntry = stagedContents.get(relPath);
        const destPath = join(activePluginDir, ...relPath.split('/'));
        atomicWriteFileSync(destPath, stagedEntry.content);
      }
      const pluginManifestPath = join(activePluginDir, 'plugin.json');
      const pluginManifest = readJsonSafe(pluginManifestPath);
      if (pluginManifest && typeof pluginManifest === 'object') {
        pluginManifest.version = updatedVersion;
        atomicWriteFileSync(pluginManifestPath, `${JSON.stringify(pluginManifest, null, 2)}\n`);
      }
      atomicWriteFileSync(join(activePluginDir, 'installed-version.json'), versionRecord);
      updatedTargets.push(activePluginDir);
    }

    if (!options.noPersist) {
      const settingsPath = getSettingsPath(options);
      const existing = readJsonSafe(settingsPath) || {};
      const prefs = normalizeUpdatePrefsObject(existing);
      const now = Date.now();
      prefs.lastCheckedAt = now;
      writeSecureJson(
        settingsPath,
        {
          ...(existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}),
          ...prefs,
          lastUpdatedVersion: updatedVersion,
          lastUpdatedAt: now,
        },
        true,
      );
    }

    return {
      ok: true,
      dryRun: false,
      previousVersion,
      updatedVersion,
      targetRef: resolvedRef,
      updatedTargets,
      overlayUiCode,
    };
  } catch (err) {
    return {
      ok: false,
      dryRun,
      previousVersion,
      updatedVersion: null,
      targetRef: resolvedRef || null,
      updatedTargets: [],
      overlayUiCode: null,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    try {
      rmSync(stagingDir, { recursive: true, force: true });
    } catch {
      // Non-fatal temp cleanup
    }
  }
}

async function runUpdateCli(argv = []) {
  const isApply = argv.includes('--update');
  const jsonOutput = argv.includes('--json');
  const dryRun = argv.includes('--dry-run');
  const force = argv.includes('--force') || !argv.includes('--cached');
  const repo = getFlagValue(argv, '--repo') || undefined;
  const targetRef = getFlagValue(argv, '--target-ref') || getFlagValue(argv, '--ref') || undefined;
  const useColor = !argv.includes('--no-color') && !process.env.NO_COLOR;
  const c = createAnsiHelpers(Boolean(useColor));

  if (!isApply) {
    const checkRes = await checkSelfUpdate({ force, repo });
    if (jsonOutput) {
      console.log(JSON.stringify(checkRes, null, 2));
    } else if (!checkRes.ok) {
      console.error(`[agy-quota] Update check failed: ${checkRes.error || 'Unknown error'}`);
    } else if (checkRes.hasUpdate) {
      console.log(
        `${c.bold(c.cyan('[agy-quota]'))} Update available: ${c.yellow(`v${checkRes.currentVersion}`)} -> ${c.bold(c.green(`v${checkRes.latestVersion}`))} ${c.dim(`(${checkRes.source})`)}`,
      );
      if (checkRes.releaseUrl) {
        console.log(`  Release: ${checkRes.releaseUrl}`);
      }
      console.log(`  Run ${c.cyan('agy-quota --update')} to apply hot update.`);
    } else {
      console.log(
        `${c.bold(c.cyan('[agy-quota]'))} Up to date: ${c.green(`v${checkRes.currentVersion}`)} ${c.dim(`(remote: v${checkRes.latestVersion}, source: ${checkRes.source})`)}`,
      );
    }
    if (!checkRes.ok) {
      process.exitCode = 1;
    }
    return checkRes;
  }

  if (!argv.includes('--force') && !dryRun && !targetRef) {
    const preCheck = await checkSelfUpdate({ force: true, repo });
    if (preCheck.ok && !preCheck.hasUpdate) {
      const noopRes = {
        ok: true,
        upToDate: true,
        currentVersion: preCheck.currentVersion,
        latestVersion: preCheck.latestVersion,
        updatedVersion: preCheck.currentVersion,
        updatedTargets: [],
      };
      if (jsonOutput) {
        console.log(JSON.stringify(noopRes, null, 2));
      } else {
        console.log(
          `${c.bold(c.cyan('[agy-quota]'))} Already on latest version ${c.green(`v${preCheck.currentVersion}`)} ${c.dim(`(remote: v${preCheck.latestVersion})`)}. Pass --force to reinstall.`,
        );
      }
      return noopRes;
    }
  }

  const applyRes = await applySelfUpdate({
    repo,
    targetRef,
    dryRun,
    force: argv.includes('--force'),
  });

  if (jsonOutput) {
    const printable = { ...applyRes };
    if (typeof printable.overlayUiCode === 'string') {
      printable.overlayUiCodeBytes = Buffer.byteLength(printable.overlayUiCode, 'utf8');
      delete printable.overlayUiCode;
    }
    console.log(JSON.stringify(printable, null, 2));
  } else if (!applyRes.ok) {
    console.error(`[agy-quota] Self-update aborted safely: ${applyRes.error || 'Unknown error'}`);
  } else if (dryRun) {
    console.log(
      `${c.bold(c.cyan('[agy-quota]'))} Dry-run validation passed for ${c.green(`v${applyRes.updatedVersion}`)} (${applyRes.validatedFiles.length} files verified).`,
    );
  } else {
    console.log(
      `${c.bold(c.cyan('[agy-quota]'))} Updated to ${c.bold(c.green(`v${applyRes.updatedVersion}`))} (${applyRes.updatedTargets.length} runtime target(s) synced)`,
    );
    for (const target of applyRes.updatedTargets) {
      console.log(`  - ${target}`);
    }
  }

  if (!applyRes.ok) {
    process.exitCode = 1;
  }
  return applyRes;
}

function readHttpJsonBody(req, maxBytes = 256 * 1024) {
  return new Promise((resolveBody, rejectBody) => {
    let raw = '';
    let received = 0;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      received += Buffer.byteLength(chunk, 'utf8');
      if (received > maxBytes) {
        req.destroy();
        rejectBody(new Error('Request body too large'));
        return;
      }
      raw += chunk;
    });
    req.on('error', rejectBody);
    req.on('end', () => {
      const trimmed = raw.trim();
      if (!trimmed) {
        resolveBody({});
        return;
      }
      try {
        const parsed = JSON.parse(trimmed);
        resolveBody(parsed && typeof parsed === 'object' ? parsed : {});
      } catch {
        rejectBody(new Error('Invalid JSON request body'));
      }
    });
  });
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

function createStandaloneHandler(assetsDir, runtimeOpts = {}) {
  const readAsset = (filename) => readFileSync(join(assetsDir, filename), 'utf8');
  const sendJson = (res, statusCode, payload) => {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  };

  return async (req, res) => {
    const hostHeader = req.headers?.host || '127.0.0.1';
    const url = new URL(req.url || '/', `http://${hostHeader}`);
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
      const force = url.searchParams.get('force') === '1';
      const bundle = await fetchQuotaBundle({ ...runtimeOpts, force });
      if (bundle.ok && bundle.snapshot) {
        sendJson(res, 200, bundle.snapshot);
      } else {
        sendJson(res, 500, { ok: false, error: bundle.error || 'Unknown error' });
      }
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/update/status') {
      sendJson(res, 200, getUpdateStatus());
      return;
    }
    if ((req.method === 'POST' || req.method === 'GET') && url.pathname === '/api/update/check') {
      let body = {};
      if (req.method === 'POST') {
        try {
          body = await readHttpJsonBody(req);
        } catch (err) {
          sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
          return;
        }
      }
      const force =
        body.force === true ||
        body.force === '1' ||
        url.searchParams.get('force') === '1' ||
        url.searchParams.get('force') === 'true';
      const checkRes = await checkSelfUpdate({
        force,
        currentVersion: body.currentVersion || url.searchParams.get('currentVersion') || undefined,
        repo: body.repo || url.searchParams.get('repo') || undefined,
      });
      sendJson(res, 200, { ...checkRes, prefs: getUpdatePrefs() });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/update/prefs') {
      let body = {};
      try {
        body = await readHttpJsonBody(req);
      } catch (err) {
        sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
        return;
      }
      const patch = body.prefs && typeof body.prefs === 'object' ? body.prefs : body;
      const prefs = setUpdatePrefs(patch);
      sendJson(res, 200, { ok: true, prefs, ...prefs });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/update/apply') {
      let body = {};
      try {
        body = await readHttpJsonBody(req);
      } catch (err) {
        sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
        return;
      }
      const applyRes = await applySelfUpdate({
        repo: body.repo || undefined,
        targetRef: body.targetRef || undefined,
        dryRun: body.dryRun === true || body.dryRun === '1',
      });
      sendJson(res, 200, applyRes);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  };
}

module.exports = {
  VERSION: QUOTA_CORE_VERSION,
  QUOTA_CORE_VERSION,
  DEFAULT_UPDATE_REPO,
  UPDATE_CHECK_TTL_MS,
  RUNTIME_UPDATE_MANIFEST,
  QUOTA_POOLS,
  MODEL_GROUPS,
  KNOWN_MODEL_MAP,
  TREND_MODEL_PALETTE,
  BUNDLE_CACHE_TTL_MS,
  resolveSharedDataDir,
  resolveContextMeterStateDir,
  resolveCurrentVersion,
  parseSemver,
  normalizeVersionString,
  compareSemver,
  getUpdatePrefs,
  setUpdatePrefs,
  getUpdateStatus,
  resolveUpdateProxy,
  checkSelfUpdate,
  applySelfUpdate,
  checkUpdate: checkSelfUpdate,
  applyUpdate: applySelfUpdate,
  runUpdateCli,
  fetchQuotaBundle,
  fetchQuotaSnapshot,
  parseSnapshot,
  detectIndependentArgonPool,
  shortenModelFamily,
  extractPoolFamilies,
  classifyTrendModel,
  collectRecentModelCalls,
  classifyModel,
  normalizeModelLabel,
  mergeAndDedupeModels,
  normalizeTierAndPlan,
  formatTimeUntilReset,
  formatRunwayDuration,
  maskEmailAddress,
  formatCliReport,
  getFlagValue,
  parseWatchOptions,
  runCliReport,
  createStandaloneHandler,
  STANDALONE_PRELOAD_JS,
};
