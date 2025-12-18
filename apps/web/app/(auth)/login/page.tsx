"use client";

export const dynamic = 'force-dynamic';
import { AuthForm } from '@/components/AuthForm';
import { BackBar } from '@/components/BackBar';
import { KeyRound, Shield } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import Link from 'next/link';

export default function LoginPage() {
  return (
    <div className="max-w-md mx-auto pb-8">
      <BackBar fallbackHref="/" />

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
