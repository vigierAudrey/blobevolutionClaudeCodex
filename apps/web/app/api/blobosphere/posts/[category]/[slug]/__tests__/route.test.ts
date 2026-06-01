import { promises as fs } from 'node:fs';
import { GET } from '../route';

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

jest.mock('node:fs', () => ({
  promises: {
    readFile: jest.fn(),
  },
}));

const mockReadFile = fs.readFile as jest.MockedFunction<typeof fs.readFile>;

function requestWithAdminCookie(value?: string) {
  // Test double for the cookies subset read by the route guard.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return {
    cookies: {
      get: jest.fn(() => (value ? { value } : undefined)),
    },
  } as never;
}

describe('/api/blobosphere/posts/[category]/[slug] route', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    jest.clearAllMocks();
  });

  it('does not expose raw MDX outside development', async () => {
    process.env.NODE_ENV = 'production';

    const response = await GET(requestWithAdminCookie(), {
      params: Promise.resolve({ category: 'surf', slug: 'draft' }),
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Blobosphère CMS accessible uniquement en local.');
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('requires an admin session cookie in development', async () => {
    process.env.NODE_ENV = 'development';

    const response = await GET(requestWithAdminCookie(), {
      params: Promise.resolve({ category: 'surf', slug: 'draft' }),
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Session admin requise.');
    expect(mockReadFile).not.toHaveBeenCalled();
  });
});
