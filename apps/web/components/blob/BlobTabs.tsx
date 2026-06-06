import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type BlobTabItem = {
  label: string;
  href?: string;
  active?: boolean;
  disabled?: boolean;
  marker?: ReactNode;
};

export type BlobTabsProps = {
  items: BlobTabItem[];
  ariaLabel?: string;
  className?: string;
};

const itemClass = (active?: boolean, disabled?: boolean) =>
  cn(
    'inline-flex min-h-10 items-center gap-2 rounded-sm border-2 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] transition-colors',
    active
      ? 'border-blob-black bg-blob-yellow text-blob-black shadow-[inset_0_-4px_0_#16181C]'
      : 'border-blob-black/30 bg-transparent text-blob-black hover:border-blob-black hover:bg-white/60',
    disabled && 'pointer-events-none opacity-45',
  );

export function BlobTabs({ items, ariaLabel = 'Navigation secondaire', className }: BlobTabsProps) {
  return (
    <nav aria-label={ariaLabel} className={className}>
      <ul className="flex flex-wrap gap-2" role="list">
        {items.map((item) => (
          <li key={`${item.href ?? item.label}-${item.label}`}>
            {item.href && !item.disabled ? (
              <Link
                href={item.href}
                aria-current={item.active ? 'page' : undefined}
                className={itemClass(item.active, item.disabled)}
              >
                {item.active && <span aria-hidden="true">▰</span>}
                <span>{item.label}</span>
                {item.marker}
              </Link>
            ) : (
              <button
                type="button"
                disabled={item.disabled}
                aria-pressed={item.active ? true : undefined}
                className={itemClass(item.active, item.disabled)}
              >
                {item.active && <span aria-hidden="true">▰</span>}
                <span>{item.label}</span>
                {item.marker}
              </button>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
