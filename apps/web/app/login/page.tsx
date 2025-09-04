"use client";
import { AuthForm } from '../../components/AuthForm';

export default function LoginPage() {
  return (
    <div className="max-w-md mx-auto">
      <AuthForm mode="login" />
      <div className="mt-4 text-center">
        <a href="/forgot-password" className="text-sm text-primary underline">
          Mot de passe oublié ?
        </a>
      </div>
    </div>
  );
}
