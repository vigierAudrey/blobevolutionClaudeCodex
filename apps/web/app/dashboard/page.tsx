"use client";
import nextDynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '../../lib/apiClient';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import Link from 'next/link';
import { User, Map, Info, LogOut, MessageSquare, GraduationCap, Search, RadioTower, Tag } from 'lucide-react';

const AdBannerSidebar = nextDynamic(
  () => import('../../components/ads/AdBanner').then((mod) => mod.AdBannerSidebar),
  {
    ssr: false,
    loading: () => <div className="hidden lg:block h-48 rounded-md bg-slate-200/60" aria-hidden="true" />,
  },
);

// Force SSR due to auth context and dynamic user data
export const dynamic = 'force-dynamic';

type DashboardUser = {
  id: string;
  email: string;
  role: 'RIDER' | 'PRO' | 'ADMIN';
  emailVerified: boolean;
  [key: string]: unknown;
};

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<DashboardUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [showProfilePrompt, setShowProfilePrompt] = useState(false);
  const [unreadTotal, setUnreadTotal] = useState<number>(0);

  useEffect(() => {
    const t = apiClient.getTokens();
    if (!t?.accessToken) {
      router.replace('/login');
      return;
    }
    apiClient
      .me()
      .then((u) => {
        setUser(u as DashboardUser);
        // First-login banner heuristic: show once per user until dismissed
        const key = `visited-dashboard-${u?.id}`;
        const visited = typeof window !== 'undefined' ? localStorage.getItem(key) : '1';
        if (!visited) setShowProfilePrompt(true);
        if (typeof window !== 'undefined') localStorage.setItem(key, '1');
      })
      .finally(() => setLoading(false));
  }, [router]);

  // Redirect to onboarding if profile is incomplete (name + at least one discipline + photo)
  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      try {
        const [p, d] = await Promise.all([
          apiClient.getProfile(),
          apiClient.getDisciplines().catch(() => []),
        ]);
        if (!active) return;
        const hasName = !!p?.displayName;
        const hasPhoto = !!p?.photoUrl;
        const hasDiscipline = Array.isArray(d) && d.length > 0;
        const incomplete = !hasName || !hasPhoto || !hasDiscipline;
        if (incomplete) router.replace('/onboarding');
      } catch (_) {
        // ignore
      }
    })();
    return () => { active = false; };
  }, [user, router]);

  // Load aggregated unread count for conversations
  useEffect(() => {
    let active = true;
    const loadUnread = async () => {
      try {
        const data = await apiClient.listConversations();
        if (!active) return;
        const response = data as { items?: Array<{ unread?: number }> };
        const total = (response.items ?? []).reduce((acc, it) => acc + Number(it.unread ?? 0), 0);
        setUnreadTotal(total);
      } catch {}
    };
    loadUnread();
    const t = setInterval(loadUnread, 15000);
    return () => { active = false; clearInterval(t); };
  }, []);

  useEffect(() => {
    // Rediriger les PRO vers leur dashboard dédié
    if (user?.role === 'PRO') {
      router.replace('/pro/dashboard');
      return;
    }
  }, [user, router]);

  const logout = async () => {
    try {
      await apiClient.logoutAll();
    } catch (_) {}
    apiClient.clearTokens();
    router.replace('/login');
  };

  if (loading) return <p>Chargement…</p>;
  if (!user) return null;

  // Ce dashboard est désormais exclusivement pour les RIDERS
  if (user.role === 'PRO') return null; // Protection supplémentaire

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Tableau de bord</h1>
          <p className="text-sm text-muted-foreground">Bienvenue, {user?.email}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/account" className="text-sm underline text-primary">Mon compte</Link>
          <Button variant="destructive" onClick={logout} className="inline-flex items-center gap-2"><LogOut size={16}/> Déconnexion</Button>
        </div>
      </div>

      {showProfilePrompt && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Première connexion détectée. Pense à compléter ton profil pour un meilleur matching.
          <div className="mt-2 flex gap-2">
            <Link href="/profile" className="underline text-amber-900">Compléter mon profil</Link>
            <button onClick={() => setShowProfilePrompt(false)} className="underline">Plus tard</button>
          </div>
        </div>
      )}

      {!user?.emailVerified && (
        <div className="rounded-lg border border-blue-300 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          Ton email n&rsquo;est pas encore vérifié. Pense à confirmer ton adresse pour sécuriser ton compte.
          <div className="mt-2">
            <Link className="underline" href="/account">Voir mon compte</Link>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><MessageSquare size={18}/> Messagerie {unreadTotal>0 && (<span className="ml-2 inline-flex items-center rounded-full bg-primary/10 text-primary text-xs px-2 py-0.5">{unreadTotal}</span>)}</CardTitle>
            <CardDescription>Retrouve tes conversations</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/messages" className="inline-block w-full">
              <Button className="w-full" variant="outline">Ouvrir la messagerie</Button>
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><User size={18}/> Profil</CardTitle>
            <CardDescription>Crée ou mets à jour tes infos</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/profile" className="inline-block w-full">
              <Button className="w-full">Compléter mon profil</Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Map size={18}/> Matching</CardTitle>
            <CardDescription>Trouve des partenaires proches</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/matching" className="inline-block w-full">
              <Button className="w-full" variant="secondary">Accéder au matching</Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GraduationCap size={18}/> Cours & Bons Plans
              <Tag size={14} className="text-muted-foreground" />
            </CardTitle>
            <CardDescription>
              Trouve un moniteur, signale que tu cherches un cours ou profite de promos
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Link href="/offers" className="block">
              <Button className="w-full" variant="outline">
                <Search size={16} className="mr-2" />
                Chercher un pro près de moi
              </Button>
            </Link>
            <Link href="/lesson-request" className="block">
              <Button className="w-full" variant="secondary">
                <RadioTower size={16} className="mr-2" />
                Me rendre visible aux pros
              </Button>
            </Link>
            <Link href="/promos" className="block">
              <Button className="w-full" variant="outline">
                <Tag size={16} className="mr-2" />
                Voir les bons plans
              </Button>
            </Link>
            <p className="text-xs text-muted-foreground mt-2 px-1">
              💡 Les pros voient ta demande sur la BloboMap et peuvent te proposer un cours
            </p>
          </CardContent>
        </Card>

        <Card className="sm:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Info size={18}/> À propos & RGPD</CardTitle>
            <CardDescription>
              Comprendre l&rsquo;utilisation des données, la sécurité et le fonctionnement du site.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/about" className="inline-block w-full sm:w-auto">
              <Button>En savoir plus</Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Publicité dashboard - sidebar */}
      <AdBannerSidebar
        slot="dashboard-sidebar"
        className="max-w-md mx-auto mt-6"
      />
    </div>
  );
}
