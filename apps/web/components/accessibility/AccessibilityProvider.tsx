"use client";

import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type AccessibilityPreferences = {
  highContrast: boolean;
  largeText: boolean;
  reducedMotion: boolean;
  dyslexicFont: boolean;
};

export type AccessibilityPreferenceKey = keyof AccessibilityPreferences;

const STORAGE_KEY = 'blobinfini.accessibility-preferences';
const defaultPreferences: AccessibilityPreferences = {
  highContrast: false,
  largeText: false,
  reducedMotion: false,
  dyslexicFont: false,
};

type AccessibilityContextValue = {
  preferences: AccessibilityPreferences;
  togglePreference: (key: AccessibilityPreferenceKey) => void;
  setPreference: (key: AccessibilityPreferenceKey, value: boolean) => void;
  resetPreferences: () => void;
};

const AccessibilityContext = createContext<AccessibilityContextValue | undefined>(undefined);

const toggleClass = (element: HTMLElement | null, className: string, enabled: boolean) => {
  if (!element) return;
  element.classList.toggle(className, enabled);
};

export function AccessibilityProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<AccessibilityPreferences>(defaultPreferences);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let stored: Partial<AccessibilityPreferences> | null = null;

    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      stored = raw ? (JSON.parse(raw) as Partial<AccessibilityPreferences>) : null;
    } catch (error) {
      console.warn('[accessibility] Impossible de lire les préférences locales', error);
    }

    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const merged: AccessibilityPreferences = {
      ...defaultPreferences,
      ...stored,
      reducedMotion: stored?.reducedMotion ?? prefersReducedMotion,
    };

    setPreferences(merged);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch (error) {
      console.warn('[accessibility] Impossible d’enregistrer les préférences', error);
    }
  }, [preferences, hydrated]);

  useEffect(() => {
    if (typeof document === 'undefined' || !hydrated) return;
    const html = document.documentElement;
    const body = document.body;

    toggleClass(body, 'accessibility-high-contrast', preferences.highContrast);
    toggleClass(html, 'accessibility-large-text', preferences.largeText);
    toggleClass(body, 'accessibility-dyslexic-font', preferences.dyslexicFont);

    if (preferences.reducedMotion) {
      html.dataset.reduceMotion = 'true';
    } else {
      delete html.dataset.reduceMotion;
    }
  }, [preferences, hydrated]);

  const resetPreferences = () => {
    if (typeof window === 'undefined') return;
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const baseline: AccessibilityPreferences = { ...defaultPreferences, reducedMotion: prefersReducedMotion };
    setPreferences(baseline);

    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.warn('[accessibility] Impossible de réinitialiser les préférences', error);
    }
  };

  const contextValue = useMemo<AccessibilityContextValue>(
    () => ({
      preferences,
      togglePreference: (key) => setPreferences((previous) => ({ ...previous, [key]: !previous[key] })),
      setPreference: (key, value) => setPreferences((previous) => ({ ...previous, [key]: value })),
      resetPreferences,
    }),
    [preferences],
  );

  return <AccessibilityContext.Provider value={contextValue}>{children}</AccessibilityContext.Provider>;
}

export function useAccessibility() {
  const context = useContext(AccessibilityContext);
  if (!context) {
    throw new Error('useAccessibility doit être utilisé à l’intérieur de <AccessibilityProvider>');
  }
  return context;
}
