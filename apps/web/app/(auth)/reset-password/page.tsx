"use client";

export const dynamic = 'force-dynamic';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { BackBar } from '@/components/BackBar';

function ResetPasswordInner() {
  const search = useSearchParams();
  const router = useRouter();
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const t = search.get('token');
    if (t) setToken(t);
  }, [search]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('loading');
    setMessage('');
    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      setStatus('done');
      setMessage('Mot de passe mis à jour. Tu peux te connecter.');
    } catch (e: any) {
      setStatus('error');
      setMessage(e?.message || 'Impossible de réinitialiser');
    }
  };

  return (
    <div className="max-w-md mx-auto">
      <BackBar fallbackHref="/login" />
      <Card>
        <CardHeader>
          <CardTitle>Réinitialiser le mot de passe</CardTitle>
          <CardDescription>Colle le token reçu par email puis saisis ton nouveau mot de passe.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="token">Token</Label>
              <Input id="token" value={token} onChange={(e) => setToken(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Nouveau mot de passe</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <Button type="submit" disabled={!token || !password || status === 'loading'} className="w-full">
              {status === 'loading' ? 'Mise à jour…' : 'Mettre à jour'}
            </Button>
            {message && (
              <p className={`text-sm ${status === 'error' ? 'text-red-600' : 'text-green-600'}`}>{message}</p>
            )}
            {status === 'done' && (
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

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="max-w-md mx-auto">Chargement…</div>}>
      <ResetPasswordInner />
    </Suspense>
  );
}
