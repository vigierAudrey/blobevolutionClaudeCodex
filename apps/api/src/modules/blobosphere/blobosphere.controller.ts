import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { exec as _exec } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { pushBlobosphereChange } from '../../services/github.service';
import { requireAuth, requireAdmin, requireVerifiedEmail } from '../auth/auth.guard';
import { validate } from '../../middleware/validate';
import { audit } from '../../middleware/audit';
import { secureLogger } from '../../utils/secure-logger';

const CONTENT_ROOT = path.join(process.cwd(), 'apps', 'web', 'content', 'blobosphere');
const exec = promisify(_exec);

const PostSchema = z.object({
  title: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9\-]+$/).min(1),
  category: z.enum(['surf', 'kitesurf', 'communaute', 'impact']),
  tags: z.array(z.string()).default([]),
  excerpt: z.string().default(''),
  status: z.enum(['draft', 'published']).default('draft'),
  publishedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(new Date().toISOString().slice(0, 10)),
  updatedAt: z.string().optional().nullable(),
  coverImage: z.string().optional().nullable(),
  readingTime: z.number().int().min(1).max(60).optional().nullable(),
  language: z.literal('fr').default('fr'),
  body: z.string().default(''),
});

function frontmatter(data: Record<string, unknown>) {
  const lines: string[] = ['---'];
  const keys = [
    'title', 'slug', 'category', 'tags', 'excerpt', 'status',
    'publishedAt', 'updatedAt', 'coverImage', 'readingTime', 'language',
  ];
  for (const key of keys) {
    const value = (data as any)[key];
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map((v) => JSON.stringify(v)).join(', ')}]`);
    } else if (value === null) {
      lines.push(`${key}: null`);
    } else if (typeof value === 'string') {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    } else {
      lines.push(`${key}: ${String(value)}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

function sanitizeSlug(slug: string) {
  return slug.toLowerCase().replace(/[^a-z0-9\-]+/g, '-').replace(/^-+|-+$/g, '');
}

export const blobosphereAdminRouter = Router();
blobosphereAdminRouter.use(requireAuth, requireVerifiedEmail, requireAdmin);

async function maybeCommit(fileRelPath: string, message: string) {
  if (String(process.env.BLOBOSPHERE_AUTO_COMMIT || 'false').toLowerCase() !== 'true') return;
  const cwd = process.cwd();
  try {
    await exec(`git add ${fileRelPath}`, { cwd });
    await exec(`git commit -m ${JSON.stringify(message)}`, { cwd });
  } catch (e) {
    // swallow commit errors to not block API
    secureLogger.warn('BLOBOSPHERE_GIT_COMMIT_SKIPPED', { error: e });
  }
}

// List posts (metadata only)
blobosphereAdminRouter.get(
  '/posts',
  audit('admin:blobosphere:posts:list', () => 'admin:blobosphere:posts'),
  async (_req, res) => {
    const categories = ['surf', 'kitesurf', 'communaute', 'impact'] as const;
    const items: any[] = [];
    for (const cat of categories) {
      const dir = path.join(CONTENT_ROOT, cat);
      let files: string[] = [];
      try { files = await fs.readdir(dir); } catch { continue; }
      for (const file of files) {
        if (!file.endsWith('.mdx') && !file.endsWith('.md')) continue;
        const raw = await fs.readFile(path.join(dir, file), 'utf8');
        const start = raw.indexOf('---');
        const end = raw.indexOf('\n---', 3);
        const fm = start === 0 && end > 0 ? raw.slice(3, end + 1) : '';
        const meta: Record<string, any> = {};
        if (fm) {
          for (const line of fm.split(/\r?\n/)) {
            const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
            if (!m) continue;
            const k = m[1];
            let v = m[2];
            if (/^\[.*\]$/.test(v)) {
              v = JSON.parse(v.replace(/([a-zA-Z0-9_]+):/g, '"$1":'));
              meta[k] = v;
            } else {
              meta[k] = v.replace(/^"|"$/g, '');
            }
          }
        }
        items.push({
          category: cat,
          file,
          slug: meta.slug || file.replace(/\.(mdx|md)$/i, ''),
          title: meta.title || file,
          status: meta.status || 'draft',
          publishedAt: meta.publishedAt || null,
        });
      }
    }
    res.json({ items });
  }
);

// Get a single post (frontmatter + body)
blobosphereAdminRouter.get(
  '/posts/:category/:slug',
  audit('admin:blobosphere:posts:get', (req) => `blobosphere:${req.params.category}/${req.params.slug}`),
  async (req, res) => {
    const category = req.params.category as 'surf'|'kitesurf'|'communaute'|'impact';
    const slug = sanitizeSlug(req.params.slug);
    const file = path.join(CONTENT_ROOT, category, `${slug}.mdx`);
    try {
      const raw = await fs.readFile(file, 'utf8');
      res.type('application/json').send({ raw });
    } catch (e: any) {
      return res.status(404).json({ error: 'Not found' });
    }
  }
);

