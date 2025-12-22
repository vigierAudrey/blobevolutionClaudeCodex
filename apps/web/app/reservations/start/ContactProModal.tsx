"use client";

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../../components/ui/button';
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <form onSubmit={submit} className="w-full max-w-lg space-y-4 rounded-lg bg-white p-6 shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Contacter {pro.businessName || pro.email}</h2>
            <p className="text-sm text-muted-foreground">
              Tu peux demander un cours ou te présenter, même sans créneau publié.
            </p>
          </div>
          <button
            type="button"
            className="text-sm text-muted-foreground hover:text-foreground"
            onClick={onClose}
            disabled={saving}
          >
            Fermer
          </button>
        </div>

        <div className="space-y-3 text-sm">
          <p className="font-medium">Message au pro</p>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={4}
            className="w-full rounded-md border px-3 py-2"
            placeholder="Présente-toi et décris ton besoin (dates, spot préféré, niveau…)."
          />
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert" aria-live="assertive">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Annuler
          </Button>
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
        </div>
      </form>
    </div>
  );
}
