"use client";

import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from './ThemeProvider';

export function ThemeToggle({ floating = false, showLabel = false }: { floating?: boolean; showLabel?: boolean }) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const label = isDark ? 'Passer en mode clair' : 'Passer en mode sombre';

  if (floating) {
    return (
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={label}
        className="rounded-md border border-border bg-background/90 p-2 shadow-lg backdrop-blur-sm transition hover:bg-accent hover:text-accent-foreground"
      >
        {isDark ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
        {showLabel && <span className="ml-2 text-xs">{isDark ? 'Sombre' : 'Clair'}</span>}
      </button>
    );
  }

  return (
    <Button variant="secondary" size="sm" onClick={toggleTheme} aria-label={label} className="shadow-lg">
      {isDark ? (
        <Sun className="mr-2 h-4 w-4" aria-hidden="true" />
      ) : (
        <Moon className="mr-2 h-4 w-4" aria-hidden="true" />
      )}
      {showLabel ? (isDark ? 'Sombre' : 'Clair') : label}
    </Button>
  );
}
