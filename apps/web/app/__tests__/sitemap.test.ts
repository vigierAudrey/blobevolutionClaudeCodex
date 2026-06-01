import { promises as fs } from 'node:fs';
import { listMdxFiles } from '@/lib/blobosphere/fs';

jest.mock('node:fs', () => ({
  promises: {
    readFile: jest.fn(),
  },
}));

jest.mock('@/lib/blobosphere/fs', () => ({
  listMdxFiles: jest.fn(),
}));

const mockReadFile = fs.readFile as jest.MockedFunction<typeof fs.readFile>;
const mockListMdxFiles = listMdxFiles as jest.MockedFunction<typeof listMdxFiles>;

let sitemap: () => Promise<Array<{ url: string; lastModified?: string | Date }>>;

describe('app sitemap', () => {
  const initialSiteUrl = process.env.SITE_URL;
  const initialPublicSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

  beforeAll(async () => {
    ({ default: sitemap } = await import('../sitemap'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SITE_URL = 'https://blobsurf.com';
    delete process.env.NEXT_PUBLIC_SITE_URL;
    mockListMdxFiles.mockResolvedValue([
      '/repo/apps/web/content/blobosphere/surf/article-z.mdx',
      '/repo/apps/web/content/blobosphere/surf/article-a.mdx',
      '/repo/apps/web/content/blobosphere/surf/article-publie.mdx',
      '/repo/apps/web/content/blobosphere/surf/article-draft.mdx',
      '/repo/apps/web/content/blobosphere/surf/article-review.mdx',
      '/repo/apps/web/content/blobosphere/surf/article-archived.mdx',
      '/repo/apps/web/content/blobosphere/surf/article-futur.mdx',
    ]);

    mockReadFile.mockImplementation(async (filePath: Parameters<typeof fs.readFile>[0]) => {
      const value = String(filePath);
      if (value.includes('article-z.mdx')) {
        return `---
title: "Article Z"
slug: "article-z"
category: "surf"
status: "published"
publishedAt: "2025-02-01T00:00:00.000Z"
---
Article Z`;
      }

      if (value.includes('article-a.mdx')) {
        return `---
title: "Article A"
slug: "article-a"
category: "surf"
status: "published"
publishedAt: "2025-02-01T00:00:00.000Z"
---
Article A`;
      }

      if (value.includes('article-draft.mdx')) {
        return `---
title: "Article draft"
slug: "article-draft"
category: "surf"
status: "draft"
publishedAt: "2025-02-01T00:00:00.000Z"
---
Draft`;
      }

      if (value.includes('article-review.mdx')) {
        return `---
title: "Article review"
slug: "article-review"
category: "surf"
status: "review"
publishedAt: "2025-02-01T00:00:00.000Z"
---
Review`;
      }

      if (value.includes('article-archived.mdx')) {
        return `---
title: "Article archived"
slug: "article-archived"
category: "surf"
status: "archived"
publishedAt: "2025-02-01T00:00:00.000Z"
---
Archived`;
      }

      if (value.includes('article-futur.mdx')) {
        return `---
title: "Article futur"
slug: "article-futur"
category: "surf"
status: "published"
publishedAt: "2099-01-01T00:00:00.000Z"
---
Futur`;
      }

      return `---
title: "Article publie"
slug: "article-publie"
category: "surf"
status: "published"
publishedAt: "2025-01-01T00:00:00.000Z"
updatedAt: "2025-01-05T00:00:00.000Z"
---
Publie`;
    });
  });

  afterEach(() => {
    if (initialSiteUrl === undefined) {
      delete process.env.SITE_URL;
    } else {
      process.env.SITE_URL = initialSiteUrl;
    }
    if (initialPublicSiteUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SITE_URL;
    } else {
      process.env.NEXT_PUBLIC_SITE_URL = initialPublicSiteUrl;
    }
  });

  it('contains /blobosphere', async () => {
    const result = await sitemap();
    const urls = result.map((entry) => entry.url);

    expect(urls).toContain('https://blobsurf.com/blobosphere');
  });

  it('contains published article slug fixture', async () => {
    const result = await sitemap();
    const urls = result.map((entry) => entry.url);

    expect(urls).toContain('https://blobsurf.com/blobosphere/article-publie');
  });

  it('keeps stable deterministic ordering (date desc, then slug asc)', async () => {
    const result = await sitemap();
    const urls = result.map((entry) => entry.url);

    expect(urls).toEqual([
      'https://blobsurf.com/blobosphere',
      'https://blobsurf.com/blobosphere/article-a',
      'https://blobsurf.com/blobosphere/article-z',
      'https://blobsurf.com/blobosphere/article-publie',
    ]);
  });

  it('never includes draft, review, archived or future fixtures', async () => {
    const result = await sitemap();
    const urls = result.map((entry) => entry.url);

    expect(urls).not.toContain('https://blobsurf.com/blobosphere/article-draft');
    expect(urls).not.toContain('https://blobsurf.com/blobosphere/article-review');
    expect(urls).not.toContain('https://blobsurf.com/blobosphere/article-archived');
    expect(urls).not.toContain('https://blobsurf.com/blobosphere/article-futur');
  });
});
