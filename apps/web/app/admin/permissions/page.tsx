"use client";

// Force SSR for admin auth and dynamic data
export const dynamic = 'force-dynamic';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { Textarea } from '../../../components/ui/textarea';
import { apiClient } from '../../../lib/apiClient';
import { ArrowLeft, Shield, Settings, Crown, Users } from 'lucide-react';
import Link from 'next/link';

interface Admin {
  id: string;
  email: string;
  emailVerified: boolean;
  createdAt: string;
  adminProfile?: {
    displayName: string;
    permissions: string[];
    lastLoginAt: string | null;
    allowedIPs: string[];
  };
}

interface PermissionData {
  available: string[];
  roles: Record<string, string[]>;
}

type AdminsResponse = {
  admins?: Admin[] | null;
};

const isAdminsResponse = (value: unknown): value is AdminsResponse => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as { admins?: unknown };
  return candidate.admins === undefined || Array.isArray(candidate.admins);
};

const isPermissionData = (value: unknown): value is PermissionData => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<PermissionData>;
  const roles = candidate.roles;
  return Array.isArray(candidate.available) && typeof roles === 'object' && roles !== null;
};

const PERMISSION_LABELS: Record<string, string> = {
  'users.view': 'Voir les utilisateurs',
  'users.suspend': 'Suspendre des utilisateurs',
  'users.delete': 'Supprimer des utilisateurs',
  'pros.verify': 'Vérifier les professionnels',
  'pros.manage': 'Gérer les professionnels',
  'reports.view': 'Voir les signalements',
  'reports.moderate': 'Modérer les signalements',
  'analytics.view': 'Voir les analytics',
  'permissions.manage': 'Gérer les permissions',
  'system.configure': 'Configuration système'
};

const ROLE_LABELS: Record<string, string> = {
  'SUPER_ADMIN': 'Super Administrateur',
  'MODERATOR': 'Modérateur',
  'ANALYTICS': 'Analyste'
};

const ROLE_DESCRIPTIONS: Record<string, string> = {
  'SUPER_ADMIN': 'Accès complet à toutes les fonctionnalités',
  'MODERATOR': 'Gestion des utilisateurs et modération',
  'ANALYTICS': 'Accès aux statistiques et rapports'
};

