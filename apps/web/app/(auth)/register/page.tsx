"use client";

export const dynamic = 'force-dynamic';
import { Suspense } from 'react';
import { AuthForm } from '@/components/AuthForm';
import { BackBar } from '@/components/BackBar';
import { BlobAuthLayout } from '@/components/blob/BlobAuthLayout';

export default function RegisterPage() {
  return (
    <BlobAuthLayout
      title="Inscription"
      subtitle="Crée ton accès Blob pour rejoindre la bêta locale."
    >
      <BackBar fallbackHref="/" tone="blobDark" />

      <Suspense fallback={<div className="h-96 animate-pulse rounded-sm border-2 border-blob-sand-deep bg-white" />}>
        <AuthForm mode="register" />
      </Suspense>
    </BlobAuthLayout>
  );
}
