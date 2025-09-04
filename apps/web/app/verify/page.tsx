"use client";
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { apiClient } from '../../lib/apiClient';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { BackBar } from '../../components/BackBar';

function VerifyInner() {
  const search = useSearchParams();
  const router = useRouter();
  const [token, setToken] = useState<string>('');
  const [status, setStatus] = useState<'idle' | 'success' | 'error' | 'loading'>('idle');
  const [message, setMessage] = useState<string>('');

  useEffect(() => {
    const t = search.get('token');
    if (t) {
      setToken(t);
      void verify(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const verify = async (t: string) => {
    setStatus('loading');
    setMessage('');
    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/auth/verify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: t }),
      });
      setStatus('success');
      setMessage('Email vérifié avec succès. Tu peux te connecter.');
    } catch (e: any) {
      setStatus('error');
      setMessage(e?.message || 'Impossible de vérifier le token');
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    await verify(token);
  };

  return (
    <div className="max-w-md mx-auto">
      <BackBar fallbackHref="/login" />
      <Card>
        <CardHeader>
          <CardTitle>Vérification de l’email</CardTitle>
          <CardDescription>Cette page confirme la validation de ton compte.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="token">Token</Label>
              <Input id="token" value={token} onChange={(e) => setToken(e.target.value)} placeholder="colle le token ici si besoin" />
            </div>
            <Button type="submit" disabled={!token || status === 'loading'} className="w-full">
              {status === 'loading' ? 'Vérification…' : 'Vérifier'}
            </Button>
            {message && (
              <p className={`text-sm ${status === 'success' ? 'text-green-600' : status === 'error' ? 'text-red-600' : 'text-muted-foreground'}`}>{message}</p>
            )}
            {status === 'success' && (
              <Button type="button" className="w-full" onClick={() => router.push('/login')}>
                Aller à la connexion
              </Button>
            )}
          </form>
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
