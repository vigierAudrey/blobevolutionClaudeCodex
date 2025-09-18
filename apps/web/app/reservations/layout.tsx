import type { ReactNode } from 'react';
import Link from 'next/link';
import { Button } from '../../components/ui/button';

export default function ReservationsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-5xl mx-auto space-y-6 py-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Réserver un cours</h1>
          <p className="text-muted-foreground text-sm">Choisis ton sport, ton niveau et trouve le pro idéal.</p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/dashboard">Retour au tableau de bord</Link>
        </Button>
      </header>
      {children}
    </div>
  );
}
