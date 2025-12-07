#!/usr/bin/env node
// Cross‑platform helper to start @blobinfini/web on a specific port with fallbacks
// Usage:
//   npm run dev:web:port               # default 3002 (auto-fallback if busy)
//   npm run dev:web:port -- 3010       # force preferred port (auto-fallback if busy)
//   npm run dev:web:port -- --port 3010
//   PORT=3020 npm run dev:web:port

import { spawn } from 'node:child_process';
import net from 'node:net';

function parsePort(argv) {
  // priority: env.PORT > --port N > -p N > first numeric arg > default
  if (process.env.PORT && /^\d+$/.test(process.env.PORT)) return Number(process.env.PORT);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' || a === '-p') {
      const v = argv[i + 1];
      if (v && /^\d+$/.test(v)) return Number(v);
    }
    if (/^\d+$/.test(a)) return Number(a);
  }
  return 3002;
}

function sh(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', shell: false, ...opts });
    p.on('exit', (code) => {
      if (code === 0) resolve(0);
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => {
        srv.close(() => resolve(true));
      })
      .listen(port, '0.0.0.0');
  });
}

async function ensurePortFree(port) {
  if (await isPortFree(port)) return true;
  try { await sh('npx', ['kill-port', String(port)]); } catch {}
  await new Promise((r) => setTimeout(r, 200));
  return isPortFree(port);
}

const argv = process.argv.slice(2);
const preferred = parsePort(argv);
const candidates = [preferred, 3002, 3010, 3011, 3020, 3030, 3040];

async function pickPort() {
  for (const p of candidates) {
    if (await ensurePortFree(p)) return p;
  }
  // Last resort: let OS pick a free port >= 3000
  for (let p = 3050; p < 3100; p++) {
    if (await ensurePortFree(p)) return p;
  }
  throw new Error('Aucun port libre trouvé autour de 3000‑3100');
}

async function main() {
  const port = await pickPort();
  console.log(`→ Starting @blobinfini/web on http://localhost:${port}`);
  // Pass explicit --port to override the fixed -p from the workspace script
  await sh('npm', ['run', 'dev', '--workspace', '@blobinfini/web', '--', '--port', String(port)]);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
