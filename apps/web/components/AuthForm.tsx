"use client";
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { apiClient } from '../lib/apiClient';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import type { ZodIssue } from 'zod';
import type { DashboardUser, UserRole } from '@/types/user';
import { Eye, EyeOff, LogIn, UserPlus, AlertCircle, CheckCircle2, Mail } from 'lucide-react';
import { getPasswordRequirementStatuses } from '../../api/src/utils/password-validator';
import { PasswordRequirementsList } from './PasswordRequirementsList';
import { useAnalytics } from '@/hooks/useAnalytics';
import { BLOBOSPHERE_SIGNUP_ARTICLE_KEY, BLOBOSPHERE_SIGNUP_INTENT_KEY } from '@/components/blobosphere/BlobosphereAnalyticsLink';
import { FRANCE_ONLY_COUNTRY_CODE } from '../lib/franceLaunch';
import { mapAuthErrorToKey } from '../lib/mapAuthErrorToKey';
import { BlobButton } from './blob/BlobButton';
import { BlobMark } from './blob/BlobMark';

const PUBLIC_ROLES = [
  { value: 'RIDER', labelKey: 'form.roleRider' },
  { value: 'PRO', labelKey: 'form.rolePro' },
] as const satisfies ReadonlyArray<{ value: Extract<UserRole, 'RIDER' | 'PRO'>; labelKey: string }>;

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

