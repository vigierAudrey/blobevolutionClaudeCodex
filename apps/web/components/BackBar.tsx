"use client";
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from './ui/button';

type BackBarProps = {
  fallbackHref?: string;
  label?: string;
};

export function BackBar({ fallbackHref = '/dashboard', label = 'Retour' }: BackBarProps) {
  const router = useRouter();

  const onBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push(fallbackHref);
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
