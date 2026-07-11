/*
 * Garde-fou anti-dérive des traductions : chaque locale doit exposer
 * exactement les mêmes clés que le français (référence), avec des valeurs
 * non vides et les mêmes placeholders ICU. Une clé oubliée dans une langue
 * casse ce test au lieu d'afficher une IntlError en production.
 */
import fs from 'fs';
import path from 'path';
import { DEFAULT_LOCALE, LOCALES } from '../config';

const MESSAGES_DIR = path.join(__dirname, '..', '..', 'messages');

type Tree = { [key: string]: string | Tree };

function loadMessages(locale: string): Tree {
  const raw = fs.readFileSync(path.join(MESSAGES_DIR, `${locale}.json`), 'utf8');
  return JSON.parse(raw) as Tree;
}

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      out.set(fullKey, value);
    } else {
      for (const [k, v] of flatten(value, fullKey)) out.set(k, v);
    }
  }
  return out;
}

function icuPlaceholders(message: string): string[] {
  return [...message.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();
}

describe('parité des fichiers de messages', () => {
  const reference = flatten(loadMessages(DEFAULT_LOCALE));

  it('la référence française est non triviale', () => {
    expect(reference.size).toBeGreaterThan(50);
  });

  const otherLocales = LOCALES.filter((locale) => locale !== DEFAULT_LOCALE);

  describe.each(otherLocales)('%s.json', (locale) => {
    const flat = flatten(loadMessages(locale));

    it('a exactement les mêmes clés que fr.json', () => {
      const missing = [...reference.keys()].filter((key) => !flat.has(key));
      const extra = [...flat.keys()].filter((key) => !reference.has(key));
      expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    });

    it("n'a aucune valeur vide", () => {
      const empty = [...flat.entries()]
        .filter(([, value]) => value.trim() === '')
        .map(([key]) => key);
      expect(empty).toEqual([]);
    });

    it('conserve les placeholders ICU de la référence', () => {
      const mismatches = [...reference.entries()]
        .filter(([key, frValue]) => {
          const localized = flat.get(key);
          return (
            localized !== undefined &&
            JSON.stringify(icuPlaceholders(frValue)) !== JSON.stringify(icuPlaceholders(localized))
          );
        })
        .map(([key]) => key);
      expect(mismatches).toEqual([]);
    });
  });
});
