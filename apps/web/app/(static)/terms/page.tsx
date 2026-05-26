import { BackBar } from '@/components/BackBar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';

// ISR with 5min revalidation
export const revalidate = 300;

export const metadata = {
  title: 'Conditions Générales d\'Utilisation – Blob',
};

export default function TermsPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-8">
      <BackBar fallbackHref="/dashboard" />

      <Card>
        <CardHeader>
          <CardTitle>Conditions Générales d&apos;Utilisation (CGU)</CardTitle>
          <CardDescription>
            Dernière mise à jour : 28 décembre 2025 – Version v1.1.0
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 text-sm text-muted-foreground">
          {/* Article 1 : Objet */}
          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-foreground">1. Objet de la plateforme</h2>
            <p>
              Blob est une plateforme de mise en relation permettant aux pratiquants de sports de glisse (surf, kitesurf, etc.) de :
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Trouver des partenaires de session adaptés à leur niveau</li>
              <li>Contacter des professionnels (moniteurs, coachs) pour des cours</li>
              <li>Échanger via une messagerie sécurisée</li>
              <li>Organiser des sessions en toute autonomie</li>
            </ul>
            <p className="text-amber-800 dark:text-amber-400 font-medium bg-amber-50 dark:bg-amber-950/30 p-3 rounded-lg border border-amber-200 dark:border-amber-800/50">
              ⚠️ Blob n&apos;organise pas d&apos;activités, ne fournit ni assurance ni encadrement, et n&apos;est pas responsable des activités entre utilisateurs.
            </p>
          </section>

          {/* Article 2 : Accès */}
          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-foreground">2. Conditions d&apos;accès</h2>
            <div className="bg-blue-50 dark:bg-blue-950/30 p-4 rounded-lg border-2 border-blue-300 dark:border-blue-800/50">
              <p className="font-semibold text-blue-900 dark:text-blue-100">
                🔞 L&apos;accès à Blob est strictement réservé aux personnes majeures (18 ans et plus).
              </p>
              <p className="mt-2 text-blue-800 dark:text-blue-200">
                En créant un compte, vous certifiez avoir 18 ans révolus. Toute fausse déclaration pourra entraîner la suspension immédiate de votre compte sans préavis.
              </p>
            </div>
            <p className="mt-3">
              L&apos;inscription est gratuite et nécessite :
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Une adresse email valide</li>
              <li>Un mot de passe sécurisé (minimum 8 caractères)</li>
              <li>L&apos;acceptation des présentes CGU</li>
              <li>L&apos;acceptation de la <Link href="/securite-sessions" className="underline text-primary">Sécurité des sessions</Link></li>
            </ul>
          </section>

          {/* Article 3 : Responsabilités */}
          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-foreground">3. Responsabilités de l&apos;utilisateur</h2>
            <p>En utilisant Blob, vous vous engagez à :</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Fournir des informations exactes et à jour</li>
              <li>Respecter les autres utilisateurs</li>
              <li>Ne pas tenir de propos discriminatoires, haineux ou inappropriés</li>
              <li>Évaluer vous-même les conditions de sécurité avant toute session</li>
              <li>Vérifier les qualifications des professionnels (diplômes, assurances, etc.)</li>
              <li>Ne pas utiliser la plateforme à des fins commerciales non autorisées</li>
            </ul>
            <p className="mt-3 font-medium text-foreground">
              Vous êtes seul responsable de vos décisions, de votre sécurité et de vos biens lors des activités organisées via Blob.
            </p>
          </section>

          {/* Article 4 : Limitation de responsabilité */}
          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-foreground">4. Limitation de responsabilité de Blob</h2>
            <p>
              Blob est un simple intermédiaire technique. Nous ne sommes pas responsables :
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Des dommages corporels, matériels ou immatériels survenus lors des sessions</li>
              <li>De la véracité des informations fournies par les utilisateurs</li>
              <li>Des qualifications réelles des professionnels inscrits</li>
              <li>Des comportements inappropriés ou frauduleux entre utilisateurs</li>
              <li>Des pertes financières liées aux transactions effectuées hors plateforme</li>
            </ul>
            <p className="mt-3 text-amber-800 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 p-3 rounded-lg">
              Les sports de glisse comportent des risques inhérents. Il est fortement recommandé de souscrire une assurance personnelle adaptée.
            </p>
          </section>

          {/* Article 5 : Données personnelles */}
          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-foreground">5. Protection des données personnelles (RGPD)</h2>
            <p>
              Vos données sont traitées conformément au Règlement Général sur la Protection des Données (RGPD). Vous disposez de :
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Droit d&apos;accès</strong> : consulter vos données</li>
              <li><strong>Droit de rectification</strong> : corriger vos informations</li>
              <li><strong>Droit de suppression</strong> : supprimer votre compte (délai de rétractation de 30 jours)</li>
              <li><strong>Droit de portabilité</strong> : exporter vos données au format JSON</li>
              <li><strong>Droit d&apos;opposition</strong> : refuser certains traitements</li>
            </ul>
            <p className="mt-3">
              Pour plus de détails, consultez notre page <Link href="/about" className="underline text-primary">RGPD & Utilisation des données</Link>.
            </p>
          </section>

          {/* Article 6 : Modération */}
          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-foreground">6. Modération et sanctions</h2>
            <p>
              Nous nous réservons le droit de modérer les contenus et de suspendre ou supprimer tout compte en cas de :
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Non-respect des présentes CGU ou des règles de sécurité des sessions</li>
              <li>Comportement inapproprié, harcèlement ou discrimination</li>
              <li>Fraude ou tentative d&apos;escroquerie</li>
              <li>Usurpation d&apos;identité</li>
              <li>Utilisation de faux profils ou de bots</li>
            </ul>
            <p className="mt-3 font-medium text-foreground">
              Tout signalement est examiné dans les plus brefs délais. Les utilisateurs sanctionnés peuvent contester la décision via notre support.
            </p>
          </section>

          {/* Article 7 : Propriété intellectuelle */}
          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-foreground">7. Propriété intellectuelle</h2>
            <p>
              Tous les contenus de la plateforme (logos, textes, design, code source) sont protégés par le droit d&apos;auteur. Toute reproduction non autorisée est interdite.
            </p>
            <p>
              Les contenus que vous publiez (photos, messages, bio) restent votre propriété, mais vous accordez à Blob une licence d&apos;utilisation pour afficher ces contenus sur la plateforme.
            </p>
          </section>

          {/* Article 8 : Modifications */}
          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-foreground">8. Modifications des CGU</h2>
            <p>
              Blob se réserve le droit de modifier les présentes CGU à tout moment. Les utilisateurs seront informés par email des changements significatifs.
            </p>
            <p>
              En continuant à utiliser la plateforme après modification, vous acceptez les nouvelles conditions.
            </p>
          </section>

          {/* Article 9 : Droit applicable */}
          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-foreground">9. Droit applicable et juridiction</h2>
            <p>
              Les présentes CGU sont soumises au droit français. En cas de litige, les tribunaux français seront seuls compétents.
            </p>
          </section>

          {/* Article 10 : Contact */}
          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-foreground">10. Contact</h2>
            <p>
              Pour toute question concernant les présentes CGU, vous pouvez nous contacter via :
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>La messagerie de votre compte</li>
              <li>La page de support (à venir)</li>
            </ul>
          </section>

          {/* Liens utiles */}
          <div className="pt-6 border-t flex flex-wrap gap-4">
            <Link href="/securite-sessions" className="underline text-primary">
              Sécurité des sessions
            </Link>
            <Link href="/about" className="underline text-primary">
              RGPD & Données
            </Link>
            <Link href="/dashboard" className="underline text-primary">
              Retour au dashboard
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
