import { Router } from 'express';
import { loadPublishedBlobosphereArticles } from '../../services/blobosphere-content.service';

export const blobospherePublicRouter = Router();

blobospherePublicRouter.get('/articles', async (_req, res) => {
  const items = await loadPublishedBlobosphereArticles();
  const response = items
    .map((article) => ({
      title: article.title,
      slug: article.slug,
      excerpt: article.excerpt,
      publishedAt: article.publishedAt,
      cover: article.cover,
    }))
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

  return res.json({ items: response });
});

blobospherePublicRouter.get('/articles/:slug', async (req, res) => {
  const slug = String(req.params.slug || '').toLowerCase();
  if (!slug.match(/^[a-z0-9-]{1,80}$/)) {
    return res.status(400).json({ error: 'Invalid slug' });
  }

  const items = await loadPublishedBlobosphereArticles();
  const found = items.find((article) => article.slug === slug);
  if (!found) {
    return res.status(404).json({ error: 'Not found' });
  }

  return res.json({
    title: found.title,
    slug: found.slug,
    excerpt: found.excerpt,
    publishedAt: found.publishedAt,
    cover: found.cover,
  });
});
