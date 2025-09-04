"use client";
import { AuthForm } from '../../components/AuthForm';
import { BackBar } from '../../components/BackBar';

export default function RegisterPage() {
  return (
    <div className="max-w-md mx-auto">
      <BackBar fallbackHref="/" />
      <h1 className="text-2xl font-semibold mb-4">Inscription</h1>
      <p className="text-sm text-gray-600 mb-4">Crée ton compte pour rejoindre la communauté.</p>
      <AuthForm mode="register" />
    </div>
  );
}
