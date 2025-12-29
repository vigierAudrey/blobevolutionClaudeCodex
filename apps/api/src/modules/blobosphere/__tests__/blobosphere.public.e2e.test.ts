import request from 'supertest';
import jwt from 'jsonwebtoken';
import path from 'node:path';
import fs from 'node:fs/promises';
import { clientPrisma as prisma } from '@blobinfini/database';
import { createApp } from '../../../index';

const app = createApp();

const slug = 'test-blobosphere-public';
const category = 'surf';
const contentDir = path.join(process.cwd(), 'apps', 'web', 'content', 'blobosphere', category);
const filePath = path.join(contentDir, `${slug}.mdx`);

const allowedKeys = ['title', 'slug', 'excerpt', 'publishedAt', 'cover'];

function ensureSecrets() {
  process.env.JWT_SECRET ||= 'test-jwt-secret';
  process.env.SESSION_SECRET ||= 'test-session-secret';
}

let userToken = '';
let userId = '';

async function seedContent() {
  await fs.mkdir(contentDir, { recursive: true });
  const mdx = `---\n` +
    `title: "Guide test"\n` +
    `slug: "${slug}"\n` +
    `category: "${category}"\n` +
    `excerpt: "Test public"\n` +
    `status: "published"\n` +
    `publishedAt: "2025-01-01"\n` +
    `coverImage: "https://example.com/cover.jpg"\n` +
    `---\n\n` +
    `Contenu test.`;
  await fs.writeFile(filePath, mdx, 'utf8');
}

async function cleanup() {
  await fs.rm(filePath, { force: true });
  if (userId) {
    await prisma.user.deleteMany({ where: { id: userId } });
  }
}

describe('Blobosphere public endpoints', () => {
  beforeAll(async () => {
    ensureSecrets();
    await seedContent();
    const user = await prisma.user.create({
      data: {
        email: 'blobosphere-public@test.com',
        password: 'hash',
        role: 'RIDER',
        emailVerified: true,
      },
    });
    userId = user.id;
    userToken = jwt.sign({ sub: user.id, role: 'RIDER' }, process.env.JWT_SECRET!, { expiresIn: '1h' });
  });

  afterAll(async () => {
    await cleanup();
  });

  it('lists only public fields', async () => {
    const res = await request(app)
      .get('/blobosphere/articles')
      .expect(200);

    const item = res.body.items.find((entry: { slug: string }) => entry.slug === slug);
    expect(item).toBeTruthy();
    expect(Object.keys(item).sort()).toEqual(allowedKeys.slice().sort());
  });

  it('returns a single article without private data', async () => {
    const res = await request(app)
      .get(`/blobosphere/articles/${slug}`)
      .expect(200);

    expect(Object.keys(res.body).sort()).toEqual(allowedKeys.slice().sort());
  });

  it('returns the same payload for anon and authenticated users', async () => {
    const anon = await request(app)
      .get(`/blobosphere/articles/${slug}`)
      .expect(200);

    const authed = await request(app)
      .get(`/blobosphere/articles/${slug}`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(authed.body).toEqual(anon.body);
  });
});
