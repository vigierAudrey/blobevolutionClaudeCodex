import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';

export const LOCALES = ['fr', 'en', 'es', 'de', 'nl'] as const;
export const DEFAULT_LOCALE = 'fr';

export type Locale = (typeof LOCALES)[number];

export default getRequestConfig(async () => {
  // 1. Vérifier si l'utilisateur a déjà choisi une langue (cookie)
  const cookieStore = await cookies();
  const savedLocale = cookieStore.get('NEXT_LOCALE')?.value;

  // 2. Utiliser la langue sauvegardée ou fallback FR
  const locale = (savedLocale && LOCALES.includes(savedLocale as Locale))
    ? savedLocale
    : DEFAULT_LOCALE;

  // 3. Charger les traductions
  let messages;
  try {
    messages = (await import(`../messages/${locale}.json`)).default;
  } catch (error) {
    // Fallback si fichier de traduction manquant
    console.warn(`Translation file for locale "${locale}" not found, falling back to French`);
    messages = (await import(`../messages/fr.json`)).default;
  }

  return {
    locale,
    messages,
  };
});
