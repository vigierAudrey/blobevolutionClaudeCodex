import Link from 'next/link';
import { GraduationCap, Tag, BookOpen, type LucideIcon } from 'lucide-react';
import { BlobBrushDivider } from '@/components/blob/BlobBrushDivider';

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

/*
 * HomeYellowBar — barre jaune brush, 4 items cliquables.
 *
 * Effet peinture : BlobBrushDivider (SVG inline existant, zéro asset externe).
 *   - Haut : wrapper bg-blob-black + fill="yellow" → bord supérieur irrégulier
 *     (le noir continue du hero, le jaune monte depuis la vague).
 *   - Bas  : wrapper bg-blob-yellow + fill="background" flip → bord inférieur irrégulier
 *     (le jaune descend dans la couleur de fond de page).
 *
 * Contrôles validés :
 *   fill="yellow"      → DividerFill valide → fill-blob-yellow ✓
 *   fill="background"  → DividerFill valide → fill-background ✓ (présent CSS compilé)
 *   flip={true}        → prop valide → scaleY(-1) ✓
 *
 * Responsive : mobile 2×2 grid, sm+ 4 colonnes.
 * Accessibilité : focus-visible ring blob-black (contraste élevé sur jaune).
 * prefers-reduced-motion : aucune animation CSS → conforme d'office.
 */
export function HomeYellowBar() {
  return (
    <section
      aria-label="Accès rapide aux fonctionnalités Blob"
      className="-mx-4 sm:-mx-6 lg:-mx-8"
    >
      {/* ═══ Bord supérieur brush : dark → yellow ════════════════════════ */}
      {/*
       * Le wrapper bg-blob-black prolonge visuellement le hero sombre.
       * BlobBrushDivider fill="yellow" remplit de jaune depuis la vague vers le bas :
       * l'œil perçoit un bord supérieur irrégulier façon coup de pinceau.
       */}
      <div className="bg-blob-black overflow-hidden">
        <BlobBrushDivider fill="yellow" />
      </div>

      {/* ═══ Contenu jaune ══════════════════════════════════════════════ */}
      <div className="bg-blob-yellow">
        <div className="px-4 sm:px-6 lg:px-10 xl:px-14 py-5 sm:py-6">
          <ul
            className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-blob-yellow-dark/20"
            role="list"
          >
            {items.map((item) => {
              const Icon = item.Icon;
              return (
                <li key={item.href} className="bg-blob-yellow">
                  <Link
                    href={item.href}
                    className={[
                      'group flex flex-col items-center text-center gap-2',
                      'px-3 py-4 sm:py-5',
                      'rounded-sm',
                      'hover:bg-blob-yellow-dark',
                      'transition-colors duration-200',
                      'focus-visible:outline-none focus-visible:ring-2',
                      'focus-visible:ring-inset focus-visible:ring-blob-black',
                    ].join(' ')}
                  >
                    {/* Icône ou logo Blob */}
                    <span
                      className="flex items-center justify-center w-10 h-10 rounded-full bg-blob-black/10 group-hover:bg-blob-black/20 transition-colors duration-200"
                      aria-hidden
                    >
                      {/* Item 1 : "B" en Adlery Pro — logo de marque Blob sur fond jaune */}
                      {item.blobLogo && (
                        <span className="font-display text-blob-black text-2xl leading-none select-none">
                          B
                        </span>
                      )}
                      {/* Items 2-4 : icônes Lucide */}
                      {Icon && !item.blobLogo && (
                        <Icon size={20} className="text-blob-black" />
                      )}
                    </span>

                    {/* Label */}
                    <span className="font-bold uppercase tracking-wide text-blob-black text-[11px] sm:text-xs leading-tight">
                      {item.label}
                    </span>

                    {/* Description — masquée sur mobile, visible sm+ */}
                    <span className="hidden sm:block text-blob-black/70 text-[11px] leading-snug">
                      {item.description}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* ═══ Bord inférieur brush : yellow → background ═════════════════ */}
      {/*
       * Le wrapper bg-blob-yellow continue le fond jaune jusqu'à la vague.
       * BlobBrushDivider fill="background" flip remplit la couleur de fond
       * depuis la vague vers le bas (SVG retourné via scaleY(-1)) :
       * l'œil perçoit un bord inférieur irrégulier façon coup de pinceau.
       */}
      <div className="bg-blob-yellow overflow-hidden">
        <BlobBrushDivider fill="background" flip />
      </div>
    </section>
  );
}
