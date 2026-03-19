#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import pg from 'pg';

const { Client } = pg;

const ROOT = process.cwd();
const SCRIPT_PATH = path.join(ROOT, 'tests/load/active-user-simulation.js');
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:4100';
const DATABASE_URL = process.env.ACTIVE_LOAD_DATABASE_URL || process.env.DATABASE_URL || '';
const ACTIVE_PRO_EMAIL = process.env.ACTIVE_LOAD_PRO_EMAIL || 'dev+active-pro@test.com';

function fail(message) {
  process.stderr.write(`[active-load] ${message}\n`);
  process.exit(1);
}

function parseUrl(value, label) {
  try {
    return new URL(value);
  } catch {
    fail(`${label} invalide: ${value || '(vide)'}`);
  }
}

function isLocalHost(hostname) {
  return ['localhost', '127.0.0.1', 'host.docker.internal'].includes(hostname);
}

function looksDisposableStaging(hostname) {
  return /(staging|preview|ephemeral|sandbox|jetable)/i.test(hostname);
}

function assertSafeBaseUrl() {
  const url = parseUrl(BASE_URL, 'BASE_URL');
  const lower = url.toString().toLowerCase();

  if (/(prod|production)/.test(lower)) {
    fail(`refus d'exécuter la charge contre une cible production-like: ${BASE_URL}`);
  }

  if (isLocalHost(url.hostname)) {
    return;
  }

  const allowStaging = String(process.env.ACTIVE_LOAD_ALLOW_STAGING || '').toLowerCase() === 'true';
  if (allowStaging && looksDisposableStaging(url.hostname)) {
    return;
  }

  fail(
    `refus d'exécuter la charge contre ${BASE_URL}. Autorisé: localhost/127.0.0.1 ou staging jetable explicitement marqué via ACTIVE_LOAD_ALLOW_STAGING=true`
  );
}

function assertSafeExternalIntegrations() {
  const smtpHost = String(process.env.SMTP_HOST || '').trim().toLowerCase();
  if (smtpHost && !['localhost', '127.0.0.1', 'mailpit'].includes(smtpHost)) {
    fail(`SMTP_HOST non sûr pour la charge: ${smtpHost}`);
  }

  const firebaseProject = String(process.env.FIREBASE_PROJECT_ID || '').trim().toLowerCase();
  if (firebaseProject && !/(demo|test|local)/.test(firebaseProject)) {
    fail(`FIREBASE_PROJECT_ID semble réel: ${firebaseProject}`);
  }

  if (String(process.env.FIREBASE_PRIVATE_KEY || '').trim()) {
    fail('FIREBASE_PRIVATE_KEY configuré: refus d\'exécuter la charge');
  }

  if (String(process.env.BLOBOSPHERE_GITHUB_PUSH || '').toLowerCase() === 'true') {
    fail('BLOBOSPHERE_GITHUB_PUSH=true détecté: refus d\'exécuter la charge');
  }

  const webhookEntries = Object.entries(process.env).filter(([key, value]) =>
    /WEBHOOK/i.test(key) && /^https?:\/\//i.test(String(value || '').trim())
  );

  for (const [key, value] of webhookEntries) {
    const url = parseUrl(String(value), key);
    if (!isLocalHost(url.hostname)) {
      fail(`${key} pointe vers une URL non locale: ${value}`);
    }
  }
}

function assertDedicatedDatabase() {
  if (!DATABASE_URL) {
    fail('ACTIVE_LOAD_DATABASE_URL ou DATABASE_URL est requis');
  }

  const url = parseUrl(DATABASE_URL, 'ACTIVE_LOAD_DATABASE_URL/DATABASE_URL');
  const dbName = url.pathname.replace(/^\//, '').toLowerCase();
  const lower = url.toString().toLowerCase();

  if (/(prod|production)/.test(lower) || /(prod|production)/.test(dbName)) {
    fail(`refus d'utiliser une base production-like: ${dbName}`);
  }

  if (!/(test|load|active)/.test(dbName)) {
    fail(`la base doit être dédiée test/load, nom actuel: ${dbName}`);
  }
}

async function resolveActiveFixtures() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const proResult = await client.query('SELECT id FROM "User" WHERE email = $1 LIMIT 1', [ACTIVE_PRO_EMAIL]);
    if (proResult.rowCount !== 1) {
      fail(`fixture pro introuvable pour ${ACTIVE_PRO_EMAIL}. Lance db:reseed:active-tests sur la DB de charge.`);
    }

    return {
      openTargetUserId: proResult.rows[0].id,
    };
  } finally {
    await client.end();
  }
}

