/**
 * Garde-fou P1 (sprint durcissement MVP) : les pages /promos et /pro/promos
 * sont des placeholders sans contenu. Aucune surface UI (pages app/ et
 * composants) ne doit exposer de CTA vers ces pages tant qu'elles ne sont
 * pas réellement développées — ni en JSX (href="/promos") ni en data
 * (href: '/promos').
 * Les pages elles-mêmes sont conservées (pas de lien externe cassé).
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');

const SCAN_DIRS = ['app', 'components'];

// Motifs interdits : lien JSX ou littéral objet vers /promos ou /pro/promos
const FORBIDDEN = /href(=|:\s*)["'`]\/(pro\/)?promos["'`]/;

function collectTsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      out.push(...collectTsxFiles(full));
      continue;
    }
    if (!entry.name.endsWith('.tsx')) continue;
    if (entry.name.includes('.test.') || entry.name.includes('.stories.')) continue;
    out.push(full);
  }
  return out;
}

describe('liens promos masqués (placeholders non MVP)', () => {
  const files = SCAN_DIRS.flatMap((dir) => collectTsxFiles(path.join(ROOT, dir)))
    // Les pages placeholder elles-mêmes sont autorisées
    .filter((f) => !f.includes(`${path.sep}promos${path.sep}`));

  it('au moins un fichier est scanné', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(files.map((f) => [path.relative(ROOT, f), f]))(
    '%s ne contient aucun lien vers /promos ou /pro/promos',
    (_rel, file) => {
      const content = fs.readFileSync(file as string, 'utf8');
      expect(content).not.toMatch(FORBIDDEN);
    },
  );

  it('les pages placeholder existent toujours (pas de lien externe cassé)', () => {
    expect(fs.existsSync(path.join(ROOT, 'app/promos/page.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, 'app/pro/promos/page.tsx'))).toBe(true);
  });
});
