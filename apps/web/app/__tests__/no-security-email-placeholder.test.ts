/**
 * Garde-fou P1 (sprint durcissement MVP) : le placeholder
 * METTRE_EMAIL_SECURITE_ICI_AVANT_PROD ne doit plus apparaître dans les
 * sources servies (pages publiques security-policy / hall-of-fame et
 * public/.well-known/security.txt). Tant qu'aucun email officiel n'existe,
 * ces surfaces doivent renvoyer vers le canal security.txt « en préparation »
 * — jamais vers une adresse factice.
 */
import * as fs from 'fs';
import * as path from 'path';

const PLACEHOLDER = 'METTRE_EMAIL' + '_SECURITE'; // évite l'auto-match de ce fichier de test
const ROOT = path.resolve(__dirname, '..', '..');
const SCAN_DIRS = ['app', 'components', 'lib', 'public'];
const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.txt', '.md', '.mdx', '.json', '.yml', '.html']);
const IGNORED_DIRS = new Set(['node_modules', '.next', 'storybook-static', '__tests__']);

function collectFiles(dir: string, acc: string[]): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      collectFiles(path.join(dir, entry.name), acc);
    } else if (SCAN_EXTENSIONS.has(path.extname(entry.name))) {
      acc.push(path.join(dir, entry.name));
    }
  }
  return acc;
}

describe('placeholder email sécurité', () => {
  it('n\'apparaît plus dans app/, components/, lib/ ni public/', () => {
    const offenders: string[] = [];
    for (const dir of SCAN_DIRS) {
      const abs = path.join(ROOT, dir);
      if (!fs.existsSync(abs)) continue;
      for (const file of collectFiles(abs, [])) {
        if (fs.readFileSync(file, 'utf8').includes(PLACEHOLDER)) {
          offenders.push(path.relative(ROOT, file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('security.txt garde un champ Contact valide (RFC 9116) sans mailto factice', () => {
    const content = fs.readFileSync(
      path.join(ROOT, 'public', '.well-known', 'security.txt'),
      'utf8',
    );
    const contactLines = content
      .split('\n')
      .filter((line) => line.startsWith('Contact:'));
    expect(contactLines.length).toBeGreaterThanOrEqual(1);
    for (const line of contactLines) {
      expect(line).toMatch(/^Contact: https:\/\//);
      expect(line).not.toContain('example.com');
    }
  });

  it('les surfaces sécurité pointent vers le domaine public canonique blobsurf.com', () => {
    // Domaine canonique confirmé par robots.ts / sitemap.ts — blobinfini.fr
    // ne doit pas réapparaître sur les surfaces de divulgation responsable.
    const securityTxt = fs.readFileSync(
      path.join(ROOT, 'public', '.well-known', 'security.txt'),
      'utf8',
    );
    const policyPage = fs.readFileSync(
      path.join(ROOT, 'app', 'security-policy', 'page.tsx'),
      'utf8',
    );

    expect(securityTxt).toMatch(/^Contact: https:\/\/blobsurf\.com\//m);
    expect(securityTxt).toMatch(/^Canonical: https:\/\/blobsurf\.com\/\.well-known\/security\.txt$/m);
    expect(securityTxt).not.toContain('blobinfini.fr');
    expect(securityTxt).not.toContain('Blobinfini');
    expect(policyPage).not.toContain('blobinfini.fr');
    expect(policyPage).not.toContain('Blobinfini');
  });
});
