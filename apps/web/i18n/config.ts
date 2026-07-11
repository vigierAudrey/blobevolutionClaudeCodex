/*
 * Configuration i18n partagée (server + client + tests).
 * Source de vérité unique pour les locales supportées et le cookie de langue.
 */

export const LOCALES = ['fr', 'en', 'es', 'de', 'nl'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'fr';

/* Nom standard lu par i18n/request.ts et écrit par LanguageSelector. */
export const LOCALE_COOKIE = 'NEXT_LOCALE';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/*
 * Résout la locale effective à partir d'une valeur de cookie non fiable
 * (absente, vide ou forgée) — fallback silencieux sur le français.
 */
export function resolveLocale(value: string | null | undefined): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}
