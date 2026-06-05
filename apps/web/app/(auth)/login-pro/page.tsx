"use client";

export const dynamic = 'force-dynamic';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';
import { BackBar } from '@/components/BackBar';
import { Shield, Mail, Lock, RefreshCw, ArrowLeft } from 'lucide-react';
import { mapAuthErrorToFrench } from '@/lib/mapAuthErrorToFrench';
import Link from 'next/link';
import {
  BlobAlert,
  BlobAuthLayout,
  BlobBadge,
  BlobButton,
  BlobFormCard,
  BlobInput,
} from '@/components/blob';

export default function ProLoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const getErrorMessage = (error: unknown) => (error instanceof Error ? error.message : null);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);

    try {
      const result = (await apiClient.send2FA(email)) as { message?: string };
      setStep('code');
      // Security: API returns a generic message to prevent email/user enumeration.
      // UX: reflect the backend message instead of asserting an email was sent.
      const baseMessage = result?.message || 'Si un compte PRO correspondant existe, un code a été envoyé.';
      setInfo(`${baseMessage} (Dev: Mailpit sur :8025)`);
    } catch (err: unknown) {
      const msg = getErrorMessage(err) || 'Une erreur est survenue';
      if (msg.toLowerCase().includes('utilisateur non trouvé')) {
        setError('Si un compte PRO correspondant existe, un code peut être envoyé.');
      } else if (msg.toLowerCase().includes('2fa disponible uniquement pour les pros')) {
        setError('La connexion 2FA est réservée aux comptes professionnels.');
      } else {
        setError(mapAuthErrorToFrench(msg));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);

    try {
      await apiClient.verifyPro2FA(email, code);
      // Auth via cookie httpOnly — pas de tokens en body (setAuthCookies côté serveur)
      apiClient.saveTokens();

      // Récupérer le rôle de l'utilisateur pour rediriger correctement
      try {
        const user = await apiClient.me();
        if (user.role === 'PRO') {
          router.push('/pro/onboarding');
        } else {
          router.push('/dashboard');
        }
      } catch {
        router.push('/dashboard');
      }
    } catch (err: unknown) {
      const msg = getErrorMessage(err) || 'Une erreur est survenue';
      if (msg.toLowerCase().includes('code incorrect') || msg.toLowerCase().includes('code expiré')) {
        setError('Code incorrect ou expiré. Réessaye ou demande un nouveau code.');
      } else {
        setError(mapAuthErrorToFrench(msg));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    setError(null);
    setInfo(null);
    setLoading(true);

    try {
      const result = (await apiClient.send2FA(email)) as { message?: string };
      const baseMessage = result?.message || 'Si un compte PRO correspondant existe, un code a été envoyé.';
      setInfo(`${baseMessage} (Dev: Mailpit sur :8025)`);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || 'Impossible de renvoyer le code');
    } finally {
      setLoading(false);
    }
  };

  return (
    <BlobAuthLayout
      mode="dark"
      title="Connexion Pro"
      subtitle="Sécurité renforcée avec authentification à deux facteurs."
    >
      <BackBar fallbackHref="/login" tone="blobLight" />

      <BlobFormCard mode="dark">
        <header className="space-y-3">
          <BlobBadge variant="yellow" brandMark>
            Pro 2FA
          </BlobBadge>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-sm border-2 border-blob-yellow bg-blob-yellow text-blob-black">
              {step === 'email' ? <Mail size={20} aria-hidden="true" /> : <Lock size={20} aria-hidden="true" />}
            </div>
            <div>
              <h2 className="text-xl font-black uppercase tracking-widest">
                {step === 'email' ? 'Étape 1 : Identification' : 'Étape 2 : Vérification'}
              </h2>
              <p className="mt-1 text-sm leading-6 text-white/70">
                {step === 'email'
                  ? 'Entre ton email professionnel.'
                  : 'Saisis le code reçu par email.'
                }
              </p>
            </div>
          </div>
        </header>

        {step === 'email' ? (
          <form onSubmit={handleSendCode} className="space-y-4">
            <BlobInput
              id="email"
              label="Email professionnel"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="pro@exemple.com"
            />

            <div className="rounded-sm border-2 border-white/15 bg-white/5 p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border-2 border-blob-yellow text-blob-yellow">
                  <Shield className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <p className="font-black uppercase tracking-[0.12em] text-white">Sécurité renforcée</p>
                  <p className="mt-1 text-sm leading-6 text-white/70">
                    Un code de sécurité sera envoyé à votre adresse email pour vérifier votre identité.
                  </p>
                </div>
              </div>
            </div>

            {error && <BlobAlert variant="error">{error}</BlobAlert>}
            {info && <BlobAlert variant="success">{info}</BlobAlert>}

            <BlobButton
              type="submit"
              disabled={loading}
              loading={loading}
              className="w-full"
              size="lg"
            >
              {loading ? 'Envoi en cours…' : 'Envoyer le code de sécurité'}
            </BlobButton>
          </form>
        ) : (
          <form onSubmit={handleVerifyCode} className="space-y-4">
            <BlobInput
              id="email-display"
              label="Email professionnel"
              type="email"
              value={email}
              disabled
              autoComplete="email"
            />

            <BlobInput
              id="code"
              label="Code de sécurité"
              type="text"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              maxLength={6}
              inputMode="numeric"
              autoComplete="one-time-code"
              hint="Vérifie ton email et saisis le code à 6 chiffres reçu."
              className="text-center font-mono text-2xl tracking-widest"
            />

            {error && <BlobAlert variant="error">{error}</BlobAlert>}
            {info && <BlobAlert variant="success">{info}</BlobAlert>}

            <BlobButton
              type="submit"
              disabled={loading || code.length !== 6}
              loading={loading}
              className="w-full"
              size="lg"
            >
              {loading ? 'Vérification…' : 'Se connecter'}
            </BlobButton>

            <div className="grid grid-cols-2 gap-3">
              <BlobButton
                type="button"
                variant="outlineLight"
                onClick={handleResendCode}
                disabled={loading}
                className="w-full"
              >
                <RefreshCw size={16} aria-hidden="true" />
                Renvoyer
              </BlobButton>
              <BlobButton
                type="button"
                variant="outlineLight"
                onClick={() => setStep('email')}
                className="w-full"
              >
                <ArrowLeft size={16} aria-hidden="true" />
                Retour
              </BlobButton>
            </div>
          </form>
        )}
      </BlobFormCard>

      <Link
        href="/login"
        className="mt-6 block rounded-sm border-2 border-white/15 bg-white/5 p-4 text-center text-sm text-white/75 transition-colors hover:border-blob-yellow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow"
      >
        Tu n&apos;es pas pro ?{' '}
        <span className="font-black uppercase tracking-[0.12em] text-blob-yellow">Connexion standard (Riders)</span>
      </Link>
    </BlobAuthLayout>
  );
}
