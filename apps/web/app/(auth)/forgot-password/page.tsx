"use client";

export const dynamic = 'force-dynamic';
import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { BackBar } from '@/components/BackBar';
import { apiClient } from '@/lib/apiClient';
import { KeyRound, Mail, CheckCircle2, AlertCircle } from 'lucide-react';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState<string>('');

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('loading');
    setMessage('');
    try {
      await apiClient.requestPasswordReset(email);
      setStatus('done');
      setMessage('Si le compte existe, un email de réinitialisation a été envoyé.');
    } catch (err: unknown) {
      setStatus('error');
      const errorMessage = err instanceof Error ? err.message : null;
      setMessage(errorMessage || 'Erreur lors de la demande');
    }
  };

  return (
    <div className="max-w-md mx-auto pb-8">
      <BackBar fallbackHref="/login" />

      {/* Hero section Peps */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-amber-500 via-orange-500 to-amber-400 p-6 sm:p-8 text-white shadow-xl mb-6">
        <div aria-hidden="true" className="pointer-events-none absolute top-0 right-0 -mt-8 -mr-8 h-32 w-32 rounded-full bg-white/10 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute bottom-0 left-0 -mb-8 -ml-8 h-40 w-40 rounded-full bg-white/10 blur-3xl" />
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-xl bg-white/20">
              <KeyRound className="w-6 h-6" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Mot de passe oublié
            </h1>
          </div>
          <p className="text-amber-50 text-sm sm:text-base">
            Pas de souci ! Entre ton email pour recevoir un lien de réinitialisation.
          </p>
        </div>
      </div>

      <Card className="border-2 border-transparent hover:border-amber-300 transition-all">
        <CardHeader className="bg-gradient-to-br from-amber-50/80 to-transparent dark:from-amber-950/30 dark:to-transparent">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 text-white">
              <Mail size={20} />
            </div>
            <div>
              <CardTitle>Réinitialisation</CardTitle>
              <CardDescription>Entre ton adresse email pour continuer</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="ton@email.com"
                className="text-base"
              />
            </div>
            <Button
              type="submit"
              disabled={!email || status === 'loading'}
              className="w-full bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 shadow-lg hover:shadow-xl transition-all"
              size="lg"
            >
              {status === 'loading' ? 'Envoi en cours…' : 'Envoyer le lien'}
            </Button>
            {message && (
              <div className={`flex items-start gap-2 p-3 rounded-lg ${status === 'error' ? 'bg-red-50 dark:bg-red-950/30' : 'bg-green-50 dark:bg-green-950/30'}`}>
                {status === 'error' ? (
                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                ) : (
                  <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                )}
                <p className={`text-sm ${status === 'error' ? 'text-red-700 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`}>
                  {message}
                </p>
              </div>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
