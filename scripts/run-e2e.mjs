#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const requestedWebPort = parseInt(process.env.E2E_WEB_PORT ?? '3020', 10);
const requestedApiPort = parseInt(process.env.E2E_API_PORT ?? '4020', 10);

async function pickPorts() {
  try {
    const { default: getPort } = await import('get-port');
    const web = await getPort({ port: [requestedWebPort, requestedWebPort + 1, requestedWebPort + 2] });
    const api = await getPort({ port: [requestedApiPort, requestedApiPort + 1, requestedApiPort + 2] });

    if (web !== requestedWebPort) {
      console.warn(`[E2E] Requested web port ${requestedWebPort} unavailable, using ${web}`);
    }
    if (api !== requestedApiPort) {
      console.warn(`[E2E] Requested API port ${requestedApiPort} unavailable, using ${api}`);
    }

    return { web, api };
  } catch (error) {
    console.warn('[E2E] ⚠️ Failed to auto-resolve ports, fallback to defaults 3020/4020', error);
    return { web: requestedWebPort, api: requestedApiPort };
  }
}

const { web, api } = await pickPorts();
console.info(`[E2E] Using ports: web=${web}, api=${api}`);

const playwrightBin = path.resolve(__dirname, '../node_modules/.bin', process.platform === 'win32' ? 'playwright.cmd' : 'playwright');
const child = spawn(playwrightBin, ['test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: process.env.E2E_NODE_ENV ?? 'development',
    E2E_WEB_PORT: String(web),
    E2E_API_PORT: String(api),
  },
  shell: false,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
