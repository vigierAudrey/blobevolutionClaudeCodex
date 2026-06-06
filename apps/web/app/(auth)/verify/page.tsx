"use client";

export const dynamic = 'force-dynamic';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { BackBar } from '@/components/BackBar';
import { BlobAlert, BlobAuthLayout, BlobButton, BlobFormCard } from '@/components/blob';

function VerifyInner() {
  const search = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<'idle' | 'success' | 'error' | 'loading'>('idle');
  const [message, setMessage] = useState<string>('');
  const [redirectTo, setRedirectTo] = useState<string>('/login');
  // Guard against React StrictMode double-invocation: the one-time token must only
  // be consumed once. Without this ref, StrictMode's mount→unmount→remount cycle
  // sends two concurrent POST requests; the second always gets 401 (token already used).
  const verifyCalledRef = useRef(false);

  useEffect(() => {
    const t = search.get('token');
    if (t && !verifyCalledRef.current) {
      verifyCalledRef.current = true;
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
    <BlobAuthLayout
      title="Vérification email"
      subtitle="Cette page confirme la validation de ton compte."
    >
      <BackBar fallbackHref="/" tone="blobDark" />
      <BlobFormCard>
        <div className="space-y-4">
          {(status === 'idle' || status === 'loading') && (
            <BlobAlert variant="info">Vérification en cours…</BlobAlert>
          )}
          {message && (
            <BlobAlert variant={status === 'success' ? 'success' : status === 'error' ? 'error' : 'info'}>
              {message}
            </BlobAlert>
          )}
          {status === 'success' && (
            <BlobButton type="button" className="w-full" onClick={() => router.replace(redirectTo)}>
              Aller à la connexion maintenant
            </BlobButton>
          )}
          {status === 'error' && (
            <BlobButton type="button" variant="outlineDark" className="w-full" onClick={() => router.replace('/login')}>
              Retour à la connexion
            </BlobButton>
          )}
        </div>
      </BlobFormCard>
    </BlobAuthLayout>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-md rounded-sm border-2 border-blob-sand-deep bg-blob-sand p-4">Chargement…</div>}>
      <VerifyInner />
    </Suspense>
  );
}
