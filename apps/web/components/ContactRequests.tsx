"use client";

import { useEffect, useState } from 'react';
import { Check, X, Clock } from 'lucide-react';
import { apiClient, type PendingContactRequest } from '../lib/apiClient';
import { BlobButton, BlobCard } from './blob';

type RequestState =
  | { kind: 'idle' }
  | { kind: 'loading'; action: 'ACCEPT' | 'REJECT' }
  | { kind: 'error'; message: string; retryable: boolean }
  | { kind: 'done'; finalStatus: 'ACCEPTED' | 'REJECTED' | 'PENDING'; label: string };

type PerRequestState = Record<string, RequestState>;

function getErrorInfo(err: unknown): { message: string; retryable: boolean; dismiss: boolean } {
  const body =
    typeof err === 'object' && err !== null && 'body' in err
      ? (err as { body?: { error?: string } }).body
      : undefined;
  const status =
    typeof err === 'object' && err !== null && 'status' in err
      ? (err as { status?: number }).status
      : undefined;
  const errorCode = body?.error;

  if (errorCode === 'ALREADY_RESPONDED') {
    return { message: 'Tu as déjà répondu à cette demande.', retryable: false, dismiss: true };
  }
  if (errorCode === 'CONTACT_REQUEST_ALREADY_RESOLVED') {
    return { message: 'Cette demande a déjà été traitée.', retryable: false, dismiss: true };
  }
  if (errorCode === 'CONCURRENT_UPDATE') {
    return { message: 'Conflit temporaire, réessaie dans un instant.', retryable: true, dismiss: false };
  }
  if (status === 429) {
    return { message: 'Trop de réponses en peu de temps. Attends un moment.', retryable: false, dismiss: false };
  }
  return { message: 'Une erreur est survenue. Réessaie.', retryable: true, dismiss: false };
}

export function ContactRequests() {
  const [requests, setRequests] = useState<PendingContactRequest[]>([]);
  const [states, setStates] = useState<PerRequestState>({});

  useEffect(() => {
    void load();
    let interval: number | null = null;
    const start = () => {
      if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
      if (interval != null) window.clearInterval(interval);
      interval = window.setInterval(() => void load(), 60_000);
    };
    const stop = () => {
      if (interval != null) {
        window.clearInterval(interval);
        interval = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void load();
        start();
      } else {
        stop();
      }
    };
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  async function load() {
    try {
      const data = await apiClient.getPendingContactRequests();
      setRequests(data.requests);
    } catch {
      // Silent: not critical, will retry on next poll
    }
  }

  async function handleRespond(requestId: string, action: 'ACCEPT' | 'REJECT') {
    const current = states[requestId];
    if (current?.kind === 'loading') return;

    setStates(prev => ({ ...prev, [requestId]: { kind: 'loading', action } }));

    try {
      const res = await apiClient.respondToContactRequest(requestId, action);
      const labels: Record<string, string> = {
        ACCEPTED: 'Mise en relation ouverte : le professionnel a rejoint ta conversation.',
        REJECTED: 'Demande non retenue.',
        PENDING: 'Ta réponse a été enregistrée.',
      };
      setStates(prev => ({
        ...prev,
        [requestId]: { kind: 'done', finalStatus: res.status, label: labels[res.status] ?? res.message },
      }));
      // Remove from list after brief display delay
      setTimeout(() => {
        setRequests(prev => prev.filter(r => r.id !== requestId));
        setStates(prev => {
          const next = { ...prev };
          delete next[requestId];
          return next;
        });
      }, 2500);
    } catch (err: unknown) {
      const { message, retryable, dismiss } = getErrorInfo(err);
      if (dismiss) {
        // Permanent: remove silently
        setRequests(prev => prev.filter(r => r.id !== requestId));
        setStates(prev => {
          const next = { ...prev };
          delete next[requestId];
          return next;
        });
      } else {
        setStates(prev => ({ ...prev, [requestId]: { kind: 'error', message, retryable } }));
      }
    }
  }

  const visible = requests.filter(r => {
    const s = states[r.id];
    // Keep in list while done-message is displayed (timeout above handles removal)
    return s?.kind !== 'done' || true;
  });

  if (visible.length === 0) return null;

  return (
    <div className="mb-4 space-y-2" data-testid="contact-requests">
      {visible.map((req) => {
        const state = states[req.id] ?? { kind: 'idle' };
        const proName = req.proName;
        const isLoading = state.kind === 'loading';

        return (
          <BlobCard
            key={req.id}
            className="bg-white"
            data-testid={`contact-request-${req.id}`}
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-sm border-2 border-blob-black bg-blob-sand font-black text-blob-black">
                {proName.charAt(0).toUpperCase()}
              </div>

              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-blob-black">
                  <span className="font-semibold">{proName}</span> souhaite vous contacter
                </div>
                {req.message && (
                  <div className="mt-0.5 line-clamp-2 text-xs text-blob-black/56">
                    {req.message}
                  </div>
                )}
              </div>

              {state.kind === 'idle' || state.kind === 'loading' || state.kind === 'error' ? (
                <div className="flex items-center gap-2 flex-shrink-0">
                  <BlobButton
                    variant="dark"
                    size="sm"
                    onClick={() => void handleRespond(req.id, 'ACCEPT')}
                    disabled={isLoading}
                    aria-label={`Ouvrir la mise en relation avec ${proName}`}
                    data-testid={`accept-${req.id}`}
                  >
                    <Check size={14} />
                    Ouvrir
                  </BlobButton>
                  <BlobButton
                    variant="outlineDark"
                    size="sm"
                    onClick={() => void handleRespond(req.id, 'REJECT')}
                    disabled={isLoading}
                    aria-label={`Ne pas retenir la demande de ${proName}`}
                    data-testid={`reject-${req.id}`}
                  >
                    <X size={14} />
                    Ne pas retenir
                  </BlobButton>
                </div>
              ) : state.kind === 'done' ? (
                <div className="flex flex-shrink-0 items-center gap-1 text-xs text-green-900">
                  <Check size={14} />
                  {state.finalStatus === 'ACCEPTED' ? 'Mise en relation ouverte' : state.finalStatus === 'REJECTED' ? 'Non retenue' : 'Enregistré'}
                </div>
              ) : null}
            </div>

            {state.kind === 'loading' && (
              <div className="flex items-center gap-1.5 pl-13 text-xs text-blob-black/56">
                <Clock size={12} className="animate-spin" />
                {state.action === 'ACCEPT' ? 'Ouverture de la mise en relation…' : 'Réponse en cours…'}
              </div>
            )}

            {state.kind === 'done' && (
              <p className="pl-13 text-xs text-green-900">{state.label}</p>
            )}

            {state.kind === 'error' && (
              <div className="flex items-center justify-between pl-13 text-xs text-red-700">
                <span>{state.message}</span>
                {state.retryable && (
                  <button
                    className="ml-2 text-xs underline hover:text-red-800"
                    onClick={() => setStates(prev => ({ ...prev, [req.id]: { kind: 'idle' } }))}
                  >
                    Réessayer
                  </button>
                )}
              </div>
            )}
          </BlobCard>
        );
      })}
    </div>
  );
}
