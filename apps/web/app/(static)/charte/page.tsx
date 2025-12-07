// ISR with 5min revalidation
export const revalidate = 300;

export const metadata = {
  title: 'Charte et avertissement – BlobConnect',
};

export default function ChartePage() {
  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <h1 className="text-2xl font-semibold">Charte de sécurité & avertissement</h1>
      <p className="mt-2 text-muted-foreground">
        Dernière mise à jour: 8 septembre 2025 – Version v1.0.0
      </p>

      <section className="mt-6 space-y-4">
        <p>
          BlobConnect est une plateforme de mise en relation pour partager des activités et de bons moments.
          Nous ne sommes ni un organisateur d’activités, ni une agence, ni un assureur.
          Les décisions que tu prends, les rencontres que tu effectues et les activités que tu pratiques
          relèvent de ta seule responsabilité.
        </p>
        <p>
          En utilisant la plateforme, tu reconnais et acceptes que:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>BlobConnect ne fournit aucune assurance ni couverture pour les activités réalisées entre utilisateurs.</li>
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
          Remarque: ce document n’est pas un conseil juridique. Si tu as des questions sur tes droits ou obligations,
          consulte un professionnel du droit.
        </p>
      </section>
    </div>
  );
}
