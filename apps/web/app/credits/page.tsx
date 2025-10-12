"use client";

import { BackBar } from '../../components/BackBar';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import Link from 'next/link';

export default function CreditsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <BackBar fallbackHref="/dashboard" />
      <Card>
        <CardHeader>
          <CardTitle>Paiements désactivés</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Le porte-monnaie virtuel et les paiements sont actuellement désactivés dans Blobinfini.</p>
          <p>
            Vous pouvez continuer à utiliser le matching et la messagerie sans frais. Pour toute
            question, contactez-nous via le centre d&apos;aide.
          </p>
          <Link href="/dashboard" className="underline text-primary">
            Retour au tableau de bord
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
