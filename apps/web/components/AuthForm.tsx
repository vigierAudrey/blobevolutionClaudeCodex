"use client";
import { useState } from 'react';
import Link from 'next/link';
import { apiClient } from '../lib/apiClient';
import { useRouter } from 'next/navigation';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

type Mode = 'login' | 'register';

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'RIDER' | 'PRO'>('RIDER');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [loginConsentNeeded, setLoginConsentNeeded] = useState(false);
  const [loginConsentAccepted, setLoginConsentAccepted] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      if (mode === 'register') {
        if (!consentAccepted) {
          throw new Error('Merci de confirmer que vous avez lu et accepté la charte.');
        }
        const res = await apiClient.register({ email, password, role, consentAccepted: true });
        setInfo('Compte créé. Vérifie ta boîte mail pour valider ton email.');
        // Optionnel: rediriger vers login
        setTimeout(() => router.push('/login'), 800);
      } else {
        const res = await apiClient.login({ email, password, consentAccepted: loginConsentNeeded ? loginConsentAccepted : undefined });
        apiClient.saveTokens(res.accessToken, res.refreshToken);
        router.push('/dashboard');
      }
    } catch (err: any) {
      const msg = err?.message || 'Une erreur est survenue';
      if (mode === 'login' && msg.toLowerCase().includes('consent')) {
        setLoginConsentNeeded(true);
        setError('Pour continuer, merci d’accepter la charte.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{mode === 'login' ? 'Connexion' : 'Inscription'}</CardTitle>
        <CardDescription>
          {mode === 'login' ? 'Accède à ton compte Blobinfini.' : 'Rejoins la communauté Blobinfini.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Mot de passe</Label>
            <Input
              id="password"
              type="password"
              required
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {mode === 'register' && (
            <div className="space-y-2">
              <Label htmlFor="role">Rôle</Label>
              <select
                id="role"
                className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={role}
                onChange={(e) => setRole(e.target.value as any)}
              >
                <option value="RIDER">Rider</option>
                <option value="PRO">Pro</option>
              </select>
            </div>
          )}
          {mode === 'register' && (
            <div className="space-y-2 border rounded-md p-3 bg-muted/30">
              <div className="text-sm text-foreground">
                <p className="font-medium">Charte de sécurité & responsabilité</p>
                <p className="mt-1">
                  Blobinfini facilite la mise en relation entre personnes pour partager de bons moments.
                  Tu restes toutefois seul responsable de tes choix, de ta sécurité et de tes biens.
                  Blobinfini ne fournit ni assurance, ni encadrement, ni garantie sur les activités organisées entre utilisateurs.
                </p>
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>Donne rendez‑vous dans un lieu public et préviens un proche.</li>
                  <li>Reste vigilant face aux comportements inappropriés ou malveillants.</li>
                  <li>Évalue toi‑même les conditions (météo, niveau, matériel) avant de pratiquer.</li>
                  <li>Interromps toute activité si tu ne te sens pas en sécurité.</li>
                </ul>
                <p className="mt-2 text-muted-foreground">
                  En t’inscrivant, tu confirmes avoir lu et accepté cette charte.
                  Pour les détails, consulte la page «
                  <a className="underline text-primary" href="/charte" target="_blank" rel="noopener noreferrer">Charte et avertissement</a> ».
                </p>
              </div>
              <label className="flex items-start gap-2 text-sm mt-2">
                <input
                  id="consentAccepted"
                  type="checkbox"
                  className="mt-1"
                  checked={consentAccepted}
                  onChange={(e) => setConsentAccepted(e.target.checked)}
                  required
                />
                <span>J’ai lu et j’accepte la charte de sécurité et l’avertissement.</span>
              </label>
            </div>
          )}
          {mode === 'login' && loginConsentNeeded && (
            <div className="space-y-2 border rounded-md p-3 bg-muted/30">
              <div className="text-sm text-foreground">
                <p className="font-medium">Charte de sécurité & responsabilité</p>
                <p className="mt-1">
                  Pour poursuivre la connexion, confirme avoir lu et accepté la charte.
                  Consulte la page «
                  <a className="underline text-primary" href="/charte" target="_blank" rel="noopener noreferrer">Charte et avertissement</a> ».
                </p>
              </div>
              <label className="flex items-start gap-2 text-sm mt-2">
                <input
                  id="loginConsentAccepted"
                  type="checkbox"
                  className="mt-1"
                  checked={loginConsentAccepted}
                  onChange={(e) => setLoginConsentAccepted(e.target.checked)}
                  required
                />
                <span>J’ai lu et j’accepte la charte de sécurité et l’avertissement.</span>
              </label>
            </div>
          )}
          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
          {info && <p className="text-sm text-green-600">{info}</p>}
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? 'En cours…' : mode === 'login' ? 'Se connecter' : 'Créer le compte'}
          </Button>
        </form>
        <div className="mt-4 text-sm text-center text-muted-foreground">
          {mode === 'login' ? (
            <span>
              Pas encore de compte ? <Link href="/register" className="text-primary underline">Inscription</Link>
            </span>
          ) : (
            <span>
              Déjà un compte ? <Link href="/login" className="text-primary underline">Connexion</Link>
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
