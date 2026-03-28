import { Router } from 'express';
import { z } from 'zod';
import { clientPrisma as prisma, Prisma } from '@blobinfini/database';
import type { AuditLog, Role, Sport, AvailabilityStatus } from '@blobinfini/database';
import { requireAuth, requireAdmin, requireVerifiedEmail } from '../auth/auth.guard';
import { gdprPurgeService } from '../../services/gdpr-purge.service';
import { systemAlertService } from '../../services/system-alert.service';
import { audit } from '../../middleware/audit';
import { ROLE_PERMISSIONS, AVAILABLE_PERMISSIONS, type Permission } from './permissions';
import { requirePermissions } from './admin.guard';
import { enforceAdminAllowedIp, requireAdminStepUp } from './admin.security-guard';
import { createRateLimiter, createLazyRateLimiter, createLazyCustomRateLimiter } from '../../middleware/enhanced-rate-limit';
import { secureLogger } from '../../utils/secure-logger';
import { invalidateSessionCache } from '../../lib/auth-session-store';
import { disconnectUserSockets } from '../../lib/socket';
import { analyticsReportService } from '../../services/analytics/reports.service';
import { type AnalyticsPeriod } from '../../services/analytics/definitions';
import { capAdminLimit } from '../../utils/admin-list-cap';

type ConversationMemberWithUser = Prisma.ConversationMemberGetPayload<{
  include: {
    user: {
      select: {
        id: true;
        email: true;
        role: true;
      };
    };
  };
}>;

type LoginAttemptWithUser = Prisma.LoginAttemptGetPayload<{
  include: {
    user: {
      select: {
        id: true;
        role: true;
      };
    };
  };
}>;

type RoleCountGroup = { role: Role; _count: { role: number } };

const resolveAnalyticsPeriod = (value: unknown): AnalyticsPeriod => {
  if (typeof value === 'string' && ['7d', '30d', '90d', '1y'].includes(value)) {
    return value as AnalyticsPeriod;
  }
  return '30d';
};
type CountGroup = { _count: { _all: number } };
type AuditActionGroup = { action: string; _count: { action: number } };
type ReportReasonGroup = { reason: string | null; _count: { _all: number } };
type AvailabilityStatusGroup = { sport: Sport | null; status: AvailabilityStatus; _count: { _all: number } };

async function ensureAdminConversation(adminId: string, targetUserId: string) {
  const existing = await prisma.conversation.findFirst({
    where: {
      type: 'ADMIN_TO_USER',
      members: {
        some: { userId: adminId }
      },
      AND: {
        members: {
          some: { userId: targetUserId }
        }
      }
    },
    select: { id: true }
  });

  if (existing) {
    return existing.id;
  }

  const conversation = await prisma.conversation.create({
    data: {
      type: 'ADMIN_TO_USER',
      members: {
        create: [
          { userId: adminId },
          { userId: targetUserId }
        ]
      }
    },
    select: { id: true }
  });

  return conversation.id;
}

export const adminRouter = Router();

// Rate limiting lazy pour les actions admin destructives / de gestion.
// createLazyRateLimiter est safe au module-level (résout Redis après bootstrap).
// Profil ADMIN : 50 req / 5 min. Seuil raisonné : une admin seule ne fera jamais
// 50 modifications de permissions en 5 min. Protège contre scripting et boucles accidentelles.
const adminWriteLimiter = createLazyRateLimiter('ADMIN');

// Purge RGPD : 3 tentatives / heure / admin.
// Justification : une purge manuelle est une action planifiée, rare, irréversible.
// Même lors d'un incident RGPD actif, 3 exécutions en 1h est largement suffisant.
// Defense-in-depth : step-up + confirmation string restent les verrous fonctionnels.
// keyGenerator userId-based → le compteur est isolé par admin, pas par IP.
const adminGdprPurgeLimiter = createLazyCustomRateLimiter(
  {
    windowMs: 60 * 60 * 1000,
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req: any) =>
      process.env.NODE_ENV === 'test' &&
      String(process.env.ENABLE_RATE_LIMIT_IN_TESTS ?? '').toLowerCase() !== 'true',
    keyGenerator: (req: any) => {
      const userId = (req as any).user?.id;
      return userId ? `admin_gdpr_purge:${userId}` : 'admin_gdpr_purge:anonymous';
    },
    handler: (_req: any, res: any) => {
      secureLogger.warn('ADMIN_GDPR_PURGE_RATE_LIMIT_EXCEEDED', { endpoint: '/admin/gdpr/run-purge' });
      res.status(429).json({
        error: 'ADMIN_GDPR_PURGE_RATE_LIMIT_EXCEEDED',
        message: 'Limite de purges RGPD atteinte. Maximum 3 par heure.',
        retryAfter: 3600,
        timestamp: new Date().toISOString(),
      });
    },
  },
  'admin_gdpr_purge',
);

// Création d'alertes système : 10 / heure / admin.
// Justification : les alertes sont des signaux manuels d'exploitation.
// 10/heure couvre une maintenance intensive (incident actif). Au-delà : script ou boucle accidentelle.
const adminAlertCreateLimiter = createLazyCustomRateLimiter(
  {
    windowMs: 60 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req: any) =>
      process.env.NODE_ENV === 'test' &&
      String(process.env.ENABLE_RATE_LIMIT_IN_TESTS ?? '').toLowerCase() !== 'true',
    keyGenerator: (req: any) => {
      const userId = (req as any).user?.id;
      return userId ? `admin_alert_create:${userId}` : 'admin_alert_create:anonymous';
    },
    handler: (_req: any, res: any) => {
      secureLogger.warn('ADMIN_ALERT_CREATE_RATE_LIMIT_EXCEEDED', { endpoint: '/admin/alerts' });
      res.status(429).json({
        error: 'ADMIN_ALERT_CREATE_RATE_LIMIT_EXCEEDED',
        message: "Limite de création d'alertes atteinte. Maximum 10 par heure.",
        retryAfter: 3600,
        timestamp: new Date().toISOString(),
      });
    },
  },
  'admin_alert_create',
);

// Toutes les routes admin nécessitent une authentification, un email vérifié et le rôle admin
adminRouter.use(requireAuth, requireVerifiedEmail);
adminRouter.use(requireAdmin);
adminRouter.use(enforceAdminAllowedIp);

