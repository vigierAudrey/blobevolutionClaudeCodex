"use client";
import { AuthForm } from '../../components/AuthForm';
import { BackBar } from '../../components/BackBar';

export default function LoginPage() {
  return (
    <div className="max-w-md mx-auto">
      <BackBar fallbackHref="/" />
      <AuthForm mode="login" />
      <div className="mt-4 text-center">
        <a href="/forgot-password" className="text-sm text-primary underline">
          Mot de passe oublié ?
        </a>
      </div>
    </div>
  );
}
