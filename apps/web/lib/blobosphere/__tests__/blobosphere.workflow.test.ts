import { promises as fs } from 'node:fs';
import { listMdxFiles } from '../fs';
import { loadPublishedBlobosphereArticleBySlug } from '../loadBlobosphereArticle';
import { loadBlobospherePreviews } from '../loadBlobospherePreviews';
import { CreateSchema } from '../payload';
import { isBlobosphereStatus, normalizeBlobosphereStatus } from '../utils';

jest.mock('node:fs', () => ({
  promises: {
    readFile: jest.fn(),
  },
}));

jest.mock('../fs', () => ({
  listMdxFiles: jest.fn(),
}));

const mockReadFile = fs.readFile as jest.MockedFunction<typeof fs.readFile>;
const mockListMdxFiles = listMdxFiles as jest.MockedFunction<typeof listMdxFiles>;

function articleFixture(status: 'draft' | 'review' | 'published' | 'archived', slug = `article-${status}`) {
  return `---
title: "Article ${status}"
slug: "${slug}"
category: "surf"
excerpt: "Extrait ${status}"
tags: ["test"]
status: "${status}"
publishedAt: "2025-01-10"
coverImage: "/images/blobosphere/placeholder-surf.jpg"
readingTime: 2
---

# Titre ${status}

Contenu **${status}**.`;
}

describe('blobosphere editorial workflow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListMdxFiles.mockResolvedValue([
      '/repo/apps/web/content/blobosphere/surf/article-published.mdx',
      '/repo/apps/web/content/blobosphere/surf/article-draft.mdx',
      '/repo/apps/web/content/blobosphere/surf/article-review.mdx',
      '/repo/apps/web/content/blobosphere/surf/article-archived.mdx',
    ]);
    mockReadFile.mockImplementation(async (filePath: Parameters<typeof fs.readFile>[0]) => {
      const value = String(filePath);
      if (value.includes('article-published')) return articleFixture('published');
      if (value.includes('article-review')) return articleFixture('review');
      if (value.includes('article-archived')) return articleFixture('archived');
      return articleFixture('draft');
    });
  });

  it('lists only published articles on /blobosphere data loader', async () => {
    const previews = await loadBlobospherePreviews();

    expect(previews).toHaveLength(1);
    expect(previews[0]).toMatchObject({ slug: 'article-published', title: 'Article published' });
  });

  it('loads a published article by slug', async () => {
    const article = await loadPublishedBlobosphereArticleBySlug('article-published');

    expect(article).toMatchObject({
      slug: 'article-published',
      title: 'Article published',
      category: 'surf',
      body: expect.stringContaining('Contenu **published**.'),
    });
  });

  it.each(['draft', 'review', 'archived'] as const)('does not expose %s articles by slug', async (status) => {
    const article = await loadPublishedBlobosphereArticleBySlug(`article-${status}`);

    expect(article).toBeNull();
  });

  it('returns null for unknown slugs', async () => {
    const article = await loadPublishedBlobosphereArticleBySlug('inconnu');

    expect(article).toBeNull();
  });

  it('accepts only canonical workflow statuses', () => {
    expect(isBlobosphereStatus('draft')).toBe(true);
    expect(isBlobosphereStatus('review')).toBe(true);
    expect(isBlobosphereStatus('published')).toBe(true);
    expect(isBlobosphereStatus('archived')).toBe(true);
    expect(normalizeBlobosphereStatus('scheduled')).toBe('draft');
    expect(CreateSchema.safeParse({ title: 'x', slug: 'x', category: 'surf', status: 'scheduled' }).success).toBe(false);
  });
});

