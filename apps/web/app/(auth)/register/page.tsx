"use client";

export const dynamic = 'force-dynamic';
import { AuthForm } from '@/components/AuthForm';
import { BackBar } from '@/components/BackBar';

export default function RegisterPage() {
  return (
    <div className="max-w-md mx-auto pb-8">
      <BackBar fallbackHref="/" />

      <AuthForm mode="register" />
    </div>
  );
}
