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
    const canNavigateBack =
      typeof window !== 'undefined' &&
      typeof window.history.state?.idx === 'number' &&
      window.history.state.idx > 0;

    if (canNavigateBack) {
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
