"use client";

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { KeyRound, RefreshCw } from 'lucide-react';
import { apiClient } from '../../lib/apiClient';
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

function getStepUpErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message) {
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

  const sendCode = useCallback(async () => {
    setSending(true);
    setError(null);
    try {
      const response = await requestStepUp();
      setNotice(response.message || 'Code de confirmation envoyé.');
    } catch (err: unknown) {
      setError(getStepUpErrorMessage(err));
    } finally {
      setSending(false);
    }
  }, [requestStepUp]);

  useEffect(() => {
    if (!open) {
      setCode('');
      setNotice(null);
      setError(null);
      setSending(false);
      setVerifying(false);
      return;
    }

    void sendCode();
  }, [open, sendCode]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (code.trim().length !== 6) {
      setError('Saisis le code admin à 6 chiffres.');
      return;
    }

    setVerifying(true);
    setError(null);
    try {
      await verifyStepUp(code.trim());
      await onConfirmed();
      onOpenChange(false);
    } catch (err: unknown) {
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
            <Button type="button" variant="outline" onClick={sendCode} disabled={sending || verifying}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {sending ? 'Envoi...' : 'Renvoyer'}
            </Button>
            <Button type="submit" disabled={verifying || code.length !== 6}>
              {verifying ? 'Confirmation...' : 'Confirmer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
