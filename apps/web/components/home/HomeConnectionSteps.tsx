/*
 * HomeConnectionSteps — "Blob te connecte" section, mode Sand Paper.
 * Extraite de page.tsx (LOT 3). Textes validés, conservés tels quels.
 * Mobile : empilement vertical (lecture séquentielle).
 * Desktop : 3 colonnes.
 * Animations : blob-reveal en cascade, motion-safe.
 */
const steps = [
  {
    n: '01',
    title: 'Exprime ton envie',
    body: 'Niveau, dispo, ambiance : tu poses ton intention.',
  },
  {
    n: '02',
    title: 'Rencontre les bons profils',
    body: 'Riders ou pros locaux, selon ce que tu cherches vraiment.',
  },
  {
    n: '03',
    title: 'Ride en communauté',
    body: "Tu échanges, tu organises, tu gardes l'esprit glisse.",
  },
] as const;

export function HomeConnectionSteps() {
  return (
    <section
      aria-labelledby="blob-connects"
      className="rounded-2xl bg-blob-sand overflow-hidden px-6 py-10 sm:px-10 space-y-8"
    >
      {/* En-tête */}
      <div className="space-y-3">
        <div className="h-px w-12 bg-blob-yellow rounded-full" aria-hidden />
        <h2
          id="blob-connects"
          className="text-2xl sm:text-3xl font-black uppercase tracking-widest text-blob-black"
        >
          Blob te connecte
        </h2>
      </div>

      {/* Étapes */}
      <ol
        className="grid grid-cols-1 sm:grid-cols-3 gap-8 sm:gap-6"
        aria-label="Comment Blob te connecte"
      >
        {steps.map((step, i) => (
          <li
            key={step.n}
            className={[
              'flex flex-col gap-2',
              'motion-safe:animate-blob-reveal',
              i === 0 ? 'blob-stagger-1' : i === 1 ? 'blob-stagger-2' : 'blob-stagger-3',
            ].join(' ')}
          >
            {/* Numéro — signature visuelle forte */}
            <span
              className="text-5xl font-black text-blob-yellow leading-none"
              aria-hidden
            >
              {step.n}
            </span>

            <p className="font-bold uppercase tracking-wide text-blob-black text-sm sm:text-base">
              {step.title}
            </p>

            <p className="text-sm text-blob-black/65 leading-relaxed">
              {step.body}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
