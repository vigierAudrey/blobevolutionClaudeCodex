/**
 * Garde-fou P1 (sprint durcissement MVP) : le proxy OAuth Decap est réservé
 * à l'éditeur interne, lui-même désactivé en production. En production la
 * route doit répondre 404 sans jamais appeler l'upstream Netlify.
 */
import { GET, POST } from '../route';
import { isDecapAuthProxyEnabled } from '../enabled';

jest.mock('next/server', () => ({
  NextRequest: class {},
  NextResponse: class {
    status: number;
    body: unknown;
    constructor(body: unknown, init?: { status?: number }) {
      this.body = body;
      this.status = init?.status ?? 200;
    }
  },
}));

function setNodeEnv(value: string | undefined): void {
  Object.defineProperty(process.env, 'NODE_ENV', { value, writable: true, configurable: true });
}

function makeFakeRequest(method: 'GET' | 'POST') {
  // Test double for the NextRequest subset read by proxyAuth.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return {
    method,
    nextUrl: { search: '?provider=github' },
    headers: { get: () => null },
    text: async () => '',
  } as never;
}

describe('/api/decap/auth route', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalFetch = global.fetch;
  const originalHeaders = (global as Record<string, unknown>).Headers;

  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    setNodeEnv(originalNodeEnv);
    global.fetch = originalFetch;
    (global as Record<string, unknown>).Headers = originalHeaders;
    jest.clearAllMocks();
  });

  it('isDecapAuthProxyEnabled() est false en production, true sinon', () => {
    setNodeEnv('production');
    expect(isDecapAuthProxyEnabled()).toBe(false);

    setNodeEnv('development');
    expect(isDecapAuthProxyEnabled()).toBe(true);

    setNodeEnv('test');
    expect(isDecapAuthProxyEnabled()).toBe(true);
  });

  it('répond 404 en production sans contacter l\'upstream (GET)', async () => {
    setNodeEnv('production');

    const response = (await GET(makeFakeRequest('GET'))) as unknown as { status: number };

    expect(response.status).toBe(404);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('répond 404 en production sans contacter l\'upstream (POST)', async () => {
    setNodeEnv('production');

    const response = (await POST(makeFakeRequest('POST'))) as unknown as { status: number };

    expect(response.status).toBe(404);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('proxifie vers le host Netlify fixe hors production (pas de host dérivé de la requête)', async () => {
    setNodeEnv('development');
    (global as Record<string, unknown>).Headers = class {
      set() {}
    };
    (global.fetch as jest.Mock).mockResolvedValue({
      status: 200,
      body: null,
      headers: { forEach: () => undefined },
    });

    await GET(makeFakeRequest('GET'));

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(calledUrl.startsWith('https://api.netlify.com/api/v1/auth/github')).toBe(true);
  });
});
