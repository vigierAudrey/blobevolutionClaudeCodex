import { promises as fs } from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import {
  isBlobosphereRelativeCoverImage,
  validatePublishedBlobosphereCoverImage,
} from '../validateBlobosphereFrontmatter';

async function resolveBlobosphereContentRoot(): Promise<string> {
  const candidates = [
    path.join(process.cwd(), 'content', 'blobosphere'),
    path.join(process.cwd(), 'apps', 'web', 'content', 'blobosphere'),
  ];

  for (const candidate of candidates) {
    try {
      const stats = await fs.stat(candidate);
      if (stats.isDirectory()) {
        return candidate;
      }
    } catch {
      // continue
    }
  }

  throw new Error(`Blobosphere content directory not found. Tried: ${candidates.join(', ')}`);
}

async function resolveWebPublicRoot(): Promise<string> {
  const candidates = [
    path.join(process.cwd(), 'public'),
    path.join(process.cwd(), 'apps', 'web', 'public'),
  ];

  for (const candidate of candidates) {
    try {
      const stats = await fs.stat(candidate);
      if (stats.isDirectory()) {
        return candidate;
      }
    } catch {
      // continue
    }
  }

  throw new Error(`Web public directory not found. Tried: ${candidates.join(', ')}`);
}

async function collectMdxFiles(rootDir: string): Promise<string[]> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectMdxFiles(entryPath)));
      continue;
    }
    if (entry.isFile() && (entry.name.endsWith('.mdx') || entry.name.endsWith('.md'))) {
      files.push(entryPath);
    }
  }

  return files;
}

describe('blobosphere frontmatter validation', () => {
  it('rejects published articles without a valid coverImage', async () => {
    const rootDir = await resolveBlobosphereContentRoot();
    const publicRoot = await resolveWebPublicRoot();
    const files = await collectMdxFiles(rootDir);
    const violations: string[] = [];

    for (const filePath of files) {
      const raw = await fs.readFile(filePath, 'utf8');
      const { data } = matter(raw);
      const validationError = validatePublishedBlobosphereCoverImage(data as Record<string, unknown>);

      if (validationError) {
        violations.push(`${path.relative(process.cwd(), filePath)}: ${validationError}`);
        continue;
      }

      const coverImage = typeof data.coverImage === 'string' ? data.coverImage.trim() : '';
      if (isBlobosphereRelativeCoverImage(coverImage)) {
        const assetPath = path.join(publicRoot, coverImage.replace(/^\//, ''));
        try {
          const stats = await fs.stat(assetPath);
          if (!stats.isFile()) {
            violations.push(
              `${path.relative(process.cwd(), filePath)}: coverImage asset not found (${path.relative(process.cwd(), assetPath)})`,
            );
          }
        } catch {
          violations.push(
            `${path.relative(process.cwd(), filePath)}: coverImage asset not found (${path.relative(process.cwd(), assetPath)})`,
          );
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(`Invalid Blobosphere frontmatter:\n- ${violations.join('\n- ')}`);
    }
  });
});
