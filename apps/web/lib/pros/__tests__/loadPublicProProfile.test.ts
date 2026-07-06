import { loadPublicProProfile, loadPublicProSlugs, loadPublicProList } from '../loadPublicProProfile';

const originalFetch = global.fetch;
const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;

afterEach(() => {
  global.fetch = originalFetch;
  if (originalApiUrl === undefined) {
    delete process.env.NEXT_PUBLIC_API_URL;
  } else {
    process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
  }
  jest.resetAllMocks();
});

describe('loadPublicProProfile', () => {
  it('returns the profile on a 200 response', async () => {
    const body = { slug: 'blob-surf', businessName: 'Blob Surf', offers: [] };
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => body });

    const result = await loadPublicProProfile('blob-surf');
    expect(result).toEqual(body);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/public/pros/blob-surf'),
      expect.any(Object),
    );
  });

  it('returns null on a 404', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    expect(await loadPublicProProfile('inconnu')).toBeNull();
  });

  it('returns null when the payload is malformed', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ foo: 'bar' }) });
    expect(await loadPublicProProfile('blob-surf')).toBeNull();
  });

  it('returns null on a network error instead of throwing', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
    await expect(loadPublicProProfile('blob-surf')).resolves.toBeNull();
  });

  it('URL-encodes the slug', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    await loadPublicProProfile('a b/c');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/public/pros/a%20b%2Fc'),
      expect.any(Object),
    );
  });
});

describe('loadPublicProSlugs', () => {
  it('paginates through cursor until nextCursor is null', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ slug: 'a', updatedAt: '2026-01-01' }], nextCursor: 'a' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ slug: 'b', updatedAt: '2026-01-02' }], nextCursor: null }),
      });

    const entries = await loadPublicProSlugs();
    expect(entries).toEqual([
      { slug: 'a', updatedAt: '2026-01-01' },
      { slug: 'b', updatedAt: '2026-01-02' },
    ]);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('fails open (returns []) when the API is unreachable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('down'));
    expect(await loadPublicProSlugs()).toEqual([]);
  });

  it('fails open when the API returns a non-2xx status', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    expect(await loadPublicProSlugs()).toEqual([]);
  });
});

describe('loadPublicProList', () => {
  it('returns items and nextCursor on success', async () => {
    const body = {
      items: [{ slug: 'a', businessName: 'A', photoUrl: null, publicCity: 'Lacanau', verified: true }],
      nextCursor: 'a',
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => body });

    expect(await loadPublicProList()).toEqual(body);
  });

  it('forwards the cursor as a query param', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [], nextCursor: null }) });
    await loadPublicProList('some-cursor');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.objectContaining({ href: expect.stringContaining('cursor=some-cursor') }),
      expect.any(Object),
    );
  });

  it('fails open (empty page) on a network error', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('down'));
    expect(await loadPublicProList()).toEqual({ items: [], nextCursor: null });
  });

  it('fails open when the payload is malformed', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ foo: 'bar' }) });
    expect(await loadPublicProList()).toEqual({ items: [], nextCursor: null });
  });
});
