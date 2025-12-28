"use client";

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../../../components/ui/dialog';
import { StatusMessage } from '../../../components/ui/status-message';
import { apiClient, type NearbyProResult } from '../../../lib/apiClient';

interface ContactProModalProps {
  pro: NearbyProResult | null;
  onClose: () => void;
  onSubmitted: (pro: NearbyProResult) => void;
}

const COOLDOWN_SECONDS = 30;

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }
  return fallback;
};

function getEnvKey() {
  if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_APP_ENV) {
    return process.env.NEXT_PUBLIC_APP_ENV;
  }
  return 'local';
}

function getCooldownKey(proId: string) {
  return `blob:contactCooldown:${getEnvKey()}:${proId}`;
}

export function ContactProModal({ pro, onClose, onSubmitted }: ContactProModalProps) {
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!pro) {
      setMessage('');
      setSaving(false);
      setError(null);
      setCooldown(0);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem(getCooldownKey(pro.proId));
      if (stored) {
        const expiresAt = Number(stored);
        const remainingMs = expiresAt - Date.now();
        if (remainingMs > 0) {
          setCooldown(Math.ceil(remainingMs / 1000));
        } else {
          window.localStorage.removeItem(getCooldownKey(pro.proId));
          setCooldown(0);
        }
      }
    }
  }, [pro]);

  useEffect(() => {
    if (cooldown <= 0) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }
    intervalRef.current = setInterval(() => {
      setCooldown((prev) => {
        const next = prev - 1;
        if (next <= 0) {
          if (typeof window !== 'undefined') {
            window.localStorage.removeItem(getCooldownKey(pro?.proId ?? ''));
          }
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          return 0;
        }
        return next;
      });
    }, 1000);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [cooldown, pro?.proId]);

  if (!pro) {
    return null;
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!message.trim()) {
      setError('Ajoute un message pour expliquer ta demande.');
      return;
    }
    try {
      setSaving(true);
      setError(null);
      const conversation = await apiClient.openConversation(pro.proId);
      await apiClient.sendMessage(conversation.id, { type: 'TEXT', content: message.trim() });
      onSubmitted(pro);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      const bodyMessage = (err as { body?: { message?: string } })?.body?.message;
      if (status === 429) {
        const retry = typeof bodyMessage === 'string' && (err as { body?: { retryAfterSeconds?: number } })?.body?.retryAfterSeconds;
        const nextCooldown = typeof retry === 'number' && retry > 0 ? retry : COOLDOWN_SECONDS;
        setCooldown(nextCooldown);
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(getCooldownKey(pro.proId), (Date.now() + nextCooldown * 1000).toString());
        }
        setError(bodyMessage || 'Trop de tentatives. Attends 30 secondes avant de renvoyer un message.');
      } else {
        setError(getErrorMessage(err, 'Impossible d’envoyer ton message.'));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!pro} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {pro && (
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Contacter {pro.businessName || pro.email}</DialogTitle>
              <DialogDescription>
                Tu peux demander un cours ou te présenter, même sans créneau publié
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <label className="text-sm font-medium">Message au pro</label>
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows={4}
                className="w-full rounded-md border px-3 py-2 text-sm"
                placeholder="Présente-toi et décris ton besoin (dates, spot préféré, niveau…)."
              />
            </div>

            {error && (
              <StatusMessage variant="error">
                {error}
              </StatusMessage>
            )}

            <DialogFooter>
              <Button
                type="submit"
                disabled={saving || cooldown > 0}
                aria-busy={saving}
                aria-live="polite"
                title={cooldown > 0 ? `Réessayer dans ${cooldown}s` : undefined}
              >
                {saving
                  ? 'Envoi…'
                  : cooldown > 0
                    ? `Réessayer dans ${cooldown}s`
                    : 'Envoyer le message'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
