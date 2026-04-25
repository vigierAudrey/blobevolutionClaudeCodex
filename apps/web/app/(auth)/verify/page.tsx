"use client";

export const dynamic = 'force-dynamic';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BackBar } from '@/components/BackBar';

function VerifyInner() {
  const search = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<'idle' | 'success' | 'error' | 'loading'>('idle');
  const [message, setMessage] = useState<string>('');
  const [redirectTo, setRedirectTo] = useState<string>('/login');

  useEffect(() => {
    const t = search.get('token');
    if (t) {
      // Remove token from URL bar immediately after reading it — token must not
      // linger in the address bar or browser history after submission.
      window.history.replaceState(null, '', '/verify');
      void verify(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const verify = async (t: string) => {
    setStatus('loading');
    setMessage('');
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/auth/verify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: t }),
      });
      if (!res.ok) {
        setStatus('error');
        setMessage('Lien invalide ou expiré. Demande un nouveau lien de vérification.');
        return;
      }
      const data = (await res.json()) as { message?: string; role?: string };
      const destination = data.role === 'PRO' ? '/login-pro' : '/login';
      setRedirectTo(destination);
      setStatus('success');
      setMessage('Email vérifié avec succès. Redirection…');
    } catch {
      setStatus('error');
      setMessage('Une erreur est survenue. Réessaie ou demande un nouveau lien.');
    }
  };

  useEffect(() => {
    if (status === 'success') {
      const id = setTimeout(() => router.replace(redirectTo), 2000);
      return () => clearTimeout(id);
    }
  }, [status, redirectTo, router]);

  return (
    <div className="max-w-md mx-auto">
      <BackBar fallbackHref="/" />
      <Card>
        <CardHeader>
          <CardTitle>Vérification de l&apos;email</CardTitle>
          <CardDescription>Cette page confirme la validation de ton compte.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {status === 'idle' && (
              <p className="text-sm text-muted-foreground">Vérification en cours…</p>
            )}
            {status === 'loading' && (
              <p className="text-sm text-muted-foreground">Vérification en cours…</p>
            )}
            {message && (
              <p className={`text-sm ${status === 'success' ? 'text-green-600' : status === 'error' ? 'text-red-600' : 'text-muted-foreground'}`}>{message}</p>
            )}
            {status === 'success' && (
              <Button type="button" className="w-full" onClick={() => router.replace(redirectTo)}>
                Aller à la connexion maintenant
              </Button>
            )}
            {status === 'error' && (
              <Button type="button" variant="outline" className="w-full" onClick={() => router.replace('/login')}>
                Retour à la connexion
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<div className="max-w-md mx-auto">Chargement…</div>}>
      <VerifyInner />
    </Suspense>
  );
}
