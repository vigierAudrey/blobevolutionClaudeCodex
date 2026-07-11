"use client";

export const dynamic = 'force-dynamic';
import { Suspense } from 'react';
import { useTranslations } from 'next-intl';
import { AuthForm } from '@/components/AuthForm';
import { BackBar } from '@/components/BackBar';
import { BlobAuthLayout } from '@/components/blob/BlobAuthLayout';

export default function RegisterPage() {
  const t = useTranslations('auth.register');

  return (
    <BlobAuthLayout
      title={t('title')}
      subtitle={t('subtitle')}
    >
      <BackBar fallbackHref="/" tone="blobDark" />

      <Suspense fallback={<div className="h-96 animate-pulse rounded-sm border-2 border-blob-sand-deep bg-white" />}>
        <AuthForm mode="register" />
      </Suspense>
    </BlobAuthLayout>
  );
}
