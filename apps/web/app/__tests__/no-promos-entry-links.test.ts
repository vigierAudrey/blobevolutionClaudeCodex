/**
 * Garde-fou P1 (sprint durcissement MVP) : les pages /promos et /pro/promos
 * sont des placeholders sans contenu. Les points d'entrée principaux
 * (dashboards rider/pro, hero Blobosphère) ne doivent plus exposer de CTA
 * vers ces pages tant qu'elles ne sont pas réellement développées.
 * Les pages elles-mêmes sont conservées (pas de lien externe cassé).
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');

const ENTRY_FILES = [
  'app/dashboard/page.tsx',
  'app/pro/dashboard/page.tsx',
  'app/blobosphere/page.tsx',
];

describe('liens promos masqués (placeholders non MVP)', () => {
  it.each(ENTRY_FILES)('%s ne contient aucun lien vers /promos ou /pro/promos', (file) => {
    const content = fs.readFileSync(path.join(ROOT, file), 'utf8');
    expect(content).not.toMatch(/href=["'`]\/promos["'`]/);
    expect(content).not.toMatch(/href=["'`]\/pro\/promos["'`]/);
  });

  it('les pages placeholder existent toujours (pas de lien externe cassé)', () => {
    expect(fs.existsSync(path.join(ROOT, 'app/promos/page.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, 'app/pro/promos/page.tsx'))).toBe(true);
  });
});
