"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { KeyRound, RefreshCw } from 'lucide-react';
import { apiClient, getApiRetryAfterSeconds } from '../../lib/apiClient';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

type AdminStepUpDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirmed: () => Promise<void>;
  requestStepUp?: typeof apiClient.requestAdminStepUp;
  verifyStepUp?: typeof apiClient.verifyAdminStepUp;
};

const AUTO_SEND_DEDUP_MS = 1500;
let lastAutoSendStartedAt = 0;

function formatRateLimitMessage(seconds: number): string {
  return `Trop de tentatives. Réessaie dans ${seconds} seconde${seconds > 1 ? 's' : ''}.`;
}

function getStepUpErrorMessage(error: unknown): string {
  const retryAfterSeconds = getApiRetryAfterSeconds(error);
  if (retryAfterSeconds) {
    return formatRateLimitMessage(retryAfterSeconds);
  }

  const apiError = error as { status?: number; body?: { error?: unknown } } | null;
  if (apiError?.status === 401) {
    return 'Code invalide ou expiré.';
  }
  if (apiError?.status === 403) {
    return 'Confirmation admin requise avant de continuer.';
  }
  if (apiError?.status === 503) {
    return 'Confirmation admin indisponible pour le moment.';
  }
  if (apiError?.status === 429) {
    return 'Trop de tentatives. Réessaie dans quelques instants.';
  }

  const message = error instanceof Error ? error.message : '';
  if (message && !/AUTH_RATE_LIMIT|RATE_LIMIT|HTTP \d+|Redis|Prisma|Internal/i.test(message)) {
    return message;
  }
  return 'Confirmation impossible pour le moment.';
}

export function AdminStepUpDialog({
  open,
  onOpenChange,
  onConfirmed,
  requestStepUp = apiClient.requestAdminStepUp,
  verifyStepUp = apiClient.verifyAdminStepUp,
}: AdminStepUpDialogProps) {
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const autoSendStartedRef = useRef(false);

  const cooldownRemainingSeconds = cooldownUntil
    ? Math.max(0, Math.ceil((cooldownUntil - now) / 1000))
    : 0;

  useEffect(() => {
    if (!cooldownUntil) return;

    const interval = window.setInterval(() => {
      const nextNow = Date.now();
      setNow(nextNow);
      if (nextNow >= cooldownUntil) {
        setCooldownUntil(null);
        setError(null);
      }
    }, 1000);

    return () => window.clearInterval(interval);
  }, [cooldownUntil]);

  const sendCode = useCallback(async () => {
    if (cooldownUntil && Date.now() < cooldownUntil) {
      setError(formatRateLimitMessage(Math.ceil((cooldownUntil - Date.now()) / 1000)));
      return;
    }

    setSending(true);
    setError(null);
    try {
      const response = await requestStepUp();
      setNotice(response.message || 'Code de confirmation envoyé.');
    } catch (err: unknown) {
      const retryAfterSeconds = getApiRetryAfterSeconds(err);
      if (retryAfterSeconds) {
        const until = Date.now() + retryAfterSeconds * 1000;
        setNow(Date.now());
        setCooldownUntil(until);
        setNotice(null);
      }
      setError(getStepUpErrorMessage(err));
    } finally {
      setSending(false);
    }
  }, [cooldownUntil, requestStepUp]);

  useEffect(() => {
    if (!open) {
      setCode('');
      setNotice(null);
      setError(null);
      setSending(false);
      setVerifying(false);
      setCooldownUntil(null);
      autoSendStartedRef.current = false;
      return;
    }

    if (autoSendStartedRef.current) {
      return;
    }
    const currentStartedAt = Date.now();
    if (process.env.NODE_ENV !== 'test' && currentStartedAt - lastAutoSendStartedAt < AUTO_SEND_DEDUP_MS) {
      autoSendStartedRef.current = true;
      return;
    }
    autoSendStartedRef.current = true;
    lastAutoSendStartedAt = currentStartedAt;
    void sendCode();
  }, [open, sendCode]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (code.trim().length !== 6) {
      setError('Saisis le code admin à 6 chiffres.');
      return;
    }

    if (cooldownRemainingSeconds > 0) {
      setError(formatRateLimitMessage(cooldownRemainingSeconds));
      return;
    }

    setVerifying(true);
    setError(null);
    try {
      await verifyStepUp(code.trim());
      await onConfirmed();
      onOpenChange(false);
    } catch (err: unknown) {
      const retryAfterSeconds = getApiRetryAfterSeconds(err);
      if (retryAfterSeconds) {
        const until = Date.now() + retryAfterSeconds * 1000;
        setNow(Date.now());
        setCooldownUntil(until);
      }
      setError(getStepUpErrorMessage(err));
    } finally {
      setVerifying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Confirmation admin requise</DialogTitle>
            <DialogDescription>
              Cette action modifie le statut de validation du professionnel. Confirme ton identité pour continuer.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="admin-step-up-code">Code 2FA admin</Label>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="admin-step-up-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                className="pl-9"
                aria-describedby="admin-step-up-status"
              />
            </div>
          </div>

          <div id="admin-step-up-status" className="min-h-5 text-sm">
            {notice && <p className="text-muted-foreground">{notice}</p>}
            {error && <p className="text-red-600">{error}</p>}
          </div>

          <DialogFooter className="flex-col-reverse sm:flex-row">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={verifying}>
              Annuler
            </Button>
            <Button type="button" variant="outline" onClick={sendCode} disabled={sending || verifying || cooldownRemainingSeconds > 0}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {sending ? 'Envoi...' : cooldownRemainingSeconds > 0 ? `Renvoyer (${cooldownRemainingSeconds}s)` : 'Renvoyer'}
            </Button>
            <Button type="submit" disabled={verifying || cooldownRemainingSeconds > 0 || code.length !== 6}>
              {verifying ? 'Confirmation...' : 'Confirmer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
