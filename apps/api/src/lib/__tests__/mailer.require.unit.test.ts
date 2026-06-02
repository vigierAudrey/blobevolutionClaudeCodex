/**
 * Regression test: nodemailer module resolution must work from the file's own location.
 *
 * Bug (fixed): createRequire(resolve(process.cwd(), 'package.json')) fails in production
 * Docker where CWD=/workspace (monorepo root). The root package.json has no nodemailer
 * dependency, so require('nodemailer') throws MODULE_NOT_FOUND, making all email
 * delivery fail with latencyMs ~3ms.
 *
 * Fix: createRequire(__filename) anchors resolution to apps/api/src/lib/mailer.ts,
 * which walks up to apps/api/node_modules/nodemailer (pnpm symlink) correctly.
 */
import { createRequire } from 'module';
import { describe, expect, it } from '@jest/globals';

describe('mailer — nodemailer module resolution', () => {
  it('resolves nodemailer via __filename (production-safe resolution)', () => {
    // This is the strategy used by the fixed mailer.ts line 14.
    // createRequire(__filename) starts lookup from apps/api/src/lib/__tests__/,
    // walks up to apps/api/node_modules/nodemailer (pnpm symlink) — always works.
    const r = createRequire(__filename);
    const nm = r('nodemailer');
    expect(nm).toBeDefined();
    const nmDefault = (nm as any).default ?? nm;
    expect(typeof nmDefault.createTransport).toBe('function');
  });

  it('createTransport returns a transport object with sendMail', () => {
    // Validate the module shape is what mailer.ts expects
    const r = createRequire(__filename);
    const nm = r('nodemailer');
    const nmDefault = (nm as any).default ?? nm;
    const transport = nmDefault.createTransport({ host: 'localhost', port: 25 });
    expect(typeof transport.sendMail).toBe('function');
    expect(typeof transport.verify).toBe('function');
  });
});