async function probeBaseUrl() {
  const probeUrl = new URL(BASE_URL);
  if (probeUrl.hostname === 'host.docker.internal') {
    probeUrl.hostname = '127.0.0.1';
  }

  const response = await fetch(`${probeUrl.toString().replace(/\/$/, '')}/csrf-token`, {
    signal: AbortSignal.timeout(5000),
  }).catch((error) => {
    fail(`cible injoignable (${BASE_URL}/csrf-token): ${error instanceof Error ? error.message : String(error)}`);
  });

  if (!response || response.status !== 200) {
    fail(`cible injoignable ou inattendue sur ${BASE_URL}/csrf-token (status=${response ? response.status : 'none'})`);
  }
}

function runCommand(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${path.basename(command)} exited with code ${code ?? 'unknown'}`));
    });
  });
}

function resolveLocalK6Bin() {
  const envBin = process.env.K6_BIN;
  if (envBin && fs.existsSync(envBin)) {
    return envBin;
  }

  const localBin = path.join(ROOT, 'node_modules/.bin', process.platform === 'win32' ? 'k6.exe' : 'k6');
  return fs.existsSync(localBin) ? localBin : null;
}

function rewriteBaseUrlForDocker(value) {
  const parsed = new URL(value);
  if (['127.0.0.1', 'localhost'].includes(parsed.hostname)) {
    parsed.hostname = 'host.docker.internal';
  }
  return parsed.toString();
}

async function runK6(env, summaryDir) {
  const summaryPath = path.join(summaryDir, 'summary.json');
  const commonArgs = [
    'run',
    '--summary-trend-stats',
    'min,avg,med,p(50),p(95),p(99),max',
    '--summary-export',
    summaryPath,
    path.relative(ROOT, SCRIPT_PATH),
  ];

  const localK6Bin = resolveLocalK6Bin();
  if (localK6Bin) {
    await runCommand(localK6Bin, commonArgs, env);
    return summaryPath;
  }

  const dockerArgs = [
    'run',
    '--rm',
    '--add-host',
    'host.docker.internal:host-gateway',
    '--user',
    `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
    '-v',
    `${ROOT}:/work`,
    '-w',
    '/work',
    '-v',
    `${summaryDir}:/results`,
  ];

  const dockerEnv = {
    ...env,
    BASE_URL: rewriteBaseUrlForDocker(env.BASE_URL),
  };

  for (const [key, value] of Object.entries(dockerEnv)) {
    if (value !== undefined) {
      dockerArgs.push('-e', `${key}=${value}`);
    }
  }

  dockerArgs.push(
    'grafana/k6:0.49.0',
    'run',
    '--summary-trend-stats',
    'min,avg,med,p(50),p(95),p(99),max',
    '--summary-export',
    '/results/summary.json',
    path.relative(ROOT, SCRIPT_PATH),
  );

  await runCommand('docker', dockerArgs, process.env);
  return summaryPath;
}

function readMetric(summary, name) {
  return summary.metrics?.[name] || null;
}

function readCount(summary, name) {
  return Number(summary.metrics?.[name]?.count || 0);
}

