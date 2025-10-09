"use client";

// Force SSR for admin auth and dynamic data
export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { Badge } from '../../../../components/ui/badge';
import { apiClient, type AdminUserDetail } from '../../../../lib/apiClient';
import { ArrowLeft, Mail, ShieldOff, Shield, User, Briefcase, Crown, MapPin, Activity } from 'lucide-react';

const ROLE_LABEL: Record<string, { label: string; badge: 'default' | 'destructive' | 'secondary' | 'outline' }> = {
  ADMIN: { label: 'Admin', badge: 'destructive' },
  PRO: { label: 'Pro', badge: 'secondary' },
  RIDER: { label: 'Rider', badge: 'outline' }
};

export default function AdminUserDetailPage() {
  const router = useRouter();
  const params = useParams();
  const userId = params?.id as string;

  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const tokens = apiClient.getTokens();
        if (!tokens?.accessToken) {
          router.replace('/login');
          return;
        }

        const currentUser = await apiClient.me();
        if (currentUser.role !== 'ADMIN') {
          router.replace('/dashboard');
          return;
        }
      } catch (err) {
        console.error('Auth check failed:', err);
        router.replace('/login');
      }
    };

    checkAuth();
  }, [router]);

  useEffect(() => {
    const load = async () => {
      if (!userId) return;
      setLoading(true);
      setError(null);
      try {
        const data = await apiClient.getAdminUser(userId);
        setDetail(data);
      } catch (err: any) {
        setError(err?.message || 'Erreur de chargement');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [userId]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <p>Chargement du profil…</p>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <Button variant="outline" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Retour
        </Button>
        <Card>
          <CardContent className="pt-6">
            <p className="text-red-600">{error || 'Profil introuvable'}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { user, metrics } = detail;
  const roleMeta = ROLE_LABEL[user.role] ?? ROLE_LABEL.RIDER;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Retour
        </Button>
        <Link href="/admin/users">
          <Button variant="ghost" size="sm">
            Gestion des utilisateurs
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            {user.role === 'ADMIN' ? <Crown className="h-5 w-5" /> : user.role === 'PRO' ? <Briefcase className="h-5 w-5" /> : <User className="h-5 w-5" />}
            {user.riderProfile?.displayName || user.proProfile?.businessName || user.adminProfile?.displayName || user.email}
            <Badge variant={roleMeta.badge}>{roleMeta.label}</Badge>
          </CardTitle>
          <CardDescription className="flex items-center gap-3 text-sm">
            <span className="inline-flex items-center gap-1"><Mail className="h-4 w-4" /> {user.email}</span>
            <span className="inline-flex items-center gap-1"><Activity className="h-4 w-4" /> Inscrit le {new Date(user.createdAt).toLocaleDateString('fr-FR')}</span>
            {user.deletedAt ? (
              <span className="inline-flex items-center gap-1 text-red-600"><ShieldOff className="h-4 w-4" /> Suspendu</span>
            ) : (
              <span className="inline-flex items-center gap-1 text-emerald-600"><Shield className="h-4 w-4" /> Actif</span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-muted-foreground uppercase">Dernière recherche</p>
            {user.lastSearch ? (
              <p className="text-sm">
                {user.lastSearch.sport} • {user.lastSearch.level}
                {user.lastSearch.distanceKm ? ` • ${user.lastSearch.distanceKm} km` : ''}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Aucune recherche</p>
            )}
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase">Rapports reçus</p>
            <p className="text-sm">{metrics.reportsReceived}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase">Sessions enregistrées</p>
            <p className="text-sm">{metrics.sessionsCount}</p>
          </div>
        </CardContent>
      </Card>

      {user.riderProfile && (
        <Card>
          <CardHeader>
            <CardTitle>Profil rider</CardTitle>
            <CardDescription>Informations publiques du rider</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground uppercase">Display name</p>
                <p className="text-sm">{user.riderProfile.displayName || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase">Notifications email</p>
                <p className="text-sm">{user.riderProfile.emailNotif ? 'Activées' : 'Désactivées'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase">Distance max</p>
                <p className="text-sm">{user.riderProfile.maxDistanceKm ? `${user.riderProfile.maxDistanceKm} km` : 'Non définie'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase">Préférence cours</p>
                <p className="text-sm">{user.riderProfile.wantsLesson ? user.riderProfile.lessonSport || 'Cours souhaités' : 'Pas de cours'}</p>
              </div>
            </div>

            {user.riderProfile.bio && (
              <div>
                <p className="text-xs text-muted-foreground uppercase mb-1">Bio</p>
                <p className="text-sm whitespace-pre-line bg-muted/50 rounded-md p-3">{user.riderProfile.bio}</p>
              </div>
            )}

            {user.riderProfile.lat != null && user.riderProfile.lng != null && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <MapPin className="h-4 w-4" />
                Position: {user.riderProfile.lat.toFixed(4)}, {user.riderProfile.lng.toFixed(4)}
              </div>
            )}

            <div className="space-y-2">
              <p className="text-xs text-muted-foreground uppercase">Disciplines</p>
              {user.riderProfile.disciplines.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune discipline configurée</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {user.riderProfile.disciplines.map((d) => (
                    <Badge key={`${d.sport}-${d.level}`}>{d.sport} • {d.level}</Badge>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {user.proProfile && (
        <Card>
          <CardHeader>
            <CardTitle>Profil professionnel</CardTitle>
            <CardDescription>Informations publiques du pro</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground uppercase">Business</p>
                <p className="text-sm">{user.proProfile.businessName || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase">Vérification</p>
                <p className="text-sm">{user.proProfile.verified ? 'Vérifié' : 'Non vérifié'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase">Tarif horaire</p>
                <p className="text-sm">{user.proProfile.pricePerHour ? `${user.proProfile.pricePerHour} €` : 'Non renseigné'}</p>
              </div>
              {user.proProfile.lat != null && user.proProfile.lng != null && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <MapPin className="h-4 w-4" /> {user.proProfile.lat.toFixed(4)}, {user.proProfile.lng.toFixed(4)}
                </div>
              )}
            </div>

            {user.proProfile.bio && (
              <div>
                <p className="text-xs text-muted-foreground uppercase mb-1">Bio</p>
                <p className="text-sm whitespace-pre-line bg-muted/50 rounded-md p-3">{user.proProfile.bio}</p>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-xs text-muted-foreground uppercase">Offres</p>
              {user.proProfile.offers.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune offre active</p>
              ) : (
                <div className="space-y-2">
                  {user.proProfile.offers.map((offer) => (
                    <div key={offer.id} className="border rounded-md p-3 text-sm">
                      <div className="font-medium">{offer.title}</div>
                      <div className="text-muted-foreground">
                        {offer.sport} • {offer.level} • {offer.hourlyRate} €
                      </div>
                      <div className={`text-xs mt-1 ${offer.isActive ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                        {offer.isActive ? 'Active' : 'Inactive'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {user.adminProfile && (
        <Card>
          <CardHeader>
            <CardTitle>Profil administrateur</CardTitle>
            <CardDescription>Permissions du compte</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div>
              <p className="text-xs text-muted-foreground uppercase">Display name</p>
              <p className="text-sm">{user.adminProfile.displayName || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">Dernière connexion</p>
              <p className="text-sm">{user.adminProfile.lastLoginAt ? new Date(user.adminProfile.lastLoginAt).toLocaleString('fr-FR') : 'Jamais'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase mb-1">Permissions</p>
              {user.adminProfile.permissions.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune permission spécifique</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {user.adminProfile.permissions.map((perm) => (
                    <Badge key={perm} variant="outline">{perm}</Badge>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

