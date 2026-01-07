import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

const projectRoot = path.resolve(__dirname, '..', '..');
const candidates = process.env.NODE_ENV === 'test' ? ['.env.test', '.env'] : ['.env'];

for (const filename of candidates) {
  const candidatePath = path.join(projectRoot, filename);
  if (fs.existsSync(candidatePath)) {
    dotenv.config({ path: candidatePath });
    break;
  }
}

// Force TRUST_PROXY_MODE=disabled in tests to prevent warnings
// Tests should not rely on proxy headers
if (process.env.NODE_ENV === 'test' && !process.env.TRUST_PROXY_MODE) {
  process.env.TRUST_PROXY_MODE = 'disabled';
}
