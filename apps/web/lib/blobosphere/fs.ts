import { promises as fs } from 'node:fs';
import path from 'node:path';
import { BLOBOSPHERE_CONTENT_ROOT } from './utils';

export async function listMdxFiles(rootDir: string = BLOBOSPHERE_CONTENT_ROOT): Promise<string[]> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      const nested = await listMdxFiles(entryPath);
      files.push(...nested);
      continue;
    }
    if (entry.isFile() && (entry.name.endsWith('.mdx') || entry.name.endsWith('.md'))) {
      files.push(entryPath);
    }
  }
  return files;
}
