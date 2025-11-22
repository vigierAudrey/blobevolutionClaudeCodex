"use client";

import type { ReactNode } from 'react';

import { ToastProvider } from './toast';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { AccessibilityProvider } from '@/components/accessibility/AccessibilityProvider';
import { AccessibilityControls } from '@/components/accessibility/AccessibilityControls';

export type ClientProviderProps = {
  children: ReactNode;
};

export default function ClientProvider({ children }: ClientProviderProps) {
  return (
    <ThemeProvider>
      <AccessibilityProvider>
        <ToastProvider>{children}</ToastProvider>
        {/* Floating access panel + dark mode toggle */}
        <AccessibilityControls />
      </AccessibilityProvider>
    </ThemeProvider>
  );
}
