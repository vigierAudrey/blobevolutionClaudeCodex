import Image from 'next/image';
import Link from 'next/link';
import { GraduationCap, Tag, BookOpen, type LucideIcon } from 'lucide-react';

type YellowBarItem = {
  label: string;
  description: string;
  href: string;
  blobLogo?: true;
  Icon?: LucideIcon;
};

const items: YellowBarItem[] = [
  {
    label: 'Rider ou débutant',
    description: 'Trouve des partenaires pour rider et progresser.',
    href: '/register?intent=matching',
    blobLogo: true,
  },
  {
    label: 'Cours avec un pro',
    description: 'Réserve un cours avec des pros locaux.',
    href: '/register?intent=lesson-request',
    Icon: GraduationCap,
  },
  {
    label: 'Bons plans',
    description: 'Promos, matos, stages, événements.',
    href: '/promos',
    Icon: Tag,
  },
  {
    label: 'Guides & conseils',
    description: 'Tips sécurité, conditions, matos et plus encore.',
    href: '/blobosphere',
    Icon: BookOpen,
  },
];

function WaveEdge({ gradId }: { gradId: string }) {
  return (
    <div
      className="h-2.5 sm:h-3 overflow-hidden leading-none"
      aria-hidden
    >
      <svg
        viewBox="0 0 1440 24"
        preserveAspectRatio="none"
        xmlns="http://www.w3.org/2000/svg"
        className="block h-full w-full"
        focusable="false"
      >
        <defs>
          <linearGradient id={gradId} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#E9AA2A" />
            <stop offset="38%" stopColor="#FAB914" />
            <stop offset="68%" stopColor="#FFD83A" />
            <stop offset="100%" stopColor="#EAB03B" />
          </linearGradient>
        </defs>

        <path
          fill={`url(#${gradId})`}
          d="
            M0 15
            C118 11, 214 7, 332 9
            C470 11, 548 18, 692 17
            C826 16, 914 8, 1048 8
            C1182 8, 1292 15, 1440 11
            L1440 24 L0 24 Z
          "
        />

        <path
          stroke="rgba(255,255,255,0.72)"
          strokeWidth="1"
          fill="none"
          strokeLinecap="round"
          d="
            M0 15
            C118 11, 214 7, 332 9
            C470 11, 548 18, 692 17
            C826 16, 914 8, 1048 8
            C1182 8, 1292 15, 1440 11
          "
        />
      </svg>
    </div>
  );
}

export function HomeYellowBar() {
  return (
    <section
      aria-label="Accès rapide aux fonctionnalités Blob"
      className="relative z-20"
    >
      <div className="bg-blob-black overflow-hidden">
        <WaveEdge gradId="home-ribbon-wave" />
      </div>

      <div
        className="relative overflow-visible border-b border-blob-sand-deep dark:border-white/10 bg-blob-sand dark:bg-blob-black"
      >
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-blob-yellow/80"
          aria-hidden
        />

        <div className="relative px-4 sm:px-6 lg:px-10 xl:px-14 py-2.5 sm:py-3">
          <ul
            className="grid grid-cols-2 sm:grid-cols-4"
            role="list"
          >
            {items.map((item, index) => {
              const Icon = item.Icon;
              return (
                <li
                  key={item.href}
                  className={[
                    index % 2 === 1 ? 'border-l border-blob-sand-deep dark:border-white/10' : '',
                    index > 1 ? 'border-t border-blob-sand-deep dark:border-white/10' : '',
                    index > 0 ? 'sm:border-l sm:border-t-0 dark:sm:border-white/10' : '',
                  ].join(' ')}
                >
                  <Link
                    href={item.href}
                    className={[
                      'group relative flex min-h-[72px] items-center justify-center gap-2.5 text-left',
                      'px-3 py-2 sm:min-h-[68px] sm:px-4 lg:px-5',
                      'bg-blob-sand dark:bg-blob-black',
                      'hover:bg-white/55 dark:hover:bg-white/6',
                      'transition-colors duration-200 motion-reduce:transition-none',
                      'focus-visible:outline-none focus-visible:ring-2',
                      'focus-visible:ring-inset focus-visible:ring-blob-yellow',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blob-yellow/30 ring-1 ring-blob-black/5 transition-colors duration-200 group-hover:bg-blob-yellow/45 motion-reduce:transition-none',
                        item.blobLogo ? 'home-blob-pulse' : '',
                      ].join(' ')}
                      aria-hidden
                    >
                      {item.blobLogo && (
                        <Image
                          src="/images/brand/blob-b-mark-transparent.png"
                          alt=""
                          width={20}
                          height={20}
                          className="h-5 w-5 object-contain"
                        />
                      )}
                      {Icon && !item.blobLogo && (
                        <Icon size={16} className="text-blob-black dark:text-white/80" />
                      )}
                    </span>

                    <span className="flex min-w-0 flex-col">
                      <span className="font-bold uppercase tracking-wide text-blob-black dark:text-white text-[10px] sm:text-[11px] leading-tight">
                        {item.label}
                      </span>
                      <span className="hidden max-w-[22ch] pt-0.5 text-[10px] leading-snug text-blob-black/58 dark:text-white/50 sm:block lg:absolute lg:left-1/2 lg:top-[calc(100%-4px)] lg:z-30 lg:w-max lg:max-w-[210px] lg:-translate-x-1/2 lg:rounded-[4px] lg:border lg:border-blob-black/10 dark:lg:border-white/10 lg:bg-white dark:lg:bg-[hsl(220_14%_16%)] lg:px-2.5 lg:py-1.5 lg:text-center lg:opacity-0 lg:shadow-[0_10px_24px_rgba(17,19,24,0.14)] dark:lg:shadow-[0_10px_24px_rgba(0,0,0,0.5)] lg:transition-opacity lg:duration-150 lg:group-hover:opacity-100 lg:group-focus-visible:opacity-100 lg:motion-reduce:transition-none">
                        {item.description}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <style>{`
        .home-blob-pulse {
          animation: homeBlobPulse 3.2s ease-out infinite;
          transform-origin: center;
        }

        @keyframes homeBlobPulse {
          0% {
            transform: scale(1);
            box-shadow: 0 0 0 rgba(245, 192, 62, 0);
          }
          8% {
            transform: scale(1.08);
            box-shadow: 0 0 0 6px rgba(245, 192, 62, 0.18);
          }
          16% {
            transform: scale(1);
            box-shadow: 0 0 0 12px rgba(245, 192, 62, 0);
          }
          100% {
            transform: scale(1);
            box-shadow: 0 0 0 rgba(245, 192, 62, 0);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .home-blob-pulse {
            animation: none;
          }
        }
      `}</style>
    </section>
  );
}
