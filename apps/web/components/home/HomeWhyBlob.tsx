import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Unlock, Users } from 'lucide-react';

const pillars = [
  /* key = clé sous home.why.pillars.* portant label/body */
  { id: 'beta-locale', key: 'beta', brandIcon: true },
  { id: 'gratuit', key: 'free', Icon: Unlock },
  { id: 'utile', key: 'community', Icon: Users },
] as const;

/*
 * HomeWhyBlob — section "Pourquoi Blob ?" fond sable, messaging bêta locale.
 * Full-bleed via marges négatives (-mx-4 sm:-mx-6 lg:-mx-8).
 * id="why-blob" sur la section pour l'ancre /#why-blob du header.
 * Server Component — aucun JS client.
 */
export function HomeWhyBlob() {
  const t = useTranslations('home.why');

  return (
    <section
      id="why-blob"
      aria-labelledby="why-blob-title"
      className="-mx-4 sm:-mx-6 lg:-mx-8"
    >
      <div className="bg-blob-sand px-4 pb-14 pt-16 sm:px-6 sm:pb-16 sm:pt-20 lg:px-10 lg:pb-20 lg:pt-24 xl:px-14">

        {/* Titre */}
        <div className="mb-10 sm:mb-12 lg:mb-14">
          <h2
            id="why-blob-title"
            className="text-3xl sm:text-4xl lg:text-5xl font-black uppercase tracking-widest text-blob-black"
          >
            {t('title')}
          </h2>
          <div className="mt-3 h-1 w-14 bg-blob-yellow rounded-full" aria-hidden />
        </div>

        {/* Corps : intro + 3 piliers */}
        <div className="space-y-10 lg:grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-14 lg:space-y-0 xl:gap-20">

          {/* Texte brand story */}
          <div className="space-y-4 max-w-prose">
            <p className="text-base sm:text-lg leading-relaxed text-blob-black/80 font-medium">
              {t('intro1')}
            </p>
            <p className="text-sm sm:text-base leading-relaxed text-blob-black/65">
              {t('intro2')}
            </p>
          </div>

          {/* 3 piliers */}
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3 sm:gap-8 lg:grid-cols-1 lg:pt-2 xl:grid-cols-3">
            {pillars.map(({ id, key, ...pillar }) => (
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
                    {t(`pillars.${key}.label`)}
                  </p>
                </div>
                <p className="text-sm leading-relaxed text-blob-black/60 pl-[42px] lg:pl-0 xl:pl-0">
                  {t(`pillars.${key}.body`)}
                </p>
              </div>
            ))}
          </div>

        </div>
      </div>
    </section>
  );
}
