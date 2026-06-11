/**
 * Garde-fou MVP : aucun lien interne mort dans l'UI.
 * Tout href statique vers un chemin interne ("/...") trouvé dans app/ et
 * components/ doit correspondre à une page App Router existante
 * (app/**&#47;page.tsx), en tenant compte des route groups "(...)".
 *
 * Hors périmètre : ancres ("/#..."), routes API ("/api/..."), hrefs
 * dynamiques (template literals avec interpolation), fichiers servis
 * depuis public/ (allowlist explicite).
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const APP_DIR = path.join(ROOT, 'app');
const SCAN_DIRS = ['app', 'components'];

function collectFiles(dir: string, ext: string[]): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      out.push(...collectFiles(full, ext));
      continue;
    }
    if (!ext.some((e) => entry.name.endsWith(e))) continue;
    if (entry.name.includes('.test.') || entry.name.includes('.stories.')) continue;
    out.push(full);
  }
  return out;
}

/** Routes statiques existantes, route groups "(...)" aplatis. */
function collectRoutes(): Set<string> {
  const routes = new Set<string>();
  const walk = (dir: string, segments: string[]) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const isGroup = entry.name.startsWith('(') && entry.name.endsWith(')');
        walk(full, isGroup ? segments : [...segments, entry.name]);
      } else if (entry.name === 'page.tsx') {
        routes.add('/' + segments.join('/'));
      }
    }
  };
  walk(APP_DIR, []);
  return routes;
}

/** Extrait les hrefs internes statiques (JSX href="..." et littéraux href: '...'). */
function extractInternalHrefs(content: string): string[] {
  const hrefs: string[] = [];
  const re = /href(?:=|:\s*)["'](\/[^"']*)["']/g;
  for (const m of content.matchAll(re)) {
    let href = m[1];
    if (href.startsWith('/#')) continue; // ancre home
    if (href.startsWith('/api/')) continue; // routes API
    href = href.split('?')[0].split('#')[0];
    // Fichiers statiques servis depuis public/ (ex: /.well-known/security.txt)
    const last = href.split('/').pop() ?? '';
    if (last.includes('.')) continue;
    if (href.length > 1 && href.endsWith('/')) href = href.slice(0, -1);
    hrefs.push(href);
  }
  return hrefs;
}

describe('aucun lien interne mort (href statique sans page)', () => {
  const routes = collectRoutes();
  const files = SCAN_DIRS.flatMap((dir) =>
    collectFiles(path.join(ROOT, dir), ['.tsx', '.ts']),
  );

  it('le scan couvre bien le routeur (sanity check)', () => {
    expect(routes.has('/dashboard')).toBe(true);
    expect(routes.has('/login')).toBe(true); // route group (auth) aplati
    expect(routes.has('/')).toBe(true); // route group (static) aplati
  });

  it('tous les hrefs statiques pointent vers une page existante', () => {
    const broken: string[] = [];
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      for (const href of extractInternalHrefs(content)) {
        if (!routes.has(href)) {
          broken.push(`${path.relative(ROOT, file)} → ${href}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });
});
