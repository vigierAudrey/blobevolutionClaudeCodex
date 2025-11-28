import { z } from 'zod';
import type { SaveMdxPayload } from './saveMdx';
import { ensureCategory, sanitizeSlug, type BlobosphereCategory } from './utils';

export const CATEGORY_VALUES = ['surf', 'kitesurf', 'communaute', 'impact'] as const;

const tagSchema = z.union([z.array(z.string()), z.string()]);
const baseSchema = {
  title: z.string().min(1, 'Titre requis'),
  slug: z.string().min(1, 'Slug requis'),
  category: z.enum(CATEGORY_VALUES),
  excerpt: z.string().optional(),
  tags: tagSchema.optional(),
  status: z.enum(['draft', 'published']).optional(),
  publishedAt: z.string().optional(),
  updatedAt: z.string().optional(),
  coverImage: z.string().optional(),
  readingTime: z.number().int().positive().optional(),
  body: z.string().optional(),
};

export const CreateSchema = z.object(baseSchema);
export const UpdateSchema = z.object({
  ...Object.fromEntries(Object.entries(baseSchema).map(([key, schema]) => [key, (schema as z.ZodTypeAny).optional()])),
  newSlug: z.string().min(1).optional(),
  newCategory: z.enum(CATEGORY_VALUES).optional(),
});

export type CreatePayloadInput = z.infer<typeof CreateSchema>;
export type UpdatePayloadInput = z.infer<typeof UpdateSchema>;

export function normalizeTags(value?: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((tag) => String(tag)).filter(Boolean);
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  return [];
}

export function buildCreatePayload(data: unknown): SaveMdxPayload {
  const parsed = CreateSchema.parse(data);
  return {
    title: parsed.title.trim(),
    slug: sanitizeSlug(parsed.slug),
    category: ensureCategory(parsed.category),
    excerpt: parsed.excerpt ?? '',
    tags: normalizeTags(parsed.tags),
    status: parsed.status ?? 'draft',
    publishedAt: parsed.publishedAt,
    updatedAt: parsed.updatedAt,
    coverImage: parsed.coverImage ?? '',
    readingTime: parsed.readingTime ?? null,
    body: parsed.body ?? '',
  };
}

export type ParsedUpdatePayload = ReturnType<typeof buildUpdatePayload>;

export function buildUpdatePayload(data: unknown) {
  const parsed = UpdateSchema.parse(data ?? {});
  return {
    ...parsed,
    slug: parsed.slug ? sanitizeSlug(parsed.slug) : undefined,
    newSlug: parsed.newSlug ? sanitizeSlug(parsed.newSlug) : undefined,
    category: parsed.category ? ensureCategory(parsed.category) : undefined,
    newCategory: parsed.newCategory ? ensureCategory(parsed.newCategory) : undefined,
    tags: normalizeTags(parsed.tags),
  };
}

export function mergePayload(
  defaults: SaveMdxPayload,
  overrides: Partial<SaveMdxPayload>,
): SaveMdxPayload {
  return {
    title: overrides.title ?? defaults.title,
    slug: overrides.slug ?? defaults.slug,
    category: overrides.category ?? defaults.category,
    excerpt: overrides.excerpt ?? defaults.excerpt,
    tags: overrides.tags ?? defaults.tags,
    status: overrides.status ?? defaults.status,
    publishedAt: overrides.publishedAt ?? defaults.publishedAt,
    updatedAt: overrides.updatedAt ?? defaults.updatedAt,
    coverImage: overrides.coverImage ?? defaults.coverImage,
    readingTime: overrides.readingTime ?? defaults.readingTime,
    body: overrides.body ?? defaults.body,
  };
}

export function ensureCategoryOrDefault(value: BlobosphereCategory | undefined, fallback: BlobosphereCategory) {
  return value ?? fallback;
}
