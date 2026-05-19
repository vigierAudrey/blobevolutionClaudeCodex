import { Router, type Response } from 'express';
import { z } from 'zod';
import { clientPrisma as prisma, Prisma } from '@blobinfini/database';
import type { AuditLog, Role } from '@blobinfini/database';
import { requireAuth, requireAdmin, requireVerifiedEmail } from '../auth/auth.guard';
import { gdprPurgeService } from '../../services/gdpr-purge.service';
import { systemAlertService } from '../../services/system-alert.service';
import { audit } from '../../middleware/audit';
import { ROLE_PERMISSIONS, AVAILABLE_PERMISSIONS, type Permission } from './permissions';
import { requirePermissions, requireAnyPermission } from './admin.guard';
import { enforceAdminAllowedIp, requireAdminStepUp } from './admin.security-guard';
import { createRateLimiter, createLazyRateLimiter, createLazyCustomRateLimiter } from '../../middleware/enhanced-rate-limit';
import { secureLogger } from '../../utils/secure-logger';
import { invalidateSessionCache } from '../../lib/auth-session-store';
import { disconnectUserSockets } from '../../lib/socket';
import { analyticsReportService } from '../../services/analytics/reports.service';
import { type AnalyticsPeriod } from '../../services/analytics/definitions';
import { capAdminLimit } from '../../utils/admin-list-cap';
import {
  ADMIN_STATS_MAIN_CACHE_KEY,
  getAdminStatsCache,
  getAdminStatsCacheTtlSeconds,
  invalidateAdminStatsCache,
  setAdminStatsCache,
} from '../../lib/admin-stats-cache';
import {
  DEFAULT_BULK_MAX_SYNC,
  conversationBlockEventService,
  ConversationBlockEventServiceError,
} from '../../services/conversation-block-event.service';
import { retentionExportArtifactService } from '../../services/retention-export-artifact.service';
import {
  CONVERSATION_BLOCK_HISTORY_RELIABLE_SINCE_DATE,
  CONVERSATION_BLOCK_HISTORY_RELIABLE_SINCE_VERSION,
} from './moderation-history.constants';

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
const adminStatsCacheSchema = z.object({
  totalUsers: z.number().int().nonnegative(),
  totalRiders: z.number().int().nonnegative(),
  totalPros: z.number().int().nonnegative(),
  totalAdmins: z.number().int().nonnegative(),
  totalConversations: z.number().int().nonnegative(),
  activeUsers: z.number().int().nonnegative(),
  reportedProfiles: z.number().int().nonnegative(),
}).strict();

type AdminStatsResponse = z.infer<typeof adminStatsCacheSchema>;

async function buildAdminStats(): Promise<AdminStatsResponse> {
  const totalUsers = await prisma.user.count();
  const usersByRole = await prisma.user.groupBy({
    by: ['role'],
    _count: { role: true }
  }) as RoleCountGroup[];

  const totalConversations = await prisma.conversation.count();

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

  const reportedProfiles = await prisma.profileReport.count({ where: { reviewedAt: null } });

  return {
    totalUsers,
    totalRiders: usersByRole.find((group: RoleCountGroup) => group.role === 'RIDER')?._count?.role ?? 0,
    totalPros: usersByRole.find((group: RoleCountGroup) => group.role === 'PRO')?._count?.role ?? 0,
    totalAdmins: usersByRole.find((group: RoleCountGroup) => group.role === 'ADMIN')?._count?.role ?? 0,
    totalConversations,
    activeUsers,
    reportedProfiles
  };
}

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
    const cachedStats = await getAdminStatsCache(ADMIN_STATS_MAIN_CACHE_KEY, adminStatsCacheSchema);
    if (cachedStats) {
      return res.json(cachedStats);
    }

    const stats = await buildAdminStats();
    await setAdminStatsCache(ADMIN_STATS_MAIN_CACHE_KEY, stats, getAdminStatsCacheTtlSeconds());

    return res.json(stats);
  } catch (error) {
    secureLogger.error('Admin stats error', { error });
    return res.status(500).json({ error: 'Internal error' });
  }
});

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

const reportHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

