import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BackBar } from '@/components/BackBar';
import Link from 'next/link';

// ISR with 5min revalidation
export const revalidate = 300;

export default function AboutPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <BackBar fallbackHref="/dashboard" />
      <Card>
        <CardHeader>
          <CardTitle>RGPD & Utilisation des données</CardTitle>
          <CardDescription>Transparence, sécurité et respect de ta vie privée.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Nous collectons uniquement les données nécessaires au fonctionnement de la plateforme (authentification, profil, matching, paiements).
            Tu gardes le contrôle: export, suppression et consentement sont au cœur du produit.
          </p>
          <p>
            Sécurité: validation stricte, chiffrement, tokens courts, rotation des refresh, et 2FA pour les pros (à venir). Les données sont hébergées en Europe.
          </p>
          <p>
            Pour plus de détails, consulte la documentation RGPD et Sécurité.
          </p>
          <div className="flex gap-3">
            <Link href="/docs/rgpd" className="underline">RGPD (résumé)</Link>
            <Link href="/docs/security" className="underline">Sécurité</Link>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fonctionnement du site</CardTitle>
          <CardDescription>Déroulé d’une session — de la recherche au paiement.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <ol className="list-decimal pl-5 space-y-1">
            <li>Complète ton profil et active la vérification email</li>
            <li>Lance le matching et trouve des partenaires proches</li>
            <li>Planifie une session et règle via paiement sécurisé</li>
            <li>Profite et gagne des “Flocons d’avoine”</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
