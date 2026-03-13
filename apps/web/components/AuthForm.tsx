"use client";
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClient } from '../lib/apiClient';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import type { ZodIssue } from 'zod';
import type { DashboardUser, UserRole } from '@/types/user';
import { Eye, EyeOff, LogIn, UserPlus, AlertCircle, CheckCircle2, Mail } from 'lucide-react';
import { getPasswordRequirementStatuses } from '../../api/src/utils/password-validator';
import { PasswordRequirementsList } from './PasswordRequirementsList';
import { useAnalytics } from '@/hooks/useAnalytics';
import { BLOBOSPHERE_SIGNUP_ARTICLE_KEY, BLOBOSPHERE_SIGNUP_INTENT_KEY } from '@/components/blobosphere/BlobosphereAnalyticsLink';

const PUBLIC_ROLES = [
  { value: 'RIDER', label: 'Rider' },
  { value: 'PRO', label: 'Pro' },
] as const satisfies ReadonlyArray<{ value: Extract<UserRole, 'RIDER' | 'PRO'>; label: string }>;

type PublicRole = (typeof PUBLIC_ROLES)[number]['value'];

type Mode = 'login' | 'register';

interface AuthFormProps {
  mode: Mode;
}

type FieldErrors = {
  email?: string;
  password?: string;
  role?: string;
  consent?: string;
  ageConfirmation?: string;
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
  const [role, setRole] = useState<PublicRole>('RIDER');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [loginConsentNeeded, setLoginConsentNeeded] = useState(false);
  const [loginConsentAccepted, setLoginConsentAccepted] = useState(false);
  const [emailNotVerified, setEmailNotVerified] = useState(false);
  const [resendStatus, setResendStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle');
  const [showPassword, setShowPassword] = useState(false);
  const passwordStatuses = useMemo(() => getPasswordRequirementStatuses(password), [password]);
  const { trackEvent } = useAnalytics();

  // ✅ NOUVEAU : États pour 2FA admin
  const [requires2FA, setRequires2FA] = useState(false);
  const [twoFAChallengeId, setTwoFAChallengeId] = useState<string | null>(null);
  const [twoFACode, setTwoFACode] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('intent') === 'blobosphere') {
      window.localStorage.setItem(BLOBOSPHERE_SIGNUP_INTENT_KEY, new Date().toISOString());
    }
  }, []);

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
        } else if (typeof message === 'string' && message.trim()) {
          errors.password = message;
        } else {
          errors.password = 'Mot de passe invalide.';
        }
      } else if (pathSegment === 'role') {
        errors.role = 'Rôle invalide.';
      } else if (pathSegment === 'consentAccepted') {
        errors.consent = 'Vous devez accepter la charte pour continuer.';
      } else if (pathSegment === 'ageConfirmed') {
        errors.ageConfirmation = 'Vous devez avoir 18 ans ou plus pour vous inscrire.';
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
        if (!ageConfirmed) {
          setFieldErrors({ ageConfirmation: 'Vous devez avoir 18 ans ou plus pour vous inscrire.' });
          return;
        }
        if (!consentAccepted) {
          setFieldErrors({ consent: 'Merci de confirmer que vous avez lu et accepté la charte.' });
          return;
        }
        await apiClient.register({ email, password, role, ageConfirmed: true, consentAccepted: true });
        if (typeof window !== 'undefined') {
          const intent = window.localStorage.getItem(BLOBOSPHERE_SIGNUP_INTENT_KEY);
          if (intent) {
            const articleId = window.localStorage.getItem(BLOBOSPHERE_SIGNUP_ARTICLE_KEY) || undefined;
            window.localStorage.removeItem(BLOBOSPHERE_SIGNUP_INTENT_KEY);
            window.localStorage.removeItem(BLOBOSPHERE_SIGNUP_ARTICLE_KEY);
            trackEvent({ eventType: 'BLOBOSPHERE_SIGNUP', ...(articleId ? { contentId: articleId } : {}) });
          }
        }
        setInfo('Compte créé. Vérifie ta boîte mail pour valider ton email.');
        setTimeout(() => router.push('/login'), 800);
        return;
      }

      const response = await apiClient.login({
        email,
        password,
        consentAccepted: loginConsentNeeded ? loginConsentAccepted : undefined,
      });

      // Vérifier si 2FA est requis
      if ('requires2FA' in response && response.requires2FA && 'challengeId' in response) {
        setRequires2FA(true);
        setTwoFAChallengeId(response.challengeId as string);
        setInfo('Un code de vérification a été envoyé à votre adresse email');
        setLoading(false);
        return;
      }

      // Tokens are now httpOnly cookies set by server — activate local session hint
      apiClient.saveTokens();

      try {
        const user = (await apiClient.me()) as DashboardUser;
        // Set a lightweight cookie for edge middleware gating on /admin
        if (typeof document !== 'undefined') {
          if (user.role === 'ADMIN') {
            document.cookie = 'admin_session=1; Path=/; Max-Age=604800; SameSite=Lax';
          } else {
            document.cookie = 'admin_session=; Path=/; Max-Age=0; SameSite=Lax';
          }
        }

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
      setError(getErrorMessage(resendError, "Impossible de renvoyer l'email"));
    }
  };

  // ✅ NOUVEAU : Soumettre le code 2FA
  const submit2FA = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!twoFAChallengeId || !twoFACode) return;

    setLoading(true);
    setError(null);
    setInfo(null);

    try {
      await apiClient.verify2FA(
        twoFAChallengeId,
        twoFACode,
        loginConsentNeeded ? loginConsentAccepted : undefined
      );

      // Tokens set as httpOnly cookies by server — activate local session hint
      apiClient.saveTokens();

      try {
        const user = (await apiClient.me()) as DashboardUser;
        if (typeof document !== 'undefined') {
          if (user.role === 'ADMIN') {
            document.cookie = 'admin_session=1; Path=/; Max-Age=604800; SameSite=Lax';
          } else {
            document.cookie = 'admin_session=; Path=/; Max-Age=0; SameSite=Lax';
          }
        }
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
    } catch (verifyError) {
      setError(getErrorMessage(verifyError, 'Code invalide ou expiré'));
      setTwoFACode('');
    } finally {
      setLoading(false);
    }
  };

  // ✅ NOUVEAU : Si 2FA est requis, afficher le formulaire 2FA
  if (requires2FA && twoFAChallengeId) {
    return (
      <Card className="border-2 border-transparent hover:border-emerald-300 transition-all">
        <CardHeader className="bg-gradient-to-br from-emerald-50/80 to-transparent dark:from-emerald-950/30 dark:to-transparent">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gradient-to-br from-emerald-600 to-teal-600 text-white">
              <Mail size={20} />
            </div>
            <div>
              <CardTitle>Vérification en deux étapes</CardTitle>
              <CardDescription>
                Un code de vérification a été envoyé à votre adresse email
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          <form onSubmit={submit2FA} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="2fa-code">Code de vérification (6 chiffres)</Label>
              <Input
                id="2fa-code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoComplete="one-time-code"
                value={twoFACode}
                onChange={(e) => setTwoFACode(e.target.value.replace(/\D/g, ''))}
                placeholder="123456"
                className="text-center text-2xl tracking-widest"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/30" role="alert">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700 dark:text-red-400">
                  {error}
                </p>
              </div>
            )}

            {info && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-green-50 dark:bg-green-950/30" role="alert">
                <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-green-700 dark:text-green-400">
                  {info}
                </p>
              </div>
            )}

            <Button
              type="submit"
              className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 shadow-lg hover:shadow-xl transition-all"
              disabled={loading || twoFACode.length !== 6}
              size="lg"
            >
              {loading ? 'Vérification...' : 'Vérifier le code'}
            </Button>

            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => {
                setRequires2FA(false);
                setTwoFAUserId(null);
                setTwoFACode('');
                setError(null);
                setInfo(null);
              }}
            >
              Annuler
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-transparent hover:border-blue-300 transition-all">
      <CardHeader className={`bg-gradient-to-br ${mode === 'login' ? 'from-indigo-50/80' : 'from-blue-50/80'} to-transparent dark:${mode === 'login' ? 'from-indigo-950/30' : 'from-blue-950/30'} dark:to-transparent`}>
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg bg-gradient-to-br ${mode === 'login' ? 'from-indigo-600 to-blue-600' : 'from-blue-500 to-cyan-500'} text-white`}>
            {mode === 'login' ? <LogIn size={20} /> : <UserPlus size={20} />}
          </div>
          <div>
            <CardTitle>{mode === 'login' ? 'Connexion' : 'Inscription'}</CardTitle>
            <CardDescription>
              {mode === 'login' ? 'Accède à ton compte BlobConnect' : 'Rejoins la communauté BlobConnect'}
            </CardDescription>
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
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={`${fieldErrors.password ? 'border-red-500 focus-visible:ring-red-500' : ''} pr-10`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
              </button>
            </div>
            {fieldErrors.password && (
              <p className="text-sm text-red-600" role="alert">
                {fieldErrors.password}
              </p>
            )}
            {mode === 'register' && <PasswordRequirementsList statuses={passwordStatuses} />}
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
                onChange={(event) => setRole(event.target.value as PublicRole)}
              >
                {PUBLIC_ROLES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {fieldErrors.role && (
                <p className="text-sm text-red-600" role="alert">
                  {fieldErrors.role}
                </p>
              )}
            </div>
          )}
          {mode === 'register' && (
            <div className="space-y-2 border rounded-md p-3 bg-blue-50/50 dark:bg-blue-950/20">
              <label className="flex items-start gap-2 text-sm">
                <input
                  id="ageConfirmed"
                  type="checkbox"
                  className={`mt-1 ${fieldErrors.ageConfirmation ? 'border-red-500' : ''}`}
                  checked={ageConfirmed}
                  onChange={(event) => setAgeConfirmed(event.target.checked)}
                  required
                />
                <span className="font-medium">
                  Je certifie avoir 18 ans ou plus et accepte les{' '}
                  <a className="underline text-primary" href="/terms" target="_blank" rel="noopener noreferrer">
                    Conditions Générales d&apos;Utilisation
                  </a>
                </span>
              </label>
              {fieldErrors.ageConfirmation && (
                <p className="text-sm text-red-600 mt-2" role="alert">
                  {fieldErrors.ageConfirmation}
                </p>
              )}
            </div>
          )}
          {mode === 'register' && (
            <div className="space-y-2 border rounded-md p-3 bg-muted/30">
              <div className="text-sm text-foreground">
                <p className="font-medium">Charte de sécurité & responsabilité</p>
                <p className="mt-1">
                  BlobConnect facilite la mise en relation entre personnes pour partager de bons moments.
                  Tu restes toutefois seul responsable de tes choix, de ta sécurité et de tes biens.
                  BlobConnect ne fournit ni assurance, ni encadrement, ni garantie sur les activités organisées entre utilisateurs.
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
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/30" role="alert">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700 dark:text-red-400">
                {error}
              </p>
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
            className={`w-full bg-gradient-to-r ${mode === 'login' ? 'from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700' : 'from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700'} shadow-lg hover:shadow-xl transition-all`}
            size="lg"
          >
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
