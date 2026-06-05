import Image from 'next/image';
import { Unlock, Users } from 'lucide-react';

const pillars = [
  {
    id: 'beta-locale',
    brandIcon: true,
    label: 'Bêta locale',
    body: 'On commence dans le Médoc Atlantique, sans fermer la porte aux riders bordelais.',
  },
  {
    id: 'gratuit',
    Icon: Unlock,
    label: 'Gratuit & sans engagement',
    body: "Pendant la phase de test, l'inscription est gratuite. L'idée est d'observer les usages réels et d'améliorer Blob avec les retours de la communauté.",
  },
  {
    id: 'utile',
    Icon: Users,
    label: 'Utile pour la communauté',
    body: "Articles, conseils et bons plans arriveront progressivement. Plus la communauté grandira, plus Blob pourra aller chercher des offres intéressantes pour les riders, les débutants et les pros.",
  },
] as const;

/*
 * HomeWhyBlob — section "Pourquoi Blob ?" fond sable, messaging bêta locale.
 * Full-bleed via marges négatives (-mx-4 sm:-mx-6 lg:-mx-8).
 * id="why-blob" sur la section pour l'ancre /#why-blob du header.
 * Server Component — aucun JS client.
 */
export function HomeWhyBlob() {
  return (
    <section
      id="why-blob"
      aria-labelledby="why-blob-title"
      className="-mx-4 sm:-mx-6 lg:-mx-8"
    >
      <div className="bg-blob-sand px-4 sm:px-6 lg:px-10 xl:px-14 py-14 sm:py-16 lg:py-20">

        {/* Titre */}
        <div className="mb-10 sm:mb-12">
          <h2
            id="why-blob-title"
            className="text-3xl sm:text-4xl lg:text-5xl font-black uppercase tracking-widest text-blob-black"
          >
            Pourquoi Blob&nbsp;?
          </h2>
          <div className="mt-3 h-1 w-14 bg-blob-yellow rounded-full" aria-hidden />
        </div>

        {/* Corps : intro + 3 piliers */}
        <div className="space-y-10 lg:space-y-0 lg:grid lg:grid-cols-2 lg:gap-12 xl:gap-16">

          {/* Texte brand story */}
          <div className="space-y-4 max-w-prose">
            <p className="text-base sm:text-lg leading-relaxed text-blob-black/80 font-medium">
              Blob démarre comme une bêta locale autour du surf et du kite dans le Médoc
              Atlantique.
            </p>
            <p className="text-sm sm:text-base leading-relaxed text-blob-black/65">
              L&apos;idée est simple : tester si une communauté peut aider les riders, les
              débutants et les pros à se trouver plus facilement, partager les bonnes infos et
              construire des avantages utiles ensemble.
            </p>
          </div>

          {/* 3 piliers */}
          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3 gap-6 sm:gap-8">
            {pillars.map(({ id, label, body, ...pillar }) => (
              <div key={id} className="flex flex-col gap-3">
                <div className="flex items-center gap-2.5">
                  <span
                    className="flex items-center justify-center w-8 h-8 rounded-full bg-blob-yellow/30 shrink-0"
                    aria-hidden
                  >
                    {'brandIcon' in pillar ? (
                      <Image
                        src="/android-chrome-192x192.png"
                        alt=""
                        width={22}
                        height={22}
                        className="h-[22px] w-[22px] rounded-full object-cover"
                      />
                    ) : (
                      <pillar.Icon size={15} className="text-blob-black" />
                    )}
                  </span>
                  <p className="text-[11px] font-black uppercase tracking-[0.14em] text-blob-black">
                    {label}
                  </p>
                </div>
                <p className="text-sm leading-relaxed text-blob-black/60 pl-[42px] lg:pl-0 xl:pl-0">
                  {body}
                </p>
              </div>
            ))}
          </div>

        </div>
      </div>
    </section>
  );
}
