"use client";

export const dynamic = 'force-dynamic';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BackBar } from '@/components/BackBar';
import { Shield, Mail, Lock, CheckCircle2, AlertCircle, RefreshCw, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

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
        setError('Aucun compte professionnel trouvé avec cette adresse email.');
      } else if (msg.toLowerCase().includes('2fa disponible uniquement pour les pros')) {
        setError('La connexion 2FA est réservée aux comptes professionnels.');
      } else {
        setError(msg);
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
        setError(msg);
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
    <div className="max-w-md mx-auto pb-8">
      <BackBar fallbackHref="/login" />

      {/* Hero section Peps */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600 via-teal-600 to-emerald-500 p-6 sm:p-8 text-white shadow-xl mb-6">
        <div aria-hidden="true" className="pointer-events-none absolute top-0 right-0 -mt-8 -mr-8 h-32 w-32 rounded-full bg-white/10 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute bottom-0 left-0 -mb-8 -ml-8 h-40 w-40 rounded-full bg-white/10 blur-3xl" />
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-xl bg-white/20">
              <Shield className="w-6 h-6" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Connexion Pro
            </h1>
          </div>
          <p className="text-emerald-50 text-sm sm:text-base">
            Sécurité renforcée avec authentification à deux facteurs (2FA)
          </p>
        </div>
      </div>

      <Card className="border-2 border-transparent hover:border-emerald-300 transition-all">
        <CardHeader className="bg-gradient-to-br from-emerald-50/80 to-transparent dark:from-emerald-950/30 dark:to-transparent">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gradient-to-br from-emerald-600 to-teal-600 text-white">
              {step === 'email' ? <Mail size={20} /> : <Lock size={20} />}
            </div>
            <div>
              <CardTitle>
                {step === 'email' ? 'Étape 1 : Identification' : 'Étape 2 : Vérification'}
              </CardTitle>
              <CardDescription>
                {step === 'email'
                  ? 'Entre ton email professionnel'
                  : 'Saisis le code reçu par email'
                }
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          {step === 'email' ? (
            <form onSubmit={handleSendCode} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email professionnel</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="pro@exemple.com"
                  className="text-base"
                />
              </div>

              <div className="bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30 border-2 border-emerald-200 dark:border-emerald-800 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <div className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-900">
                    <Shield className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <p className="font-semibold text-emerald-900 dark:text-emerald-100 mb-1">Sécurité renforcée</p>
                    <p className="text-sm text-emerald-700 dark:text-emerald-300">
                      Un code de sécurité sera envoyé à votre adresse email pour vérifier votre identité.
                    </p>
                  </div>
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/30">
                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700 dark:text-red-400" role="alert">{error}</p>
                </div>
              )}
              {info && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-green-50 dark:bg-green-950/30">
                  <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-green-700 dark:text-green-400">{info}</p>
                </div>
              )}

              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 shadow-lg hover:shadow-xl transition-all"
                size="lg"
              >
                {loading ? 'Envoi en cours…' : 'Envoyer le code de sécurité'}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleVerifyCode} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email-display">Email professionnel</Label>
                <Input
                  id="email-display"
                  type="email"
                  value={email}
                  disabled
                  className="bg-muted"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="code">Code de sécurité</Label>
                <Input
                  id="code"
                  type="text"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="123456"
                  maxLength={6}
                  className="text-center text-2xl tracking-widest font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Vérifie ton email et saisis le code à 6 chiffres reçu.
                </p>
              </div>

              {error && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/30">
                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700 dark:text-red-400" role="alert">{error}</p>
                </div>
              )}
              {info && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-green-50 dark:bg-green-950/30">
                  <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-green-700 dark:text-green-400">{info}</p>
                </div>
              )}

              <Button
                type="submit"
                disabled={loading || code.length !== 6}
                className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 shadow-lg hover:shadow-xl transition-all"
                size="lg"
              >
                {loading ? 'Vérification…' : 'Se connecter'}
              </Button>

              <div className="grid grid-cols-2 gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleResendCode}
                  disabled={loading}
                  className="w-full border-2 border-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                >
                  <RefreshCw size={16} className="mr-2" />
                  Renvoyer
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep('email')}
                  className="w-full"
                >
                  <ArrowLeft size={16} className="mr-2" />
                  Retour
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      {/* Lien vers connexion standard */}
      <Link href="/login" className="block mt-6">
        <Card className="border-2 border-transparent hover:border-blue-300 transition-all duration-200 hover:shadow-lg cursor-pointer">
          <CardContent className="p-4 text-center">
            <p className="text-sm text-muted-foreground">
              Tu n&apos;es pas pro ?{' '}
              <span className="font-medium text-primary">Connexion standard (Riders)</span>
            </p>
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}
