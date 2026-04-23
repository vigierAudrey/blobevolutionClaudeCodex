import robots from '../robots';

describe('app robots', () => {
  let envRestore: ReturnType<typeof jest.replaceProperty<typeof process, 'env'>> | null = null;

  const replaceEnv = (overrides: Partial<NodeJS.ProcessEnv>) => {
    envRestore?.restore();
    envRestore = jest.replaceProperty(process, 'env', {
      ...process.env,
      ...overrides,
    });
  };

  afterEach(() => {
    envRestore?.restore();
    envRestore = null;
  });

  it('contains Disallow: /admin and sitemap line', () => {
    replaceEnv({
      SITE_URL: 'https://blobinfini.com',
      NEXT_PUBLIC_SITE_URL: undefined,
    });

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
    replaceEnv({
      NODE_ENV: 'production',
      SITE_URL: undefined,
      NEXT_PUBLIC_SITE_URL: undefined,
    });

    const result = robots();

    expect(result.sitemap).toBe('https://blobinfini.com/sitemap.xml');
    expect(result.sitemap).toMatch(/^https:\/\//);
    expect(result.sitemap).not.toContain('localhost');
  });
});
