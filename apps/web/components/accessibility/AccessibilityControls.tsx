"use client";

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Accessibility, ScanText, SunMoon, Type, Waves } from 'lucide-react';

import { Button } from '../ui/button';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import type { AccessibilityPreferenceKey } from './AccessibilityProvider';
import { useAccessibility } from './AccessibilityProvider';

type Control = {
  key: AccessibilityPreferenceKey;
  title: string;
  description: string;
  Icon: typeof Accessibility;
};

const controls: Control[] = [
  {
    key: 'highContrast',
    title: 'Contraste élevé',
    description: 'Renforce les couleurs et les contours pour améliorer la lisibilité.',
    Icon: SunMoon,
  },
  {
    key: 'largeText',
    title: 'Police agrandie',
    description: 'Augmente la taille globale des textes et labels.',
    Icon: Type,
  },
  {
    key: 'dyslexicFont',
    title: 'Police sans ambiguïté',
    description: 'Active une fonte lisible (Atkinson Hyperlegible) avec espacement accru.',
    Icon: ScanText,
  },
  {
    key: 'reducedMotion',
    title: 'Animations réduites',
    description: 'Désactive la plupart des animations pour éviter l’inconfort.',
    Icon: Waves,
  },
];

export function AccessibilityControls() {
  const { preferences, togglePreference, resetPreferences } = useAccessibility();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const baseId = useId();

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  const toggleLabel = useMemo(
    () => (open ? 'Fermer le panneau d’accessibilité' : 'Ouvrir le panneau d’accessibilité'),
    [open],
  );

  return (
    <div className="fixed bottom-6 right-4 z-40 flex flex-col items-end gap-2 sm:right-6">
      {/* Theme toggle always visible */}
      <ThemeToggle floating />

      <Button
        variant="secondary"
        size="sm"
        aria-haspopup="dialog"
        aria-controls="accessibility-panel"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="shadow-lg"
      >
        <Accessibility className="mr-2 h-4 w-4" aria-hidden="true" />
        {toggleLabel}
      </Button>

      {open && (
        <div
          ref={panelRef}
          id="accessibility-panel"
          role="dialog"
          aria-label="Préférences d’accessibilité"
          className="w-80 rounded-lg border border-border bg-white p-4 text-sm shadow-xl dark:bg-slate-950"
        >
          <p className="mb-3 text-xs text-muted-foreground">
            Choisissez les aides visuelles dont vous avez besoin. Vos préférences sont enregistrées dans ce navigateur.
          </p>

          <ul className="space-y-3">
            {controls.map(({ key, title, description, Icon }, index) => {
              const labelId = `${baseId}-${key}-${index}`;
              const descriptionId = `${labelId}-description`;
              return (
                <li key={key} className="rounded-md border border-border/60 p-3">
                  <label htmlFor={labelId} className="flex cursor-pointer items-start gap-3">
                    <input
                      id={labelId}
                      type="checkbox"
                      checked={preferences[key]}
                      onChange={() => togglePreference(key)}
                      aria-describedby={descriptionId}
                      className="mt-1 h-4 w-4 cursor-pointer rounded border border-border text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
                        <span className="font-medium">{title}</span>
                      </div>
                      <p id={descriptionId} className="mt-1 text-xs text-muted-foreground">
                        {description}
                      </p>
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>

          <div className="mt-4 flex items-center justify-between">
            <button
              type="button"
              onClick={resetPreferences}
              className="text-xs font-medium text-primary underline-offset-4 hover:underline"
            >
              Réinitialiser
            </button>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Fermer
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
