import { BackBar } from '@/components/BackBar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';

// ISR with 5min revalidation
export const revalidate = 300;

export const metadata = {
  title: 'Sécurité · Blob',
};

export default function SecuritySummaryPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-4 pb-8">
      <BackBar fallbackHref="/about" />

      <Card>
        <CardHeader>
          <CardTitle>Sécurité</CardTitle>
          <CardDescription>Les mesures principales qui protègent les comptes et les échanges.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 text-sm text-muted-foreground">
          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-foreground">Comptes et connexions</h2>
            <p>
              Blob utilise des validations strictes, des sessions sécurisées, des tokens courts et une
              rotation des refresh tokens. La double authentification est obligatoire pour les comptes pros.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-foreground">Messages et rencontres</h2>
            <p>
              Les utilisateurs organisent leurs sessions et leurs cours en autonomie dans la messagerie.
              Les signalements sont suivis pour garder un espace respectueux et limiter les abus.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-foreground">Bonnes pratiques</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>Vérifie le niveau, le spot, la météo et le matériel avant une session.</li>
              <li>Pour un cours, demande les informations utiles au pro directement dans la conversation.</li>
              <li>Signale rapidement un comportement suspect ou inapproprié.</li>
            </ul>
          </section>

          <div className="pt-4 border-t flex flex-wrap gap-4">
            <Link href="/about" className="underline text-primary">
              Retour à la page À propos
            </Link>
            <Link href="/securite-sessions" className="underline text-primary">
              Sécurité des sessions
            </Link>
            <Link href="/security-policy" className="underline text-primary">
              Politique de sécurité
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
