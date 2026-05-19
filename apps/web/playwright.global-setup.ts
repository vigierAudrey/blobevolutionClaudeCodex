import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = fileURLToPath(new URL('.', import.meta.url));

async function run(command: string, args: string[]) {
  return new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: resolve(currentDir, '../..'),
      stdio: 'inherit',
    });

    child.on('error', rejectPromise);
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        rejectPromise(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
      }
    });
  });
}

async function globalSetup() {
  // Always flush auth rate-limit keys from Redis before each run.
  // express-rate-limit Redis counters persist across server restarts (15-min TTL).
  // Without this flush, rapid re-runs exhaust the loginIpLimiter / loginAccountIpLimiter
  // budget and cause 429 on the very first login of a new run.
  // Fail-open: if Redis is unreachable the script exits 0 and the run continues.
  await run('pnpm', ['--filter', '@blobinfini/api', 'flush:e2e-rate-limits']);

  if (process.env.SKIP_E2E_RESEED === '1') return;

  await run('npm', ['run', 'db:reseed']);
}

export default globalSetup;
