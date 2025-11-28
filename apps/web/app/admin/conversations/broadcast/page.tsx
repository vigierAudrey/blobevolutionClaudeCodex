"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { apiClient } from '@/lib/apiClient';
import { ArrowLeft, SendHorizonal } from 'lucide-react';

type BroadcastTarget = 'ALL' | 'RIDERS' | 'PROS' | 'CUSTOM';

const TARGET_OPTIONS: Array<{ value: BroadcastTarget; label: string }> = [
  { value: 'ALL', label: 'Tous les riders et pros' },
  { value: 'RIDERS', label: 'Riders uniquement' },
  { value: 'PROS', label: 'Pros uniquement' },
  { value: 'CUSTOM', label: 'Emails précis' }
];

export default function AdminBroadcastPage() {
  const router = useRouter();
  const [target, setTarget] = useState<BroadcastTarget>('ALL');
  const [message, setMessage] = useState('');
  const [emailsInput, setEmailsInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ensureAdmin = async () => {
      try {
        const tokens = apiClient.getTokens();
        if (!tokens?.accessToken) {
          router.replace('/login');
          return;
        }
        const me = await apiClient.me();
        if (me.role !== 'ADMIN') {
          router.replace('/dashboard');
        }
      } catch {
        router.replace('/login');
      }
    };
    ensureAdmin();
  }, [router]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!message.trim()) {
      setError('Le message ne peut pas être vide.');
      return;
    }
    if (target === 'CUSTOM' && !emailsInput.trim()) {
      setError('Merci de saisir au moins un email.');
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const payload = {
        message,
        target,
        emails:
          target === 'CUSTOM'
            ? emailsInput
                .split(/\n|,/)
                .map((email) => email.trim())
                .filter(Boolean)
            : undefined
      };
      const response = await apiClient.sendAdminBroadcast(payload);
      setSuccess(
        `Message envoyé à ${response.sentCount} utilisateur(s).` +
          (response.missingEmails?.length
            ? ` Emails introuvables : ${response.missingEmails.join(', ')}`
            : '')
      );
      setMessage('');
      setEmailsInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible d’envoyer le message');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <Button variant="outline" size="sm" asChild>
          <Link href="/admin/dashboard">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Retour dashboard
          </Link>
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin/conversations/blocked">Voir blocages</Link>
        </Button>
      </div>

      <div>
        <h1 className="text-3xl font-bold">Diffusion admin</h1>
        <p className="text-muted-foreground">
          Envoyer un message dans la messagerie des riders et pros (conversation Admin → utilisateur).
        </p>
      </div>

      {(error || success) && (
        <Card>
          <CardContent className="pt-6 space-y-2">
            {error && <p className="text-sm text-red-600">{error}</p>}
            {success && <p className="text-sm text-green-600">{success}</p>}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Composer un message</CardTitle>
          <CardDescription>Choisir la cible puis rédiger la notification à envoyer.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Cible</label>
              <Select value={target} onValueChange={(value: BroadcastTarget) => setTarget(value)}>
                <SelectTrigger className="w-full md:w-1/2">
                  <SelectValue placeholder="Sélectionner une cible" />
                </SelectTrigger>
                <SelectContent>
                  {TARGET_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {target === 'CUSTOM' && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Emails (un par ligne ou séparés par des virgules)</label>
                <Textarea
                  placeholder="dev+rider1@test.com\ndev+pro1@test.com"
                  value={emailsInput}
                  onChange={(event) => setEmailsInput(event.target.value)}
                  rows={4}
                />
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium">Message</label>
              <Textarea
                placeholder="Contenu du message envoyé aux utilisateurs"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows={6}
              />
            </div>

            <Button type="submit" disabled={loading}>
              <SendHorizonal className="h-4 w-4 mr-2" />
              {loading ? 'Envoi...' : 'Envoyer la diffusion'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
