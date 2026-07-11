'use client';

import { useLocale, useTranslations } from 'next-intl';
import { setCookie } from 'cookies-next';
import { useState, useEffect } from 'react';
import { LOCALE_COOKIE, type Locale } from '@/i18n/config';
import { hardReload } from '@/lib/hardReload';

const LANGUAGES: ReadonlyArray<{ code: Locale; flag: string; label: string }> = [
  { code: 'fr', flag: '🇫🇷', label: 'Français' },
  { code: 'en', flag: '🇬🇧', label: 'English' },
  { code: 'es', flag: '🇪🇸', label: 'Español' },
  { code: 'de', flag: '🇩🇪', label: 'Deutsch' },
  { code: 'nl', flag: '🇳🇱', label: 'Nederlands' },
];

export function LanguageSelector() {
  const locale = useLocale();
  const t = useTranslations('language');
  const [isOpen, setIsOpen] = useState(false);
  const [isChanging, setIsChanging] = useState(false);

  const currentLang = LANGUAGES.find(lang => lang.code === locale) || LANGUAGES[0];

  useEffect(() => {
    // Close dropdown when clicking outside
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-language-selector]')) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [isOpen]);

  const handleLanguageChange = async (newLocale: string) => {
    if (newLocale === locale || isChanging) return;

    setIsChanging(true);
    setIsOpen(false);

    // Save preference (expires in 1 year)
    setCookie(LOCALE_COOKIE, newLocale, {
      maxAge: 365 * 24 * 60 * 60,
      path: '/',
      sameSite: 'lax',
    });

    // Refresh the page to apply new language
    // Full reload : re-rend les Server Components et met à jour <html lang>
    hardReload();
  };

  return (
    <div className="relative" data-language-selector>
      {/* Current language button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label={t('select')}
        disabled={isChanging}
      >
        <span className="text-xl" aria-hidden="true">{currentLang.flag}</span>
        <span className="hidden sm:inline text-sm font-medium">{currentLang.label}</span>
        <svg
          className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {isOpen && !isChanging && (
        <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              onClick={() => handleLanguageChange(lang.code)}
              className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors first:rounded-t-lg last:rounded-b-lg ${
                locale === lang.code ? 'bg-blue-50 dark:bg-blue-900/20' : ''
              }`}
              disabled={locale === lang.code}
            >
              <span className="text-2xl" aria-hidden="true">{lang.flag}</span>
              <span className="text-sm font-medium">{t(lang.code)}</span>
              {locale === lang.code && (
                <svg
                  className="w-4 h-4 ml-auto text-blue-600"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                  aria-label="Selected"
                >
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
