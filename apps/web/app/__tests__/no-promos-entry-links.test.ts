/**
 * Garde-fou P1 (sprint durcissement MVP) : les pages /promos et /pro/promos
 * sont des placeholders sans contenu. Aucune surface UI (pages app/ et
 * composants) ne doit exposer de point d'entrée vers ces pages tant qu'elles
 * ne sont pas réellement développées :
 *  - JSX : href="/promos", href={'/promos'}, href={`/promos`}
 *  - data : href: '/promos'
 *  - navigation impérative : router.push('/promos'), redirect('/promos')
 * Les pages elles-mêmes sont conservées (pas de lien externe cassé) mais
 * doivent rester noindex.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');

const SCAN_DIRS = ['app', 'components'];

// Motifs interdits : tout point d'entrée vers /promos ou /pro/promos —
// attribut JSX (avec ou sans expression container), littéral objet,
// .push()/.replace() de router, redirect() Next.
const FORBIDDEN =
  /(?:href(?:=|:)\s*\{?\s*|\.push\(\s*|\.replace\(\s*|\bredirect\(\s*)["'`]\/(?:pro\/)?promos\b/;

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      out.push(...collectSourceFiles(full));
      continue;
    }
    if (!entry.name.endsWith('.tsx') && !entry.name.endsWith('.ts')) continue;
    if (entry.name.includes('.test.') || entry.name.includes('.stories.')) continue;
    out.push(full);
  }
  return out;
}

describe('liens promos masqués (placeholders non MVP)', () => {
  const files = SCAN_DIRS.flatMap((dir) => collectSourceFiles(path.join(ROOT, dir)))
    // Les pages placeholder elles-mêmes sont autorisées
    .filter((f) => !f.includes(`${path.sep}promos${path.sep}`));

  it('au moins un fichier est scanné', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('le motif interdit détecte bien toutes les variantes connues', () => {
    const shouldMatch = [
      'href="/promos"',
      "href='/pro/promos'",
      'href={`/promos`}',
      "href={'/promos'}",
      'href={ "/promos" }',
      "href: '/promos'",
      'href: "/pro/promos"',
      "router.push('/promos')",
      'router.push( "/pro/promos" )',
      "router.replace('/promos')",
      "redirect('/promos')",
      'redirect(`/pro/promos`)',
    ];
    const shouldNotMatch = [
      'href="/promotions-legales"', // \b empêche le match partiel… sauf si la route existe vraiment
      "href='/dashboard'",
      "redirect('/admin/dashboard')",
      'const promos = [];',
      '// les promos sont hors MVP',
    ];
    for (const sample of shouldMatch) {
      expect(sample).toMatch(FORBIDDEN);
    }
    for (const sample of shouldNotMatch) {
      expect(sample).not.toMatch(FORBIDDEN);
    }
  });

  it.each(files.map((f) => [path.relative(ROOT, f), f]))(
    '%s ne contient aucun point d\'entrée vers /promos ou /pro/promos',
    (_rel, file) => {
      const content = fs.readFileSync(file as string, 'utf8');
      expect(content).not.toMatch(FORBIDDEN);
    },
  );

  it('les pages placeholder existent toujours (pas de lien externe cassé)', () => {
    expect(fs.existsSync(path.join(ROOT, 'app/promos/page.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, 'app/pro/promos/page.tsx'))).toBe(true);
  });

  it('les pages placeholder sont noindex (pas de promesse produit dans Google)', async () => {
    const promos = await import('../promos/page');
    const proPromos = await import('../pro/promos/page');
    expect(promos.metadata?.robots).toEqual({ index: false, follow: false });
    expect(proPromos.metadata?.robots).toEqual({ index: false, follow: false });
  });
});
