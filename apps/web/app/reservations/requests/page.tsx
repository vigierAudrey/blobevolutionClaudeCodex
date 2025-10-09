"use client";

// Force SSR for dynamic user-specific features
export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClient } from '../../../lib/apiClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import type { RiderBookingRequest } from '../../../lib/types/booking';
import { ListItemSkeleton, PageHeaderSkeleton } from '../../../components/ui/skeleton';

function statusLabel(status: RiderBookingRequest['status']) {
  switch (status) {
    case 'PENDING':
      return { label: 'En attente', variant: 'outline' as const };
    case 'ACCEPTED':
      return { label: 'Acceptée', variant: 'secondary' as const };
    case 'REJECTED':
      return { label: 'Refusée', variant: 'destructive' as const };
    default:
      return { label: status, variant: 'outline' as const };
  }
}

export default function RiderRequestsPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<RiderBookingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const tokens = apiClient.getTokens();
    if (!tokens?.accessToken) {
      router.replace('/login');
      return;
    }

    apiClient
      .me()
      .then((user) => {
        if (user.role !== 'RIDER') {
          router.replace('/dashboard');
          return;
        }
        return apiClient.getMyBookingRequests();
      })
      .then((res) => {
        if (res) {
          setRequests(res.requests);
        }
      })
      .catch((err: any) => {
        setError(err?.message || 'Impossible de charger vos demandes');
      })
      .finally(() => setLoading(false));
  }, [router]);

  const grouped = useMemo(() => {
    const byStatus: Record<RiderBookingRequest['status'], RiderBookingRequest[]> = {
      PENDING: [],
      ACCEPTED: [],
      REJECTED: [],
    };
    for (const request of requests) {
      byStatus[request.status].push(request);
    }
    return byStatus;
  }, [requests]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>Mes demandes de cours</span>
        <Link href="/reservations/start">Nouvelle recherche</Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Demandes envoyées</CardTitle>
          <CardDescription>Retrouve l’état de tes demandes et leurs prochaines étapes.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="text-sm font-medium text-muted-foreground">🔄 Chargement de vos demandes...</div>
                {Array.from({ length: 3 }).map((_, i) => (
                  <ListItemSkeleton key={i} />
                ))}
              </div>
            </div>
          ) : error ? (
            <p className="text-sm text-red-700">{error}</p>
          ) : requests.length === 0 ? (
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>Aucune demande envoyée pour le moment.</p>
              <Button asChild variant="secondary">
                <Link href="/reservations/start">Rechercher un créneau</Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-6">
              {(['PENDING', 'ACCEPTED', 'REJECTED'] as RiderBookingRequest['status'][]).map((status) => {
                const items = grouped[status];
                if (!items.length) return null;
                const { label, variant } = statusLabel(status);
                return (
                  <div key={status} className="space-y-3">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <Badge variant={variant}>{label}</Badge>
                      <span className="text-muted-foreground">{items.length} demande{items.length > 1 ? 's' : ''}</span>
                    </div>
                    <div className="space-y-3">
                      {items.map((req) => (
                        <div key={req.id} className="rounded-md border p-3 text-sm">
                          <div className="flex flex-col gap-1">
                            <span className="font-medium">
                              {req.availability.spotName || 'Spot à définir'} — {new Date(req.availability.startAt).toLocaleString('fr-FR')}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              Pro: {req.availability.pro.businessName || req.availability.pro.email}
                            </span>
                            <span className="text-xs text-muted-foreground">Envoyée le {new Date(req.createdAt).toLocaleString('fr-FR')}</span>
                            {req.message && (
                              <span className="italic text-muted-foreground">« {req.message} »</span>
                            )}
                            {req.status !== 'PENDING' && req.respondedAt && (
                              <span className="text-xs text-muted-foreground">
                                Réponse le {new Date(req.respondedAt).toLocaleString('fr-FR')}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
