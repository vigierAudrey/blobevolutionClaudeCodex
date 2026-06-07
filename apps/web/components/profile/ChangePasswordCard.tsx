"use client";

import { useMemo, useState } from 'react';
import { PasswordRequirementsList } from '../PasswordRequirementsList';
import { getPasswordRequirementStatuses } from '../../../api/src/utils/password-validator';
import { apiClient } from '../../lib/apiClient';
import { useToast } from '../ui/toast';
import { BlobAlert, BlobButton, BlobCard, BlobInput } from '@/components/blob';

export function ChangePasswordCard() {
  const toast = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const passwordStatuses = useMemo(() => getPasswordRequirementStatuses(newPassword), [newPassword]);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus('loading');
    setMessage(null);

    if (newPassword !== confirmPassword) {
      setStatus('error');
      setMessage('Les mots de passe ne correspondent pas.');
      return;
    }

    try {
      await apiClient.changePassword({ currentPassword, newPassword });
      setStatus('success');
      setMessage('Mot de passe mis à jour.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast('Mot de passe mis à jour', 'success');
    } catch {
      const errorMessage = 'Impossible de mettre à jour le mot de passe pour le moment.';
      setStatus('error');
      setMessage(errorMessage);
      toast(errorMessage, 'error');
    } finally {
      setStatus((prev) => (prev === 'loading' ? 'idle' : prev));
    }
  };

  const isSubmitting = status === 'loading';

  return (
    <BlobCard className="bg-white">
      <button
        type="button"
        className="flex w-full cursor-pointer flex-row items-center justify-between gap-4 text-left"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
      >
        <div className="space-y-1.5">
          <h3 className="text-base font-black uppercase tracking-widest">Sécurité du compte</h3>
          <p className="text-sm leading-6 text-blob-black/64 dark:text-white/60">
            Modifie ton mot de passe actuel. Tous les appareils seront déconnectés après mise à jour.
          </p>
        </div>
        <span className="ml-4 text-xs font-black uppercase tracking-widest text-blob-black/64 dark:text-white/55">
          {isOpen ? 'Masquer' : 'Modifier'}
        </span>

      </button>
      {isOpen && (
        <div className="mt-5 border-t-2 border-blob-sand-deep dark:border-white/10 pt-5">
          <form onSubmit={onSubmit} className="space-y-4">
            <BlobInput
              id="current-password"
              type="password"
              label="Mot de passe actuel"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
            />
            <BlobInput
              id="new-password"
              type="password"
              label="Nouveau mot de passe"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
            />
            <PasswordRequirementsList statuses={passwordStatuses} />
            <BlobInput
              id="confirm-password"
              type="password"
              label="Confirmer le mot de passe"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
            />

            {message && (
              <BlobAlert variant={status === 'error' ? 'error' : 'success'}>
                {message}
              </BlobAlert>
            )}

            <BlobButton
              type="submit"
              className="w-full sm:w-auto"
              disabled={isSubmitting || !currentPassword || !newPassword || !confirmPassword}
            >
              {isSubmitting ? 'Mise à jour…' : 'Mettre à jour le mot de passe'}
            </BlobButton>
          </form>
        </div>
      )}
    </BlobCard>
  );
}
