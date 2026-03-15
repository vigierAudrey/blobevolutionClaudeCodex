import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { secureLogger } from '../utils/secure-logger';

const projectRoot = path.resolve(__dirname, '../../../../');
const candidates = process.env.NODE_ENV === 'test' ? ['.env.test', '.env'] : ['.env'];

const loadedPath = candidates
  .map((file) => path.join(projectRoot, file))
  .find((candidate) => fs.existsSync(candidate));

if (loadedPath) {
  dotenv.config({ path: loadedPath });
  secureLogger.info('ENV_FILE_LOADED', { loadedPath });
} else {
  secureLogger.warn('ENV_FILE_MISSING', { candidates });
}
