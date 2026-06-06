import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { BlobLogo } from './BlobLogo';

export type BlobDashboardNavItem = {
  label: string;
  href: string;
  icon?: ReactNode;
};

export type BlobDashboardShellProps = {
  title: string;
  nav?: BlobDashboardNavItem[];
  children: ReactNode;
};

export function BlobDashboardShell({ title, nav = [], children }: BlobDashboardShellProps) {
  return (
    <div className="min-h-screen bg-blob-sand text-blob-black">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:grid lg:grid-cols-[240px_1fr] lg:px-8">
        <aside className="rounded-sm border-2 border-blob-black bg-blob-black p-4 text-white lg:min-h-[calc(100vh-3rem)]">
          <div className="mb-6">
            <BlobLogo variant="light" size="md" asLink />
          </div>
          {nav.length > 0 && (
            <nav aria-label="Navigation du tableau de bord">
              <ul className="space-y-2" role="list">
                {nav.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="flex min-h-10 items-center gap-3 rounded-sm border-2 border-white/15 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-white transition-colors hover:border-blob-yellow hover:text-blob-yellow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow"
                    >
                      {item.icon && <span aria-hidden="true">{item.icon}</span>}
                      <span>{item.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </aside>

        <main className="min-w-0 space-y-6">
          <header className="rounded-sm border-2 border-blob-sand-deep bg-white px-4 py-5 sm:px-6">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-blob-black/55">
              Tableau de bord
            </p>
            <h1 className="mt-2 text-2xl font-black uppercase tracking-widest sm:text-3xl">
              {title}
            </h1>
          </header>
          <div className={cn('min-w-0')}>{children}</div>
        </main>
      </div>
    </div>
  );
}
