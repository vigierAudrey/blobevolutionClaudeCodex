import robots from '../robots';

describe('app robots', () => {
  it('contains Disallow: /admin and sitemap line', () => {
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
});
