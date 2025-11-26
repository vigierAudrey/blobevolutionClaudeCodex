import path from 'node:path';

export const BLOBOSPHERE_CONTENT_ROOT = path.join(process.cwd(), 'apps', 'web', 'content', 'blobosphere');

export const BLOBOSPHERE_CATEGORIES = ['surf', 'kitesurf', 'communaute', 'impact'] as const;

export type BlobosphereCategory = (typeof BLOBOSPHERE_CATEGORIES)[number];

export function ensureCategory(input: string): BlobosphereCategory {
  const normalized = input.toLowerCase() as BlobosphereCategory;
  if (!BLOBOSPHERE_CATEGORIES.includes(normalized)) {
    throw new Error(`Catégorie Blobosphère invalide: ${input}`);
  }
  return normalized;
}

export function sanitizeSlug(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function ensureDateString(value?: string | null): string {
  if (!value) {
    return new Date().toISOString().slice(0, 10);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

export function computeReadingTime(text: string): number {
  const words = text
    .replace(/[`*_#>\-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}