// Create a new post
blobosphereAdminRouter.post(
  '/posts',
  validate(PostSchema),
  audit('admin:blobosphere:posts:create', (req) => `blobosphere:${(req.body as any).category}/${(req.body as any).slug}`),
  async (req, res) => {
    const data = PostSchema.parse(req.body);
    const slug = sanitizeSlug(data.slug);
    const dir = path.join(CONTENT_ROOT, data.category);
    await ensureDir(dir);
    const file = path.join(dir, `${slug}.mdx`);
    try {
      await fs.access(file);
      return res.status(409).json({ error: 'Slug already exists' });
    } catch {}

    const fm = frontmatter(data as any);
    const content = `${fm}\n\n${data.body || ''}\n`;
    await fs.writeFile(file, content, 'utf8');
    await maybeCommit(`apps/web/content/blobosphere/${data.category}/${slug}.mdx`, `blobosphere: create ${data.category}/${slug}`);
    // Optional: push to GitHub and open PR
    try {
      const branch = `feature/blobosphere-${slug}-${Date.now()}`;
      const result = await pushBlobosphereChange({
        fileRelPath: `apps/web/content/blobosphere/${data.category}/${slug}.mdx`,
        content,
        message: `blobosphere: create ${data.category}/${slug}`,
        branchName: branch,
      });
      res.status(201).json({ success: true, path: `apps/web/content/blobosphere/${data.category}/${slug}.mdx`, pr: result ?? undefined });
    } catch (e) {
      secureLogger.warn('BLOBOSPHERE_GITHUB_PUSH_SKIPPED', { error: (e as Error)?.message });
      res.status(201).json({ success: true, path: `apps/web/content/blobosphere/${data.category}/${slug}.mdx` });
    }
  }
);

// Update an existing post (allows slug/category change via newSlug/newCategory)
const UpdateSchema = PostSchema.partial().extend({
  slug: z.string().regex(/^[a-z0-9\-]+$/).optional(),
  category: z.enum(['surf', 'kitesurf', 'communaute', 'impact']).optional(),
  body: z.string().optional(),
  newSlug: z.string().regex(/^[a-z0-9\-]+$/).optional(),
  newCategory: z.enum(['surf', 'kitesurf', 'communaute', 'impact']).optional(),
});

blobosphereAdminRouter.put(
  '/posts/:category/:slug',
  validate(UpdateSchema),
  audit('admin:blobosphere:posts:update', (req) => `blobosphere:${req.params.category}/${req.params.slug}`),
  async (req, res) => {
    const category = req.params.category as 'surf'|'kitesurf'|'communaute'|'impact';
    const slug = sanitizeSlug(req.params.slug);
    const currentFile = path.join(CONTENT_ROOT, category, `${slug}.mdx`);
    try { await fs.access(currentFile); } catch { return res.status(404).json({ error: 'Not found' }); }

    const body = req.body as any;
    const nextSlug = sanitizeSlug(body.newSlug || body.slug || slug);
    const nextCategory = (body.newCategory || body.category || category) as 'surf'|'kitesurf'|'communaute'|'impact';

    // Merge: read existing, parse crude frontmatter, then overwrite provided fields
    const raw = await fs.readFile(currentFile, 'utf8');
    const start = raw.indexOf('---');
    const end = raw.indexOf('\n---', 3);
    const existingFm = start === 0 && end > 0 ? raw.slice(3, end + 1) : '';
    const existingBody = end > 0 ? raw.slice(end + 4) : raw;
    const meta: Record<string, any> = {};
    if (existingFm) {
      for (const line of existingFm.split(/\r?\n/)) {
        const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
        if (!m) continue;
        const k = m[1];
        const v = m[2];
        meta[k] = v.replace(/^"|"$/g, '');
      }
    }
    const merged = { ...meta, ...body, slug: nextSlug, category: nextCategory };
    const fm = frontmatter(merged);
    const content = `${fm}\n\n${typeof body.body === 'string' ? body.body : existingBody}`;

    const nextDir = path.join(CONTENT_ROOT, nextCategory);
    await ensureDir(nextDir);
    const nextFile = path.join(nextDir, `${nextSlug}.mdx`);
    if (nextFile !== currentFile) {
      await fs.writeFile(nextFile, content, 'utf8');
      await fs.unlink(currentFile);
    } else {
      await fs.writeFile(currentFile, content, 'utf8');
    }
    await maybeCommit(`apps/web/content/blobosphere/${nextCategory}/${nextSlug}.mdx`, `blobosphere: update ${category}/${slug} -> ${nextCategory}/${nextSlug}`);
    try {
      const branch = `feature/blobosphere-${nextSlug}-${Date.now()}`;
      const result = await pushBlobosphereChange({
        fileRelPath: `apps/web/content/blobosphere/${nextCategory}/${nextSlug}.mdx`,
        content,
        message: `blobosphere: update ${category}/${slug} -> ${nextCategory}/${nextSlug}`,
        branchName: branch,
      });
      res.json({ success: true, path: `apps/web/content/blobosphere/${nextCategory}/${nextSlug}.mdx`, pr: result ?? undefined });
    } catch (e) {
      secureLogger.warn('BLOBOSPHERE_GITHUB_PUSH_SKIPPED', { error: (e as Error)?.message });
      res.json({ success: true, path: `apps/web/content/blobosphere/${nextCategory}/${nextSlug}.mdx` });
    }
  }
);