export default function AdminPermissions() {
  const router = useRouter();
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [permissions, setPermissions] = useState<PermissionData>({ available: [], roles: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<{ [key: string]: boolean }>({});
  const [selectedAdmin, setSelectedAdmin] = useState<Admin | null>(null);
  const [editingPermissions, setEditingPermissions] = useState<string[]>([]);
  const [allowedIpDraft, setAllowedIpDraft] = useState('');

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

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [adminsResponseRaw, permissionsResponseRaw] = await Promise.all([
        apiClient.getAdmins(),
        apiClient.getPermissions()
      ]);

      const resolvedAdmins = isAdminsResponse(adminsResponseRaw) ? adminsResponseRaw.admins ?? [] : [];
      const resolvedPermissions = isPermissionData(permissionsResponseRaw)
        ? permissionsResponseRaw
        : { available: [], roles: {} };

      setAdmins(resolvedAdmins);
      setPermissions(resolvedPermissions);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : null;
      setError(message || 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  const getRoleFromPermissions = (adminPermissions: string[]): string | null => {
    for (const [role, rolePerms] of Object.entries(permissions.roles)) {
      if (rolePerms.length === adminPermissions.length &&
          rolePerms.every(p => adminPermissions.includes(p))) {
        return role;
      }
    }
    return null;
  };

  const handleSetRole = async (admin: Admin, role: string) => {
    const actionKey = `role-${admin.id}`;
    setActionLoading(prev => ({ ...prev, [actionKey]: true }));

    try {
      await apiClient.setAdminRole(admin.id, role);
      await loadData(); // Reload data
      setSelectedAdmin(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : null;
      setError(message || 'Erreur lors de la mise à jour du rôle');
    } finally {
      setActionLoading(prev => ({ ...prev, [actionKey]: false }));
    }
  };

  const handleUpdatePermissions = async (admin: Admin) => {
    const actionKey = `permissions-${admin.id}`;
    setActionLoading(prev => ({ ...prev, [actionKey]: true }));

    try {
      await apiClient.updateAdminPermissions(admin.id, editingPermissions);
      await loadData(); // Reload data
      setSelectedAdmin(null);
      setEditingPermissions([]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : null;
      setError(message || 'Erreur lors de la mise à jour des permissions');
    } finally {
      setActionLoading(prev => ({ ...prev, [actionKey]: false }));
    }
  };

  const startEditPermissions = (admin: Admin) => {
    setSelectedAdmin(admin);
    setEditingPermissions(admin.adminProfile?.permissions || []);
    setAllowedIpDraft((admin.adminProfile?.allowedIPs || []).join('\n'));
  };

  const togglePermission = (permission: string) => {
    setEditingPermissions(prev =>
      prev.includes(permission)
        ? prev.filter(p => p !== permission)
        : [...prev, permission]
    );
  };

  const handleUpdateAllowedIPs = async (admin: Admin) => {
    const actionKey = `allowed-ips-${admin.id}`;
    setActionLoading(prev => ({ ...prev, [actionKey]: true }));
    const parsed = allowedIpDraft
      .split(/[\n,]/)
      .map(value => value.trim())
      .filter(Boolean);

    try {
      await apiClient.setAdminAllowedIPs(admin.id, parsed);
      await loadData();
      setSelectedAdmin(null);
      setAllowedIpDraft('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : null;
      setError(message || 'Erreur lors de la mise à jour des IPs autorisées');
    } finally {
      setActionLoading(prev => ({ ...prev, [actionKey]: false }));
    }
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto space-y-6">
        <p>Chargement des permissions...</p>
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
            <h1 className="text-3xl font-bold">Gestion des permissions</h1>
            <p className="text-muted-foreground">
              Administration des rôles et permissions des administrateurs
            </p>
          </div>
        </div>
      </div>

      {/* Erreurs */}
      {error && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-red-600">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Rôles prédéfinis */}
      <Card>
        <CardHeader>
          <CardTitle>Rôles prédéfinis</CardTitle>
          <CardDescription>
            Rôles avec permissions pré-configurées
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Object.entries(permissions.roles).map(([role, rolePermissions]) => (
              <div key={role} className="border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Crown className="h-4 w-4" />
                  <h3 className="font-semibold">{ROLE_LABELS[role] || role}</h3>
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  {ROLE_DESCRIPTIONS[role]}
                </p>
                <div className="space-y-1">
                  <p className="text-xs font-medium">Permissions incluses:</p>
                  <div className="flex flex-wrap gap-1">
                    {rolePermissions.slice(0, 3).map(permission => (
                      <Badge key={permission} variant="secondary" className="text-xs">
                        {PERMISSION_LABELS[permission] || permission}
                      </Badge>
                    ))}
                    {rolePermissions.length > 3 && (
                      <Badge variant="outline" className="text-xs">
                        +{rolePermissions.length - 3} autres
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Liste des administrateurs */}
      <Card>
        <CardHeader>
          <CardTitle>Administrateurs</CardTitle>
          <CardDescription>
            {admins.length} administrateur{admins.length > 1 ? 's' : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {admins.map((admin) => {
              const currentPermissions = admin.adminProfile?.permissions || [];
              const currentRole = getRoleFromPermissions(currentPermissions);
              const isEditing = selectedAdmin?.id === admin.id;

              return (
                <div key={admin.id} className="border rounded-lg p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 space-y-3">
                      {/* Header admin */}
                      <div className="flex items-center gap-3">
                        <Shield className="h-5 w-5 text-blue-500" />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">
                              {admin.adminProfile?.displayName || admin.email}
                            </span>
                            {!admin.emailVerified && (
                              <Badge variant="outline" className="text-xs">
                                Email non vérifié
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">{admin.email}</p>
                          <p className="text-xs text-muted-foreground">
                            Inscrit le {formatDate(admin.createdAt)}
                          </p>
                        </div>
                      </div>

                      {/* Rôle actuel */}
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">Rôle actuel:</span>
                          {currentRole ? (
                            <Badge variant="default">
                              {ROLE_LABELS[currentRole] || currentRole}
                            </Badge>
                          ) : (
                            <Badge variant="outline">Personnalisé</Badge>
                          )}
                        </div>

                        {/* Permissions actuelles */}
                        <div className="space-y-1">
                          <span className="text-sm font-medium">
                            Permissions ({currentPermissions.length}):
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {currentPermissions.map(permission => (
                              <Badge key={permission} variant="secondary" className="text-xs">
                                {PERMISSION_LABELS[permission] || permission}
                              </Badge>
                            ))}
                            {currentPermissions.length === 0 && (
                              <span className="text-xs text-muted-foreground">Aucune permission</span>
                            )}
                          </div>
                        </div>

                        {/* IPs autorisées */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-medium">IPs autorisées</p>
                              <p className="text-xs text-muted-foreground">
                                Limiter l&rsquo;accès à la console admin
                              </p>
                            </div>
                            {admin.adminProfile?.allowedIPs?.length ? (
                              <Badge variant="default" className="text-xs">
                                {admin.adminProfile.allowedIPs.length} IP{admin.adminProfile.allowedIPs.length > 1 ? 's' : ''}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs">
                                Aucune restriction
                              </Badge>
                            )}
                          </div>

                          {admin.adminProfile?.allowedIPs?.length ? (
                            <ul className="text-xs font-mono bg-muted rounded-md p-3 space-y-1">
                              {admin.adminProfile.allowedIPs.map(ip => (
                                <li key={ip}>{ip}</li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              Tous les réseaux autorisés (non recommandé en production)
                            </p>
                          )}

                          {isEditing && (
                            <div className="space-y-2">
                              <Textarea
                                value={allowedIpDraft}
                                onChange={(event) => setAllowedIpDraft(event.target.value)}
                                placeholder="192.168.0.1&#10;10.0.0.0/24"
                                className="text-sm font-mono"
                                rows={4}
                              />
                              <p className="text-xs text-muted-foreground">
                                Une IP ou plage CIDR par ligne.
                              </p>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleUpdateAllowedIPs(admin)}
                                disabled={actionLoading[`allowed-ips-${admin.id}`]}
                              >
                                {actionLoading[`allowed-ips-${admin.id}`] ? '...' : 'Mettre à jour les IPs'}
                              </Button>
                            </div>
                          )}
                        </div>

                        {/* Edition des permissions */}
                        {isEditing && (
                          <div className="border rounded-lg p-4 bg-gray-50">
                            <h4 className="font-medium mb-3">Modifier les permissions</h4>
                            <div className="grid grid-cols-2 gap-2 mb-4">
                              {permissions.available.map(permission => (
                                <label key={permission} className="flex items-center gap-2 text-sm">
                                  <input
                                    type="checkbox"
                                    checked={editingPermissions.includes(permission)}
                                    onChange={() => togglePermission(permission)}
                                  />
                                  <span>{PERMISSION_LABELS[permission] || permission}</span>
                                </label>
                              ))}
                            </div>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                onClick={() => handleUpdatePermissions(admin)}
                                disabled={actionLoading[`permissions-${admin.id}`]}
                              >
                                {actionLoading[`permissions-${admin.id}`] ? '...' : 'Sauvegarder'}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setSelectedAdmin(null);
                                  setEditingPermissions([]);
                                  setAllowedIpDraft('');
                                }}
                              >
                                Annuler
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="ml-6 flex flex-col gap-2">
                      {!isEditing && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => startEditPermissions(admin)}
                          >
                            <Settings className="h-4 w-4 mr-1" />
                            Permissions
                          </Button>

                          {/* Boutons rôles prédéfinis */}
                          {Object.keys(permissions.roles).map(role => (
                            <Button
                              key={role}
                              variant={currentRole === role ? "default" : "outline"}
                              size="sm"
                              onClick={() => handleSetRole(admin, role)}
                              disabled={actionLoading[`role-${admin.id}`] || currentRole === role}
                            >
                              {actionLoading[`role-${admin.id}`] ? '...' : ROLE_LABELS[role]}
                            </Button>
                          ))}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {admins.length === 0 && !loading && (
              <div className="text-center py-12">
                <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">Aucun administrateur</h3>
                <p className="text-muted-foreground">
                  Aucun compte administrateur trouvé
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
