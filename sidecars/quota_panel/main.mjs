import { readFileSync, realpathSync } from 'node:fs';
import http from 'node:http';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import quotaCore from '../../src/quota-core.cjs';

const {
  QUOTA_CORE_VERSION,
  QUOTA_POOLS,
  TREND_MODEL_PALETTE,
  resolveSharedDataDir,
  resolveCurrentVersion,
  compareSemver,
  getUpdatePrefs,
  setUpdatePrefs,
  getUpdateStatus,
  checkSelfUpdate,
  applySelfUpdate,
  runUpdateCli,
  fetchQuotaBundle,
  fetchQuotaSnapshot,
  parseSnapshot,
  detectIndependentArgonPool,
  shortenModelFamily,
  extractPoolFamilies,
  classifyTrendModel,
  collectRecentModelCalls,
  formatTimeUntilReset,
  maskEmailAddress,
  getFlagValue,
  runCliReport,
  createStandaloneHandler,
} = quotaCore;

export {
  QUOTA_CORE_VERSION,
  QUOTA_POOLS,
  TREND_MODEL_PALETTE,
  resolveSharedDataDir,
  resolveCurrentVersion,
  compareSemver,
  getUpdatePrefs,
  setUpdatePrefs,
  getUpdateStatus,
  checkSelfUpdate,
  applySelfUpdate,
  runUpdateCli,
  fetchQuotaBundle,
  fetchQuotaSnapshot,
  parseSnapshot,
  detectIndependentArgonPool,
  shortenModelFamily,
  extractPoolFamilies,
  classifyTrendModel,
  collectRecentModelCalls,
  formatTimeUntilReset,
  maskEmailAddress,
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function readAsset(filename) {
  return readFileSync(join(__dirname, filename), 'utf8');
}

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

const CLI_HELP_TEXT = `AGY Quota v1.3.5 Sidecar & CLI

Usage:
  node main.mjs --cli [options]       Render colored quota dashboard in terminal
  node main.mjs --watch [sec]         Refresh terminal quota dashboard periodically (default: 30s)
  node main.mjs --dump | --json       Print full quota snapshot as JSON
  node main.mjs --check-update        Check GitHub for newer AGY Quota release
  node main.mjs --update [--dry-run]  Download, syntax-verify & hot-apply latest update
  node main.mjs --standalone [--host <addr>] [--port <n>] [--admin-token <token>]
                                      Start standalone local Web UI server
  node main.mjs --help, -h            Show this help message

CLI Options:
  --models, -m          Include deduplicated per-model quota breakdown
  --watch [sec], -w     Auto-refresh interval in seconds (default: 30)
  --iterations <n>      Exit after <n> watch refreshes (for automated checks)
  --mask                Mask account email (e.g. bi***@gmail.com)
  --no-color            Disable ANSI terminal colors (also honors NO_COLOR)
  --read-only           Zero-write query (skip creating dirs, writing cache/history, or refreshing OAuth file)
  --oauth               Force Cloud Code OAuth API fallback (~/.gemini/antigravity-cli)
  --profile-dir <dir>   Target profile home containing .gemini/antigravity-cli
  --check-update        Query remote version (honors HTTPS_PROXY & ContextMeter proxy)
  --update              Pull & atomically sync runtime update (--dry-run, --force, --skill-dir)
  --host <addr>         Bind address for --standalone (default: 127.0.0.1)
  --port <n>            Bind port for --standalone (default: 0 / auto)
  --admin-token <tok>   Required bearer/header token when binding --standalone to non-loopback hosts
  --allowed-host <list> Comma-separated allowed Host headers when reverse-proxying --standalone`;

async function runDumpMode(argv, runtimeOptions) {
  const snap = await fetchQuotaSnapshot(true, runtimeOptions);
  if (argv.includes('--mask') && snap?.userInfo) {
    const masked = {
      ...snap,
      userInfo: {
        ...snap.userInfo,
        email: maskEmailAddress(snap.userInfo.email),
        name: snap.userInfo.name ? `${snap.userInfo.name.slice(0, 1)}***` : '',
      },
    };
    console.log(JSON.stringify(masked, null, 2));
    return;
  }
  console.log(JSON.stringify(snap, null, 2));
}

function isLoopbackBindHost(hostStr) {
  const h = String(hostStr || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  return h === '' || h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '::ffff:127.0.0.1';
}

async function runStandaloneServer(port = 0, host = '127.0.0.1', runtimeOptions = {}) {
  if (!isLoopbackBindHost(host) && !String(runtimeOptions.adminToken || '').trim()) {
    throw new Error(
      `Refusing to bind standalone server to non-loopback host "${host}" without --admin-token <secret> (or AGY_QUOTA_ADMIN_TOKEN).`,
    );
  }
  const handler = createStandaloneHandler(__dirname, {
    ...runtimeOptions,
    listenHost: host,
  });
  const server = http.createServer((req, res) => {
    handler(req, res).catch((err) => {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    });
  });

  server.listen(port, host, () => {
    const addr = server.address();
    console.log(`[quota_panel] standalone server listening on http://${host}:${addr.port}`);
  });
}

async function runSidecarMode(runtimeOptions = {}) {
  const { SidecarApp, Response } = await importSidecarSdk();
  const app = new SidecarApp();

  app.page('/', () => readAsset('index.html'));
  app.api('/styles.css', () => new Response(readAsset('styles.css'), { contentType: 'text/css; charset=utf-8' }), 'GET');
  app.api('/app.js', () => new Response(readAsset('app.js'), { contentType: 'application/javascript; charset=utf-8' }), 'GET');
  app.api('/api/quota', async (data) => {
    try {
      const force = data?.force === '1' || data?.force === true;
      return await fetchQuotaSnapshot(force, runtimeOptions);
    } catch (err) {
      return new Response(
        JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
        { contentType: 'application/json; charset=utf-8', status: 500 },
      );
    }
  }, 'GET');

  app.api('/api/update/status', async () => getUpdateStatus(), 'GET');

  const handleUpdateCheck = async (data) => {
    const force = data?.force === true || data?.force === '1';
    const checkRes = await checkSelfUpdate({ force });
    return { ...checkRes, prefs: getUpdatePrefs() };
  };
  app.api('/api/update/check', handleUpdateCheck, 'POST');
  app.api('/api/update/check', handleUpdateCheck, 'GET');

  app.api('/api/update/prefs', async (data) => {
    const rawPatch = data?.prefs && typeof data.prefs === 'object' ? data.prefs : (data || {});
    const safePatch = {};
    if (typeof rawPatch.autoUpdate === 'boolean') safePatch.autoUpdate = rawPatch.autoUpdate;
    if (typeof rawPatch.skippedVersion === 'string') safePatch.skippedVersion = rawPatch.skippedVersion;
    if (typeof rawPatch.channel === 'string') safePatch.channel = rawPatch.channel;
    const prefs = setUpdatePrefs(safePatch);
    return { ok: true, prefs, ...prefs };
  }, 'POST');

  app.api('/api/update/apply', async (data) => {
    return await applySelfUpdate({
      dryRun: data?.dryRun === true || data?.dryRun === '1',
    });
  }, 'POST');

  await app.run();
}

function hasCliInvocationFlag(argv) {
  return argv.some((arg) => (
    arg === '--cli'
    || arg === '--watch'
    || arg === '-w'
    || arg.startsWith('--watch=')
    || arg === '--models'
    || arg === '-m'
    || arg === '--oauth'
    || arg === '--mask'
    || arg === '--no-color'
    || arg === '--read-only'
    || arg === '--no-save-history'
    || arg === '--profile-dir'
    || arg.startsWith('--profile-dir=')
    || arg === '--iterations'
    || arg.startsWith('--iterations=')
  ));
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
  const args = process.argv.slice(2);
  const runtimeOptions = {
    oauthOnly: args.includes('--oauth'),
    readOnly: args.includes('--read-only') || args.includes('--no-save-history'),
    profileDir: getFlagValue(args, '--profile-dir'),
    adminToken: getFlagValue(args, '--admin-token') || process.env.AGY_QUOTA_ADMIN_TOKEN || '',
    allowedHosts: getFlagValue(args, '--allowed-host') || process.env.AGY_QUOTA_ALLOWED_HOSTS || '',
  };

  if (args.includes('--help') || args.includes('-h')) {
    console.log(CLI_HELP_TEXT);
  } else if (args.includes('--check-update') || args.includes('--update')) {
    runUpdateCli(args).catch((err) => {
      console.error(`[agy-quota] ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    });
  } else if (args.includes('--dump') || args.includes('--json')) {
    runDumpMode(args, runtimeOptions).catch((err) => {
      console.error(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }, null, 2));
      process.exitCode = 1;
    });
  } else if (!args.includes('--standalone') && hasCliInvocationFlag(args)) {
    runCliReport(args).catch((err) => {
      console.error(`[agy-quota] ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    });
  } else if (args.includes('--standalone') || !process.env.ANTIGRAVITY_SIDECAR_WEB_PORT) {
    const requestedPort = Number(getFlagValue(args, '--port')) || Number(process.env.PORT) || 0;
    const requestedHost = getFlagValue(args, '--host') || process.env.HOST || '127.0.0.1';
    runStandaloneServer(requestedPort, requestedHost, runtimeOptions).catch((err) => {
      console.error('[quota_panel] fatal:', err);
      process.exitCode = 1;
    });
  } else {
    runSidecarMode(runtimeOptions).catch((err) => {
      console.error('[quota_panel] fatal:', err);
      process.exitCode = 1;
    });
  }
}
