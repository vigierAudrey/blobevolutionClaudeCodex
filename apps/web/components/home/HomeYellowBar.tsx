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

/* Vague océane — rappelle l'esprit surf/kite, en cohérence avec la marque Blob.
 * gradId unique pour éviter les conflits SVG entre top et bottom. */
function WaveEdge({ flip = false, gradId }: { flip?: boolean; gradId: string }) {
  return (
    <div
      className="h-5 sm:h-7 overflow-hidden leading-none"
      aria-hidden
      style={flip ? { transform: 'scaleY(-1)' } : undefined}
    >
      <svg
        viewBox="0 0 1440 44"
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

        {/* Corps principal de la vague */}
        <path
          fill={`url(#${gradId})`}
          d="
            M0 27
            C80 22, 160 10, 260 9
            C340 8, 400 24, 480 31
            C560 37, 640 35, 720 24
            C800 12, 862 5, 944 8
            C1010 11, 1068 24, 1148 29
            C1228 34, 1304 28, 1382 20
            C1408 16, 1428 15, 1440 16
            L1440 44 L0 44 Z
          "
        />

        {/* Liseré d'écume — fin trait blanc sur la crête */}
        <path
          stroke="rgba(255,255,255,0.42)"
          strokeWidth="1.6"
          fill="none"
          strokeLinecap="round"
          d="
            M0 27
            C80 22, 160 10, 260 9
            C340 8, 400 24, 480 31
            C560 37, 640 35, 720 24
            C800 12, 862 5, 944 8
            C1010 11, 1068 24, 1148 29
            C1228 34, 1304 28, 1382 20
            C1408 16, 1428 15, 1440 16
          "
        />

        {/* Ombre portée douce sous la crête */}
        <path
          fill="rgba(0,0,0,0.07)"
          d="
            M0 30
            C80 25, 160 13, 260 12
            C340 11, 400 27, 480 34
            C560 40, 640 38, 720 27
            C800 15, 862 8, 944 11
            C1010 14, 1068 27, 1148 32
            L1148 44 L0 44 Z
          "
          opacity="0.5"
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
      {/* Vague supérieure — transition dark → jaune */}
      <div className="bg-blob-black overflow-hidden">
        <WaveEdge gradId="ybw-top" />
      </div>

      {/* Bande jaune */}
      <div
        className="relative overflow-hidden"
        style={{
          background:
            'linear-gradient(90deg, #E9AA2A 0%, #FAB914 22%, #FFD83A 54%, #F4C234 76%, #EAB03B 100%)',
        }}
      >
        {/* Texture de lumière subtile */}
        <div
          className="pointer-events-none absolute inset-0 opacity-20"
          aria-hidden
          style={{
            backgroundImage:
              'radial-gradient(circle at 12% 30%, rgba(255,255,255,0.38) 0 1px, transparent 1px), radial-gradient(circle at 78% 70%, rgba(0,0,0,0.20) 0 1px, transparent 1px)',
            backgroundSize: '34px 28px, 42px 36px',
          }}
        />

        <div className="relative px-4 sm:px-6 lg:px-10 xl:px-14 py-2 sm:py-2.5">
          <ul
            className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y divide-[rgba(17,19,24,0.15)] sm:divide-y-0"
            role="list"
          >
            {items.map((item) => {
              const Icon = item.Icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={[
                      'group flex flex-col items-center text-center gap-1.5',
                      'px-3 py-2 sm:px-4 sm:py-2',
                      'rounded-sm',
                      'hover:bg-white/10',
                      'transition-colors duration-200',
                      'focus-visible:outline-none focus-visible:ring-2',
                      'focus-visible:ring-inset focus-visible:ring-blob-black',
                    ].join(' ')}
                  >
                    {/* Icône */}
                    <span
                      className="flex items-center justify-center w-8 h-8 rounded-full bg-blob-black/10 group-hover:bg-blob-black/18 transition-colors duration-200"
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
                        <Icon size={16} className="text-blob-black" />
                      )}
                    </span>

                    {/* Label */}
                    <span className="max-w-[16ch] font-bold uppercase tracking-wide text-blob-black text-[10px] sm:text-[11px] leading-tight">
                      {item.label}
                    </span>

                    {/* Description — visible uniquement sur grand écran */}
                    <span className="hidden lg:block max-w-[22ch] text-blob-black/65 text-[10px] leading-snug">
                      {item.description}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* Vague inférieure — transition jaune → fond page */}
      <div className="bg-background overflow-hidden">
        <WaveEdge gradId="ybw-bottom" flip />
      </div>
    </section>
  );
}
