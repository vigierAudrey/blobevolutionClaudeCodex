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

export default function ProLoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);

    try {
      await apiClient.send2FA(email);
      setStep('code');
      setInfo('Code de sécurité envoyé par email. Vérifie ta boîte mail.');
    } catch (err: any) {
      const msg = err?.message || 'Une erreur est survenue';
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
      const res = await apiClient.verify2FA(email, code);
      apiClient.saveTokens(res.accessToken, res.refreshToken);

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
    } catch (err: any) {
      const msg = err?.message || 'Une erreur est survenue';
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
      await apiClient.send2FA(email);
      setInfo('Nouveau code envoyé par email.');
    } catch (err: any) {
      setError(err?.message || 'Impossible de renvoyer le code');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto">
      <BackBar fallbackHref="/login" />
      <Card>
        <CardHeader>
          <CardTitle>🔒 Connexion Pro</CardTitle>
          <CardDescription>
            {step === 'email'
              ? 'Sécurisée par authentification à deux facteurs'
              : 'Saisir le code de sécurité reçu par email'
            }
          </CardDescription>
        </CardHeader>
        <CardContent>
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
                />
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-sm">
                <div className="flex items-start gap-2">
                  <span className="text-blue-600">🔐</span>
                  <div>
                    <p className="font-medium text-blue-900">Sécurité renforcée</p>
                    <p className="text-blue-700 mt-1">
                      Un code de sécurité sera envoyé à votre adresse email pour vérifier votre identité.
                    </p>
                  </div>
                </div>
              </div>

              {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
              {info && <p className="text-sm text-green-600">{info}</p>}

              <Button type="submit" disabled={loading} className="w-full">
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
                  className="bg-gray-50"
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
                  className="text-center text-lg tracking-wider"
                />
                <p className="text-xs text-gray-600">
                  Vérifie ton email et saisis le code à 6 chiffres reçu.
                </p>
              </div>

              {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
              {info && <p className="text-sm text-green-600">{info}</p>}

              <Button type="submit" disabled={loading || code.length !== 6} className="w-full">
                {loading ? 'Vérification…' : 'Se connecter'}
              </Button>

              <div className="space-y-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleResendCode}
                  disabled={loading}
                  className="w-full"
                >
                  Renvoyer le code
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setStep('email')}
                  className="w-full"
                >
                  ← Changer d'email
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <div className="mt-4 text-center">
        <a href="/login" className="text-sm text-primary underline">
          Connexion standard (Riders)
        </a>
      </div>
    </div>
  );
}