// Statistiques principales
adminRouter.get('/stats', requirePermissions('analytics.view'), audit('admin:stats:view', () => 'admin:stats'), async (req, res) => {
  try {
    // Compter les utilisateurs par rôle
    const totalUsers = await prisma.user.count();
    const usersByRole = await prisma.user.groupBy({
      by: ['role'],
      _count: { role: true }
    }) as RoleCountGroup[];

    // Conversations totales
    const totalConversations = await prisma.conversation.count();

    // Utilisateurs actifs (derniers 30 jours)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const activeUsers = await prisma.user.count({
      where: {
        sessions: {
          some: {
            createdAt: {
              gte: thirtyDaysAgo
            }
          }
        }
      }
    });

    // F07 — Signalements en attente uniquement (reviewedAt IS NULL)
    const reportedProfiles = await prisma.profileReport.count({ where: { reviewedAt: null } });

    // Formater les statistiques
    const stats = {
      totalUsers,
      totalRiders: usersByRole.find((group: RoleCountGroup) => group.role === 'RIDER')?._count?.role ?? 0,
      totalPros: usersByRole.find((group: RoleCountGroup) => group.role === 'PRO')?._count?.role ?? 0,
      totalAdmins: usersByRole.find((group: RoleCountGroup) => group.role === 'ADMIN')?._count?.role ?? 0,
      totalConversations,
      activeUsers,
      reportedProfiles
    };

    return res.json(stats);
  } catch (error) {
    secureLogger.error('Admin stats error', { error });
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Visibilité sur les créneaux complets / ouverts pour les admins
adminRouter.get(
  '/booking/availability-status',
  requirePermissions('analytics.view'),
  audit('admin:availability:status', () => 'admin:availability-status'),
  async (req, res) => {
    try {
      const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 25));
      const statusQuery = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : undefined;
      const statusFilter = statusQuery === 'OPEN' || statusQuery === 'CLOSED' ? statusQuery : undefined;

      const [openCount, closedCount, sportBreakdown, items] = await Promise.all([
        prisma.proAvailability.count({ where: { status: 'OPEN' } }),
        prisma.proAvailability.count({ where: { status: 'CLOSED' } }),
        prisma.proAvailability.groupBy({
          by: ['sport', 'status'],
          _count: { _all: true }
        }),
        prisma.proAvailability.findMany({
          where: statusFilter ? { status: statusFilter as 'OPEN' | 'CLOSED' } : undefined,
          orderBy: { startAt: 'desc' },
          take: limit,
          select: {
            id: true,
            startAt: true,
            endAt: true,
            sport: true,
            levels: true,
            capacity: true,
            bookedCount: true,
            status: true,
            spotName: true,
            pro: {
              select: {
                id: true,
                email: true,
                proProfile: {
                  select: {
                    businessName: true,
                  }
                }
              }
            }
          }
        })
      ]);

      return res.json({
          summary: {
            total: openCount + closedCount,
            open: openCount,
            closed: closedCount,
            bySport: (sportBreakdown as AvailabilityStatusGroup[]).map((entry: AvailabilityStatusGroup) => ({
              sport: entry.sport,
              status: entry.status,
              count: entry._count?._all ?? 0
            }))
        },
        items
      });
    } catch (error) {
      secureLogger.error('Admin availability status error', { error });
      return res.status(500).json({ error: 'Internal error' });
    }
  }
);

