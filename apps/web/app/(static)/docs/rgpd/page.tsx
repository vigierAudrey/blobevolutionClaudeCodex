import { BackBar } from '@/components/BackBar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';

// ISR with 5min revalidation
export const revalidate = 300;

export const metadata = {
  title: 'RGPD résumé – Blob',
};

export default function RgpdSummaryPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-4 pb-8">
      <BackBar fallbackHref="/about" />

      <Card>
        <CardHeader>
          <CardTitle>RGPD résumé</CardTitle>
          <CardDescription>Les grandes lignes sur l’utilisation de tes données.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 text-sm text-muted-foreground">
          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-foreground">Ce que Blob collecte</h2>
            <p>
              Blob collecte les informations nécessaires au compte, au matching, aux demandes de cours,
              à la messagerie et à la sécurité de la plateforme. Aucune donnée de paiement n’est stockée.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-foreground">Pourquoi ces données sont utilisées</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>Proposer des riders proches selon ton sport, ton niveau et ta zone.</li>
              <li>Rendre une demande de cours visible aux pros concernés par leur zone d’activité.</li>
              <li>Permettre les échanges en messagerie et la modération en cas de signalement.</li>
              <li>Sécuriser les connexions, les sessions et les actions sensibles.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-foreground">Tes droits</h2>
            <p>
              Depuis ton profil, tu peux exporter tes données au format JSON. Tu peux aussi demander
              la suppression de ton compte, avec un délai de réflexion de 30 jours pour annuler.
            </p>
          </section>

          <div className="pt-4 border-t flex flex-wrap gap-4">
            <Link href="/about" className="underline text-primary">
              Retour à la page À propos
            </Link>
            <Link href="/terms" className="underline text-primary">
              CGU
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
