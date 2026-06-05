"use client";
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiClient } from '../lib/apiClient';
import {
  BlobAlert,
  BlobBadge,
  BlobButton,
  BlobFormCard,
  BlobInput,
} from './blob';
import type { ZodIssue } from 'zod';
import type { DashboardUser, UserRole } from '@/types/user';
import { Eye, EyeOff, Mail } from 'lucide-react';
import { getPasswordRequirementStatuses } from '../../api/src/utils/password-validator';
import { PasswordRequirementsList } from './PasswordRequirementsList';
import { useAnalytics } from '@/hooks/useAnalytics';
import { BLOBOSPHERE_SIGNUP_ARTICLE_KEY, BLOBOSPHERE_SIGNUP_INTENT_KEY } from '@/components/blobosphere/BlobosphereAnalyticsLink';
import { FRANCE_ONLY_COUNTRY_CODE, PRO_BETA_INFO_MESSAGE } from '../lib/franceLaunch';
import { mapAuthErrorToFrench } from '../lib/mapAuthErrorToFrench';

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
        errors.consent = 'Vous devez accepter les règles de sécurité des sessions pour continuer.';
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
          setFieldErrors({ consent: 'Merci de confirmer que vous avez lu et accepté les règles de sécurité des sessions.' });
          return;
        }
        await apiClient.register({
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
        setError("Pour continuer, merci d'accepter les règles de sécurité des sessions.");
        setEmailNotVerified(false);
      } else if (mode === 'login' && normalized.includes('email not verified')) {
        setEmailNotVerified(true);
        setError(null);
      } else if (mode === 'register' && normalized.includes('email already registered')) {
        setFieldErrors({
          email: "Cette adresse email est déjà utilisée. Essayez de vous connecter ou utilisez une autre adresse.",
        });
      } else {
        setError(mapAuthErrorToFrench(message));
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
      setError(getErrorMessage(verifyError, 'Code invalide ou expiré'));
      setTwoFACode('');
    } finally {
      setLoading(false);
    }
  };

  // ✅ NOUVEAU : Si 2FA est requis, afficher le formulaire 2FA
  if (requires2FA && twoFAChallengeId) {
    return (
      <BlobFormCard className="space-y-5">
        <header className="space-y-2">
          <BlobBadge variant="dark" brandMark>2FA</BlobBadge>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-sm border-2 border-blob-black bg-blob-yellow text-blob-black">
              <Mail size={20} aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-xl font-black uppercase tracking-widest">
                Vérification en deux étapes
              </h2>
              <p className="mt-1 text-sm leading-6 text-blob-black/70">
                Un code de vérification a été envoyé à votre adresse email.
              </p>
            </div>
          </div>
        </header>

        <form onSubmit={submit2FA} className="space-y-4">
          <BlobInput
            id="2fa-code"
            label="Code de vérification (6 chiffres)"
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

          {error && <BlobAlert variant="error">{error}</BlobAlert>}
          {info && <BlobAlert variant="success">{info}</BlobAlert>}

          <BlobButton
            type="submit"
            className="w-full"
            disabled={loading || twoFACode.length !== 6}
            loading={loading}
            size="lg"
          >
            {loading ? 'Vérification...' : 'Vérifier le code'}
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
            Annuler
          </BlobButton>
        </form>
      </BlobFormCard>
    );
  }

  return (
    <BlobFormCard className="space-y-5">
      <header className="space-y-2">
        <BlobBadge variant="yellow" brandMark>
          {mode === 'login' ? 'Accès membre' : 'Bêta locale'}
        </BlobBadge>
        <div>
          <h2 className="text-2xl font-black uppercase tracking-widest">
            {mode === 'login' ? 'Connexion' : 'Inscription'}
          </h2>
          <p className="mt-1 text-sm leading-6 text-blob-black/70">
            {mode === 'login' ? 'Accède à ton compte Blob.' : 'Rejoins la communauté Blob.'}
          </p>
        </div>
      </header>

      <form onSubmit={onSubmit} className="space-y-4">
        <BlobInput
          id="email"
          label="Email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldErrors.email}
        />

        <div className="space-y-2">
          <div className="relative">
            <BlobInput
              id="password"
              label="Mot de passe"
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              error={fieldErrors.password}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              className="absolute right-0 top-7 flex h-11 w-11 items-center justify-center text-blob-black/65 transition hover:text-blob-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow"
              aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
            >
              {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
          {mode === 'register' && <PasswordRequirementsList statuses={passwordStatuses} />}
        </div>

        {mode === 'register' && (
          <div className="space-y-2">
            {!selectorVisible ? (
              <div className="flex items-center justify-between gap-3 rounded-sm border-2 border-blob-sand-deep bg-white px-3 py-2">
                <span className="text-sm text-blob-black">
                  Tu t&apos;inscris comme : <strong>{role === 'PRO' ? 'Pro' : 'Rider'}</strong>
                </span>
                <button
                  type="button"
                  className="shrink-0 text-xs font-black uppercase tracking-[0.12em] text-blob-black underline decoration-blob-yellow decoration-2 underline-offset-4 hover:text-blob-yellow-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow"
                  onClick={() => setSelectorVisible(true)}
                >
                  Changer de rôle
                </button>
              </div>
            ) : (
              <>
                <label htmlFor="role" className="block text-xs font-black uppercase tracking-[0.14em] text-current">
                  Rôle
                </label>
                <select
                  id="role"
                  className={`min-h-11 w-full rounded-sm border-2 bg-white px-3 py-2 text-sm text-blob-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow focus-visible:ring-offset-2 ${
                    fieldErrors.role ? 'border-red-700 focus-visible:ring-red-700' : 'border-blob-black/30'
                  }`}
                  value={role}
                  onChange={(event) => setRole(event.target.value as PublicRole)}
                  aria-invalid={fieldErrors.role ? true : undefined}
                  aria-describedby={fieldErrors.role ? 'role-error' : undefined}
                >
                  {PUBLIC_ROLES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {fieldErrors.role && (
                  <p id="role-error" className="text-xs font-semibold leading-5 text-red-700" role="alert">
                    {fieldErrors.role}
                  </p>
                )}
              </>
            )}
            {role === 'PRO' && (
              <BlobAlert variant="warning" title="Bêta pro">
                {PRO_BETA_INFO_MESSAGE}
              </BlobAlert>
            )}
          </div>
        )}

        {mode === 'register' && (
          <div className="space-y-2 rounded-sm border-2 border-blob-sand-deep bg-white p-3">
            <label className="flex items-start gap-2 text-sm">
              <input
                id="ageConfirmed"
                type="checkbox"
                className={`mt-1 h-4 w-4 accent-blob-yellow ${fieldErrors.ageConfirmation ? 'border-red-700' : ''}`}
                checked={ageConfirmed}
                onChange={(event) => setAgeConfirmed(event.target.checked)}
                required
              />
              <span className="font-medium">
                Je certifie avoir 18 ans ou plus et accepte les{' '}
                <a className="font-semibold underline decoration-blob-yellow decoration-2 underline-offset-4" href="/terms" target="_blank" rel="noopener noreferrer">
                  Conditions Générales d&apos;Utilisation
                </a>
              </span>
            </label>
            {fieldErrors.ageConfirmation && (
              <p className="text-xs font-semibold leading-5 text-red-700" role="alert">
                {fieldErrors.ageConfirmation}
              </p>
            )}
          </div>
        )}

        {mode === 'register' && (
          <div className="space-y-3 rounded-sm border-2 border-blob-sand-deep bg-white p-3">
            <div className="text-sm text-blob-black">
              <p className="font-black uppercase tracking-[0.12em]">Sécurité des sessions & responsabilité</p>
              <p className="mt-2">
                Blob facilite la mise en relation entre personnes pour partager de bons moments.
                Tu restes toutefois seul responsable de tes choix, de ta sécurité et de tes biens.
                Blob ne fournit ni assurance, ni encadrement, ni garantie sur les activités organisées entre utilisateurs.
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>Donne rendez-vous dans un lieu public et préviens un proche.</li>
                <li>Reste vigilant face aux comportements inappropriés ou malveillants.</li>
                <li>Évalue toi-même les conditions (météo, niveau, matériel) avant de pratiquer.</li>
                <li>Interromps toute activité si tu ne te sens pas en sécurité.</li>
              </ul>
              <p className="mt-2 text-blob-black/70">
                En t&apos;inscrivant, tu confirmes avoir lu et accepté ces règles de sécurité.
                Pour les détails, consulte la page «
                <a className="font-semibold underline decoration-blob-yellow decoration-2 underline-offset-4" href="/securite-sessions" target="_blank" rel="noopener noreferrer">
                  Sécurité des sessions
                </a>
                ».
              </p>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                id="consentAccepted"
                type="checkbox"
                className={`mt-1 h-4 w-4 accent-blob-yellow ${fieldErrors.consent ? 'border-red-700' : ''}`}
                checked={consentAccepted}
                onChange={(event) => setConsentAccepted(event.target.checked)}
                required
              />
              <span>J&apos;ai lu et j&apos;accepte les règles de sécurité des sessions.</span>
            </label>
            {fieldErrors.consent && (
              <p className="text-xs font-semibold leading-5 text-red-700" role="alert">
                {fieldErrors.consent}
              </p>
            )}
          </div>
        )}

        {mode === 'login' && loginConsentNeeded && (
          <div className="space-y-3 rounded-sm border-2 border-blob-sand-deep bg-white p-3">
            <div className="text-sm text-blob-black">
              <p className="font-black uppercase tracking-[0.12em]">Sécurité des sessions & responsabilité</p>
              <p className="mt-2">
                Pour poursuivre la connexion, confirme avoir lu et accepté les règles de sécurité.
                Consulte la page «
                <a className="font-semibold underline decoration-blob-yellow decoration-2 underline-offset-4" href="/securite-sessions" target="_blank" rel="noopener noreferrer">
                  Sécurité des sessions
                </a>
                ».
              </p>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                id="loginConsentAccepted"
                type="checkbox"
                className="mt-1 h-4 w-4 accent-blob-yellow"
                checked={loginConsentAccepted}
                onChange={(event) => setLoginConsentAccepted(event.target.checked)}
                required
              />
              <span>J&apos;ai lu et j&apos;accepte les règles de sécurité des sessions.</span>
            </label>
          </div>
        )}

        {mode === 'login' && emailNotVerified && (
          <div className="space-y-3 rounded-sm border-2 border-blob-yellow-dark bg-blob-yellow/20 p-3">
            <div className="text-sm text-blob-black">
              <p className="font-black uppercase tracking-[0.12em]">Email non vérifié</p>
              <p className="mt-1">Avant de te connecter, confirme ton adresse email.</p>
            </div>
            <BlobButton type="button" variant="outlineDark" size="sm" disabled={resendStatus === 'loading' || !email} onClick={resend}>
              {resendStatus === 'loading' ? 'Envoi…' : "Renvoyer l'email de vérification"}
            </BlobButton>
            <p className="text-xs text-blob-black/65">Astuce : vérifie aussi le dossier spam.</p>
          </div>
        )}

        {error && <BlobAlert variant="error">{error}</BlobAlert>}
        {info && <BlobAlert variant="success">{info}</BlobAlert>}

        <BlobButton
          type="submit"
          disabled={loading}
          loading={loading}
          className="w-full"
          size="lg"
        >
          {loading ? 'En cours…' : mode === 'login' ? 'Se connecter' : 'Créer le compte'}
        </BlobButton>
      </form>

      <div className="text-center text-sm text-blob-black/70">
        {mode === 'login' ? (
          <span>
            Pas encore de compte ? <Link href="/register" className="font-semibold text-blob-black underline decoration-blob-yellow decoration-2 underline-offset-4">Inscription</Link>
          </span>
        ) : (
          <span>
            Déjà un compte ? <Link href="/login" className="font-semibold text-blob-black underline decoration-blob-yellow decoration-2 underline-offset-4">Connexion</Link>
          </span>
        )}
      </div>
    </BlobFormCard>
  );
}
