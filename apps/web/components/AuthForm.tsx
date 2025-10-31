"use client";
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClient } from '../lib/apiClient';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import type { ZodIssue } from 'zod';
import type { DashboardUser, UserRole } from '@/types/user';

type Mode = 'login' | 'register';

interface AuthFormProps {
  mode: Mode;
}

type FieldErrors = {
  email?: string;
  password?: string;
  role?: string;
  consent?: string;
};

const isZodIssueArray = (value: unknown): value is ZodIssue[] => {
  return (
    Array.isArray(value) &&
    value.every(
      (issue) =>
        typeof issue === 'object' &&
        issue !== null &&
        'code' in issue &&
        'message' in issue &&
        Array.isArray((issue as { path?: unknown }).path ?? [])
    )
  );
};

const getErrorMessage = (error: unknown, fallback = 'Une erreur est survenue') => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const { message } = error as { message?: unknown };
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }
  return fallback;
};

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('RIDER');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [loginConsentNeeded, setLoginConsentNeeded] = useState(false);
  const [loginConsentAccepted, setLoginConsentAccepted] = useState(false);
  const [emailNotVerified, setEmailNotVerified] = useState(false);
  const [resendStatus, setResendStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle');

  const handleZodErrors = (details: ZodIssue[]) => {
    const errors: FieldErrors = {};

    details.forEach((detail) => {
      const pathSegment = Array.isArray(detail.path) ? detail.path[0] : undefined;
      const code = detail.code;
      const message = detail.message;

      if (pathSegment === 'email') {
        if (code === 'invalid_string' && typeof message === 'string' && message.includes('email')) {
          errors.email = 'Adresse email invalide.';
        } else {
          errors.email = 'Adresse email invalide.';
        }
      } else if (pathSegment === 'password') {
        const minimum =
          'minimum' in detail && typeof (detail as { minimum?: unknown }).minimum === 'number'
            ? (detail as { minimum: number }).minimum
            : null;
        if (code === 'too_small' && minimum === 8) {
          errors.password = 'Le mot de passe doit contenir au moins 8 caractères.';
        } else {
          errors.password = 'Mot de passe invalide.';
        }
      } else if (pathSegment === 'role') {
        errors.role = 'Rôle invalide.';
      } else if (pathSegment === 'consentAccepted') {
        errors.consent = 'Vous devez accepter la charte pour continuer.';
      }
    });

    setFieldErrors(errors);

    if (Object.keys(errors).length === 0) {
      setError('Une erreur est survenue, veuillez vérifier vos informations.');
    }
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setInfo(null);
    setFieldErrors({});
    setLoading(true);

    try {
      if (mode === 'register') {
        if (!consentAccepted) {
          setFieldErrors({ consent: 'Merci de confirmer que vous avez lu et accepté la charte.' });
          return;
        }
        await apiClient.register({ email, password, role, consentAccepted: true });
        setInfo('Compte créé. Vérifie ta boîte mail pour valider ton email.');
        setTimeout(() => router.push('/login'), 800);
        return;
      }

      const response = await apiClient.login({
        email,
        password,
        consentAccepted: loginConsentNeeded ? loginConsentAccepted : undefined,
      });
      apiClient.saveTokens(response.accessToken, response.refreshToken);

      try {
        const user = (await apiClient.me()) as DashboardUser;
        if (user.role === 'PRO') {
          router.push('/pro/onboarding');
        } else if (user.role === 'ADMIN') {
          router.push('/admin/dashboard');
        } else {
          router.push('/onboarding');
        }
      } catch {
        router.push('/dashboard');
      }
    } catch (submissionError) {
      const message = getErrorMessage(submissionError);

      if (
        message === 'Invalid input' &&
        submissionError &&
        typeof submissionError === 'object' &&
        'details' in submissionError &&
        isZodIssueArray((submissionError as { details?: unknown }).details)
      ) {
        handleZodErrors((submissionError as { details: ZodIssue[] }).details);
        return;
      }

      const normalized = message.toLowerCase();

      if (mode === 'login' && normalized.includes('consent')) {
        setLoginConsentNeeded(true);
        setError('Pour continuer, merci d’accepter la charte.');
        setEmailNotVerified(false);
      } else if (mode === 'login' && normalized.includes('email not verified')) {
        setEmailNotVerified(true);
        setError(null);
      } else if (mode === 'register' && normalized.includes('email already registered')) {
        setFieldErrors({
          email: "Cette adresse email est déjà utilisée. Essayez de vous connecter ou utilisez une autre adresse.",
        });
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    if (!email) return;
    setResendStatus('loading');
    setError(null);
    setInfo(null);
    try {
      await apiClient.resendVerification(email);
      setResendStatus('sent');
      setInfo('Email de vérification renvoyé. Vérifie ta boîte mail.');
    } catch (resendError) {
      setResendStatus('error');
      setError(getErrorMessage(resendError, 'Impossible de renvoyer l’email'));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{mode === 'login' ? 'Connexion' : 'Inscription'}</CardTitle>
        <CardDescription>
          {mode === 'login' ? 'Accède à ton compte Blobinfini.' : 'Rejoins la communauté Blobinfini.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={fieldErrors.email ? 'border-red-500 focus-visible:ring-red-500' : ''}
            />
            {fieldErrors.email && (
              <p className="text-sm text-red-600" role="alert">
                {fieldErrors.email}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Mot de passe</Label>
            <Input
              id="password"
              type="password"
              required
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={fieldErrors.password ? 'border-red-500 focus-visible:ring-red-500' : ''}
            />
            {fieldErrors.password && (
              <p className="text-sm text-red-600" role="alert">
                {fieldErrors.password}
              </p>
            )}
          </div>
          {mode === 'register' && (
            <div className="space-y-2">
              <Label htmlFor="role">Rôle</Label>
              <select
                id="role"
                className={`h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 ${
                  fieldErrors.role
                    ? 'border-red-500 focus-visible:ring-red-500'
                    : 'border-input bg-background focus-visible:ring-ring'
                }`}
                value={role}
                onChange={(event) => setRole(event.target.value as UserRole)}
              >
                <option value="RIDER">Rider</option>
                <option value="PRO">Pro</option>
                <option value="ADMIN">Admin</option>
              </select>
              {fieldErrors.role && (
                <p className="text-sm text-red-600" role="alert">
                  {fieldErrors.role}
                </p>
              )}
            </div>
          )}
          {mode === 'register' && (
            <div className="space-y-2 border rounded-md p-3 bg-muted/30">
              <div className="text-sm text-foreground">
                <p className="font-medium">Charte de sécurité & responsabilité</p>
                <p className="mt-1">
                  Blobinfini facilite la mise en relation entre personnes pour partager de bons moments.
                  Tu restes toutefois seul responsable de tes choix, de ta sécurité et de tes biens.
                  Blobinfini ne fournit ni assurance, ni encadrement, ni garantie sur les activités organisées entre utilisateurs.
                </p>
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>Donne rendez-vous dans un lieu public et préviens un proche.</li>
                  <li>Reste vigilant face aux comportements inappropriés ou malveillants.</li>
                  <li>Évalue toi-même les conditions (météo, niveau, matériel) avant de pratiquer.</li>
                  <li>Interromps toute activité si tu ne te sens pas en sécurité.</li>
                </ul>
                <p className="mt-2 text-muted-foreground">
                  En t’inscrivant, tu confirmes avoir lu et accepté cette charte.
                  Pour les détails, consulte la page «
                  <a className="underline text-primary" href="/charte" target="_blank" rel="noopener noreferrer">
                    Charte et avertissement
                  </a>
                  ».
                </p>
              </div>
              <label className="flex items-start gap-2 text-sm mt-2">
                <input
                  id="consentAccepted"
                  type="checkbox"
                  className={`mt-1 ${fieldErrors.consent ? 'border-red-500' : ''}`}
                  checked={consentAccepted}
                  onChange={(event) => setConsentAccepted(event.target.checked)}
                  required
                />
                <span>J&apos;ai lu et j&apos;accepte la charte de sécurité et l&apos;avertissement.</span>
              </label>
              {fieldErrors.consent && (
                <p className="text-sm text-red-600 mt-2" role="alert">
                  {fieldErrors.consent}
                </p>
              )}
            </div>
          )}
          {mode === 'login' && loginConsentNeeded && (
            <div className="space-y-2 border rounded-md p-3 bg-muted/30">
              <div className="text-sm text-foreground">
                <p className="font-medium">Charte de sécurité & responsabilité</p>
                <p className="mt-1">
                  Pour poursuivre la connexion, confirme avoir lu et accepté la charte.
                  Consulte la page «
                  <a className="underline text-primary" href="/charte" target="_blank" rel="noopener noreferrer">
                    Charte et avertissement
                  </a>
                  ».
                </p>
              </div>
              <label className="flex items-start gap-2 text-sm mt-2">
                <input
                  id="loginConsentAccepted"
                  type="checkbox"
                  className="mt-1"
                  checked={loginConsentAccepted}
                  onChange={(event) => setLoginConsentAccepted(event.target.checked)}
                  required
                />
                <span>J&apos;ai lu et j&apos;accepte la charte de sécurité et l&apos;avertissement.</span>
              </label>
            </div>
          )}
          {mode === 'login' && emailNotVerified && (
            <div className="space-y-2 border rounded-md p-3 bg-amber-50 border-amber-200">
              <div className="text-sm text-foreground">
                <p className="font-medium">Email non vérifié</p>
                <p className="mt-1">Avant de te connecter, confirme ton adresse email.</p>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" disabled={resendStatus === 'loading' || !email} onClick={resend}>
                  {resendStatus === 'loading' ? 'Envoi…' : 'Renvoyer l’email de vérification'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Astuce : vérifie aussi le dossier spam.</p>
            </div>
          )}
          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}
          {info && <p className="text-sm text-green-600">{info}</p>}
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? 'En cours…' : mode === 'login' ? 'Se connecter' : 'Créer le compte'}
          </Button>
        </form>
        <div className="mt-4 text-sm text-center text-muted-foreground">
          {mode === 'login' ? (
            <span>
              Pas encore de compte ? <Link href="/register" className="text-primary underline">Inscription</Link>
            </span>
          ) : (
            <span>
              Déjà un compte ? <Link href="/login" className="text-primary underline">Connexion</Link>
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
