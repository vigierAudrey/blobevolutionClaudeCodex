#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = process.cwd();
const RUNNER_PATH = path.join(ROOT, 'scripts/run-active-user-load.mjs');
const REPEATS = Math.max(1, Number.parseInt(process.env.ACTIVE_LOAD_REPEATS || '2', 10) || 2);
const INCLUDE_GUARDRAIL = String(process.env.ACTIVE_LOAD_INCLUDE_GUARDRAIL || '').toLowerCase() === 'true';

const BASE_PROFILES = [
  {
    name: 'petit',
    settings: {
      ACTIVE_LOAD_LOGIN_START_TIME: '31s',
      ACTIVE_LOAD_LOGIN_ITERATIONS: '2',
      ACTIVE_LOAD_MATCHING_VUS: '1',
      ACTIVE_LOAD_MATCHING_DURATION: '30s',
      ACTIVE_LOAD_MATCHING_SLEEP_SECONDS: '4',
      ACTIVE_LOAD_OPEN_VUS: '1',
      ACTIVE_LOAD_OPEN_DURATION: '30s',
      ACTIVE_LOAD_OPEN_SLEEP_SECONDS: '7',
      ACTIVE_LOAD_MESSAGE_VUS: '1',
      ACTIVE_LOAD_MESSAGE_DURATION: '30s',
      ACTIVE_LOAD_MESSAGE_SLEEP_SECONDS: '6',
    },
  },
  {
    name: 'moyen',
    settings: {
      ACTIVE_LOAD_LOGIN_START_TIME: '46s',
      ACTIVE_LOAD_LOGIN_ITERATIONS: '3',
      ACTIVE_LOAD_MATCHING_VUS: '2',
      ACTIVE_LOAD_MATCHING_DURATION: '45s',
      ACTIVE_LOAD_MATCHING_SLEEP_SECONDS: '3',
      ACTIVE_LOAD_OPEN_VUS: '2',
      ACTIVE_LOAD_OPEN_DURATION: '45s',
      ACTIVE_LOAD_OPEN_SLEEP_SECONDS: '5',
      ACTIVE_LOAD_MESSAGE_VUS: '2',
      ACTIVE_LOAD_MESSAGE_DURATION: '45s',
      ACTIVE_LOAD_MESSAGE_SLEEP_SECONDS: '4',
    },
  },
  {
    name: 'soutenu',
    settings: {
      ACTIVE_LOAD_LOGIN_START_TIME: '61s',
      ACTIVE_LOAD_LOGIN_ITERATIONS: '3',
      ACTIVE_LOAD_MATCHING_VUS: '3',
      ACTIVE_LOAD_MATCHING_DURATION: '60s',
      ACTIVE_LOAD_MATCHING_SLEEP_SECONDS: '2',
      ACTIVE_LOAD_OPEN_VUS: '3',
      ACTIVE_LOAD_OPEN_DURATION: '60s',
      ACTIVE_LOAD_OPEN_SLEEP_SECONDS: '4',
      ACTIVE_LOAD_MESSAGE_VUS: '3',
      ACTIVE_LOAD_MESSAGE_DURATION: '60s',
      ACTIVE_LOAD_MESSAGE_SLEEP_SECONDS: '3',
    },
  },
];

const GUARDRAIL_PROFILE = {
  name: 'garde_fou',
  settings: {
    ACTIVE_LOAD_LOGIN_START_TIME: '46s',
    ACTIVE_LOAD_LOGIN_ITERATIONS: '4',
    ACTIVE_LOAD_MATCHING_VUS: '4',
    ACTIVE_LOAD_MATCHING_DURATION: '45s',
    ACTIVE_LOAD_MATCHING_SLEEP_SECONDS: '1.5',
    ACTIVE_LOAD_OPEN_VUS: '4',
    ACTIVE_LOAD_OPEN_DURATION: '45s',
    ACTIVE_LOAD_OPEN_SLEEP_SECONDS: '2',
    ACTIVE_LOAD_MESSAGE_VUS: '4',
    ACTIVE_LOAD_MESSAGE_DURATION: '45s',
    ACTIVE_LOAD_MESSAGE_SLEEP_SECONDS: '2',
  },
};

function median(values) {
  const clean = values.filter((value) => typeof value === 'number' && Number.isFinite(value)).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const middle = Math.floor(clean.length / 2);
  if (clean.length % 2 === 1) return clean[middle];
  return (clean[middle - 1] + clean[middle]) / 2;
}

function aggregateProfileRuns(runs) {
  const labels = ['login', 'matching_search', 'open_conversation', 'send_message'];
  const actions = {};

  for (const label of labels) {
    const actionRuns = runs.map((run) => run.metrics.actions[label]);
    actions[label] = {
      attemptsPerRun: actionRuns.map((action) => action.attempts),
      p50Median: median(actionRuns.map((action) => action.p50)),
      p95Median: median(actionRuns.map((action) => action.p95)),
      p99Median: median(actionRuns.map((action) => action.p99)),
      errorRateMax: Math.max(...actionRuns.map((action) => action.errorRate)),
      total401: actionRuns.reduce((sum, action) => sum + action.status401, 0),
      total403: actionRuns.reduce((sum, action) => sum + action.status403, 0),
      total429: actionRuns.reduce((sum, action) => sum + action.status429, 0),
      total5xx: actionRuns.reduce((sum, action) => sum + action.status5xx, 0),
    };
  }

  return actions;
}

function runSingleProfile(profile, repeat) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [RUNNER_PATH], {
      cwd: ROOT,
      env: {
        ...process.env,
        ...profile.settings,
        ACTIVE_LOAD_JSON: 'true',
        ACTIVE_LOAD_PROFILE_NAME: profile.name,
        ACTIVE_LOAD_REPEAT_INDEX: String(repeat),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`active load runner failed for ${profile.name}#${repeat} (code ${code ?? 'unknown'})\n${stderr}`));
        return;
      }

      const summaryLine = stdout
        .trim()
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line.startsWith('{"type":"ACTIVE_LOAD_SUMMARY"'));

      if (!summaryLine) {
        reject(new Error(`missing ACTIVE_LOAD_SUMMARY for ${profile.name}#${repeat}`));
        return;
      }

      resolve(JSON.parse(summaryLine));
    });
  });
}

async function main() {
  const profiles = INCLUDE_GUARDRAIL ? [...BASE_PROFILES, GUARDRAIL_PROFILE] : BASE_PROFILES;
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blobconnect-active-load-graded-'));
  const report = {
    generatedAt: new Date().toISOString(),
    repeats: REPEATS,
    profiles: {},
  };

  for (const profile of profiles) {
    const runs = [];
    for (let repeat = 1; repeat <= REPEATS; repeat += 1) {
      process.stdout.write(`\n[active-load-graded] profile=${profile.name} repeat=${repeat}/${REPEATS}\n`);
      const result = await runSingleProfile(profile, repeat);
      runs.push({
        repeat,
        summaryPath: result.summaryPath,
        metrics: result.metrics,
      });
    }

    report.profiles[profile.name] = {
      runs,
      aggregate: aggregateProfileRuns(runs),
    };
  }

  const reportPath = path.join(reportDir, 'graded-summary.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  process.stdout.write(`\n[active-load-graded] report_json=${reportPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`[active-load-graded] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
