"use client";

import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Label } from '../../components/ui/label';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { PasswordRequirementsList } from '../../components/PasswordRequirementsList';
import { getPasswordRequirementStatuses } from '../../../api/src/utils/password-validator';
import { apiClient } from '../../lib/apiClient';
import { useToast } from '../../components/ui/toast';

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
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Impossible de mettre à jour le mot de passe';
      setStatus('error');
      setMessage(errorMessage);
      toast(errorMessage, 'error');
    } finally {
      setStatus((prev) => (prev === 'loading' ? 'idle' : prev));
    }
  };

  const isSubmitting = status === 'loading';

  return (
    <Card>
      <CardHeader
        className="flex cursor-pointer flex-row items-center justify-between"
        onClick={() => setIsOpen((prev) => !prev)}
        role="button"
        aria-expanded={isOpen}
      >
        <div className="space-y-1.5">
          <CardTitle className="text-base">🔐 Sécurité du compte</CardTitle>
          <CardDescription>
            Modifie ton mot de passe actuel. Tous les appareils seront déconnectés après mise à jour.
          </CardDescription>
        </div>
        <span className="ml-4 text-sm text-muted-foreground">
          {isOpen ? 'Masquer' : 'Modifier'}
        </span>
      </CardHeader>
      {isOpen && (
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="current-password">Mot de passe actuel</Label>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">Nouveau mot de passe</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
              />
            </div>
            <PasswordRequirementsList statuses={passwordStatuses} />
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirmer le mot de passe</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
              />
            </div>

            {message && (
              <p className={`text-sm ${status === 'error' ? 'text-red-600' : 'text-green-600'}`} role="alert">
                {message}
              </p>
            )}

            <Button
              type="submit"
              className="w-full sm:w-auto"
              disabled={isSubmitting || !currentPassword || !newPassword || !confirmPassword}
            >
              {isSubmitting ? 'Mise à jour…' : 'Mettre à jour le mot de passe'}
            </Button>
          </form>
        </CardContent>
      )}
    </Card>
  );
}
