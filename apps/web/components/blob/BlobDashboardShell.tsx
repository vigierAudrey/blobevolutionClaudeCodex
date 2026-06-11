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
  actions?: ReactNode;
  children: ReactNode;
};

export function BlobDashboardShell({ title, nav = [], actions, children }: BlobDashboardShellProps) {
  return (
    <div className="min-h-screen bg-blob-sand dark:bg-blob-black text-blob-black dark:text-white">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-0 py-0 sm:px-0 lg:grid lg:grid-cols-[240px_1fr] lg:gap-6 lg:px-8 lg:py-6">

        {/* Sidebar desktop / barre compacte mobile */}
        <aside className="bg-blob-black text-white lg:rounded-sm lg:border-2 lg:border-blob-black lg:min-h-[calc(100vh-3rem)] lg:p-4">

          {/* Logo — visible uniquement desktop */}
          <div className="hidden lg:block mb-6">
            <BlobLogo variant="light" size="md" asLink />
          </div>

          {nav.length > 0 && (
            <nav aria-label="Navigation du tableau de bord">
              {/* Mobile : barre horizontale scrollable */}
              <ul className="flex flex-row gap-2 overflow-x-auto px-3 py-3 lg:hidden" role="list">
                {nav.map((item) => (
                  <li key={item.href} className="shrink-0">
                    <Link
                      href={item.href}
                      className="flex min-h-10 items-center gap-1.5 rounded-sm border border-white/15 px-3 py-2 text-[10px] font-black uppercase tracking-[0.1em] text-white transition-colors hover:border-blob-yellow hover:text-blob-yellow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow whitespace-nowrap"
                    >
                      {item.icon && <span aria-hidden="true" className="[&>svg]:h-3 [&>svg]:w-3 [&>img]:h-3 [&>img]:w-3">{item.icon}</span>}
                      <span>{item.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>

              {/* Desktop : liste verticale */}
              <ul className="hidden lg:flex lg:flex-col space-y-2" role="list">
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

        <main className="min-w-0 space-y-6 px-4 py-4 sm:px-6 lg:px-0 lg:py-0">
          <header className="rounded-sm border-2 border-blob-sand-deep dark:border-white/10 bg-white dark:bg-[hsl(220_14%_14%)] px-4 py-5 sm:px-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-blob-black/55 dark:text-white/50">
                  Tableau de bord
                </p>
                <h1 className="mt-2 break-words text-2xl font-black uppercase tracking-widest sm:text-3xl">
                  {title}
                </h1>
              </div>
              {actions && (
                <div className="flex w-full flex-wrap items-center gap-2 pt-1 sm:w-auto sm:shrink-0 sm:justify-end">
                  {actions}
                </div>
              )}
            </div>
          </header>
          <div className={cn('min-w-0')}>{children}</div>
        </main>
      </div>
    </div>
  );
}
