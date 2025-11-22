"use client";

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

type Theme = 'light' | 'dark';

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
};

const STORAGE_KEY = 'blobinfini.theme';

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('light');
  const [hydrated, setHydrated] = useState(false);

  // Initial load: read from localStorage or system preference
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY) as Theme | null;
      if (saved === 'light' || saved === 'dark') {
        setThemeState(saved);
      } else {
        const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
        setThemeState(prefersDark ? 'dark' : 'light');
      }
    } catch {
      const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
      setThemeState(prefersDark ? 'dark' : 'light');
    }
    setHydrated(true);
  }, []);

  // Apply to <html> and <body> classes and persist
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const body = document.body;
    root.classList.toggle('dark', theme === 'dark');
    body?.classList.toggle('dark', theme === 'dark');
    if (hydrated) {
      try {
        window.localStorage.setItem(STORAGE_KEY, theme);
      } catch {
        // ignore
      }
    }
  }, [theme, hydrated]);

  const setTheme = (value: Theme) => setThemeState(value);
  const toggleTheme = () => setThemeState((t) => (t === 'dark' ? 'light' : 'dark'));

  const value = useMemo<ThemeContextValue>(() => ({ theme, setTheme, toggleTheme }), [theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme doit être utilisé dans <ThemeProvider>');
  return ctx;
}
