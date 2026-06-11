/**
 * Garde-fou MVP : le dashboard admin ne doit plus exposer la carte
 * « Configuration » dont les trois boutons (Paramètres généraux,
 * Monétisation & publicités, Maintenance système) n'étaient câblés à
 * aucune action ni page. Toute réintroduction doit venir avec une vraie
 * page cible ou un handler.
 */
import * as fs from 'fs';
import * as path from 'path';

const PAGE = path.resolve(__dirname, '..', 'page.tsx');

describe('admin dashboard — aucun bouton mort', () => {
  const content = fs.readFileSync(PAGE, 'utf8');

  it.each([
    'Paramètres généraux',
    'Monétisation & publicités',
    'Maintenance système',
  ])('ne contient plus le bouton mort « %s »', (label) => {
    expect(content).not.toContain(label);
  });

  it('chaque <Button> de la page est câblé (asChild, onClick ou type)', () => {
    // Découpe sur chaque ouverture de Button et inspecte ses attributs
    const chunks = content.split('<Button').slice(1);
    for (const chunk of chunks) {
      const attrs = chunk.slice(0, chunk.indexOf('>'));
      expect(attrs).toMatch(/asChild|onClick|type=/);
    }
  });
});
