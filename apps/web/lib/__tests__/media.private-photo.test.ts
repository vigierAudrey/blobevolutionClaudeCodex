import fs from 'node:fs';
import path from 'node:path';
import { resolveProfilePhotoSrc } from '../media';

const userId = '11111111-1111-1111-1111-111111111111';
const objectId = '22222222-2222-2222-2222-222222222222';

describe('private rider media URL resolution', () => {
  it('convertit une URL storage users/* en route API authentifiée sans token', () => {
    const resolved = resolveProfilePhotoSrc(
      `https://storage.blobsurf.com/blobinfini-dev/users/${userId}/${objectId}.webp`,
    );

    expect(resolved).toBe(`http://localhost:4000/media/users/${userId}/photo`);
    expect(resolved).not.toContain('X-Amz-');
    expect(resolved).not.toContain('?');
  });

  it('préserve une URL publique pros/* inchangée', () => {
    const proUrl = `https://storage.blobsurf.com/blobinfini-dev/pros/${userId}/${objectId}.webp`;
    expect(resolveProfilePhotoSrc(proUrl)).toBe(proUrl);
  });

  it('préfixe une route média API relative', () => {
    expect(resolveProfilePhotoSrc(`/media/users/${userId}/photo`)).toBe(
      `http://localhost:4000/media/users/${userId}/photo`,
    );
  });

  it('aucun <img>/<Image> web hors écrans pro ne branche directement une photoUrl privée potentielle', () => {
    const root = path.resolve(__dirname, '..', '..');
    const allowedProFiles = new Set([
      path.join(root, 'app/pro/profile/page.tsx'),
      path.join(root, 'app/pro/profile/preview/page.tsx'),
    ]);
    const violations: string[] = [];

    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'dist') continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
          continue;
        }
        if (!/\.(tsx|ts)$/.test(entry.name) || allowedProFiles.has(fullPath)) continue;
        const content = fs.readFileSync(fullPath, 'utf8');
        const pattern = /<(?:Image|img)\b[^>\n]*src=\{[^}]*\b(?:photoUrl|otherPhotoUrl|senderPhotoUrl|inviterPhotoUrl)\b/g;
        if (pattern.test(content)) {
          violations.push(path.relative(root, fullPath));
        }
      }
    }

    walk(root);

    expect(violations).toEqual([]);
  });
});
