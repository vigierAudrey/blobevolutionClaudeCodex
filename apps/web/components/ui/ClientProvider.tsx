"use client";

import type { ReactNode } from 'react';

import { ToastProvider } from './toast';

export type ClientProviderProps = {
  children: ReactNode;
};

export default function ClientProvider({ children }: ClientProviderProps) {
  return <ToastProvider>{children}</ToastProvider>;
}
