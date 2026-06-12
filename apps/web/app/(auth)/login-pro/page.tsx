"use client";

export const dynamic = 'force-dynamic';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';
import { BackBar } from '@/components/BackBar';
import Link from 'next/link';
import { mapAuthErrorToFrench } from '@/lib/mapAuthErrorToFrench';
import { BlobAlert, BlobAuthLayout, BlobButton, BlobFormCard, BlobInput } from '@/components/blob';

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
      setInfo(`${baseMessage} (Dev: Mailpit sur :8026)`);
    } catch (err: unknown) {
      const msg = getErrorMessage(err) || 'Une erreur est survenue';
      if (msg.toLowerCase().includes('utilisateur non trouvé')) {
        setError('Aucun compte professionnel trouvé avec cette adresse email.');
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
      setInfo(`${baseMessage} (Dev: Mailpit sur :8026)`);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || 'Impossible de renvoyer le code');
    } finally {
      setLoading(false);
    }
  };

  return (
    <BlobAuthLayout
      title="Connexion Pro"
      subtitle="Accès professionnel avec code de sécurité envoyé par email."
    >
      <BackBar fallbackHref="/login" tone="blobDark" />

      <BlobFormCard>
        <header className="space-y-2">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-blob-black/60">
            {step === 'email' ? 'Étape 1 sur 2' : 'Étape 2 sur 2'}
          </p>
          <h2 className="text-2xl font-black uppercase tracking-widest">
            {step === 'email' ? 'Identification' : 'Code de sécurité'}
          </h2>
          <p className="text-sm leading-6 text-blob-black/70">
            {step === 'email'
              ? 'Entre ton email pro pour recevoir le code.'
              : 'Saisis le code à 6 chiffres reçu par email.'}
          </p>
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

              <BlobAlert title="Sécurité pro">
                Un code temporaire vérifie ton identité avant l&apos;accès au tableau de bord.
              </BlobAlert>

              {error && (
                <BlobAlert variant="error">{error}</BlobAlert>
              )}
              {info && (
                <BlobAlert variant="success">{info}</BlobAlert>
              )}

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
              />

              <BlobInput
                id="code"
                label="Code de sécurité"
                type="text"
                inputMode="numeric"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                maxLength={6}
                className="text-center font-mono text-2xl tracking-widest"
                hint="Vérifie ton email et saisis le code à 6 chiffres reçu."
              />

              {error && (
                <BlobAlert variant="error">{error}</BlobAlert>
              )}
              {info && (
                <BlobAlert variant="success">{info}</BlobAlert>
              )}

              <BlobButton
                type="submit"
                disabled={loading || code.length !== 6}
                loading={loading}
                className="w-full"
                size="lg"
              >
                {loading ? 'Vérification…' : 'Se connecter'}
              </BlobButton>

              <div className="grid gap-3 sm:grid-cols-2">
                <BlobButton
                  type="button"
                  variant="outlineDark"
                  size="md"
                  onClick={handleResendCode}
                  disabled={loading}
                  className="w-full"
                >
                  Renvoyer
                </BlobButton>
                <BlobButton
                  type="button"
                  variant="outlineDark"
                  size="md"
                  onClick={() => setStep('email')}
                  className="w-full"
                >
                  Retour à l&apos;email
                </BlobButton>
              </div>
            </form>
          )}
      </BlobFormCard>

      <Link
        href="/login"
        className="block min-h-11 rounded-sm border-2 border-blob-black bg-white px-4 py-3 text-center text-sm font-bold uppercase tracking-widest text-blob-black transition-colors hover:bg-blob-yellow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow focus-visible:ring-offset-2"
      >
        Connexion riders
      </Link>
    </BlobAuthLayout>
  );
}
