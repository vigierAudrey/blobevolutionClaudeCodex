import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(__dirname, '../../../../');
const candidates = process.env.NODE_ENV === 'test' ? ['.env.test', '.env'] : ['.env'];

const loadedPath = candidates
  .map((file) => path.join(projectRoot, file))
  .find((candidate) => fs.existsSync(candidate));

if (loadedPath) {
  dotenv.config({ path: loadedPath });
  console.log('✅ .env loaded from', loadedPath);
} else {
  console.warn('⚠️ No .env file found for', candidates.join(' / '));
}
