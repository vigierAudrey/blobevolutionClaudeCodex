"use client";

export const dynamic = 'force-dynamic';
import { AuthForm } from '@/components/AuthForm';
import { BackBar } from '@/components/BackBar';
import { KeyRound, Shield } from 'lucide-react';
import Link from 'next/link';
import { BlobAuthLayout } from '@/components/blob/BlobAuthLayout';

export default function LoginPage() {
  return (
    <BlobAuthLayout
      title="Connexion"
      subtitle="Retrouve tes messages, tes demandes et ta communauté surf & kite."
    >
      <BackBar fallbackHref="/" tone="blobDark" />

      <AuthForm mode="login" />

      <div className="mt-6 space-y-3">
        <Link
          href="/forgot-password"
          className="group flex items-center gap-3 rounded-sm border-2 border-blob-sand-deep bg-white p-4 text-blob-black transition-colors hover:border-blob-yellow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-sm border-2 border-blob-black bg-blob-yellow">
            <KeyRound size={20} aria-hidden="true" />
          </span>
          <span className="flex-1">
            <span className="block font-black uppercase tracking-[0.12em]">Mot de passe oublié ?</span>
            <span className="block text-xs text-blob-black/65">Réinitialise ton mot de passe</span>
          </span>
        </Link>

        <Link
          href="/login-pro"
          className="group flex items-center gap-3 rounded-sm border-2 border-blob-black bg-blob-black p-4 text-white transition-colors hover:border-blob-yellow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-sm border-2 border-blob-yellow bg-blob-yellow text-blob-black">
            <Shield size={20} aria-hidden="true" />
          </span>
          <span className="flex-1">
            <span className="block font-black uppercase tracking-[0.12em]">Connexion Pro (2FA)</span>
            <span className="block text-xs text-white/65">Sécurité renforcée pour les professionnels</span>
          </span>
        </Link>
      </div>
    </BlobAuthLayout>
  );
}
