"use client";

export const dynamic = 'force-dynamic';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { BackBar } from '@/components/BackBar';
import { apiClient } from '@/lib/apiClient';
import { PasswordRequirementsList } from '@/components/PasswordRequirementsList';
import { getPasswordRequirementStatuses } from '../../../../api/src/utils/password-validator';
import { BlobAlert, BlobAuthLayout, BlobButton, BlobFormCard, BlobInput } from '@/components/blob';

function ResetPasswordInner() {
  const search = useSearchParams();
  const router = useRouter();
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const passwordStatuses = useMemo(() => getPasswordRequirementStatuses(password), [password]);

  useEffect(() => {
    const t = search.get('token');
    if (t) {
      setToken(t);
      // Remove token from URL bar immediately — token must not linger in address
      // bar or browser history after being read (matches verify/page.tsx pattern).
      if (typeof window !== 'undefined') {
        window.history.replaceState(null, '', '/reset-password');
      }
    }
  }, [search]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('loading');
    setMessage('');
    try {
      await apiClient.resetPassword({ token, password });
      setStatus('done');
      setMessage('Mot de passe mis à jour. Tu peux te connecter.');
    } catch (err: unknown) {
      setStatus('error');
      const errorMessage = err instanceof Error ? err.message : null;
      setMessage(errorMessage || 'Impossible de réinitialiser');
    }
  };

  return (
    <BlobAuthLayout>
      <BackBar fallbackHref="/login" tone="blobDark" />

      <BlobFormCard className="space-y-4 p-4 sm:space-y-5 sm:p-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-black uppercase tracking-widest">Nouveau mot de passe</h1>
          <p className="text-sm leading-6 text-blob-black/70">
            Le token est prérempli si tu viens du lien email. Tu peux aussi le coller ici.
          </p>
        </header>

        <form onSubmit={onSubmit} className="space-y-4">
          <BlobInput
            id="token"
            label="Token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            required
            autoComplete="one-time-code"
          />
          <BlobInput
            id="password"
            label="Nouveau mot de passe"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
          />
          <PasswordRequirementsList statuses={passwordStatuses} />
          <BlobButton
            type="submit"
            disabled={!token || !password || status === 'loading'}
            loading={status === 'loading'}
            className="w-full"
          >
            {status === 'loading' ? 'Mise à jour…' : 'Mettre à jour'}
          </BlobButton>
          {message && (
            <BlobAlert variant={status === 'error' ? 'error' : 'success'}>
              {message}
            </BlobAlert>
          )}
          {status === 'done' && (
            <BlobButton type="button" variant="outlineDark" className="w-full" onClick={() => router.push('/login')}>
              Aller à la connexion
            </BlobButton>
          )}
        </form>
      </BlobFormCard>
    </BlobAuthLayout>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-blob-sand px-4 py-8 text-blob-black">Chargement…</div>}>
      <ResetPasswordInner />
    </Suspense>
  );
}
