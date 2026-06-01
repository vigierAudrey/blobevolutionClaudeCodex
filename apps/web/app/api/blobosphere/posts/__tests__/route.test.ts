import { listMdxFiles } from '@/lib/blobosphere/fs';
import { GET } from '../route';

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

jest.mock('@/lib/blobosphere/fs', () => ({
  listMdxFiles: jest.fn(),
}));

const mockListMdxFiles = listMdxFiles as jest.MockedFunction<typeof listMdxFiles>;

function requestWithAdminCookie(value?: string) {
  // Test double for the cookies subset read by the route guard.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return {
    cookies: {
      get: jest.fn(() => (value ? { value } : undefined)),
    },
  } as never;
}

describe('/api/blobosphere/posts route', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    jest.clearAllMocks();
  });

  it('does not expose local CMS listing outside development', async () => {
    process.env.NODE_ENV = 'production';

    const response = await GET(requestWithAdminCookie());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Blobosphère CMS accessible uniquement en local.');
    expect(mockListMdxFiles).not.toHaveBeenCalled();
  });

  it('requires an admin session cookie in development', async () => {
    process.env.NODE_ENV = 'development';

    const response = await GET(requestWithAdminCookie());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Session admin requise.');
    expect(mockListMdxFiles).not.toHaveBeenCalled();
  });
});
