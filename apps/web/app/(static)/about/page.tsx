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
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>
            Nous collectons uniquement les données indispensables au fonctionnement de Blobinfini. Aucune donnée de paiement n’est stockée : la mise en relation se fait sans transaction intégrée.
          </p>
          <div className="space-y-3">
            <div>
              <h3 className="font-medium text-foreground">Particuliers (Riders)</h3>
              <ul className="list-disc pl-5 space-y-1">
                <li>Compte: email, prénom/pseudo, préférences sport, niveau.</li>
                <li>Matching: zone géographique, disponibilités, consentement de localisation.</li>
                <li>Interactions: messages, demandes de session et historique de consentement.</li>
              </ul>
            </div>
            <div>
              <h3 className="font-medium text-foreground">Professionnels (Pros)</h3>
              <ul className="list-disc pl-5 space-y-1">
                <li>Compte: email, identité pro, coordonnées publiques vérifiées.</li>
                <li>Profil public: sports enseignés, bio, zone d’activité.</li>
                <li>Organisation: créneaux proposés, demandes reçues, journal d’actions (audit).</li>
                <li>Documents professionnels partagés hors plateforme – vérification à la charge des utilisateurs.</li>
              </ul>
            </div>
          </div>
          <p>
            Sécurité : validation stricte, chiffrement, tokens courts, rotation des refresh et 2FA obligatoire pour les pros. Les données sont hébergées en Europe.
          </p>
          <p>Pour plus de détails, consulte la documentation RGPD et Sécurité.</p>
          <div className="flex gap-3">
            <Link href="/docs/rgpd" className="underline">RGPD (résumé)</Link>
            <Link href="/docs/security" className="underline">Sécurité</Link>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fonctionnement du site</CardTitle>
          <CardDescription>Déroulé d’une session — de la découverte à la confirmation.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <ol className="list-decimal pl-5 space-y-1">
            <li>Complète ton profil et active la vérification email</li>
            <li>Lance le matching et trouve des partenaires proches</li>
            <li>Envoie une demande de session et discute avec le pro</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
