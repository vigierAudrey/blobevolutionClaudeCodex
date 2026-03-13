import robots from '../robots';

describe('app robots', () => {
  const initialNodeEnv = process.env.NODE_ENV;
  const initialSiteUrl = process.env.SITE_URL;
  const initialPublicSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

  afterEach(() => {
    process.env.NODE_ENV = initialNodeEnv;
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

  it('contains Disallow: /admin and sitemap line', () => {
    process.env.SITE_URL = 'https://blobinfini.com';
    delete process.env.NEXT_PUBLIC_SITE_URL;

    const result = robots();

    expect(result.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userAgent: '*',
          allow: '/',
          disallow: '/admin',
        }),
      ]),
    );
    expect(result.sitemap).toBe('https://blobinfini.com/sitemap.xml');
  });

  it('uses an absolute non-localhost sitemap URL in production fallback mode', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SITE_URL;
    delete process.env.NEXT_PUBLIC_SITE_URL;

    const result = robots();

    expect(result.sitemap).toBe('https://blobinfini.com/sitemap.xml');
    expect(result.sitemap).toMatch(/^https:\/\//);
    expect(result.sitemap).not.toContain('localhost');
  });
});
