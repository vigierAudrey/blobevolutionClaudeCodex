'use client';

import Link from 'next/link';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { BlobButton } from '@/components/blob/BlobButton';

const ease = [0.22, 1, 0.36, 1] as const;

const itemVariant = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease } },
};

const itemVariantReduced = {
  hidden: { opacity: 1, y: 0 },
  visible: { opacity: 1, y: 0 },
};

/*
 * HeroAnimated — Client Component isolé pour les animations d'entrée du hero.
 * Stagger: h1 → sous-titre → description → CTAs.
 * Respecte prefers-reduced-motion via useReducedMotion().
 * BlobButton gère déjà son propre hover (scale + shadow) via motion-safe:.
 */
export function HeroAnimated() {
  const t = useTranslations('home.hero');
  const reduced = useReducedMotion() === true;
  const item = reduced ? itemVariantReduced : itemVariant;

  const container = {
    hidden: {},
    visible: {
      transition: reduced
        ? {}
        : { staggerChildren: 0.11, delayChildren: 0.06 },
    },
  };

  return (
    <motion.div
      className="flex flex-col gap-4 sm:gap-5"
      variants={container}
      initial="hidden"
      animate="visible"
    >
      <motion.h1
        variants={item}
        className="text-white font-black uppercase leading-[0.95] tracking-tight text-4xl sm:text-5xl lg:text-5xl xl:text-6xl drop-shadow-[0_2px_20px_rgba(0,0,0,0.9)] max-w-xl"
      >
        {t('titleLine1')}
        <br />
        {t('titleLine2')}
      </motion.h1>

      <motion.p
        variants={item}
        className="font-display text-blob-yellow italic text-2xl sm:text-3xl lg:text-3xl xl:text-4xl leading-tight drop-shadow-[0_2px_12px_rgba(0,0,0,0.8)] max-w-xl"
      >
        {t('subtitle')}
      </motion.p>

      <motion.p
        variants={item}
        className="text-white/75 text-sm sm:text-base max-w-sm sm:max-w-md leading-relaxed"
      >
        {t('description')}
      </motion.p>

      <motion.div
        variants={item}
        className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4 mt-1 sm:mt-2"
      >
        <BlobButton asChild variant="primaryYellow" size="lg">
          <Link href="/register?intent=matching">{t('ctaRider')}</Link>
        </BlobButton>
        <BlobButton asChild variant="outlineLight" size="lg">
          <Link href="/register?intent=pro">{t('ctaPro')}</Link>
        </BlobButton>
      </motion.div>
    </motion.div>
  );
}
