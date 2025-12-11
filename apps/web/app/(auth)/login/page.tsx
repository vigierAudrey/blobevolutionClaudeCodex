"use client";

export const dynamic = 'force-dynamic';
import { AuthForm } from '@/components/AuthForm';
import { BackBar } from '@/components/BackBar';
import { LogIn, KeyRound, Shield } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import Link from 'next/link';

export default function LoginPage() {
  return (
    <div className="max-w-md mx-auto pb-8">
      <BackBar fallbackHref="/" />

      {/* Hero section Peps */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-blue-600 to-cyan-500 p-6 sm:p-8 text-white shadow-xl mb-6">
        <div aria-hidden="true" className="pointer-events-none absolute top-0 right-0 -mt-8 -mr-8 h-32 w-32 rounded-full bg-white/10 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute bottom-0 left-0 -mb-8 -ml-8 h-40 w-40 rounded-full bg-white/10 blur-3xl" />
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-xl bg-white/20">
              <LogIn className="w-6 h-6" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Connexion
            </h1>
          </div>
          <p className="text-indigo-50 text-sm sm:text-base">
            Accède à ton compte BlobConnect et retrouve tes sessions !
          </p>
        </div>
      </div>

      <AuthForm mode="login" />

      {/* Liens utiles stylisés */}
      <div className="mt-6 space-y-3">
        <Link href="/forgot-password">
          <Card className="border-2 border-transparent hover:border-amber-300 transition-all duration-200 hover:shadow-lg cursor-pointer group">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 text-white group-hover:scale-110 transition-transform">
                <KeyRound size={20} />
              </div>
              <div className="flex-1">
                <p className="font-medium text-foreground">Mot de passe oublié ?</p>
                <p className="text-xs text-muted-foreground">Réinitialise ton mot de passe</p>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/login-pro">
          <Card className="border-2 border-transparent hover:border-emerald-300 transition-all duration-200 hover:shadow-lg cursor-pointer group">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-emerald-600 to-teal-600 text-white group-hover:scale-110 transition-transform">
                <Shield size={20} />
              </div>
              <div className="flex-1">
                <p className="font-medium text-foreground">Connexion Pro (2FA)</p>
                <p className="text-xs text-muted-foreground">Sécurité renforcée pour les professionnels</p>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
