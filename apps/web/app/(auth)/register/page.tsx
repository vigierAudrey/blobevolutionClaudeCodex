"use client";

export const dynamic = 'force-dynamic';
import { AuthForm } from '@/components/AuthForm';
import { BackBar } from '@/components/BackBar';
import { Sparkles } from 'lucide-react';

export default function RegisterPage() {
  return (
    <div className="max-w-md mx-auto pb-8">
      <BackBar fallbackHref="/" />

      {/* Hero section Peps */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-blue-500 via-cyan-500 to-teal-400 p-6 sm:p-8 text-white shadow-xl mb-6">
        <div aria-hidden="true" className="pointer-events-none absolute top-0 right-0 -mt-8 -mr-8 h-32 w-32 rounded-full bg-white/10 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute bottom-0 left-0 -mb-8 -ml-8 h-40 w-40 rounded-full bg-white/10 blur-3xl" />
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-xl bg-white/20">
              <Sparkles className="w-6 h-6" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Inscription
            </h1>
          </div>
          <p className="text-blue-50 text-sm sm:text-base">
            Crée ton compte pour rejoindre la communauté BlobConnect et rider avec d'autres passionnés !
          </p>
        </div>
      </div>

      <AuthForm mode="register" />
    </div>
  );
}