const getTechnicalErrorMessage = (error: unknown, fallback = 'Une erreur est survenue') => {
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

const authCardClass =
  'overflow-hidden rounded-sm border-2 border-blob-sand-deep bg-white text-blob-black shadow-[0_10px_30px_rgba(22,24,28,0.10)] dark:border-white/10 dark:bg-[hsl(220_14%_14%)] dark:text-white';
const authHeaderClass = 'border-b-2 border-blob-sand-deep bg-blob-sand dark:border-white/10 dark:bg-white/5';
const authIconClass =
  'flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border-2 border-blob-black bg-blob-yellow text-blob-black';
const authNoticeClass =
  'rounded-sm border-2 border-blob-sand-deep bg-blob-sand p-3 text-sm text-blob-black dark:border-white/10 dark:bg-white/5 dark:text-white';
const authErrorClass =
  'flex items-start gap-2 rounded-sm border-2 border-red-800 bg-red-50 p-3 text-red-950 dark:border-red-500 dark:bg-red-950/40 dark:text-red-100';
const authSuccessClass =
  'flex items-start gap-2 rounded-sm border-2 border-green-800 bg-green-50 p-3 text-green-950 dark:border-green-500 dark:bg-green-950/40 dark:text-green-100';

export function AuthForm({ mode }: AuthFormProps) {
  const t = useTranslations('auth');
  const router = useRouter();
  const searchParams = useSearchParams();
  const intentParam = mode === 'register' ? searchParams.get('intent') : null;
  const hasIntent =
    intentParam === 'pro' || intentParam === 'matching' || intentParam === 'lesson-request';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<PublicRole>(intentParam === 'pro' ? 'PRO' : 'RIDER');
  const [selectorVisible, setSelectorVisible] = useState(!hasIntent);
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
  const [registered, setRegistered] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState('');
  const [registrationEmailSent, setRegistrationEmailSent] = useState(false);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('intent') === 'blobosphere') {
      window.localStorage.setItem(BLOBOSPHERE_SIGNUP_INTENT_KEY, new Date().toISOString());
    }
  }, []);

  // Toute erreur serveur passe par la classification par clé — jamais de
  // message brut du serveur dans l'UI, quelle que soit la langue affichée.
  const translateServerError = (message: string) => t(`errors.${mapAuthErrorToKey(message)}`);

  const handleZodErrors = (details: ZodIssue[]) => {
    const errors: FieldErrors = {};

    details.forEach((detail) => {
      const pathSegment = Array.isArray(detail.path) ? detail.path[0] : undefined;
      const code = detail.code;
      const message = detail.message;

      if (pathSegment === 'email') {
        errors.email = t('errors.emailInvalid');
      } else if (pathSegment === 'password') {
        const minimum =
          'minimum' in detail && typeof (detail as { minimum?: unknown }).minimum === 'number'
            ? (detail as { minimum: number }).minimum
            : null;
        if (code === 'too_small' && minimum === 8) {
          errors.password = t('errors.passwordMin');
        } else if (typeof message === 'string' && message.trim()) {
          errors.password = message;
        } else {
          errors.password = t('errors.passwordInvalid');
        }
      } else if (pathSegment === 'role') {
        errors.role = t('errors.roleInvalid');
      } else if (pathSegment === 'consentAccepted') {
        errors.consent = t('errors.consentRequired');
      } else if (pathSegment === 'ageConfirmed') {
        errors.ageConfirmation = t('errors.ageRequired');
      }
    });

    setFieldErrors(errors);

    if (Object.keys(errors).length === 0) {
      setError(t('errors.genericCheckInfo'));
    }
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    setInfo(null);
    setFieldErrors({});
    setLoading(true);

    try {
      if (mode === 'register') {
        if (!ageConfirmed) {
          setFieldErrors({ ageConfirmation: t('errors.ageRequired') });
          return;
        }
        if (!consentAccepted) {
          setFieldErrors({ consent: t('errors.consentConfirm') });
          return;
        }
        const registration = await apiClient.register({
          email,
          password,
          role,
          ageConfirmed: true,
          consentAccepted: true,
          ...(role === 'PRO' ? { countryCode: FRANCE_ONLY_COUNTRY_CODE } : {}),
        });
        if (typeof window !== 'undefined') {
          const intent = window.localStorage.getItem(BLOBOSPHERE_SIGNUP_INTENT_KEY);
          if (intent) {
            const articleId = window.localStorage.getItem(BLOBOSPHERE_SIGNUP_ARTICLE_KEY) || undefined;
            window.localStorage.removeItem(BLOBOSPHERE_SIGNUP_INTENT_KEY);
            window.localStorage.removeItem(BLOBOSPHERE_SIGNUP_ARTICLE_KEY);
            trackEvent({ eventType: 'BLOBOSPHERE_SIGNUP', ...(articleId ? { contentId: articleId } : {}) });
          }
        }
        setRegisteredEmail(email);
        setRegistrationEmailSent(registration.emailSent === true);
        setRegistered(true);
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
        setInfo(t('twoFA.codeSent'));
        setLoading(false);
        return;
      }

      // Tokens are now httpOnly cookies set by server — activate local session hint
      apiClient.saveTokens();

      try {
        const user = (await apiClient.me()) as DashboardUser;
        // admin_session est posé httpOnly par le serveur lors du login — pas de document.cookie ici.

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
      const message = getTechnicalErrorMessage(submissionError);

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
        setError(t('errors.loginConsentNeeded'));
        setEmailNotVerified(false);
      } else if (mode === 'login' && normalized.includes('email not verified')) {
        setEmailNotVerified(true);
        setError(null);
      } else if (mode === 'register' && normalized.includes('email already registered')) {
        setFieldErrors({
          email: t('errors.emailAlreadyUsed'),
        });
      } else {
        setError(translateServerError(message));
      }
    } finally {
      submittingRef.current = false;
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
      setInfo(t('registered.resendTaken'));
    } catch (resendError) {
      setResendStatus('error');
      const resendMessage = getTechnicalErrorMessage(resendError, '');
      setError(resendMessage ? translateServerError(resendMessage) : t('errors.resendUnavailable'));
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
        // admin_session est posé httpOnly par le serveur lors du verify-2fa — pas de document.cookie ici.
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
      const verifyMessage = getTechnicalErrorMessage(verifyError, '');
      const normalized = verifyMessage.toLowerCase();
      if (normalized.includes('code incorrect') || normalized.includes('code expiré') || normalized.includes('invalid')) {
        setError(t('twoFA.invalidCode'));
      } else {
        setError(t('twoFA.verifyUnavailable'));
      }
      setTwoFACode('');
    } finally {
      setLoading(false);
    }
  };

  // ✅ NOUVEAU : Si 2FA est requis, afficher le formulaire 2FA
  if (requires2FA && twoFAChallengeId) {
    return (
      <Card className={authCardClass}>
        <CardHeader className={authHeaderClass}>
          <div className="flex items-center gap-3">
            <div className={authIconClass}>
              <Mail size={20} />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-xl font-black uppercase tracking-widest">{t('twoFA.title')}</CardTitle>
              <CardDescription className="mt-1 text-blob-black/64 dark:text-white/60">
                {t('twoFA.codeSent')}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          <form onSubmit={submit2FA} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="2fa-code">{t('twoFA.codeLabel')}</Label>
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
              <div className={authErrorClass} role="alert">
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <p className="text-sm">
                  {error}
                </p>
              </div>
            )}

            {info && (
              <div className={authSuccessClass} role="alert">
                <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <p className="text-sm">
                  {info}
                </p>
              </div>
            )}

            <BlobButton
              type="submit"
              className="w-full"
              disabled={loading || twoFACode.length !== 6}
              size="lg"
            >
              {loading ? t('twoFA.verifying') : t('twoFA.verify')}
            </BlobButton>

            <BlobButton
              type="button"
              variant="outlineDark"
              className="w-full"
              onClick={() => {
                setRequires2FA(false);
                setTwoFAChallengeId(null);
                setTwoFACode('');
                setError(null);
                setInfo(null);
              }}
            >
              {t('twoFA.cancel')}
            </BlobButton>
          </form>
        </CardContent>
      </Card>
    );
  }

  if (registered) {
    return (
      <Card className={authCardClass}>
        <CardHeader className={authHeaderClass}>
          <div className="flex items-center gap-3">
            <div className={authIconClass}>
              <Mail size={20} />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-xl font-black uppercase tracking-widest">
                {registrationEmailSent ? t('registered.titleSent') : t('registered.titleCreated')}
              </CardTitle>
              <CardDescription className="mt-1 text-blob-black/64 dark:text-white/60">
                {registrationEmailSent ? t('registered.descSent') : t('registered.descCreated')}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-6 space-y-4">
          {registrationEmailSent ? (
            <>
              <p className="text-sm text-foreground">
                {t.rich('registered.bodySent', {
                  email: registeredEmail,
                  strong: (chunks) => <strong className="font-semibold">{chunks}</strong>,
                })}
              </p>
              <p className="text-sm text-muted-foreground">
                {t('registered.bodySpam')}
              </p>
            </>
          ) : (
            <div className={authNoticeClass} role="status">
              {t('registered.bodyNotSent')}
            </div>
          )}

          {resendStatus === 'sent' && (
            <div className={authSuccessClass} role="alert">
              <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <p className="text-sm">
                {t('registered.resendTaken')}
              </p>
            </div>
          )}
          {resendStatus === 'error' && (
            <div className={authErrorClass} role="alert">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <p className="text-sm">
                {t('registered.resendFailed')}
              </p>
            </div>
          )}

          <BlobButton
            type="button"
            variant="outlineDark"
            className="w-full"
            disabled={resendStatus === 'loading'}
            onClick={resend}
          >
            {resendStatus === 'loading' ? t('form.sending') : t('form.resendVerification')}
          </BlobButton>

          <BlobButton
            type="button"
            className="w-full"
            onClick={() => router.push('/login')}
          >
            {t('registered.goToLogin')}
          </BlobButton>

          <div className="text-center">
            <button
              type="button"
              className="min-h-10 text-sm font-semibold text-blob-black/70 underline hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow dark:text-white/70"
              onClick={() => {
                setRegistered(false);
                setRegisteredEmail('');
                setRegistrationEmailSent(false);
                setResendStatus('idle');
              }}
            >
              {t('registered.changeEmail')}
            </button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={authCardClass}>
      <CardHeader className={authHeaderClass}>
        <div className="flex items-center gap-3">
          <div className={authIconClass}>
            {mode === 'login' ? <LogIn size={20} /> : <UserPlus size={20} />}
          </div>
          <div className="min-w-0">
            <CardTitle className="text-xl font-black uppercase tracking-widest">{mode === 'login' ? t('form.loginTitle') : t('form.registerTitle')}</CardTitle>
            <CardDescription className="mt-1 text-blob-black/64 dark:text-white/60">
              {mode === 'login' ? t('form.loginDesc') : t('form.registerDesc')}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-6">
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">{t('form.emailLabel')}</Label>
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
            <Label htmlFor="password">{t('form.passwordLabel')}</Label>
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
                aria-label={showPassword ? t('form.hidePassword') : t('form.showPassword')}
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
              {!selectorVisible ? (
                <div className={authNoticeClass}>
                  <span className="text-sm text-foreground">
                    {t('form.registeringAs')}{' '}
                    <strong>{role === 'PRO' ? t('form.rolePro') : t('form.roleRider')}</strong>
                  </span>
                  <button
                    type="button"
                    className="ml-3 min-h-10 text-xs font-black uppercase tracking-widest text-blob-black underline hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow dark:text-white"
                    onClick={() => setSelectorVisible(true)}
                  >
                    {t('form.changeRole')}
                  </button>
                </div>
              ) : (
                <>
                  <Label htmlFor="role">{t('form.roleLabel')}</Label>
                  <select
                    id="role"
                    className={`min-h-11 w-full rounded-sm border-2 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow ${
                      fieldErrors.role
                        ? 'border-red-700 focus-visible:ring-red-700'
                        : 'border-blob-black/30 bg-white text-blob-black'
                    }`}
                    value={role}
                    onChange={(event) => setRole(event.target.value as PublicRole)}
                  >
                    {PUBLIC_ROLES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {t(option.labelKey)}
                      </option>
                    ))}
                  </select>
                  {fieldErrors.role && (
                    <p className="text-sm text-red-600" role="alert">
                      {fieldErrors.role}
                    </p>
                  )}
                </>
              )}
              {role === 'PRO' && (
                <div
                  className="rounded-sm border-2 border-blob-yellow-dark bg-blob-yellow/20 px-3 py-2 text-sm text-blob-black dark:bg-blob-yellow/10 dark:text-white"
                  role="status"
                >
                  {t('form.proBetaInfo')}
                </div>
              )}
            </div>
          )}
          {mode === 'register' && (
            <div className={authNoticeClass}>
              <label className="flex items-start gap-2 text-sm">
                <input
                  id="ageConfirmed"
                  type="checkbox"
                  className={`mt-1 h-5 w-5 ${fieldErrors.ageConfirmation ? 'border-red-500' : ''}`}
                  checked={ageConfirmed}
                  onChange={(event) => setAgeConfirmed(event.target.checked)}
                  required
                />
                <span className="font-medium">
                  {t.rich('form.ageConfirm', {
                    terms: (chunks) => (
                      <a className="underline text-primary" href="/terms" target="_blank" rel="noopener noreferrer">
                        {chunks}
                      </a>
                    ),
                  })}
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
            <div className={authNoticeClass}>
              <div className="text-sm text-foreground">
                <p className="font-medium">{t('form.securityTitle')}</p>
                <p className="mt-1">
                  {t('form.securityIntro')}
                </p>
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>{t('form.securityTip1')}</li>
                  <li>{t('form.securityTip2')}</li>
                  <li>{t('form.securityTip3')}</li>
                  <li>{t('form.securityTip4')}</li>
                </ul>
                <p className="mt-2 text-muted-foreground">
                  {t.rich('form.securityOutro', {
                    link: (chunks) => (
                      <a className="underline text-primary" href="/securite-sessions" target="_blank" rel="noopener noreferrer">
                        {chunks}
                      </a>
                    ),
                  })}
                </p>
              </div>
              <label className="flex items-start gap-2 text-sm mt-2">
                <input
                  id="consentAccepted"
                  type="checkbox"
                  className={`mt-1 h-5 w-5 ${fieldErrors.consent ? 'border-red-500' : ''}`}
                  checked={consentAccepted}
                  onChange={(event) => setConsentAccepted(event.target.checked)}
                  required
                />
                <span>{t('form.consentLabel')}</span>
              </label>
              {fieldErrors.consent && (
                <p className="text-sm text-red-600 mt-2" role="alert">
                  {fieldErrors.consent}
                </p>
              )}
            </div>
          )}
          {mode === 'login' && loginConsentNeeded && (
            <div className={authNoticeClass}>
              <div className="text-sm text-foreground">
                <p className="font-medium">{t('form.securityTitle')}</p>
                <p className="mt-1">
                  {t.rich('form.loginConsentPrompt', {
                    link: (chunks) => (
                      <a className="underline text-primary" href="/securite-sessions" target="_blank" rel="noopener noreferrer">
                        {chunks}
                      </a>
                    ),
                  })}
                </p>
              </div>
              <label className="flex items-start gap-2 text-sm mt-2">
                <input
                  id="loginConsentAccepted"
                  type="checkbox"
                  className="mt-1 h-5 w-5"
                  checked={loginConsentAccepted}
                  onChange={(event) => setLoginConsentAccepted(event.target.checked)}
                  required
                />
                <span>{t('form.consentLabel')}</span>
              </label>
            </div>
          )}
          {mode === 'login' && emailNotVerified && (
            <div className="space-y-2 rounded-sm border-2 border-blob-yellow-dark bg-blob-yellow/20 p-3 text-blob-black">
              <div className="text-sm text-foreground">
                <p className="font-medium">{t('form.emailNotVerifiedTitle')}</p>
                <p className="mt-1">{t('form.emailNotVerifiedBody')}</p>
              </div>
              <div className="flex gap-2">
                <BlobButton type="button" size="sm" variant="yellowSignalDark" disabled={resendStatus === 'loading' || !email} onClick={resend}>
                  {resendStatus === 'loading' ? t('form.sending') : t('form.resendVerification')}
                </BlobButton>
              </div>
              <p className="text-xs text-muted-foreground">{t('form.spamTip')}</p>
            </div>
          )}
          {error && (
            <div className={authErrorClass} role="alert">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <p className="text-sm">
                {error}
              </p>
            </div>
          )}
          {info && (
            <div className={authSuccessClass}>
              <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <p className="text-sm">{info}</p>
            </div>
          )}
          <BlobButton
            type="submit"
            disabled={loading}
            className="w-full"
            size="lg"
          >
            <BlobMark size={18} decorative />
            {loading ? t('form.submitting') : mode === 'login' ? t('form.submitLogin') : t('form.submitRegister')}
          </BlobButton>
        </form>
        <div className="mt-4 text-sm text-center text-muted-foreground">
          {mode === 'login' ? (
            <span>
              {t('form.noAccount')} <Link href="/register" className="text-primary underline">{t('form.noAccountLink')}</Link>
            </span>
          ) : (
            <span>
              {t('form.haveAccount')} <Link href="/login" className="text-primary underline">{t('form.haveAccountLink')}</Link>
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
