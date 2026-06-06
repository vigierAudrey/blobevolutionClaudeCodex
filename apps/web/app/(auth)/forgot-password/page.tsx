"use client";

export const dynamic = 'force-dynamic';
import { useState } from 'react';
import { BackBar } from '@/components/BackBar';
import { apiClient } from '@/lib/apiClient';
import { BlobAlert, BlobAuthLayout, BlobButton, BlobFormCard, BlobInput } from '@/components/blob';

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
    } catch {
      setStatus('error');
      setMessage('Impossible de traiter la demande pour le moment.');
    }
  };

  return (
    <BlobAuthLayout
      title="Mot de passe oublié"
      subtitle="Entre ton email pour recevoir un lien de réinitialisation."
    >
      <BackBar fallbackHref="/login" tone="blobDark" />

      <BlobFormCard>
        <header className="space-y-2">
          <h2 className="text-2xl font-black uppercase tracking-widest">Réinitialisation</h2>
          <p className="text-sm leading-6 text-blob-black/70">Entre ton adresse email pour continuer.</p>
        </header>
        <form onSubmit={onSubmit} className="space-y-4">
          <BlobInput
            id="email"
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            placeholder="ton@email.com"
          />
          <BlobButton
            type="submit"
            disabled={!email || status === 'loading'}
            loading={status === 'loading'}
            className="w-full"
            size="lg"
          >
            {status === 'loading' ? 'Envoi en cours…' : 'Envoyer le lien'}
          </BlobButton>
          {message && (
            <BlobAlert variant={status === 'error' ? 'error' : 'success'}>
              {message}
            </BlobAlert>
          )}
        </form>
      </BlobFormCard>
    </BlobAuthLayout>
  );
}
