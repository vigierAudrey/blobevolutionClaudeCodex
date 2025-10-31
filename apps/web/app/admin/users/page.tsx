"use client";

// Force SSR for admin auth and dynamic data
export const dynamic = 'force-dynamic';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { apiClient } from '../../../lib/apiClient';
import { ArrowLeft, Shield, ShieldOff, CheckCircle, XCircle, User, Crown, Briefcase } from 'lucide-react';
import Link from 'next/link';

interface User {
  id: string;
  email: string;
  role: 'RIDER' | 'PRO' | 'ADMIN';
  emailVerified: boolean;
  createdAt: string;
  deletedAt: string | null;
  riderProfile?: {
    displayName: string;
  };
  proProfile?: {
    businessName: string;
    verified: boolean;
  };
  adminProfile?: {
    displayName: string;
  };
}

const getRoleIcon = (role: string) => {
  switch (role) {
    case 'ADMIN': return <Crown className="h-4 w-4" />;
    case 'PRO': return <Briefcase className="h-4 w-4" />;
    default: return <User className="h-4 w-4" />;
  }
};

const getRoleBadge = (role: string) => {
  switch (role) {
    case 'ADMIN': return <Badge variant="destructive">Admin</Badge>;
    case 'PRO': return <Badge variant="secondary">Pro</Badge>;
    default: return <Badge variant="outline">Rider</Badge>;
  }
};

type AdminUsersResponse = {
  users: User[];
  pagination?: { totalPages: number };
};

export default function AdminUsers() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [roleFilter, setRoleFilter] = useState<string>('');
  const [actionLoading, setActionLoading] = useState<{ [key: string]: boolean }>({});

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

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string | number> = { page, limit: 20 };
      if (roleFilter) params.role = roleFilter;

      const response = await apiClient.getAdminUsers(params) as AdminUsersResponse;
      setUsers(response.users || []);
      setTotalPages(response.pagination?.totalPages || 1);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : null;
      setError(message || 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, [page, roleFilter]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const handleSuspend = async (user: User) => {
    const suspended = !user.deletedAt;
    const actionKey = `suspend-${user.id}`;

    setActionLoading(prev => ({ ...prev, [actionKey]: true }));
    try {
      await apiClient.suspendUser(user.id, suspended);
      await loadUsers(); // Reload the list
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : null;
      setError(message || 'Erreur lors de la suspension');
    } finally {
      setActionLoading(prev => ({ ...prev, [actionKey]: false }));
    }
  };

  const handleVerifyPro = async (user: User) => {
    if (!user.proProfile) return;

    const verified = !user.proProfile.verified;
    const actionKey = `verify-${user.id}`;

    setActionLoading(prev => ({ ...prev, [actionKey]: true }));
    try {
      await apiClient.verifyPro(user.id, verified);
      await loadUsers(); // Reload the list
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : null;
      setError(message || 'Erreur lors de la vérification');
    } finally {
      setActionLoading(prev => ({ ...prev, [actionKey]: false }));
    }
  };

  const getDisplayName = (user: User) => {
    if (user.riderProfile?.displayName) return user.riderProfile.displayName;
    if (user.proProfile?.businessName) return user.proProfile.businessName;
    if (user.adminProfile?.displayName) return user.adminProfile.displayName;
    return user.email;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading && users.length === 0) {
    return (
      <div className="max-w-6xl mx-auto space-y-6">
        <p>Chargement des utilisateurs...</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/admin/dashboard">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Retour
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold">Gestion des utilisateurs</h1>
            <p className="text-muted-foreground">
              Administration des comptes utilisateurs
            </p>
          </div>
        </div>
      </div>

      {/* Filtres */}
      <Card>
        <CardHeader>
          <CardTitle>Filtres</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Button
              variant={roleFilter === '' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setRoleFilter('')}
            >
              Tous
            </Button>
            <Button
              variant={roleFilter === 'RIDER' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setRoleFilter('RIDER')}
            >
              Riders
            </Button>
            <Button
              variant={roleFilter === 'PRO' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setRoleFilter('PRO')}
            >
              Pros
            </Button>
            <Button
              variant={roleFilter === 'ADMIN' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setRoleFilter('ADMIN')}
            >
              Admins
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Erreurs */}
      {error && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-red-600">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Liste des utilisateurs */}
      <Card>
        <CardHeader>
          <CardTitle>Utilisateurs</CardTitle>
          <CardDescription>
            {users.length} utilisateur{users.length > 1 ? 's' : ''} trouvé{users.length > 1 ? 's' : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {users.map((user) => (
              <div key={user.id} className="border rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      {getRoleIcon(user.role)}
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{getDisplayName(user)}</span>
                          {getRoleBadge(user.role)}
                          {user.role === 'PRO' && user.proProfile?.verified && (
                            <Badge variant="default" className="text-xs">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Vérifié
                            </Badge>
                          )}
                          {user.deletedAt && (
                            <Badge variant="destructive" className="text-xs">
                              Suspendu
                            </Badge>
                          )}
                          {!user.emailVerified && (
                            <Badge variant="outline" className="text-xs">
                              Email non vérifié
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">{user.email}</p>
                        <p className="text-xs text-muted-foreground">
                          Inscrit le {formatDate(user.createdAt)}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Actions suspension */}
                    {user.role !== 'ADMIN' && (
                      <Button
                        variant={user.deletedAt ? "default" : "destructive"}
                        size="sm"
                        onClick={() => handleSuspend(user)}
                        disabled={actionLoading[`suspend-${user.id}`]}
                      >
                        {actionLoading[`suspend-${user.id}`] ? (
                          '...'
                        ) : user.deletedAt ? (
                          <>
                            <Shield className="h-4 w-4 mr-1" />
                            Réactiver
                          </>
                        ) : (
                          <>
                            <ShieldOff className="h-4 w-4 mr-1" />
                            Suspendre
                          </>
                        )}
                      </Button>
                    )}

                    {/* Actions vérification pro */}
                    {user.role === 'PRO' && user.proProfile && (
                      <Button
                        variant={user.proProfile.verified ? "outline" : "default"}
                        size="sm"
                        onClick={() => handleVerifyPro(user)}
                        disabled={actionLoading[`verify-${user.id}`]}
                      >
                        {actionLoading[`verify-${user.id}`] ? (
                          '...'
                        ) : user.proProfile.verified ? (
                          <>
                            <XCircle className="h-4 w-4 mr-1" />
                            Retirer vérification
                          </>
                        ) : (
                          <>
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Vérifier
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {users.length === 0 && !loading && (
              <p className="text-center text-muted-foreground py-8">
                Aucun utilisateur trouvé
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
              >
                Précédent
              </Button>
              <span className="flex items-center px-4 text-sm">
                Page {page} sur {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
              >
                Suivant
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
