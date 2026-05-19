import { spawn } from 'node:child_process';

async function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
      }
    });
  });
}

async function globalSetup() {
  if (process.env.SKIP_E2E_RESEED === '1') return;

  await run('npm', ['run', 'db:reseed:active-tests']);
}

export default globalSetup;
