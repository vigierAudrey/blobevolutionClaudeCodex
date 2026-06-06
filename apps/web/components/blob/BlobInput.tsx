'use client';

import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export type BlobInputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  error?: string;
  hint?: string;
};

export const BlobInput = forwardRef<HTMLInputElement, BlobInputProps>(
  ({ id, label, error, hint, className, required, 'aria-describedby': ariaDescribedBy, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id ?? `blob-input-${generatedId}`;
    const hintId = hint ? `${inputId}-hint` : undefined;
    const errorId = error ? `${inputId}-error` : undefined;
    const describedBy = [ariaDescribedBy, hintId, errorId].filter(Boolean).join(' ') || undefined;

    return (
      <div className="space-y-2">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-xs font-black uppercase tracking-[0.14em] text-current"
          >
            {label}
          </label>
        )}
        <input
          id={inputId}
          ref={ref}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            'flex min-h-11 w-full rounded-sm border-2 border-blob-black/30 bg-white px-3 py-2 text-sm text-blob-black shadow-none transition-colors',
            'placeholder:text-blob-black/45',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow focus-visible:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50',
            error && 'border-red-700 focus-visible:ring-red-700',
            className,
          )}
          {...props}
        />
        {hint && (
          <p id={hintId} className="text-xs leading-5 text-current/70">
            {hint}
          </p>
        )}
        {error && (
          <p id={errorId} className="text-xs font-semibold leading-5 text-red-700">
            {error}
          </p>
        )}
      </div>
    );
  },
);
BlobInput.displayName = 'BlobInput';
