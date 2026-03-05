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
  beforeAll(async () => {
    ({ default: sitemap } = await import('../sitemap'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockListMdxFiles.mockResolvedValue([
      '/repo/apps/web/content/blobosphere/surf/article-publie.mdx',
      '/repo/apps/web/content/blobosphere/surf/article-draft.mdx',
      '/repo/apps/web/content/blobosphere/surf/article-futur.mdx',
    ]);

    mockReadFile.mockImplementation(async (filePath: Parameters<typeof fs.readFile>[0]) => {
      const value = String(filePath);
      if (value.includes('article-draft.mdx')) {
        return `---
title: "Article draft"
slug: "article-draft"
category: "surf"
published: false
status: "draft"
publishedAt: "2025-02-01T00:00:00.000Z"
---
Draft`;
      }

      if (value.includes('article-futur.mdx')) {
        return `---
title: "Article futur"
slug: "article-futur"
category: "surf"
published: true
status: "published"
publishedAt: "2099-01-01T00:00:00.000Z"
---
Futur`;
      }

      return `---
title: "Article publie"
slug: "article-publie"
category: "surf"
published: true
status: "published"
publishedAt: "2025-01-01T00:00:00.000Z"
updatedAt: "2025-01-05T00:00:00.000Z"
---
Publie`;
    });
  });

  it('contains /blobosphere', async () => {
    const result = await sitemap();
    const urls = result.map((entry) => entry.url);

    expect(urls).toContain('https://blobinfini.com/blobosphere');
  });

  it('contains published article slug fixture', async () => {
    const result = await sitemap();
    const urls = result.map((entry) => entry.url);

    expect(urls).toContain('https://blobinfini.com/blobosphere/article-publie');
  });

  it('never includes draft or future fixtures', async () => {
    const result = await sitemap();
    const urls = result.map((entry) => entry.url);

    expect(urls).not.toContain('https://blobinfini.com/blobosphere/article-draft');
    expect(urls).not.toContain('https://blobinfini.com/blobosphere/article-futur');
  });
});
