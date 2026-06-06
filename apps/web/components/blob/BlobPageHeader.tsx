import { cn } from '@/lib/utils';

export type BlobPageHeaderProps = {
  title: string;
  subtitle?: string;
  mode?: 'sand' | 'dark';
  showSeparator?: boolean;
};

export function BlobPageHeader({
  title,
  subtitle,
  mode = 'sand',
  showSeparator = true,
}: BlobPageHeaderProps) {
  const isDark = mode === 'dark';

  return (
    <header className="space-y-4">
      <div className="space-y-3">
        <h1 className="text-3xl font-black uppercase tracking-widest sm:text-4xl">
          {title}
        </h1>
        {subtitle && (
          <p className={cn('max-w-2xl text-sm leading-6 sm:text-base', isDark ? 'text-white/72' : 'text-blob-black/72')}>
            {subtitle}
          </p>
        )}
      </div>
      {showSeparator && <div className="h-1 w-20 rounded-sm bg-blob-yellow" aria-hidden="true" />}
    </header>
  );
}