// Lister tous les utilisateurs avec pagination
adminRouter.get(
  '/users',
  requirePermissions('users.view'),
  audit('admin:users:list', (req) => `admin:users:page:${req.query.page ?? 1}`),
  async (req, res) => {
  try {
    const page = parseInt(req.query.page as string || '1');
    const limit = capAdminLimit(req.query.limit); // Gate D: hard cap = 100
    const role = req.query.role as string;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (role && ['RIDER', 'PRO', 'ADMIN'].includes(role)) {
      where.role = role;
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        select: {
          id: true,
          email: true,
          role: true,
          emailVerified: true,
          createdAt: true,
          deletedAt: true,
          riderProfile: {
            select: {
              displayName: true
            }
          },
          proProfile: {
            select: {
              businessName: true,
              verified: true
            }
          },
          adminProfile: {
            select: {
              displayName: true
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      }),
      prisma.user.count({ where })
    ]);

    return res.json({
      users,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    secureLogger.error('Admin users list error', { error });
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Suspendre/réactiver un utilisateur
adminRouter.patch(
  '/users/:id/suspend',
  requirePermissions('users.suspend'),
  requireAdminStepUp,
  audit('admin:user:suspend', (req) => `user:${req.params.id}`),
  async (req, res) => {
  try {
    const userId = req.params.id;
    const { suspended } = z.object({
      suspended: z.boolean()
    }).parse(req.body);

    // Empêcher la suspension des admins
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.role === 'ADMIN') {
      return res.status(403).json({ error: 'Cannot suspend admin users' });
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        deletedAt: suspended ? new Date() : null
      },
      select: {
        id: true,
        email: true,
        deletedAt: true
      }
    });

    // Invalidate Redis session cache so requireAuth reads the updated deletedAt from DB
    // on the very next request — no waiting for the 20-min TTL to expire.
    await invalidateSessionCache(userId);

    // P0 GAP3 FIX: Disconnect active WebSocket sessions immediately on suspension
    if (suspended) {
      disconnectUserSockets(userId);
    }

    return res.json(updatedUser);
  } catch (error) {
    // Don't log validation errors (400) - they are expected client errors
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input' });
    }
    // Only log actual server errors (500)
    secureLogger.error('Admin suspend user error', { error });
    return res.status(500).json({ error: 'Internal error' });
  }
});

adminRouter.get(
  '/users/:id',
  requirePermissions('users.view'),
  audit('admin:users:get', (req) => `user:${req.params.id}`),
  async (req, res) => {
  try {
    const userId = req.params.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        deletedAt: true,
        emailVerified: true,
        consentedAt: true,
        consentVersion: true,
        riderProfile: {
          select: {
            id: true,
            displayName: true,
            bio: true,
            sex: true,
            maxDistanceKm: true,
            emailNotif: true,
            photoUrl: true,
            // F03: lat/lng selected internally to compute hasLocation, not exposed in response
            lat: true,
            lng: true,
            wantsLesson: true,
            lessonSport: true,
            createdAt: true,
            updatedAt: true,
            disciplines: {
              select: {
                sport: true,
                level: true,
                createdAt: true
              }
            }
          }
        },
        proProfile: {
          select: {
            id: true,
            businessName: true,
            bio: true,
            pricePerHour: true,
            verified: true,
            // F03: lat/lng selected internally to compute hasLocation, not exposed in response
            lat: true,
            lng: true,
            createdAt: true,
            updatedAt: true,
            offers: {
              select: {
                id: true,
                sport: true,
                level: true,
                title: true,
                hourlyRate: true,
                isActive: true,
                createdAt: true,
                updatedAt: true
              }
            }
          }
        },
        adminProfile: {
          select: {
            displayName: true,
            permissions: true,
            lastLoginAt: true
          }
        },
        lastSearch: {
          select: {
            sport: true,
            level: true,
            distanceKm: true,
            // F03: lat/lng supprimés — coordonnées précises inutiles pour l'admin
            updatedAt: true
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // F03 — Strip lat/lng from profiles, expose only hasLocation boolean (RGPD minimisation)
    const { riderProfile: rawRider, proProfile: rawPro, ...userBase } = user;
    const riderProfile = rawRider
      ? (() => {
          const { lat, lng, ...rest } = rawRider;
          return { ...rest, hasLocation: lat != null && lng != null };
        })()
      : null;
    const proProfile = rawPro
      ? (() => {
          const { lat, lng, ...rest } = rawPro;
          return { ...rest, hasLocation: lat != null && lng != null };
        })()
      : null;

    const [riderReports, reportsSubmitted, sessionsCount] = await Promise.all([
      rawRider
        ? prisma.profileReport.count({ where: { reportedProfileId: rawRider.id } })
        : Promise.resolve(0),
      prisma.profileReport.count({ where: { reporterUserId: user.id } }),
      prisma.session.count({ where: { userId } }),
    ]);

    return res.json({
      user: { ...userBase, riderProfile, proProfile },
      metrics: { reportsReceived: riderReports, reportsSubmitted, sessionsCount }
    });
  } catch (error) {
    secureLogger.error('Admin user detail error', { error });
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Vérifier un professionnel
adminRouter.patch(
  '/pros/:id/verify',
  requirePermissions('pros.verify'),
  requireAdminStepUp,
  audit('admin:pro:verify', (req) => `pro:${req.params.id}`),
  async (req, res) => {
  try {
    const userId = req.params.id;
    const { verified } = z.object({
      verified: z.boolean()
    }).parse(req.body);

    const existingProfile = await prisma.proProfile.findUnique({
      where: { userId },
      select: { id: true, lat: true, lng: true, verifiedAt: true },
    });

    if (!existingProfile) {
      return res.status(404).json({ error: 'Pro profile not found' });
    }

    if (verified && (existingProfile.lat == null || existingProfile.lng == null)) {
      return res.status(400).json({
        error: 'Missing pro location',
        message: 'La géolocalisation est requise pour rendre un profil pro visible.',
      });
    }

    const verifiedAt = verified ? (existingProfile.verifiedAt ?? new Date()) : null;
    const proProfile = await prisma.proProfile.update({
      where: { userId },
      data: { verified, verifiedAt },
      select: {
        id: true,
        businessName: true,
        verified: true,
        verifiedAt: true
      }
    });

    return res.json(proProfile);
  } catch (error) {
    // Don't log validation errors (400) - they are expected client errors
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input' });
    }
    // Only log actual server errors (500)
    secureLogger.error('Admin verify pro error', { error });
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Lister les signalements
// F07 — status param: 'pending' (default) = non traités, 'reviewed' = traités, 'all' = tous
adminRouter.get(
  '/reports',
  requirePermissions('reports.view'),
  audit('admin:reports:list', () => 'admin:reports'),
  async (req, res) => {
  try {
    const page = parseInt(req.query.page as string || '1');
    const limit = capAdminLimit(req.query.limit); // Gate D: hard cap = 100
    const skip = (page - 1) * limit;

    const statusParam = typeof req.query.status === 'string' ? req.query.status : 'pending';
    const reviewedAtFilter: Prisma.ProfileReportWhereInput =
      statusParam === 'reviewed'
        ? { reviewedAt: { not: null } }
        : statusParam === 'all'
          ? {}
          : { reviewedAt: null }; // default: pending only

    const [reports, total, pendingCount, reviewedCount] = await Promise.all([
      prisma.profileReport.findMany({
        skip,
        take: limit,
        where: reviewedAtFilter,
        include: {
          reporter: {
            select: {
              email: true,
              role: true
            }
          },
          reportedProfile: {
            select: {
              id: true,
              displayName: true,
              user: {
                select: {
                  id: true,
                  email: true,
                  role: true
                }
              }
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      }),
      prisma.profileReport.count({ where: reviewedAtFilter }),
      prisma.profileReport.count({ where: { reviewedAt: null } }),
      prisma.profileReport.count({ where: { reviewedAt: { not: null } } }),
    ]);

    return res.json({
      reports,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      },
      // F07 — compteurs fiables par statut
      summary: { pending: pendingCount, reviewed: reviewedCount }
    });
  } catch (error) {
    secureLogger.error('Admin reports list error', { error });
    return res.status(500).json({ error: 'Internal error' });
  }
});

const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  action: z.string().trim().min(1).optional(),
  userId: z.string().trim().min(1).optional(),
  resource: z.string().trim().min(1).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});

// Lister les permissions disponibles
adminRouter.get(
  '/permissions',
  requirePermissions('permissions.manage'),
  audit('admin:permissions:list', () => 'admin:permissions'),
  async (req, res) => {
  try {
    return res.json({
      available: AVAILABLE_PERMISSIONS,
      roles: ROLE_PERMISSIONS
    });
  } catch (error) {
    secureLogger.error('Admin permissions list error', { error });
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Lister les administrateurs avec leurs permissions
adminRouter.get(
  '/admins',
  requirePermissions('permissions.manage'),
  audit('admin:admins:list', () => 'admin:admins'),
  async (req, res) => {
  try {
    const admins = await prisma.user.findMany({
      where: {
        role: 'ADMIN',
        deletedAt: null
      },
      select: {
        id: true,
        email: true,
        emailVerified: true,
        createdAt: true,
        adminProfile: {
          select: {
            displayName: true,
            permissions: true,
            lastLoginAt: true,
            allowedIPs: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    return res.json({ admins });
  } catch (error) {
    secureLogger.error('Admin list error', { error });
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Mettre à jour les permissions d'un admin
adminRouter.patch(
  '/admins/:id/permissions',
  adminWriteLimiter,
  requirePermissions('permissions.manage'),
  requireAdminStepUp,
  audit('admin:permissions:update', (req) => `admin:${req.params.id}`),
  async (req, res) => {
  try {
    const adminId = req.params.id;
    const { permissions } = z.object({
      permissions: z.array(z.string())
    }).parse(req.body);

    // Vérifier que l'admin cible existe et n'est pas le même que l'utilisateur actuel
    const targetAdmin = await prisma.user.findUnique({
      where: { id: adminId, role: 'ADMIN' },
      select: { id: true }
    });

    if (!targetAdmin) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    const currentUser = (req as any).user as { id: string; role: string };
    if (targetAdmin.id === currentUser.id) {
      return res.status(403).json({ error: 'Cannot modify your own permissions' });
    }

    // Vérifier que toutes les permissions sont valides
    const invalidPermissions = permissions.filter(p => !AVAILABLE_PERMISSIONS.includes(p as Permission));
    if (invalidPermissions.length > 0) {
      return res.status(400).json({ error: `Invalid permissions: ${invalidPermissions.join(', ')}` });
    }

    // F01 — Guard escalade : l'acteur ne peut accorder que des permissions qu'il possède lui-même.
    // req.adminProfile est peuplé par requirePermissions() avant ce handler.
    const actorProfile = (req as any).adminProfile as { permissions: string[] } | undefined;
    const actorPerms = new Set(actorProfile?.permissions ?? []);
    const forbidden = permissions.filter((p: string) => !actorPerms.has(p));
    if (forbidden.length > 0) {
      secureLogger.warn('ADMIN_PRIVILEGE_ESCALATION_ATTEMPT', {
        actorId: currentUser.id,
        targetAdminId: adminId,
        forbidden,
      });
      return res.status(403).json({
        error: 'Vous ne pouvez pas accorder des droits que vous ne possédez pas.',
        forbidden,
      });
    }

    // F02 — Lire l'état avant update pour le diff d'audit.
    const beforeProfile = await prisma.adminProfile.findUnique({
      where: { userId: adminId },
      select: { permissions: true },
    });
    const before = (beforeProfile?.permissions ?? []) as string[];

    // Mettre à jour ou créer le profil admin
    const adminProfile = await prisma.adminProfile.upsert({
      where: { userId: adminId },
      create: {
        userId: adminId,
        permissions: permissions
      },
      update: {
        permissions: permissions
      },
      select: {
        id: true,
        permissions: true,
        user: {
          select: {
            email: true
          }
        }
      }
    });

    // F02 — Enrichir l'audit trail avec le diff before/after.
    // res.locals.auditMetadata est lu par le middleware audit() sur res.on('finish').
    const after = adminProfile.permissions as string[];
    res.locals.auditMetadata = {
      before,
      after,
      added: after.filter((p: string) => !before.includes(p)),
      removed: before.filter((p: string) => !after.includes(p)),
    };

    return res.json(adminProfile);
  } catch (error) {
    // Don't log validation errors (400) - they are expected client errors
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input' });
    }
    // Only log actual server errors (500)
    secureLogger.error('Admin permissions update error', { error });
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Appliquer un rôle prédéfini à un admin
adminRouter.patch(
  '/admins/:id/role',
  adminWriteLimiter,
  requirePermissions('permissions.manage'),
  requireAdminStepUp,
  audit('admin:role:apply', (req) => `admin:${req.params.id}`),
  async (req, res) => {
  try {
    const adminId = req.params.id;
    const { role } = z.object({
      role: z.enum(['SUPER_ADMIN', 'MODERATOR', 'ANALYTICS'])
    }).parse(req.body);

    // Vérifier que l'admin cible existe et n'est pas le même que l'utilisateur actuel
    const targetAdmin = await prisma.user.findUnique({
      where: { id: adminId, role: 'ADMIN' },
      select: { id: true }
    });

    if (!targetAdmin) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    const currentUser = (req as any).user as { id: string; role: string };
    if (targetAdmin.id === currentUser.id) {
      return res.status(403).json({ error: 'Cannot modify your own role' });
    }

    const permissions = ROLE_PERMISSIONS[role] || [];

    // F01 — Guard escalade : l'acteur ne peut appliquer un rôle qui contient des permissions qu'il ne possède pas.
    const actorProfile = (req as any).adminProfile as { permissions: string[] } | undefined;
    const actorPerms = new Set(actorProfile?.permissions ?? []);
    const forbidden = (permissions as string[]).filter((p: string) => !actorPerms.has(p));
    if (forbidden.length > 0) {
      secureLogger.warn('ADMIN_ROLE_ESCALATION_ATTEMPT', {
        actorId: currentUser.id,
        targetAdminId: adminId,
        requestedRole: role,
        forbidden,
      });
      return res.status(403).json({
        error: `Le rôle ${role} contient des droits que vous ne possédez pas.`,
        forbidden,
      });
    }

    // F02 — Lire l'état avant update pour le diff d'audit.
    const beforeProfile = await prisma.adminProfile.findUnique({
      where: { userId: adminId },
      select: { permissions: true },
    });
    const before = (beforeProfile?.permissions ?? []) as string[];

    // Mettre à jour les permissions
    const adminProfile = await prisma.adminProfile.upsert({
      where: { userId: adminId },
      create: {
        userId: adminId,
        permissions: permissions as string[]
      },
      update: {
        permissions: permissions as string[]
      },
      select: {
        id: true,
        permissions: true,
        user: {
          select: {
            email: true
          }
        }
      }
    });

    // F02 — Enrichir l'audit trail avec le diff before/after.
    const after = adminProfile.permissions as string[];
    res.locals.auditMetadata = {
      before,
      after,
      added: after.filter((p: string) => !before.includes(p)),
      removed: before.filter((p: string) => !after.includes(p)),
      appliedRole: role,
    };

    return res.json(adminProfile);
  } catch (error) {
    // Don't log validation errors (400) - they are expected client errors
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input' });
    }
    // Only log actual server errors (500)
    secureLogger.error('Admin role update error', { error });
    return res.status(500).json({ error: 'Internal error' });
  }
});

// ✅ NOUVEAU : Gérer les IPs autorisées pour un admin
adminRouter.patch(
  '/admins/:id/allowed-ips',
  adminWriteLimiter,
  requirePermissions('permissions.manage'),
  requireAdminStepUp,
  audit('admin:allowed-ips:update', (req) => `admin:${req.params.id}`),
  async (req, res) => {
  try {
    const adminId = req.params.id;
    const { allowedIPs } = z.object({
      allowedIPs: z.array(z.string().ip())
    }).parse(req.body);

    // Vérifier que l'admin cible existe
    const targetAdmin = await prisma.user.findUnique({
      where: { id: adminId, role: 'ADMIN' },
      select: { id: true }
    });

    if (!targetAdmin) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    // Ne pas permettre de modifier ses propres IPs (risque de se bloquer)
    const currentUser = (req as any).user as { id: string };
    if (targetAdmin.id === currentUser.id) {
      return res.status(403).json({
        error: 'Cannot modify your own IP whitelist',
        message: 'Pour des raisons de sécurité, vous ne pouvez pas modifier votre propre liste d\'IPs autorisées'
      });
    }

    // Mettre à jour les IPs autorisées
    const adminProfile = await prisma.adminProfile.upsert({
      where: { userId: adminId },
      create: {
        userId: adminId,
        allowedIPs: allowedIPs
      },
      update: {
        allowedIPs: allowedIPs
      },
      select: {
        id: true,
        allowedIPs: true,
        user: {
          select: {
            email: true
          }
        }
      }
    });

    return res.json(adminProfile);
  } catch (error) {
    // Don't log validation errors (400) - they are expected client errors
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    // Only log actual server errors (500)
    secureLogger.error('Admin allowed IPs update error', { error });
    return res.status(500).json({ error: 'Internal error' });
  }
});

adminRouter.get(
  '/analytics/matching/ttfm',
  requirePermissions('analytics.view'),
  audit('admin:analytics:ttfm', () => 'admin:analytics:ttfm'),
  async (req, res) => {
  try {
    const period = resolveAnalyticsPeriod(req.query.period);
    const report = await analyticsReportService.getTtfv(period);
    return res.json(report);

  } catch (error) {
    secureLogger.error('Analytics TTFV error', { error });
    return res.status(500).json({ error: 'Internal error' });
  }
});


// Analytics détaillées - Engagement
adminRouter.get(
  '/analytics/engagement',
  requirePermissions('analytics.view'),
  audit('admin:analytics:engagement', () => 'admin:analytics:engagement'),
  async (req, res) => {
  try {
    const period = resolveAnalyticsPeriod(req.query.period);
    const report = await analyticsReportService.getTraction(period);
    return res.json(report);

  } catch (error) {
    secureLogger.error('Analytics engagement error', { error });
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Analytics détaillées - Matching
adminRouter.get(
  '/analytics/matching',
  requirePermissions('analytics.view'),
  audit('admin:analytics:matching', () => 'admin:analytics:matching'),
  async (req, res) => {
  try {
    const period = resolveAnalyticsPeriod(req.query.period);
    const report = await analyticsReportService.getMarketplaceHealth(period);
    return res.json(report);

  } catch (error) {
    secureLogger.error('Analytics matching error', { error });
    return res.status(500).json({ error: 'Internal error' });
  }
});

const reportActionSchema = z.object({
  action: z.enum(['approve', 'dismiss', 'ban'])
});

const createSystemAlertSchema = z.object({
  type: z.string().min(3),
  message: z.string().min(5),
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL']).default('INFO'),
  link: z.string().url().optional(),
  dedupeKey: z.string().optional()
});

const conversationBroadcastSchema = z.object({
  message: z.string().min(5).max(2000),
  target: z.enum(['ALL', 'RIDERS', 'PROS', 'CUSTOM']).default('ALL'),
  emails: z.array(z.string().email()).optional()
});

adminRouter.post(
  '/conversations/broadcast',
  requirePermissions('reports.moderate'),
  requireAdminStepUp,
  audit('admin:conversations:broadcast', () => 'admin:conversations:broadcast'),
  async (req, res) => {
    try {
      const adminId = (req as any).user?.id as string | undefined;
      if (!adminId) return res.status(401).json({ error: 'Unauthorized' });

      const { message, target, emails } = conversationBroadcastSchema.parse(req.body ?? {});
      let recipients: Array<{ id: string; email: string }> = [];
      const baseWhere: Prisma.UserWhereInput = {
        deletedAt: null
      };

      if (target === 'RIDERS') {
        baseWhere.role = 'RIDER';
      } else if (target === 'PROS') {
        baseWhere.role = 'PRO';
      } else if (target === 'ALL') {
        baseWhere.role = { in: ['RIDER', 'PRO'] };
      }

      if (target === 'CUSTOM') {
        const normalizedEmails = (emails ?? [])
          .map((email) => email.trim().toLowerCase())
          .filter(Boolean);
        if (normalizedEmails.length === 0) {
          return res.status(400).json({ error: 'Emails required for CUSTOM target' });
        }
        recipients = await prisma.user.findMany({
          where: {
            ...baseWhere,
            email: { in: normalizedEmails }
          },
          select: { id: true, email: true }
        });
      } else {
        recipients = await prisma.user.findMany({
          where: baseWhere,
          select: { id: true, email: true }
        });
      }

      if (recipients.length === 0) {
        return res.status(404).json({ error: 'No recipients found' });
      }

      const missingEmails: string[] = [];
      if (target === 'CUSTOM' && emails) {
        const foundEmails = new Set(recipients.map((user) => user.email.toLowerCase()));
        emails.forEach((email) => {
          if (!foundEmails.has(email.toLowerCase())) {
            missingEmails.push(email);
          }
        });
      }

      let sentCount = 0;
      for (const recipient of recipients) {
        const conversationId = await ensureAdminConversation(adminId, recipient.id);
        await prisma.message.create({
          data: {
            conversationId,
            senderId: adminId,
            type: 'TEXT',
            content: message
          }
        });
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { updatedAt: new Date() }
        });
        sentCount++;
      }

      res.locals.auditMetadata = {
        target,
        sentCount,
        missingEmails
      };

      if (missingEmails.length > 0) {
        await systemAlertService.ensureAlert({
          type: 'messaging:broadcast-missing',
          message: `Emails introuvables lors d'une diffusion admin (${missingEmails.length})`,
          severity: 'WARNING',
          metadata: { missingEmails }
        });
      }

      return res.json({
        success: true,
        target,
        sentCount,
        missingEmails
      });
    } catch (error) {
      // Don't log validation errors (400) - they are expected client errors
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
      // Only log actual server errors (500)
      secureLogger.error('Admin conversation broadcast error', { error });
      return res.status(500).json({ error: 'Internal error' });
    }
  }
);

adminRouter.post(
  '/reports/:id/action',
  requirePermissions('reports.moderate'),
  requireAdminStepUp,
  audit('admin:report:action', (req) => `report:${req.params.id}`),
  async (req, res) => {
  try {
    const reportId = req.params.id;
    const { action } = reportActionSchema.parse(req.body);

    const report = await prisma.profileReport.findUnique({
      where: { id: reportId },
      include: {
        reportedProfile: {
          select: {
            id: true,
            user: {
              select: {
                id: true,
                role: true,
                email: true,
                deletedAt: true
              }
            }
          }
        }
      }
    });

    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    const targetUser = report.reportedProfile?.user;

    if ((action === 'ban' || action === 'approve') && !targetUser) {
      return res.status(400).json({ error: 'Reported user not found' });
    }

    if (targetUser?.role === 'ADMIN' && action === 'ban') {
      return res.status(403).json({ error: 'Cannot ban administrators' });
    }

    res.locals.auditMetadata = {
      moderationAction: action,
      reportId,
      targetUserId: targetUser?.id ?? null,
      reportCreatedAt: report.createdAt.toISOString()
    };

    const reviewingAdminId = (req as any).user?.id as string | undefined;

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (action === 'ban' && targetUser) {
        await tx.user.update({
          where: { id: targetUser.id },
          data: { deletedAt: new Date() }
        });

        await tx.session.deleteMany({ where: { userId: targetUser.id } });
        await tx.refreshToken.deleteMany({ where: { userId: targetUser.id } });
      }

      // F07 — Mark as reviewed instead of deleting: preserves audit trail, fixes pending counter
      await tx.profileReport.update({
        where: { id: reportId },
        data: {
          reviewedAt: new Date(),
          reviewedByAdminId: reviewingAdminId ?? null,
          reviewedAction: action,
        }
      });
    });

    // P0 GAP4 FIX: Invalidate session cache and disconnect WS for banned users
    if (action === 'ban' && targetUser) {
      await invalidateSessionCache(targetUser.id);
      disconnectUserSockets(targetUser.id);
    }

    return res.json({
      success: true,
      action,
      reportId,
      bannedUserId: action === 'ban' ? targetUser?.id : undefined
    });
  } catch (error) {
    // Don't log validation errors (400) - they are expected client errors
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input' });
    }
    // Only log actual server errors (500)
    secureLogger.error('Admin report action error', { error });
    return res.status(500).json({ error: 'Internal error' });
  }
});

adminRouter.get(
  '/alerts',
  requirePermissions('system.monitor'), // F05: read-only, safe for monitor role
  audit('admin:alerts:list', () => 'admin:alerts:list'),
  async (req, res) => {
    try {
      const status = req.query.status as 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | undefined;
      const severity = req.query.severity as 'INFO' | 'WARNING' | 'CRITICAL' | undefined;
      const page = parseInt(req.query.page as string || '1');
      const limit = capAdminLimit(req.query.limit); // Gate D: hard cap = 100

      const result = await systemAlertService.list({ status, severity, page, limit });
      return res.json(result);
    } catch (error) {
      secureLogger.error('Admin alerts list error', { error });
      return res.status(500).json({ error: 'Internal error' });
    }
  }
);

adminRouter.post(
  '/alerts',
  adminAlertCreateLimiter,
  requirePermissions('system.configure'),
  audit('admin:alerts:create', () => 'admin:alerts:create'),
  async (req, res) => {
    try {
      const adminId = (req as any).user?.id as string | undefined;
      const payload = createSystemAlertSchema.parse(req.body ?? {});
      const alert = await systemAlertService.createAlert({
        ...payload,
        createdById: adminId ?? null,
        dedupeKey: payload.dedupeKey ?? undefined
      });

      return res.status(201).json(alert);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
      secureLogger.error('Admin alert create error', { error });
      return res.status(500).json({ error: 'Internal error' });
    }
  }
);

adminRouter.post(
  '/alerts/:id/ack',
  requirePermissions('system.configure'),
  audit('admin:alerts:ack', (req) => `admin:alert:${req.params.id}`),
  async (req, res) => {
    try {
      const alert = await systemAlertService.acknowledge(req.params.id);
      return res.json(alert);
    } catch (error) {
      secureLogger.error('Admin alert ack error', { error });
      return res.status(500).json({ error: 'Internal error' });
    }
  }
);

adminRouter.post(
  '/alerts/:id/resolve',
  requirePermissions('system.configure'),
  audit('admin:alerts:resolve', (req) => `admin:alert:${req.params.id}`),
  async (req, res) => {
    try {
      const alert = await systemAlertService.resolve(req.params.id);
      return res.json(alert);
    } catch (error) {
      secureLogger.error('Admin alert resolve error', { error });
      return res.status(500).json({ error: 'Internal error' });
    }
  }
);

adminRouter.get(
  '/conversations/blocked',
  requirePermissions('reports.view'),
  audit('admin:conversations:blocked', () => 'admin:conversations:blocked'),
  async (req, res) => {
    try {
      const limit = Math.min(parseInt((req.query.limit as string) || '50', 10), 100);
      type BlockedMember = Prisma.ConversationMemberGetPayload<{
        include: {
          user: { select: { id: true; email: true; role: true } };
          conversation: {
            select: {
              id: true;
              type: true;
              createdAt: true;
              members: {
                select: {
                  user: { select: { id: true; email: true; role: true } };
                  blockedAt: true;
                };
              };
            };
          };
        };
      }>;

      const blockedMembers: BlockedMember[] = await prisma.conversationMember.findMany({
        where: { blockedAt: { not: null } },
        orderBy: { blockedAt: 'desc' },
        take: limit,
        include: {
          user: {
            select: { id: true, email: true, role: true }
          },
          conversation: {
            select: {
              id: true,
              type: true,
              createdAt: true,
              members: {
                select: {
                  user: {
                    select: { id: true, email: true, role: true }
                  },
                  blockedAt: true
                }
              }
            }
          }
        }
      });

      type ConvMember = NonNullable<BlockedMember['conversation']>['members'][number];

      const items = blockedMembers.map((member: BlockedMember) => ({
        conversationId: member.conversationId,
        blockedAt: member.blockedAt,
        user: member.user,
        conversation: {
          id: member.conversation?.id,
          type: member.conversation?.type,
          createdAt: member.conversation?.createdAt,
          members: member.conversation?.members.map((cm: ConvMember) => ({
            user: cm.user,
            blockedAt: cm.blockedAt
          }))
        }
      }));

      return res.json({
        blocked: items,
        pagination: {
          limit,
          count: items.length
        }
      });
    } catch (error) {
      secureLogger.error('Admin blocked conversations list error', { error });
      return res.status(500).json({ error: 'Internal error' });
    }
  }
);

const adminConversationBlockSchema = z.object({
  userId: z.string().uuid().optional(),
  action: z.enum(['block', 'unblock']).default('block')
});

adminRouter.post(
  '/conversations/:conversationId/block',
  requirePermissions('reports.moderate'),
  audit('admin:conversations:block', (req) => `admin:conversation:${req.params.conversationId}`),
  async (req, res) => {
    try {
      const { conversationId } = req.params;
      const { action, userId } = adminConversationBlockSchema.parse(req.body ?? {});

      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: {
          members: {
            include: {
              user: {
                select: {
                  id: true,
                  email: true,
                  role: true
                }
              }
            }
          }
        }
      });

      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      const targetMembers: ConversationMemberWithUser[] = userId
        ? conversation.members.filter((member: ConversationMemberWithUser) => member.userId === userId)
        : conversation.members;

      if (targetMembers.length === 0) {
        return res.status(404).json({ error: 'Member not found in conversation' });
      }

      await prisma.conversationMember.updateMany({
        where: {
          conversationId,
          userId: { in: targetMembers.map((member: ConversationMemberWithUser) => member.userId) }
        },
        data: {
          blockedAt: action === 'unblock' ? null : new Date()
        }
      });

      const refreshedMembers: ConversationMemberWithUser[] = await prisma.conversationMember.findMany({
        where: {
          conversationId,
          userId: { in: targetMembers.map((member: ConversationMemberWithUser) => member.userId) }
        },
        include: {
          user: { select: { id: true, email: true, role: true } }
        }
      });

      if (!res.locals.auditMetadata) {
        res.locals.auditMetadata = {};
      }
      res.locals.auditMetadata = {
        ...(res.locals.auditMetadata || {}),
        conversationId,
        action,
        targetUserIds: targetMembers.map((member: ConversationMemberWithUser) => member.userId)
      };

      return res.json({
        conversationId,
        action,
        updatedMembers: refreshedMembers.map((member: ConversationMemberWithUser) => ({
          userId: member.userId,
          email: member.user?.email ?? null,
          role: member.user?.role ?? null,
          blockedAt: member.blockedAt
        }))
      });
    } catch (error) {
      // Don't log validation errors (400) - they are expected client errors
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
      // Only log actual server errors (500)
      secureLogger.error('Admin conversation block error', { error });
      return res.status(500).json({ error: 'Internal error' });
    }
  }
);

adminRouter.post(
  '/conversations/unblock-all',
  requirePermissions('reports.moderate'),
  audit('admin:conversations:unblock-all', () => 'admin:conversations:bulk-unblock'),
  async (_req, res) => {
    try {
      const result = await prisma.conversationMember.updateMany({
        where: { blockedAt: { not: null } },
        data: { blockedAt: null }
      });

      res.locals.auditMetadata = {
        affectedCount: result.count
      };

      return res.json({
        success: true,
        count: result.count
      });
    } catch (error) {
      secureLogger.error('Admin unblock all conversations error', { error });
      return res.status(500).json({ error: 'Internal error' });
    }
  }
);

adminRouter.get(
  '/conversations/blocked/history',
  requirePermissions('reports.view'),
  audit('admin:conversations:block-history', () => 'admin:conversations:block-history'),
  async (req, res) => {
    try {
      const page = parseInt(req.query.page as string || '1');
      const limit = Math.min(parseInt(req.query.limit as string || '25', 10), 100);
      const skip = (page - 1) * limit;

      const where = { action: 'admin:conversations:block' } as const;

      const [items, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
          include: {
            user: {
              select: { id: true, email: true, role: true }
            }
          }
        }),
        prisma.auditLog.count({ where })
      ]);

      return res.json({
        items,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      secureLogger.error('Admin conversation block history error', { error });
      return res.status(500).json({ error: 'Internal error' });
    }
  }
);

const securityActionPrefixes = ['security:', 'admin:gdpr:', 'admin:allowed-ips', 'admin:user:', 'admin:report:'];
const securityActionsExact = ['admin:permissions:update', 'admin:role:apply'];

adminRouter.get(
  '/security/events',
  requirePermissions('system.configure'),
  audit('admin:security:events', () => 'admin:security:events'),
  async (req, res) => {
    try {
      const limit = Math.min(parseInt((req.query.limit as string) || '100', 10), 200);
      const events = await prisma.auditLog.findMany({
        where: {
          OR: [
            ...securityActionPrefixes.map(prefix => ({ action: { startsWith: prefix } })),
            { action: { in: securityActionsExact } }
          ]
        },
        include: {
          user: {
            select: { id: true, email: true, role: true }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: limit
      });

      return res.json({ events });
    } catch (error) {
      secureLogger.error('Admin security events error', { error });
      return res.status(500).json({ error: 'Internal error' });
    }
  }
);

adminRouter.get(
  '/security/logs/summary',
  requirePermissions('system.monitor'), // F05: aggregate summary, no per-user PII
  audit('admin:security:logs:summary', () => 'admin:security:logs:summary'),
  async (req, res) => {
    try {
      const days = Math.min(parseInt((req.query.days as string) || '7', 10), 90);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const grouped = await prisma.auditLog.groupBy({
        by: ['action'],
        where: {
          createdAt: { gte: since },
          OR: [
            ...securityActionPrefixes.map(prefix => ({ action: { startsWith: prefix } })),
            { action: { in: securityActionsExact } }
          ]
        },
        _count: { action: true },
        orderBy: {
          _count: {
            action: 'desc'
          }
        },
        take: 25
      }) as AuditActionGroup[];

      return res.json({
        since,
        items: grouped.map((item: AuditActionGroup) => ({
          action: item.action,
          count: item._count?.action ?? 0
        }))
      });
    } catch (error) {
      secureLogger.error('Admin security logs summary error', { error });
      return res.status(500).json({ error: 'Internal error' });
    }
  }
);

/**
 * Pseudonymise une adresse IP pour conformité RGPD Article 5.1.c
 * IPv4: Masque les 2 derniers octets (192.168.xxx.xxx)
 * IPv6: Masque les 64 derniers bits
 */
/**
 * @deprecated RGPD v2: This function is no longer used.
 * LoginAttempt.ipHash (HMAC-SHA256) is already anonymized and should be used instead of raw IPs.
 * Kept for reference only - DO NOT USE in new code.
 */
function pseudonymizeIP(ip: string | null): string {
  if (!ip) return 'N/A';

  // IPv4: masquer les 2 derniers octets
  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.xxx.xxx`;
    }
  }

  // IPv6: masquer les 64 derniers bits
  if (ip.includes(':')) {
    const parts = ip.split(':');
    if (parts.length >= 4) {
      return `${parts.slice(0, 4).join(':')}:xxxx:xxxx:xxxx:xxxx`;
    }
  }

  return 'xxx.xxx.xxx.xxx'; // Fallback
}

// Rate limiting pour endpoints admin sécurité (login-attempts)
const adminSecurityRateLimit = createRateLimiter('ADMIN');

// Schema de validation pour l'endpoint /security/login-attempts
const loginAttemptsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  onlyFailed: z.enum(['true', 'false']).optional().transform(val => val === 'true'),
  suspiciousOnly: z.enum(['true', 'false']).optional().transform(val => val === 'true')
});

adminRouter.get(
  '/security/login-attempts',
  adminSecurityRateLimit,
  requirePermissions('system.configure'),
  audit('admin:security:login-attempts', () => 'admin:security:login-attempts'),
  async (req, res) => {
    try {
      // Validation Zod des paramètres
      const parsed = loginAttemptsQuerySchema.safeParse(req.query);

      if (!parsed.success) {
        return res.status(400).json({
          error: 'Invalid query parameters',
          details: parsed.error.format()
        });
      }

      const { limit, onlyFailed, suspiciousOnly } = parsed.data;

      const where: any = {};
      if (onlyFailed) {
        where.success = false;
      }

      // Suspicious criteria: multiple failed attempts from same IP hash or email hash
      let attempts: LoginAttemptWithUser[];
      if (suspiciousOnly) {
        // Get IP hashes and email hashes with multiple failed attempts in the last 24 hours
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const failedAttempts = await prisma.loginAttempt.findMany({
          where: {
            success: false,
            createdAt: { gte: oneDayAgo }
          },
          orderBy: { createdAt: 'desc' }
        });

        // Group by ipHash and emailHash to find suspicious patterns (RGPD v2)
        const ipHashCounts = new Map<string, number>();
        const emailHashCounts = new Map<string, number>();

        for (const attempt of failedAttempts) {
          if (attempt.ipHash) {
            ipHashCounts.set(attempt.ipHash, (ipHashCounts.get(attempt.ipHash) || 0) + 1);
          }
          if (attempt.emailHash) {
            emailHashCounts.set(attempt.emailHash, (emailHashCounts.get(attempt.emailHash) || 0) + 1);
          }
        }

        // Filter suspicious ipHashes (3+ failed attempts) and emailHashes (5+ failed attempts)
        const suspiciousIpHashes = Array.from(ipHashCounts.entries())
          .filter(([, count]) => count >= 3)
          .map(([ipHash]) => ipHash);
        const suspiciousEmailHashes = Array.from(emailHashCounts.entries())
          .filter(([, count]) => count >= 5)
          .map(([emailHash]) => emailHash);

        if (suspiciousIpHashes.length > 0 || suspiciousEmailHashes.length > 0) {
          await systemAlertService.ensureAlert({
            type: 'security:suspicious-login',
            message: 'Tentatives de connexion suspectes détectées',
            severity: 'WARNING',
            metadata: { suspiciousIpHashes, suspiciousEmailHashes }
          });
        }

        attempts = await prisma.loginAttempt.findMany({
          where: {
            OR: [
              { ipHash: { in: suspiciousIpHashes } },
              { emailHash: { in: suspiciousEmailHashes } }
            ]
          },
          include: {
            user: {
              select: { id: true, role: true }
            }
          },
          orderBy: { createdAt: 'desc' },
          take: limit
        });
      } else {
        attempts = await prisma.loginAttempt.findMany({
          where,
          include: {
            user: {
              select: { id: true, role: true }
            }
          },
          orderBy: { createdAt: 'desc' },
          take: limit
        });
      }

      // Calculate stats
      const total = await prisma.loginAttempt.count({ where });
      const failed = await prisma.loginAttempt.count({ where: { success: false } });
      const successRate = total > 0 ? ((total - failed) / total) * 100 : 0;

      // RGPD v2: ipHash already anonymized (HMAC-SHA256), no need to pseudonymize
      // Remove raw IP field from response (privacy-by-design)
      const sanitizedAttempts = attempts.map((attempt: LoginAttemptWithUser) => ({
        ...attempt,
        email: null, // Never expose raw login-attempt email in API responses
        ip: undefined, // Exclude raw IP (should be null after migration anyway)
        ipHash: attempt.ipHash, // Already HMAC-SHA256 hashed
      }));

      return res.json({
        attempts: sanitizedAttempts,
        stats: {
          total,
          failed,
          successRate: successRate.toFixed(2)
        }
      });
    } catch (error) {
      secureLogger.error('Admin login attempts error', { error });
      return res.status(500).json({ error: 'Internal error' });
    }
  }
);

adminRouter.get(
  '/analytics/behavior',
  requirePermissions('analytics.view'),
  audit('admin:analytics:behavior', () => 'admin:analytics:behavior'),
  async (req, res) => {
  try {
    const period = resolveAnalyticsPeriod(req.query.period);
    const report = await analyticsReportService.getTrustAndContent(period);
    return res.json(report);

  } catch (error) {
    secureLogger.error('Analytics behavior error', { error });
    return res.status(500).json({ error: 'Internal error' });
  }
});

// ===== ENDPOINTS RGPD =====

// Rapport de conformité RGPD
adminRouter.get(
  '/gdpr/compliance-report',
  requirePermissions('system.monitor'), // F05: aggregate compliance metrics, no per-user PII
  audit('admin:gdpr:report', () => 'admin:gdpr:report'),
  async (req, res) => {
  try {
    const report = await gdprPurgeService.getGDPRComplianceReport();

    const complianceStatus = {
      isCompliant:
        report.expiredSessionsCount === 0 &&
        report.expiredTokensCount === 0 &&
        report.unanonymizedDeletedUsers < 10 && // Tolérance pour traitement quotidien
        report.oldDeletedUsersAwaitingPurge < 5,

      issues: [] as string[],
      recommendations: [] as string[]
    };

    if (report.expiredSessionsCount > 0) {
      complianceStatus.issues.push(`${report.expiredSessionsCount} sessions expirées à purger`);
      complianceStatus.recommendations.push('Exécuter la purge technique immédiatement');
    }

    if (report.unanonymizedDeletedUsers > 0) {
      complianceStatus.issues.push(`${report.unanonymizedDeletedUsers} utilisateurs supprimés non anonymisés`);
      complianceStatus.recommendations.push('Exécuter l\'anonymisation progressive');
    }

    if (report.oldDeletedUsersAwaitingPurge > 0) {
      complianceStatus.issues.push(`${report.oldDeletedUsersAwaitingPurge} utilisateurs supprimés > 10 ans à archiver`);
      complianceStatus.recommendations.push('Archiver les preuves légales et purger définitivement');
    }

    return res.json({
      timestamp: new Date().toISOString(),
      compliance: complianceStatus,
      details: report,
      legalProtection: {
        consentArchiveEnabled: true,
        retentionPeriod: '10 ans pour preuves légales',
        anonymizationDelay: '7 jours pour données détaillées, 2 ans pour email'
      }
    });
  } catch (error) {
    secureLogger.error('GDPR compliance report error', { error });
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Schéma de confirmation obligatoire pour la purge RGPD (F06).
// La chaîne exacte doit être fournie côté client — empêche déclenchement accidentel.
const runPurgeSchema = z.object({
  confirm: z.literal('CONFIRMER_PURGE_RGPD'),
});

// Exécution manuelle de la purge RGPD
adminRouter.post(
  '/gdpr/run-purge',
  adminGdprPurgeLimiter,
  requirePermissions('system.configure'),
  requireAdminStepUp,
  audit('admin:gdpr:run-purge', () => 'gdpr:purge'),
  async (req, res) => {
  // F06 — Confirmation explicite requise. Irréversible.
  const parsed = runPurgeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Confirmation requise.',
      hint: 'Envoyez { "confirm": "CONFIRMER_PURGE_RGPD" } dans le body.',
    });
  }

  try {
    const startedAt = Date.now();
    const result = await gdprPurgeService.performFullPurge();

    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      result,
      message: 'Purge RGPD exécutée avec succès'
    });
  } catch (error) {
    secureLogger.error('Manual GDPR purge error', { error });
    return res.status(500).json({
      success: false,
      error: 'Erreur lors de la purge RGPD',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Recherche dans l'archive légale (pour litiges)
adminRouter.get(
  '/gdpr/legal-archive/:userId',
  requirePermissions('system.configure'),
  audit('admin:gdpr:legal-archive', (req) => `gdpr:archive:${req.params.userId}`),
  async (req, res) => {
  try {
    const { userId } = req.params;

    // Rechercher dans l'archive légale
    const legalRecord = await prisma.legalConsentArchive.findFirst({
      where: { originalUserId: userId },
      orderBy: { archivedAt: 'desc' }
    });

    if (!legalRecord) {
      return res.status(404).json({
        error: 'Aucune archive légale trouvée pour cet utilisateur',
        userId
      });
    }

    return res.json({
      found: true,
      userId,
      legalEvidence: legalRecord,
      purpose: 'Archive légale pour protection en cas de litige',
      note: 'Ces données sont conservées conformément aux obligations légales de preuve'
    });
  } catch (error) {
    secureLogger.error('Legal archive search error', { error });
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Audit logs
adminRouter.get(
  '/audit',
  requirePermissions('system.configure'),
  audit('admin:audit:list', () => 'admin:audit'),
  async (req, res) => {
  try {
    const { page, limit, action, userId, resource, startDate, endDate } = auditQuerySchema.parse(req.query);

    const where: Prisma.AuditLogWhereInput = {};
    if (action) {
      where.action = { contains: action, mode: 'insensitive' };
    }
    if (userId) {
      where.userId = userId;
    }
    if (resource) {
      where.resource = { contains: resource, mode: 'insensitive' };
    }
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: { id: true, email: true, role: true }
          }
        }
      }),
      prisma.auditLog.count({ where })
    ]);

    return res.json({
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    secureLogger.error('Admin audit logs error', { error });
    return res.status(500).json({ error: 'Internal error' });
  }
});

// GDPR Exports Monitoring Dashboard
adminRouter.get(
  '/gdpr/exports',
  requirePermissions('system.monitor'), // F05: aggregate exports dashboard, no per-user PII
  audit('admin:gdpr:exports', () => 'admin:gdpr:exports'),
  async (req, res) => {
  try {
    const {
      page = '1',
      limit = '50',
      userId,
      startDate,
      endDate,
    } = req.query;

    const pageNum = parseInt(page as string, 10);
    const limitNum = capAdminLimit(limit); // Gate D: hard cap = 100
    const skip = (pageNum - 1) * limitNum;

    // Build filters
    const filters: any = {
      action: 'GDPR_EXPORT_REQUESTED',
    };

    if (userId && typeof userId === 'string') {
      filters.userId = userId;
    }

    if (startDate || endDate) {
      filters.createdAt = {};
      if (startDate && typeof startDate === 'string') {
        filters.createdAt.gte = new Date(startDate);
      }
      if (endDate && typeof endDate === 'string') {
        filters.createdAt.lte = new Date(endDate);
      }
    }

    // Get total count
    const total = await prisma.auditLog.count({ where: filters });

    // Get exports with user info
    const exports = await prisma.auditLog.findMany({
      where: filters,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limitNum,
    });

    // Parse metadata to extract export details
    const formattedExports = exports.map(
      (log: Prisma.AuditLogGetPayload<{ include: { user: { select: { id: true; email: true; role: true } } } }>) => {
        const metadata = log.metadata as any;
        return {
          id: log.id,
          userId: log.userId,
          userEmail: log.user?.email || 'Unknown',
          userRole: log.user?.role || 'Unknown',
          ip: log.ip || metadata?.ip || 'Unknown',
          exportDate: log.createdAt,
          dataSize: metadata?.dataSize || 0,
          dataSizeMB: metadata?.dataSizeMB || ((metadata?.dataSize || 0) / 1024 / 1024).toFixed(2),
          itemCounts: metadata?.itemCounts || {},
        };
      }
    );

    // Get summary statistics
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const last7days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const last30days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [exports24h, exports7d, exports30d] = await Promise.all([
      prisma.auditLog.count({
        where: {
          action: 'GDPR_EXPORT_REQUESTED',
          createdAt: { gte: last24h },
        },
      }),
      prisma.auditLog.count({
        where: {
          action: 'GDPR_EXPORT_REQUESTED',
          createdAt: { gte: last7days },
        },
      }),
      prisma.auditLog.count({
        where: {
          action: 'GDPR_EXPORT_REQUESTED',
          createdAt: { gte: last30days },
        },
      }),
    ]);

    // Get exports by role
    const exportsByRole = await prisma.auditLog.findMany({
      where: {
        action: 'GDPR_EXPORT_REQUESTED',
        createdAt: { gte: last30days },
      },
      include: {
        user: {
          select: { role: true },
        },
      },
    });

    const roleStats = exportsByRole.reduce(
      (
        acc: Record<string, number>,
        log: Prisma.AuditLogGetPayload<{ include: { user: { select: { role: true } } } }>
      ) => {
        const role = log.user?.role || 'Unknown';
        acc[role] = (acc[role] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    // Get top exporters (users with most exports)
    const topExporters = await prisma.auditLog.groupBy({
      by: ['userId'],
      where: {
        action: 'GDPR_EXPORT_REQUESTED',
        createdAt: { gte: last30days },
        userId: { not: null },
      },
      _count: { userId: true },
      orderBy: { _count: { userId: 'desc' } },
      take: 10,
    }) as Array<{ userId: string | null; _count: { userId: number } }>;

    const topExportersWithEmails = await Promise.all(
      topExporters.map(async (item: { userId: string | null; _count: { userId: number } }) => {
        const user = await prisma.user.findUnique({
          where: { id: item.userId! },
          select: { email: true, role: true },
        });
        return {
          userId: item.userId,
          email: user?.email || 'Unknown',
          role: user?.role || 'Unknown',
          exportCount: item._count?.userId ?? 0,
        };
      })
    );

    return res.json({
      exports: formattedExports,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
      summary: {
        total,
        last24h: exports24h,
        last7days: exports7d,
        last30days: exports30d,
        byRole: roleStats,
        topExporters: topExportersWithEmails,
      },
    });
  } catch (error) {
    secureLogger.error('GDPR exports monitoring error', { error });
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Get detailed export info for a specific user
adminRouter.get(
  '/gdpr/exports/:userId',
  requirePermissions('system.configure'),
  audit('admin:gdpr:exports:user', (req) => `admin:gdpr:exports:${req.params.userId}`),
  async (req, res) => {
  try {
    const { userId } = req.params;

    // Get user info
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get all exports for this user
    const exportLogs: AuditLog[] = await prisma.auditLog.findMany({
      where: {
        userId,
        action: 'GDPR_EXPORT_REQUESTED',
      },
      orderBy: { createdAt: 'desc' },
    });

    const formattedExports = exportLogs.map((log: AuditLog) => {
      const metadata = log.metadata as any;
      return {
        id: log.id,
        ip: log.ip || metadata?.ip || 'Unknown',
        exportDate: log.createdAt,
        dataSize: metadata?.dataSize || 0,
        dataSizeMB: metadata?.dataSizeMB || ((metadata?.dataSize || 0) / 1024 / 1024).toFixed(2),
        itemCounts: metadata?.itemCounts || {},
      };
    });

    return res.json({
      user,
      exports: formattedExports,
      totalExports: exportLogs.length,
    });
  } catch (error) {
    secureLogger.error('GDPR user exports error', { error });
    return res.status(500).json({ error: 'Internal error' });
  }
});
