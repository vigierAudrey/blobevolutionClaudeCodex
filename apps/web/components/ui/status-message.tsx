import * as React from 'react';
import { cn } from '../../lib/utils';
import { CheckCircle2, XCircle, AlertCircle, Info } from 'lucide-react';

export type StatusMessageVariant = 'success' | 'error' | 'warning' | 'info';

export interface StatusMessageProps {
  variant: StatusMessageVariant;
  children: React.ReactNode;
  className?: string;
  icon?: React.ReactNode;
  role?: 'alert' | 'status';
}

const variantStyles: Record<StatusMessageVariant, string> = {
  success: 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-200',
  error: 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200',
  warning: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200',
  info: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-200',
};

const variantIcons: Record<StatusMessageVariant, React.ReactNode> = {
  success: <CheckCircle2 className="w-5 h-5" />,
  error: <XCircle className="w-5 h-5" />,
  warning: <AlertCircle className="w-5 h-5" />,
  info: <Info className="w-5 h-5" />,
};

export function StatusMessage({
  variant,
  children,
  className,
  icon,
  role = 'status',
}: StatusMessageProps) {
  const displayIcon = icon !== undefined ? icon : variantIcons[variant];

  return (
    <div
      className={cn(
        'rounded-xl border-2 px-5 py-4 text-sm shadow-sm',
        variantStyles[variant],
        className
      )}
      role={role}
      aria-live={variant === 'error' ? 'assertive' : 'polite'}
    >
      <div className="flex items-start gap-3">
        {displayIcon && <div className="flex-shrink-0 mt-0.5">{displayIcon}</div>}
        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}
