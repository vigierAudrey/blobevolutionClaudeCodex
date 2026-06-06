import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type BlobAlertProps = {
  variant?: 'info' | 'success' | 'warning' | 'error';
  title?: string;
  children: ReactNode;
};

const variantClass: Record<NonNullable<BlobAlertProps['variant']>, string> = {
  info: 'border-blob-black/30 bg-white text-blob-black',
  success: 'border-green-800 bg-green-50 text-green-950',
  warning: 'border-blob-yellow-dark bg-blob-yellow/20 text-blob-black',
  error: 'border-red-800 bg-red-50 text-red-950',
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
