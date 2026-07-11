import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import { DEFAULT_LOCALE, LOCALE_COOKIE, resolveLocale } from './config';

export { LOCALES, DEFAULT_LOCALE, type Locale } from './config';

export default getRequestConfig(async () => {
  // La langue vient du cookie de préférence (pas de préfixe d'URL) ;
  // toute valeur absente/invalide retombe sur le français.
  const cookieStore = await cookies();
  const locale = resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value);

  let messages;
  try {
    messages = (await import(`../messages/${locale}.json`)).default;
  } catch {
    // Fichier de traduction manquant : fallback FR plutôt qu'une 500.
    console.warn(`[i18n] messages manquants pour "${locale}", fallback "${DEFAULT_LOCALE}"`);
    messages = (await import(`../messages/${DEFAULT_LOCALE}.json`)).default;
  }

  return {
    locale,
    messages,
  };
});
