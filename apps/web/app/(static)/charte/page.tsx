// ISR with 5min revalidation
export const revalidate = 300;

export const metadata = {
  title: 'Charte et avertissement – Blob',
};

export default function ChartePage() {
  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <h1 className="text-2xl font-semibold">Charte de sécurité & avertissement</h1>
      <p className="mt-2 text-muted-foreground">
        Dernière mise à jour : 28 décembre 2025 – Version v1.1.0
      </p>

      <section className="mt-6 space-y-4">
        <div className="bg-blue-100 dark:bg-blue-950/30 p-4 rounded-lg border-2 border-blue-400 dark:border-blue-800/50">
          <p className="font-semibold text-blue-900 dark:text-blue-100">
            🔞 L&apos;utilisation de Blob est strictement réservée aux personnes majeures (18 ans et plus).
          </p>
          <p className="mt-2 text-blue-800 dark:text-blue-200 text-sm">
            Les sports de glisse comportent des risques. En tant qu&apos;utilisateur majeur, tu es pleinement responsable de tes choix et de ta sécurité.
          </p>
        </div>
        <p>
          Blob est une plateforme de mise en relation pour partager des activités et de bons moments.
          Nous ne sommes ni un organisateur d&apos;activités, ni une agence, ni un assureur.
          Les décisions que tu prends, les rencontres que tu effectues et les activités que tu pratiques
          relèvent de ta seule responsabilité.
        </p>
        <p>
          En utilisant la plateforme, tu reconnais et acceptes que:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>Blob ne fournit aucune assurance ni couverture pour les activités réalisées entre utilisateurs.</li>
          <li>Les utilisateurs organisent et participent aux activités à leurs risques et périls.</li>
          <li>Tu es responsable d’évaluer les conditions (météo, niveau technique, équipement, lieu) et d’y renoncer si nécessaire.</li>
          <li>Tu restes vigilant face à tout comportement inapproprié, frauduleux ou malveillant.</li>
        </ul>
        <p>
          Conseils de prudence:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>Privilégie des rendez‑vous dans des lieux publics et informe un proche de tes plans.</li>
          <li>Vérifie la compatibilité des attentes (niveau, durée, matériel) avant la rencontre.</li>
          <li>Apporte le matériel de sécurité adéquat et respecte les règles locales applicables.</li>
          <li>Interromps l’activité si tu ne te sens pas en sécurité ou à l’aise.</li>
        </ul>
        <p>
          Si tu rencontres un profil problématique, signale‑le promptement afin que nous puissions intervenir.
        </p>
        <p className="text-sm text-muted-foreground">
          Remarque: ce document n&apos;est pas un conseil juridique. Si tu as des questions sur tes droits ou obligations,
          consulte un professionnel du droit.
        </p>
        <div className="pt-4 border-t mt-6">
          <p className="text-sm text-muted-foreground">
            Pour plus de détails sur les conditions d&apos;utilisation, consulte les{' '}
            <a href="/terms" className="underline text-primary">
              Conditions Générales d&apos;Utilisation (CGU)
            </a>
            .
          </p>
        </div>
      </section>
    </div>
  );
}
