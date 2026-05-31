"use client";

export const dynamic = 'force-dynamic';
import { Suspense } from 'react';
import { AuthForm } from '@/components/AuthForm';
import { BackBar } from '@/components/BackBar';

export default function RegisterPage() {
  return (
    <div className="max-w-md mx-auto pb-8">
      <BackBar fallbackHref="/" />

      <Suspense fallback={<div className="h-96 animate-pulse rounded-lg bg-muted" />}>
        <AuthForm mode="register" />
      </Suspense>
    </div>
  );
}
