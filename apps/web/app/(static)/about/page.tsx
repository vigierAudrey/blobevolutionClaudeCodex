import { BackBar } from '@/components/BackBar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
            Nous collectons uniquement les données indispensables au fonctionnement de Blob. Aucune donnée de paiement n’est stockée : la mise en relation se fait sans transaction intégrée.
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
          <div className="space-y-2">
            <p>
              Tu gardes la main sur tes informations : un clic sur « Exporter mes données » télécharge ton historique complet au format JSON. Une demande de suppression déclenche un email de confirmation avec un délai de réflexion de 30 jours pour annuler.
            </p>
            <p>Pour plus de détails, consulte la documentation RGPD et Sécurité.</p>
          </div>
          <div className="flex gap-3">
            <Link href="/docs/rgpd" className="underline">RGPD (résumé)</Link>
            <Link href="/docs/security" className="underline">Sécurité</Link>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fonctionnement du site</CardTitle>
          <CardDescription>Choisis ton run : plusieurs parcours cohabitent sur Blob.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div>
            <h3 className="font-medium text-foreground">Matching entre riders</h3>
            <p>Renseigne ton sport (surf ou kite), ton niveau et ta position : la communauté te propose des partenaires proches pour rider ensemble, sans obligation de cours.</p>
          </div>
          <div>
            <h3 className="font-medium text-foreground">Cours & coaching pros</h3>
            <p>Besoin d’un œil expert ? Parcours les profils pros, consulte leurs disponibilités et réserve un créneau directement depuis la messagerie.</p>
          </div>
          <div>
            <h3 className="font-medium text-foreground">Visibilité auprès des pros</h3>
            <p>Active ton alerte « je cherche un coach » : les pros savent que tu es disponible et peuvent t’envoyer une proposition personnalisée.</p>
          </div>
          <div>
            <h3 className="font-medium text-foreground">Promos & bons plans</h3>
            <p>Un espace dédié aux offres communes et aux événements débarque bientôt. Tu pourras y retrouver des remises, des bons plans pour notre communauté.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Esprit communauté</CardTitle>
          <CardDescription>Blob, c’est une tribu de riders et de pros qui partagent la même vibe.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Chaque profil est une mise à l’eau possible avec un rider bienveillant.</p>
          <p>Les retours et signalements sont monitorés en continu pour garder un espace safe, inclusif et respectueux.</p>
        </CardContent>
      </Card>
    </div>
  );
}