function summarizeMetrics(summary) {
  const endpoints = [
    ['login', 'active_login_duration'],
    ['matching_search', 'active_matching_duration'],
    ['open_conversation', 'active_open_conversation_duration'],
    ['send_message', 'active_message_duration'],
  ];
  const actions = {};

  for (const [label, metricName] of endpoints) {
    const values = readMetric(summary, metricName);
    const metricPrefix =
      label === 'matching_search'
        ? 'matching'
        : label === 'open_conversation'
          ? 'open_conversation'
          : label === 'send_message'
            ? 'message'
            : label;
    const attempts = readCount(summary, `active_${metricPrefix}_attempts`);
    const errors = readCount(summary, `active_${metricPrefix}_errors`);

    actions[label] = {
      attempts,
      errorRate: attempts > 0 ? Number(((errors / attempts) * 100).toFixed(2)) : 0,
      status401: readCount(summary, `active_${metricPrefix}_401`),
      status403: readCount(summary, `active_${metricPrefix}_403`),
      status429: readCount(summary, `active_${metricPrefix}_429`),
      status5xx: readCount(summary, `active_${metricPrefix}_5xx`),
      p50: values?.['p(50)'] ?? null,
      p95: values?.['p(95)'] ?? null,
      p99: values?.['p(99)'] ?? null,
    };
  }

  const csrfCount = readCount(summary, 'active_csrf_fetches');
  const csrfValues = readMetric(summary, 'active_csrf_duration');

  return {
    actions,
    csrf: csrfCount > 0
      ? {
          attempts: csrfCount,
          p50: csrfValues?.['p(50)'] ?? null,
          p95: csrfValues?.['p(95)'] ?? null,
        }
      : null,
    httpReqFailed: readMetric(summary, 'http_req_failed')?.value ?? null,
  };
}

function printSummary(summary) {
  const metrics = summarizeMetrics(summary);
  const endpoints = [
    ['login', 'active_login_duration'],
    ['matching_search', 'active_matching_duration'],
    ['open_conversation', 'active_open_conversation_duration'],
    ['send_message', 'active_message_duration'],
  ];

  process.stdout.write('\n[active-load] Résumé k6\n');
  for (const [label, metricName] of endpoints) {
    const values = readMetric(summary, metricName);
    const actionMetrics = metrics.actions[label];

    process.stdout.write(
      `[active-load] ${label}: attempts=${actionMetrics.attempts} ` +
      `p50=${values?.['p(50)']?.toFixed?.(2) ?? 'n/a'}ms ` +
      `p95=${values?.['p(95)']?.toFixed?.(2) ?? 'n/a'}ms ` +
      `p99=${values?.['p(99)']?.toFixed?.(2) ?? 'n/a'}ms ` +
      `error_rate=${actionMetrics.errorRate.toFixed(2)}% ` +
      `401=${actionMetrics.status401} 403=${actionMetrics.status403} 429=${actionMetrics.status429} 5xx=${actionMetrics.status5xx}\n`
    );
  }

  if (metrics.csrf) {
    process.stdout.write(
      `[active-load] csrf_fetches=${metrics.csrf.attempts} ` +
      `p50=${metrics.csrf.p50?.toFixed?.(2) ?? 'n/a'}ms ` +
      `p95=${metrics.csrf.p95?.toFixed?.(2) ?? 'n/a'}ms\n`
    );
  }

  if (metrics.httpReqFailed !== null) {
    process.stdout.write(`[active-load] http_req_failed=${metrics.httpReqFailed}\n`);
  }

  return metrics;
}

async function main() {
  assertSafeBaseUrl();
  assertSafeExternalIntegrations();
  assertDedicatedDatabase();
  await probeBaseUrl();

  const fixtures = await resolveActiveFixtures();
  const summaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blobconnect-active-load-'));
  const env = {
    ...process.env,
    BASE_URL,
    ACTIVE_TEST_OPEN_TARGET_USER_ID: fixtures.openTargetUserId,
    ACTIVE_TEST_PASSWORD: process.env.ACTIVE_TEST_PASSWORD || 'Passw0rd!',
    K6_WEB_DASHBOARD: process.env.K6_WEB_DASHBOARD || 'false',
  };

  const summaryPath = await runK6(env, summaryDir);
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  const metrics = printSummary(summary);
  process.stdout.write(`[active-load] summary_json=${summaryPath}\n`);
  if (String(process.env.ACTIVE_LOAD_JSON || '').toLowerCase() === 'true') {
    process.stdout.write(`${JSON.stringify({ type: 'ACTIVE_LOAD_SUMMARY', metrics, summaryPath })}\n`);
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