adminRouter.get(
  '/reports/history',
  requirePermissions('reports.view'),
  audit('admin:reports:history', () => 'admin:reports:history'),
  async (req, res) => {
    try {
      const { page, limit } = reportHistoryQuerySchema.parse(req.query);
      const skip = (page - 1) * limit;

      const [reports, total] = await Promise.all([
        prisma.profileReport.findMany({
          where: { reviewedAt: { not: null } },
          include: {
            reporter: {
              select: {
                email: true,
                role: true,
              },
            },
            reportedProfile: {
              select: {
                id: true,
                displayName: true,
                user: {
                  select: {
                    id: true,
                    email: true,
                    role: true,
                  },
                },
              },
            },
          },
          orderBy: [
            { reviewedAt: 'desc' },
            { createdAt: 'desc' },
          ],
          skip,
          take: limit,
        }),
        prisma.profileReport.count({
          where: { reviewedAt: { not: null } },
        }),
      ]);
      type ReviewedReport = Awaited<typeof reports>[number];
      type ReviewerSummary = { id: string; email: string; role: Role };

      const reviewerIds = [...new Set(
        reports
          .map((report: ReviewedReport) => report.reviewedByAdminId)
          .filter((value: string | null): value is string => typeof value === 'string' && value.length > 0),
      )];
      const reviewers = reviewerIds.length > 0
        ? await prisma.user.findMany({
          where: { id: { in: reviewerIds } },
          select: { id: true, email: true, role: true },
        })
        : [];
      const reviewersById = new Map(reviewers.map((reviewer: ReviewerSummary) => [reviewer.id, reviewer]));

      return res.json({
        items: reports.map((report: ReviewedReport) => ({
          ...report,
          reviewedByAdmin: report.reviewedByAdminId
            ? reviewersById.get(report.reviewedByAdminId) ?? null
            : null,
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
      secureLogger.error('Admin reports history error', { error });
      return res.status(500).json({ error: 'Internal error' });
    }
  },
);

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

// Analytics détaillées - Demandes de cours riders (BloboMap)
adminRouter.get(
  '/analytics/lesson-requests',
  requirePermissions('analytics.view'),
  audit('admin:analytics:lesson-requests', () => 'admin:analytics:lesson-requests'),
  async (req, res) => {
  try {
    const period = resolveAnalyticsPeriod(req.query.period);
    const report = await analyticsReportService.getLessonRequests(period);
    return res.json(report);

  } catch (error) {
    secureLogger.error('Analytics lesson-requests error', { error });
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
  action: z.enum(['block', 'unblock']).default('block'),
  reason: z.string().trim().max(500).optional(),
});

function handleConversationBlockServiceError(
  error: ConversationBlockEventServiceError,
  res: Response,
) {
  if (error.code === 'NOT_FOUND') {
    return res.status(404).json({ error: error.message, details: error.details ?? null });
  }

  if (error.code === 'BULK_TOO_LARGE') {
    return res.status(409).json({
      error: 'BULK_TOO_LARGE_FOR_SYNC',
      message: `Déblocage massif limité à ${DEFAULT_BULK_MAX_SYNC} entrées en mode synchrone.`,
      details: error.details ?? null,
    });
  }

  if (error.code === 'STATE_CONFLICT' || error.code === 'BULK_CONFLICT_RETRYABLE') {
    return res.status(409).json({
      error: error.code,
      message: error.message,
      details: error.details ?? null,
    });
  }

  return res.status(500).json({ error: 'Internal error' });
}

adminRouter.post(
  '/conversations/:conversationId/block',
  requirePermissions('reports.moderate'),
  requireAdminStepUp,
  audit('admin:conversations:block', (req) => `admin:conversation:${req.params.conversationId}`),
  async (req, res) => {
    try {
      const { conversationId } = req.params;
      const { action, reason, userId } = adminConversationBlockSchema.parse(req.body ?? {});

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

      const actor = (req as typeof req & { user?: { id: string } }).user;
      const result = await conversationBlockEventService.setConversationBlock({
        conversationId,
        targetUserIds: targetMembers.map((member: ConversationMemberWithUser) => member.userId),
        action,
        actorUserId: actor?.id ?? null,
        actorType: 'ADMIN',
        source: 'ADMIN_SINGLE',
        reason: reason ?? null,
      });

      if (!res.locals.auditMetadata) {
        res.locals.auditMetadata = {};
      }
      res.locals.auditMetadata = {
        ...(res.locals.auditMetadata || {}),
        conversationId,
        action,
        targetUserIds: targetMembers.map((member: ConversationMemberWithUser) => member.userId),
        reason: reason ?? null,
      };

      return res.json({
        ...result,
      });
    } catch (error) {
      if (error instanceof ConversationBlockEventServiceError) {
        return handleConversationBlockServiceError(error, res);
      }
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
  requireAdminStepUp,
  audit('admin:conversations:unblock-all', () => 'admin:conversations:bulk-unblock'),
  async (req, res) => {
    try {
      const actor = (req as typeof req & { user?: { id: string } }).user;
      if (!actor?.id) {
        return res.status(403).json({ error: 'Admin role required' });
      }

      const result = await conversationBlockEventService.unblockAllConversationMembers(actor.id);

      res.locals.auditMetadata = {
        batchId: result.batchId,
        affectedCount: result.processedCount,
        remainingCount: result.remainingCount,
      };

      return res.json({
        success: true,
        batchId: result.batchId,
        processedCount: result.processedCount,
        remainingCount: result.remainingCount,
      });
    } catch (error) {
      if (error instanceof ConversationBlockEventServiceError) {
        return handleConversationBlockServiceError(error, res);
      }
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

      const [items, total, legacyCount] = await Promise.all([
        prisma.conversationBlockEvent.findMany({
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
          include: {
            user: {
              select: { id: true, email: true, role: true }
            },
            actorUser: {
              select: { id: true, email: true, role: true }
            },
            conversation: {
              select: { id: true, type: true, createdAt: true }
            }
          }
        }),
        prisma.conversationBlockEvent.count(),
        prisma.conversationBlockEvent.count({
          where: { source: 'LEGACY_UNKNOWN' }
        })
      ]);

      return res.json({
        items,
        historyReliability: {
          hasLegacyRows: legacyCount > 0,
          reliableSinceDate: CONVERSATION_BLOCK_HISTORY_RELIABLE_SINCE_DATE,
          reliableSinceVersion: CONVERSATION_BLOCK_HISTORY_RELIABLE_SINCE_VERSION,
        },
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
  requireAnyPermission('security.read', 'system.configure'),
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
  requireAnyPermission('security.read', 'system.monitor'), // F05: aggregate summary, no per-user PII
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
// GET browsing: shared ADMIN limit (50 req/5min).
const adminSecurityRateLimit = createRateLimiter('ADMIN');

// Purge endpoint: dedicated tighter limit — prevents accidental spam and protects
// the shared ADMIN quota from being consumed by purge calls.
// 5 purge calls / 5 min is sufficient for any legitimate use.
const adminPurgeRateLimit = createLazyCustomRateLimiter(
  {
    windowMs: 5 * 60 * 1000,
    max: 5,
    message: { error: 'ADMIN_PURGE_RATE_LIMIT_EXCEEDED', message: 'Too many purge requests.' },
  },
  'admin_login_attempt_purge',
);

// ---------------------------------------------------------------------------
// Helpers — cursor pagination
// ---------------------------------------------------------------------------

interface LoginAttemptCursor {
  createdAt: Date;
  id: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseCursor(raw: string): LoginAttemptCursor | null {
  try {
    const decoded = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (typeof decoded.createdAt !== 'string' || typeof decoded.id !== 'string') return null;
    const createdAt = new Date(decoded.createdAt);
    if (isNaN(createdAt.getTime())) return null;
    if (!UUID_RE.test(decoded.id)) return null;
    return { createdAt, id: decoded.id };
  } catch {
    return null;
  }
}

function encodeCursor(attempt: { createdAt: Date; id: string }): string {
  return Buffer.from(
    JSON.stringify({ createdAt: attempt.createdAt.toISOString(), id: attempt.id })
  ).toString('base64url');
}

// ---------------------------------------------------------------------------
// Schema de validation — GET /security/login-attempts
// ---------------------------------------------------------------------------

// max 100: évite le payload N+1 (include user) et la sérialisation massive.
// cursor: opaque base64url JSON {createdAt, id} pour tri stable (createdAt DESC, id DESC).
const loginAttemptsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  onlyFailed: z.enum(['true', 'false']).optional().transform(val => val === 'true'),
  suspiciousOnly: z.enum(['true', 'false']).optional().transform(val => val === 'true'),
  cursor: z.string().optional(),
});

adminRouter.get(
  '/security/login-attempts',
  adminSecurityRateLimit,
  requireAnyPermission('security.read', 'system.configure'),
  audit('admin:security:login-attempts', () => 'admin:security:login-attempts'),
  async (req, res) => {
    try {
      const parsed = loginAttemptsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.format() });
      }

      const { limit, onlyFailed, suspiciousOnly, cursor: rawCursor } = parsed.data;

      // --- cursor validation ---
      let cursor: LoginAttemptCursor | null = null;
      if (rawCursor) {
        cursor = parseCursor(rawCursor);
        if (!cursor) {
          return res.status(400).json({ error: 'Invalid cursor' });
        }
      }

      // --- base where filter ---
      const baseWhere: Prisma.LoginAttemptWhereInput = onlyFailed ? { success: false } : {};

      // --- cursor WHERE clause: (createdAt < cur.createdAt) OR (createdAt = cur.createdAt AND id < cur.id)
      //     Requires ORDER BY createdAt DESC, id DESC to be stable.
      const cursorWhere: Prisma.LoginAttemptWhereInput | undefined = cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : undefined;

      let attempts: LoginAttemptWithUser[];

      if (suspiciousOnly) {
        // --- 2.3: suspiciousOnly rewrite — GROUP BY HAVING in SQL, zero JS aggregation ---
        //
        // WHY: the previous approach loaded ALL failed attempts of the last 24h into Node.js
        // memory and aggregated with Map. Under a DDoS (100k+ rows/day) this OOMs the process.
        //
        // NOW: two parallel $queryRaw with GROUP BY + HAVING.
        // Index used: (success, ipHash, createdAt DESC) and (success, emailHash, createdAt DESC).
        // At 10M rows: index seek on success=false + createdAt range → O(log n + matching_rows).
        // LIMIT 200 caps the IN (...) list in the subsequent findMany.

        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        type IpHashRow = { ipHash: string };
        type EmailHashRow = { emailHash: string };

        const [ipRows, emailRows] = await Promise.all([
          prisma.$queryRaw<IpHashRow[]>`
            SELECT "ipHash"
            FROM "LoginAttempt"
            WHERE success = false
              AND "createdAt" >= ${oneDayAgo}
              AND "ipHash" IS NOT NULL
            GROUP BY "ipHash"
            HAVING COUNT(*) >= 3
            ORDER BY COUNT(*) DESC
            LIMIT 200
          `,
          prisma.$queryRaw<EmailHashRow[]>`
            SELECT "emailHash"
            FROM "LoginAttempt"
            WHERE success = false
              AND "createdAt" >= ${oneDayAgo}
              AND "emailHash" IS NOT NULL
            GROUP BY "emailHash"
            HAVING COUNT(*) >= 5
            ORDER BY COUNT(*) DESC
            LIMIT 200
          `,
        ]);

        const suspiciousIpHashes = ipRows.map((r: IpHashRow) => r.ipHash);
        const suspiciousEmailHashes = emailRows.map((r: EmailHashRow) => r.emailHash);

        if (suspiciousIpHashes.length > 0 || suspiciousEmailHashes.length > 0) {
          // fire-and-forget: alert creation must not block the response
          systemAlertService.ensureAlert({
            type: 'security:suspicious-login',
            message: 'Tentatives de connexion suspectes détectées',
            severity: 'WARNING',
            metadata: { suspiciousIpHashes, suspiciousEmailHashes },
          }).catch(() => {});
        }

        if (suspiciousIpHashes.length === 0 && suspiciousEmailHashes.length === 0) {
          attempts = [];
        } else {
          const orClauses: Prisma.LoginAttemptWhereInput[] = [];
          if (suspiciousIpHashes.length > 0) orClauses.push({ ipHash: { in: suspiciousIpHashes } });
          if (suspiciousEmailHashes.length > 0) orClauses.push({ emailHash: { in: suspiciousEmailHashes } });

          // cursorWhere is { OR: [...] }. Plain spread would overwrite the outer OR.
          // Use AND to combine both conditions correctly.
          const suspiciousWhere: Prisma.LoginAttemptWhereInput = cursorWhere
            ? { AND: [{ OR: orClauses }, cursorWhere] }
            : { OR: orClauses };

          attempts = await prisma.loginAttempt.findMany({
            where: suspiciousWhere,
            include: { user: { select: { id: true, role: true } } },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: limit,
          });
        }
      } else {
        attempts = await prisma.loginAttempt.findMany({
          where: { ...baseWhere, ...cursorWhere },
          include: { user: { select: { id: true, role: true } } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: limit,
        });
      }

      // --- nextCursor: emit only when a full page was returned (more may exist) ---
      const nextCursor = attempts.length === limit
        ? encodeCursor(attempts[attempts.length - 1])
        : null;

      // --- stats: two COUNT queries scoped to the same filter (consistent with the list) ---
      // Run in parallel; the (success, createdAt) composite index covers both.
      const [total, failed] = await Promise.all([
        prisma.loginAttempt.count({ where: baseWhere }),
        prisma.loginAttempt.count({ where: { ...baseWhere, success: false } }),
      ]);
      const successRate = total > 0 ? ((total - failed) / total) * 100 : 0;

      // --- RGPD: never expose raw email or ip ---
      const sanitizedAttempts = attempts.map((attempt: LoginAttemptWithUser) => ({
        ...attempt,
        email: null,
        ip: undefined,
      }));

      return res.json({
        attempts: sanitizedAttempts,
        nextCursor,
        stats: {
          total,
          failed,
          successRate: successRate.toFixed(2),
        },
      });
    } catch (error) {
      secureLogger.error('Admin login attempts error', { error });
      return res.status(500).json({ error: 'Internal error' });
    }
  }
);

// ---------------------------------------------------------------------------
// 2.6 — POST /admin/security/login-attempts/purge
// ---------------------------------------------------------------------------
//
// SECURITY SURFACE:
//   P0 — Accidental mass purge: dryRun=true by default, confirm="CONFIRM" required for real.
//   P1 — Admin spam: adminSecurityRateLimit (module-level, shared with GET).
//   P2 — Unauthorized access: requirePermissions('system.configure') gate.
//
// Retention rules enforced server-side (not exposed in body):
//   success=true  → LOGIN_ATTEMPT_SUCCESS_RETENTION_DAYS (default 7)
//   success=false → LOGIN_ATTEMPT_FAILURE_RETENTION_DAYS (default 30)

const loginAttemptsPurgeBodySchema = z.object({
  dryRun: z.boolean().default(true),
  // Must be the literal string "CONFIRM" to execute a real purge.
  confirm: z.string().optional(),
});

adminRouter.post(
  '/security/login-attempts/purge',
  adminPurgeRateLimit,
  requireAnyPermission('security.write', 'system.configure'),
  audit('admin:security:login-attempts:purge', () => 'admin:security:login-attempts:purge'),
  async (req, res) => {
    try {
      const parsed = loginAttemptsPurgeBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid body', details: parsed.error.format() });
      }

      const { dryRun, confirm } = parsed.data;

      if (!dryRun && confirm !== 'CONFIRM') {
        return res.status(400).json({
          error: 'Real purge requires confirm="CONFIRM" in the request body.',
          hint: 'Send { dryRun: false, confirm: "CONFIRM" } to proceed.',
        });
      }

      const result = await gdprPurgeService.purgeOldLoginAttemptsBatched({ dryRun });

      secureLogger.info('ADMIN_LOGIN_ATTEMPTS_PURGE', {
        ...result,
        adminUserId: (req as any).user?.id,
      });

      // Enrich audit log with structured purge metadata (read by audit() on res.finish)
      res.locals.auditMetadata = {
        dryRun: result.dryRun,
        deleted: result.deleted,
        wouldDelete: result.wouldDelete,
        batches: result.batches,
        successRetentionDays: result.successRetentionDays,
        failureRetentionDays: result.failureRetentionDays,
      };

      return res.json(result);
    } catch (error) {
      secureLogger.error('Admin login attempts purge error', { error });
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

const retentionExportCreateSchema = z.object({
  scope: z.literal('AUDIT_LOG'),
  fromDate: z.coerce.date(),
  toDate: z.coerce.date(),
  format: z.literal('NDJSON').default('NDJSON'),
}).refine((value) => value.toDate >= value.fromDate, {
  message: 'toDate must be greater than or equal to fromDate',
  path: ['toDate'],
});

const retentionExportListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  scope: z.literal('AUDIT_LOG').optional(),
  status: z.enum(['GENERATING', 'READY', 'VERIFIED', 'FAILED', 'EXPIRED']).optional(),
});

const RETENTION_EXPORT_MAX_ROWS = 10_000;
const RETENTION_EXPORT_MAX_BYTES = 10 * 1024 * 1024;

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
    const readiness = await gdprPurgeService.getAuditLogPurgeReadiness();
    if (readiness.hasEligibleLogs && !readiness.exportVerified) {
      return res.status(409).json({
        success: false,
        error: 'MISSING_VERIFIED_EXPORT',
        blockedReason: 'Un export rétention VERIFIED doit couvrir les AuditLog avant purge.',
        details: {
          threshold: readiness.threshold.toISOString(),
          oldestPurgeableLogCreatedAt: readiness.oldestPurgeableLogCreatedAt?.toISOString() ?? null,
        },
      });
    }

    const startedAt = Date.now();
    const result = await gdprPurgeService.performFullPurge();
    await invalidateAdminStatsCache(ADMIN_STATS_MAIN_CACHE_KEY);

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

adminRouter.post(
  '/gdpr/exports',
  requirePermissions('system.configure'),
  requireAdminStepUp,
  audit('admin:gdpr:retention-export', () => 'admin:gdpr:retention-export'),
  async (req, res) => {
    let artifactId: string | null = null;

    try {
      const body = retentionExportCreateSchema.parse(req.body);
      const actor = (req as typeof req & { user?: { id: string } }).user;
      if (!actor?.id) {
        return res.status(403).json({ error: 'Admin role required' });
      }

      const total = await prisma.auditLog.count({
        where: {
          createdAt: {
            gte: body.fromDate,
            lte: body.toDate,
          },
        },
      });

      if (total > RETENTION_EXPORT_MAX_ROWS) {
        return res.status(409).json({
          error: 'EXPORT_TOO_LARGE',
          message: `Export limité à ${RETENTION_EXPORT_MAX_ROWS} lignes. Réduire la fenêtre.`,
          details: { total, maxRows: RETENTION_EXPORT_MAX_ROWS },
        });
      }

      const artifact = await retentionExportArtifactService.createArtifact({
        scope: body.scope,
        fromDate: body.fromDate,
        toDate: body.toDate,
        createdByAdminId: actor.id,
        format: body.format,
      });
      artifactId = artifact.id;

      const logs = await prisma.auditLog.findMany({
        where: {
          createdAt: {
            gte: body.fromDate,
            lte: body.toDate,
          },
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          userId: true,
          action: true,
          resource: true,
          metadata: true,
          ip: true,
          createdAt: true,
        },
      });

      type RetentionExportLog = Awaited<typeof logs>[number];
      const payload = `${logs.map((item: RetentionExportLog) => JSON.stringify(item)).join('\n')}${logs.length > 0 ? '\n' : ''}`;
      const payloadBytes = Buffer.byteLength(payload, 'utf8');
      if (payloadBytes > RETENTION_EXPORT_MAX_BYTES) {
        await retentionExportArtifactService.markFailed(artifact.id, 'EXPORT_TOO_LARGE_BYTES');
        return res.status(409).json({
          error: 'EXPORT_TOO_LARGE',
          message: `Export limité à ${RETENTION_EXPORT_MAX_BYTES} octets. Réduire la fenêtre.`,
          details: { payloadBytes, maxBytes: RETENTION_EXPORT_MAX_BYTES },
        });
      }

      const readyArtifact = await retentionExportArtifactService.markReady({
        artifactId: artifact.id,
        rowCount: logs.length,
        payload,
      });
      const verifiedArtifact = await retentionExportArtifactService.verifyArtifact(artifact.id);

      res.locals.auditMetadata = {
        artifactId: artifact.id,
        scope: body.scope,
        fromDate: body.fromDate.toISOString(),
        toDate: body.toDate.toISOString(),
        rowCount: logs.length,
        sha256: readyArtifact.sha256,
      };

      return res.json({
        artifact: {
          id: verifiedArtifact.id,
          scope: verifiedArtifact.scope,
          format: verifiedArtifact.format,
          status: verifiedArtifact.status,
          rowCount: verifiedArtifact.rowCount,
          sha256: verifiedArtifact.sha256,
          createdAt: verifiedArtifact.createdAt,
          verifiedAt: verifiedArtifact.verifiedAt,
          fromDate: verifiedArtifact.fromDate,
          toDate: verifiedArtifact.toDate,
        },
        download: {
          fileName: `audit-log-retention-${body.fromDate.toISOString()}-${body.toDate.toISOString()}.ndjson`,
          mimeType: 'application/x-ndjson',
          encoding: 'base64',
          content: Buffer.from(payload, 'utf8').toString('base64'),
        },
      });
    } catch (error) {
      if (artifactId) {
        await retentionExportArtifactService.markFailed(
          artifactId,
          error instanceof Error ? error.message : 'UNKNOWN_EXPORT_ERROR',
        );
      }
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
      secureLogger.error('Retention export generation error', { error });
      return res.status(500).json({ error: 'Internal error' });
    }
  },
);

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
    const { page, limit, scope, status } = retentionExportListQuerySchema.parse(req.query);
    const result = await retentionExportArtifactService.listArtifacts({
      page,
      limit: capAdminLimit(String(limit)),
      scope,
      status,
    });

    return res.json({
      exports: result.items,
      pagination: result.pagination,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
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
