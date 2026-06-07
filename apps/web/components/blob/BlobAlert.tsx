import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type BlobAlertProps = {
  variant?: 'info' | 'success' | 'warning' | 'error';
  title?: string;
  children: ReactNode;
};

const variantClass: Record<NonNullable<BlobAlertProps['variant']>, string> = {
  info: 'border-blob-black/30 dark:border-white/20 bg-white dark:bg-[hsl(220_14%_14%)] text-blob-black dark:text-white',
  success: 'border-green-800 bg-green-50 text-green-950 dark:border-green-500 dark:bg-green-950/40 dark:text-green-100',
  warning: 'border-blob-yellow-dark bg-blob-yellow/20 dark:bg-blob-yellow/10 text-blob-black dark:text-white',
  error: 'border-red-800 bg-red-50 text-red-950 dark:border-red-500 dark:bg-red-950/40 dark:text-red-100',
};

const labelByVariant: Record<NonNullable<BlobAlertProps['variant']>, string> = {
  info: 'Information',
  success: 'Confirmation',
  warning: 'Attention',
  error: 'Erreur',
};

export function BlobAlert({ variant = 'info', title, children }: BlobAlertProps) {
  return (
    <div
      className={cn('rounded-sm border-2 p-4 text-sm leading-6', variantClass[variant])}
      role={variant === 'error' ? 'alert' : undefined}
      aria-live={variant === 'error' ? undefined : 'polite'}
    >
      <p className="text-xs font-black uppercase tracking-[0.14em]">
        {title ?? labelByVariant[variant]}
      </p>
      <div className="mt-1">{children}</div>
    </div>
  );
}
