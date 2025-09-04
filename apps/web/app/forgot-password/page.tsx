"use client";
import { useState } from 'react';
import { apiClient } from '../../lib/apiClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Label } from '../../components/ui/label';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState<string>('');

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('loading');
    setMessage('');
    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      setStatus('done');
      setMessage('Si le compte existe, un email de réinitialisation a été envoyé.');
    } catch (e: any) {
      setStatus('error');
      setMessage(e?.message || 'Erreur lors de la demande');
    }
  };

  return (
    <div className="max-w-md mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Mot de passe oublié</CardTitle>
          <CardDescription>Entre ton email pour recevoir un lien de réinitialisation.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <Button type="submit" disabled={!email || status === 'loading'} className="w-full">
              {status === 'loading' ? 'Envoi…' : 'Envoyer'}
            </Button>
            {message && (
              <p className={`text-sm ${status === 'error' ? 'text-red-600' : 'text-green-600'}`}>{message}</p>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

