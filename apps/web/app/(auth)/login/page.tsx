"use client";

export const dynamic = 'force-dynamic';
import { AuthForm } from '@/components/AuthForm';
import { BackBar } from '@/components/BackBar';

export default function LoginPage() {
  return (
    <div className="max-w-md mx-auto">
      <BackBar fallbackHref="/" />
      <AuthForm mode="login" />
      <div className="mt-4 space-y-2 text-center">
        <div>
          <a href="/forgot-password" className="text-sm text-primary underline">
            Mot de passe oublié ?
          </a>
        </div>
        <div>
          <a href="/login-pro" className="text-sm text-blue-600 underline flex items-center justify-center gap-1">
            🔒 Connexion Pro (2FA)
          </a>
        </div>
      </div>
    </div>
  );
}
