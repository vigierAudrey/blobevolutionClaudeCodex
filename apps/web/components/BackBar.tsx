"use client";
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from './ui/button';

export function BackBar({ fallbackHref = '/dashboard', label = 'Retour' }: { fallbackHref?: string; label?: string }) {
  const router = useRouter();

  const onBack = () => {
    // Try history back; if user landed directly, also offer the fallback link
    try {
      router.back();
    } catch {
      // no-op, link below handles fallback navigation
    }
  };

  return (
    <div className="mb-4">
      <Button variant="ghost" size="sm" onClick={onBack} className="inline-flex items-center gap-2">
        <ArrowLeft size={16} /> {label}
      </Button>
    </div>
  );
}

