import { Router } from 'express';
import { z } from 'zod';
import { clientPrisma as prisma, Prisma } from '@blobinfini/database';
import type { DecisionKind } from '@blobinfini/database';
import { requireAuth, requireAdmin } from '../auth/auth.guard';
import { gdprPurgeService } from '../../services/gdpr-purge.service';
import { audit } from '../../middleware/audit';
import { ROLE_PERMISSIONS, AVAILABLE_PERMISSIONS, type Permission } from './permissions';
import { requirePermissions } from './admin.guard';
import { createRateLimiter } from '../../middleware/enhanced-rate-limit';

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

// Toutes les routes admin nécessitent une authentification et le rôle admin
adminRouter.use(requireAuth);
adminRouter.use(requireAdmin);

// Statistiques principales
adminRouter.get('/stats', requirePermissions('analytics.view'), audit('admin:stats:view', () => 'admin:stats'), async (req, res) => {
  try {
    // Compter les utilisateurs par rôle
    const totalUsers = await prisma.user.count();
    const usersByRole: Prisma.UserGroupByOutputType[] = await prisma.user.groupBy({
      by: ['role'],
      _count: { role: true }
    });

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

    // Signalements totaux (pas de champ reviewedAt dans le modèle actuel)
    const reportedProfiles = await prisma.profileReport.count();

    // Formater les statistiques
    const stats = {
      totalUsers,
      totalRiders: usersByRole.find((group: Prisma.UserGroupByOutputType) => group.role === 'RIDER')?._count.role || 0,
      totalPros: usersByRole.find((group: Prisma.UserGroupByOutputType) => group.role === 'PRO')?._count.role || 0,
      totalAdmins: usersByRole.find((group: Prisma.UserGroupByOutputType) => group.role === 'ADMIN')?._count.role || 0,
      totalConversations,
      activeUsers,
      reportedProfiles
    };

    return res.json(stats);
  } catch (error) {
    console.error('Admin stats error:', error);
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
    const limit = parseInt(req.query.limit as string || '20');
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
    console.error('Admin users list error:', error);
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Suspendre/réactiver un utilisateur
adminRouter.patch(
  '/users/:id/suspend',
  requirePermissions('users.suspend'),
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

    return res.json(updatedUser);
  } catch (error) {
    console.error('Admin suspend user error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input' });
    }
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
            lat: true,
            lng: true,
            updatedAt: true
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const riderReports = user.riderProfile
      ? await prisma.profileReport.count({ where: { reportedProfileId: user.riderProfile.id } })
      : 0;

    const reportsSubmitted = await prisma.profileReport.count({ where: { reporterUserId: user.id } });

    return res.json({
      user,
      metrics: {
        reportsReceived: riderReports,
        reportsSubmitted,
        sessionsCount: await prisma.session.count({ where: { userId } })
      }
    });
  } catch (error) {
    console.error('Admin user detail error:', error);
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Vérifier un professionnel
adminRouter.patch(
  '/pros/:id/verify',
  requirePermissions('pros.verify'),
  audit('admin:pro:verify', (req) => `pro:${req.params.id}`),
  async (req, res) => {
  try {
    const userId = req.params.id;
    const { verified } = z.object({
      verified: z.boolean()
    }).parse(req.body);

    const proProfile = await prisma.proProfile.update({
      where: { userId },
      data: { verified },
      select: {
        id: true,
        businessName: true,
        verified: true
      }
    });

    return res.json(proProfile);
  } catch (error) {
    console.error('Admin verify pro error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input' });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Lister les signalements
adminRouter.get(
  '/reports',
  requirePermissions('reports.view'),
  audit('admin:reports:list', () => 'admin:reports'),
  async (req, res) => {
  try {
    const page = parseInt(req.query.page as string || '1');
    const limit = parseInt(req.query.limit as string || '20');
    const skip = (page - 1) * limit;

    const [reports, total] = await Promise.all([
      prisma.profileReport.findMany({
        skip,
        take: limit,
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
      prisma.profileReport.count()
    ]);

    return res.json({
      reports,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Admin reports list error:', error);
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
    console.error('Admin permissions list error:', error);
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
    console.error('Admin list error:', error);
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Mettre à jour les permissions d'un admin
adminRouter.patch(
  '/admins/:id/permissions',
  requirePermissions('permissions.manage'),
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

    return res.json(adminProfile);
  } catch (error) {
    console.error('Admin permissions update error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input' });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Appliquer un rôle prédéfini à un admin
adminRouter.patch(
  '/admins/:id/role',
  requirePermissions('permissions.manage'),
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

    return res.json(adminProfile);
  } catch (error) {
    console.error('Admin role update error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input' });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
});

// ✅ NOUVEAU : Gérer les IPs autorisées pour un admin
adminRouter.patch(
  '/admins/:id/allowed-ips',
  requirePermissions('permissions.manage'),
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
    console.error('Admin allowed IPs update error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
});

adminRouter.get(
  '/analytics/matching/ttfm',
  requirePermissions('analytics.view'),
  audit('admin:analytics:ttfm', () => 'admin:analytics:ttfm'),
  async (req, res) => {
  try {
    const periodParam = typeof req.query.period === 'string' ? req.query.period : '30d';
    const period: AnalyticsPeriod = ['7d', '30d', '90d', '1y'].includes(periodParam)
      ? (periodParam as AnalyticsPeriod)
      : '30d';

    const now = new Date();
    let startDate = new Date();
    let groupBy: 'day' | 'week' | 'month' = 'day';

    switch (period) {
      case '7d':
        startDate.setDate(now.getDate() - 7);
        groupBy = 'day';
        break;
      case '30d':
        startDate.setDate(now.getDate() - 30);
        groupBy = 'day';
        break;
      case '90d':
        startDate.setDate(now.getDate() - 90);
        groupBy = 'week';
        break;
      case '1y':
        startDate.setFullYear(now.getFullYear() - 1);
        groupBy = 'month';
        break;
      default:
        startDate.setDate(now.getDate() - 30);
        groupBy = 'day';
    }

    const firstMatchesRaw = await prisma.$queryRaw<Array<{
      user_id: string;
      user_created_at: Date;
      first_conversation_at: Date;
      days_to_match: number | null;
    }>>(
      Prisma.sql`
        SELECT
          u."id" as user_id,
          u."createdAt" as user_created_at,
          first_conv.first_conversation_at,
          EXTRACT(EPOCH FROM (first_conv.first_conversation_at - u."createdAt")) / 86400.0 AS days_to_match
        FROM "User" u
        JOIN (
          SELECT cm."userId", MIN(c."createdAt") as first_conversation_at
          FROM "ConversationMember" cm
          JOIN "Conversation" c ON c."id" = cm."conversationId"
          WHERE c."type" = 'RIDER_TO_RIDER'
          GROUP BY cm."userId"
        ) first_conv ON first_conv."userId" = u."id"
        WHERE first_conv.first_conversation_at >= ${startDate}
          AND first_conv.first_conversation_at <= ${now}
          AND u."role" = 'RIDER'
          AND u."deletedAt" IS NULL
      `
    );

    const sampleSize = firstMatchesRaw.length;
    type FirstMatchRow = (typeof firstMatchesRaw)[number];

    const daysValues = firstMatchesRaw.map((row: FirstMatchRow) => {
      const value = Number(row.days_to_match ?? 0);
      return value < 0 ? 0 : value;
    });

    const sortedDays = [...daysValues].sort((a, b) => a - b);
    const averageDays = sampleSize > 0 ? sortedDays.reduce((sum, value) => sum + value, 0) / sampleSize : 0;
    const medianDays = sampleSize > 0
      ? (sampleSize % 2 === 1
        ? sortedDays[Math.floor(sampleSize / 2)]
        : (sortedDays[sampleSize / 2 - 1] + sortedDays[sampleSize / 2]) / 2)
      : 0;
    const p90Days = sampleSize > 0
      ? sortedDays[Math.min(sortedDays.length - 1, Math.ceil(sortedDays.length * 0.9) - 1)]
      : 0;

    const bucketDefs: Array<{ label: string; min: number; max: number | null }> = [
      { label: '0-1', min: 0, max: 1 },
      { label: '1-3', min: 1, max: 3 },
      { label: '3-7', min: 3, max: 7 },
      { label: '7-14', min: 7, max: 14 },
      { label: '14+', min: 14, max: null }
    ];

    const buckets = bucketDefs.map(def => ({
      label: def.label,
      count: sortedDays.filter(value => {
        if (def.max === null) {
          return value >= def.min;
        }
        return value >= def.min && value < def.max;
      }).length
    }));

    const newRidersInPeriod = await prisma.user.count({
      where: {
        role: 'RIDER',
        deletedAt: null,
        createdAt: {
          gte: startDate,
          lte: now
        }
      }
    });

    const ridersWithoutMatch = await prisma.user.count({
      where: {
        role: 'RIDER',
        deletedAt: null,
        createdAt: {
          gte: startDate,
          lte: now
        },
        conversationMembers: {
          none: {
            conversation: {
              type: 'RIDER_TO_RIDER'
            }
          }
        }
      }
    });

    const timelineMap = new Map<string, { totalDays: number; count: number }>();

    const normalizeDate = (date: Date, granularity: 'day' | 'week' | 'month') => {
      const normalized = new Date(date);
      normalized.setUTCMilliseconds(0);
      normalized.setUTCSeconds(0);
      normalized.setUTCMinutes(0);
      normalized.setUTCHours(0);

      if (granularity === 'week') {
        const day = normalized.getUTCDay();
        const diff = (day + 6) % 7;
        normalized.setUTCDate(normalized.getUTCDate() - diff);
      } else if (granularity === 'month') {
        normalized.setUTCDate(1);
      }

      return normalized.toISOString();
    };

    firstMatchesRaw.forEach((entry: FirstMatchRow) => {
      const value = entry.days_to_match ?? 0;
      const days = value < 0 ? 0 : value;
      const key = normalizeDate(entry.first_conversation_at, groupBy);
      const bucket = timelineMap.get(key) ?? { totalDays: 0, count: 0 };
      bucket.totalDays += days;
      bucket.count += 1;
      timelineMap.set(key, bucket);
    });

    type TimelineEntry = [string, { totalDays: number; count: number }];

    const timeline = Array.from(timelineMap.entries())
      .sort(([a]: TimelineEntry, [b]: TimelineEntry) => (a > b ? 1 : -1))
      .map(([periodIso, data]: TimelineEntry) => ({
        period: periodIso,
        averageDays: data.count > 0 ? data.totalDays / data.count : 0,
        count: data.count
      }));

    return res.json({
      period,
      sampleSize,
      averageDays,
      medianDays,
      p90Days,
      buckets,
      newRidersInPeriod,
      ridersWithoutMatch,
      periodGranularity: groupBy,
      timeline
    });
  } catch (error) {
    console.error('Analytics matching TTFM error:', error);
    return res.status(500).json({ error: 'Internal error' });
  }
});


// Analytics détaillées - Engagement
type AnalyticsPeriod = '7d' | '30d' | '90d' | '1y';

adminRouter.get(
  '/analytics/engagement',
  requirePermissions('analytics.view'),
  audit('admin:analytics:engagement', () => 'admin:analytics:engagement'),
  async (req, res) => {
  try {
    const periodParam = typeof req.query.period === 'string' ? req.query.period : '30d';
    const period: AnalyticsPeriod = ['7d', '30d', '90d', '1y'].includes(periodParam)
      ? (periodParam as AnalyticsPeriod)
      : '30d';

    // Calculer les dates
    const now = new Date();
    let startDate = new Date();
    let groupBy = '';

    switch (period) {
      case '7d':
        startDate.setDate(now.getDate() - 7);
        groupBy = 'day';
        break;
      case '30d':
        startDate.setDate(now.getDate() - 30);
        groupBy = 'day';
        break;
      case '90d':
        startDate.setDate(now.getDate() - 90);
        groupBy = 'week';
        break;
      case '1y':
        startDate.setFullYear(now.getFullYear() - 1);
        groupBy = 'month';
        break;
      default:
        startDate.setDate(now.getDate() - 30);
        groupBy = 'day';
    }

    // Inscriptions par période
    const registrationsRaw = await prisma.$queryRaw<Array<{
      period: Date;
      count: bigint;
      riders: bigint;
      pros: bigint;
    }>>(
      Prisma.sql`
        SELECT
          DATE_TRUNC(${Prisma.raw(`'${groupBy}'`)}, "createdAt") as period,
          COUNT(*) as count,
          COUNT(CASE WHEN role = 'RIDER' THEN 1 END) as riders,
          COUNT(CASE WHEN role = 'PRO' THEN 1 END) as pros
        FROM "User"
        WHERE "createdAt" >= ${startDate}
          AND "deletedAt" IS NULL
        GROUP BY DATE_TRUNC(${Prisma.raw(`'${groupBy}'`)}, "createdAt")
        ORDER BY period
      `
    );

    type RegistrationRow = (typeof registrationsRaw)[number];

    const registrations = registrationsRaw.map((item: RegistrationRow) => ({
      period: item.period instanceof Date ? item.period.toISOString() : String(item.period),
      total: Number(item.count),
      riders: Number(item.riders),
      pros: Number(item.pros)
    }));

    // Utilisateurs actifs (avec sessions récentes)
    const activeUsersRaw = await prisma.$queryRaw<Array<{
      period: Date;
      active_users: bigint;
    }>>(
      Prisma.sql`
        SELECT
          DATE_TRUNC(${Prisma.raw(`'${groupBy}'`)}, s."createdAt") as period,
          COUNT(DISTINCT s."userId") as active_users
        FROM "Session" s
        JOIN "User" u ON u.id = s."userId"
        WHERE s."createdAt" >= ${startDate}
          AND u."deletedAt" IS NULL
        GROUP BY DATE_TRUNC(${Prisma.raw(`'${groupBy}'`)}, s."createdAt")
        ORDER BY period
      `
    );

    type ActiveUsersRow = (typeof activeUsersRaw)[number];

    const activeUsers = activeUsersRaw.map((item: ActiveUsersRow) => ({
      period: item.period instanceof Date ? item.period.toISOString() : String(item.period),
      count: Number(item.active_users)
    }));

    // Métriques globales
    const totalUsers = await prisma.user.count({
      where: { deletedAt: null }
    });

    const totalRiders = await prisma.user.count({
      where: { role: 'RIDER', deletedAt: null }
    });

    const totalPros = await prisma.user.count({
      where: { role: 'PRO', deletedAt: null }
    });

    // Utilisateurs actifs derniers 7 jours
    const last7Days = new Date();
    last7Days.setDate(now.getDate() - 7);

    const activeUsersLast7Days = await prisma.user.count({
      where: {
        sessions: {
          some: {
            createdAt: {
              gte: last7Days
            }
          }
        },
        deletedAt: null
      }
    });

    const newUsersInPeriod = await prisma.user.count({
      where: {
        createdAt: {
          gte: startDate
        },
        deletedAt: null
      }
    });

    // Approximation simple de rétention (en production, utiliser des calculs plus complexes)
    const retentionRates = {
      day1: 75,
      day7: 45,
      day30: 25
    };

    return res.json({
      overview: {
        totalUsers,
        totalRiders,
        totalPros,
        activeUsersLast7Days,
        newUsersInPeriod,
        retentionRates
      },
      registrations,
      activeUsers,
      period
    });

  } catch (error) {
    console.error('Analytics engagement error:', error);
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
    const periodParam = typeof req.query.period === 'string' ? req.query.period : '30d';
    const period: AnalyticsPeriod = ['7d', '30d', '90d', '1y'].includes(periodParam)
      ? (periodParam as AnalyticsPeriod)
      : '30d';

    // Calculer les dates
    const now = new Date();
    let startDate = new Date();
    let groupBy: 'day' | 'week' | 'month' = 'day';

    switch (period) {
      case '7d':
        startDate.setDate(now.getDate() - 7);
        groupBy = 'day';
        break;
      case '30d':
        startDate.setDate(now.getDate() - 30);
        groupBy = 'day';
        break;
      case '90d':
        startDate.setDate(now.getDate() - 90);
        groupBy = 'week';
        break;
      default:
        startDate.setDate(now.getDate() - 30);
        groupBy = 'day';
    }

    // Statistiques des décisions de matching
    const matchingStats: Prisma.MatchDecisionGroupByOutputType[] = await prisma.matchDecision.groupBy({
      by: ['decision'],
      where: {
        createdAt: {
          gte: startDate
        }
      },
      _count: {
        decision: true
      }
    });

    const totalDecisions = matchingStats.reduce(
      (sum: number, stat: Prisma.MatchDecisionGroupByOutputType) => sum + stat._count.decision,
      0
    );
    const acceptedCount = matchingStats.find(
      (stat: Prisma.MatchDecisionGroupByOutputType) => stat.decision === 'ACCEPT'
    )?._count.decision || 0;
    const refusedCount = matchingStats.find(
      (stat: Prisma.MatchDecisionGroupByOutputType) => stat.decision === 'REFUSE'
    )?._count.decision || 0;
    const acceptRate = totalDecisions > 0 ? (acceptedCount / totalDecisions) * 100 : 0;
    const refuseRate = totalDecisions > 0 ? (refusedCount / totalDecisions) * 100 : 0;

    // Conversations créées (matches réussis)
    const matchedConversations = await prisma.conversation.count({
      where: {
        createdAt: {
          gte: startDate
        },
        type: 'RIDER_TO_RIDER'
      }
    });

    const conversationTimelineRaw = await prisma.$queryRaw<Array<{
      period: Date;
      conversations: bigint;
    }>>(
      Prisma.sql`
        SELECT
          DATE_TRUNC(${Prisma.raw(`'${groupBy}'`)}, "createdAt") as period,
          COUNT(*)::bigint as conversations
        FROM "Conversation"
        WHERE "createdAt" >= ${startDate}
          AND "type" = 'RIDER_TO_RIDER'
        GROUP BY DATE_TRUNC(${Prisma.raw(`'${groupBy}'`)}, "createdAt")
        ORDER BY period
      `
    );

    type ConversationTimelineRow = (typeof conversationTimelineRaw)[number];

    const conversationTimeline = conversationTimelineRaw.map((item: ConversationTimelineRow) => ({
      period: item.period instanceof Date ? item.period.toISOString() : String(item.period),
      conversations: Number(item.conversations)
    }));

    const decisionsTimelineRaw = await prisma.$queryRaw<Array<{
      period: Date;
      decision: DecisionKind;
      count: bigint;
    }>>(
      Prisma.sql`
        SELECT
          DATE_TRUNC(${Prisma.raw(`'${groupBy}'`)}, "createdAt") as period,
          "decision",
          COUNT(*)::bigint as count
        FROM "MatchDecision"
        WHERE "createdAt" >= ${startDate}
        GROUP BY DATE_TRUNC(${Prisma.raw(`'${groupBy}'`)}, "createdAt"), "decision"
        ORDER BY period
      `
    );

    const decisionsTimelineMap = new Map<string, { accepted: number; refused: number; total: number }>();

    for (const item of decisionsTimelineRaw) {
      const key = item.period instanceof Date ? item.period.toISOString() : String(item.period);
      const entry = decisionsTimelineMap.get(key) ?? { accepted: 0, refused: 0, total: 0 };
      const count = Number(item.count);
      if (item.decision === 'ACCEPT') {
        entry.accepted += count;
      } else if (item.decision === 'REFUSE') {
        entry.refused += count;
      }
      entry.total += count;
      decisionsTimelineMap.set(key, entry);
    }

    type DecisionTimelineEntry = [string, { accepted: number; refused: number; total: number }];

    const decisionTimeline = Array.from(decisionsTimelineMap.entries())
      .sort(([a]: DecisionTimelineEntry, [b]: DecisionTimelineEntry) => (a > b ? 1 : -1))
      .map(([periodIso, values]: DecisionTimelineEntry) => ({ period: periodIso, ...values }));

    // Préférences de sport (via RiderDiscipline)
    const sportPreferencesRaw = await prisma.riderDiscipline.groupBy({
      by: ['sport'],
      where: {
        createdAt: {
          gte: startDate
        }
      },
      _count: {
        sport: true
      }
    });

    type SportPreference = (typeof sportPreferencesRaw)[number];

    const sportPreferences = sportPreferencesRaw.map((item: SportPreference) => ({
      sport: item.sport,
      count: Number(item._count.sport)
    }));

    // Préférences de niveau (via RiderDiscipline)
    const levelPreferencesRaw = await prisma.riderDiscipline.groupBy({
      by: ['level'],
      where: {
        createdAt: {
          gte: startDate
        }
      },
      _count: {
        level: true
      }
    });

    type LevelPreference = (typeof levelPreferencesRaw)[number];

    const levelPreferences = levelPreferencesRaw.map((item: LevelPreference) => ({
      level: item.level,
      count: Number(item._count.level)
    }));

    // Recherches par sport
    const searchesBySportRaw = await prisma.lastSearch.groupBy({
      by: ['sport'],
      where: {
        createdAt: {
          gte: startDate
        }
      },
      _count: {
        sport: true
      }
    });

    const searchesBySport = searchesBySportRaw.map((item: Prisma.LastSearchGroupByOutputType) => ({
      sport: item.sport,
      count: Number(item._count?.sport ?? 0)
    }));

    // Recherches avec géolocalisation
    const searchesWithGeo = await prisma.lastSearch.count({
      where: {
        createdAt: {
          gte: startDate
        },
        lat: {
          not: null
        },
        lng: {
          not: null
        }
      }
    });

    const totalSearches = await prisma.lastSearch.count({
      where: {
        createdAt: {
          gte: startDate
        }
      }
    });

    const geoUsageRate = totalSearches > 0 ? (searchesWithGeo / totalSearches) * 100 : 0;

    // Évolution des matches par jour (simplifié)
    const matchesOverTimeRaw = await prisma.conversation.groupBy({
      by: ['createdAt'],
      where: {
        createdAt: {
          gte: startDate
        },
        type: 'RIDER_TO_RIDER'
      },
      _count: {
        id: true
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

    type MatchesOverTimeItem = (typeof matchesOverTimeRaw)[number];

    const matchesOverTime = matchesOverTimeRaw.map((item: MatchesOverTimeItem) => ({
      period: item.createdAt instanceof Date ? item.createdAt.toISOString() : String(item.createdAt),
      count: Number(item._count.id)
    }));

    return res.json({
      overview: {
        totalDecisions,
        acceptedCount,
        refusedCount,
        acceptRate,
        refuseRate,
        matchRate: totalDecisions > 0 ? (matchedConversations / totalDecisions) * 100 : 0,
        matchedConversations,
        geoUsageRate
      },
      decisionTimeline,
      conversationTimeline,
      periodGranularity: groupBy,
      matchesOverTime,
      sportPreferences,
      levelPreferences,
      searchesBySport,
      period
    });

  } catch (error) {
    console.error('Analytics matching error:', error);
    return res.status(500).json({ error: 'Internal error' });
  }
});

const reportActionSchema = z.object({
  action: z.enum(['approve', 'dismiss', 'ban'])
});

const conversationBroadcastSchema = z.object({
  message: z.string().min(5).max(2000),
  target: z.enum(['ALL', 'RIDERS', 'PROS', 'CUSTOM']).default('ALL'),
  emails: z.array(z.string().email()).optional()
});

adminRouter.post(
  '/conversations/broadcast',
  requirePermissions('reports.moderate'),
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

      return res.json({
        success: true,
        target,
        sentCount,
        missingEmails
      });
    } catch (error) {
      console.error('Admin conversation broadcast error:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
      return res.status(500).json({ error: 'Internal error' });
    }
  }
);

adminRouter.post(
  '/reports/:id/action',
  requirePermissions('reports.moderate'),
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
      targetUserId: targetUser?.id ?? null
    };

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (action === 'ban' && targetUser) {
        await tx.user.update({
          where: { id: targetUser.id },
          data: { deletedAt: new Date() }
        });

        await tx.session.deleteMany({ where: { userId: targetUser.id } });
        await tx.refreshToken.deleteMany({ where: { userId: targetUser.id } });
      }

      await tx.profileReport.delete({ where: { id: reportId } });
    });

    return res.json({
      success: true,
      action,
      reportId,
      bannedUserId: action === 'ban' ? targetUser?.id : undefined
    });
  } catch (error) {
    console.error('Admin report action error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input' });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
});

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

      const items = blockedMembers.map((member) => ({
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
      console.error('Admin blocked conversations list error:', error);
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

      const targetMembers = userId
        ? conversation.members.filter((member) => member.userId === userId)
        : conversation.members;

      if (targetMembers.length === 0) {
        return res.status(404).json({ error: 'Member not found in conversation' });
      }

      await prisma.conversationMember.updateMany({
        where: {
          conversationId,
          userId: { in: targetMembers.map((member) => member.userId) }
        },
        data: {
          blockedAt: action === 'unblock' ? null : new Date()
        }
      });

      const refreshedMembers = await prisma.conversationMember.findMany({
        where: {
          conversationId,
          userId: { in: targetMembers.map((member) => member.userId) }
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
        targetUserIds: targetMembers.map((member) => member.userId)
      };

      return res.json({
        conversationId,
        action,
        updatedMembers: refreshedMembers.map((member) => ({
          userId: member.userId,
          email: member.user?.email ?? null,
          role: member.user?.role ?? null,
          blockedAt: member.blockedAt
        }))
      });
    } catch (error) {
      console.error('Admin conversation block error:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid input', details: error.errors });
      }
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
      console.error('Admin unblock all conversations error:', error);
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
      console.error('Admin conversation block history error:', error);
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
      console.error('Admin security events error:', error);
      return res.status(500).json({ error: 'Internal error' });
    }
  }
);

adminRouter.get(
  '/security/logs/summary',
  requirePermissions('system.configure'),
  audit('admin:security:logs:summary', () => 'admin:security:logs:summary'),
  async (req, res) => {
    try {
      const days = Math.min(parseInt((req.query.days as string) || '7', 10), 90);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const grouped: Prisma.AuditLogGroupByOutputType[] = await prisma.auditLog.groupBy({
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
      });

      return res.json({
        since,
        items: grouped.map((item) => ({
          action: item.action,
          count: item._count.action
        }))
      });
    } catch (error) {
      console.error('Admin security logs summary error:', error);
      return res.status(500).json({ error: 'Internal error' });
    }
  }
);

/**
 * Pseudonymise une adresse IP pour conformité RGPD Article 5.1.c
 * IPv4: Masque les 2 derniers octets (192.168.xxx.xxx)
 * IPv6: Masque les 64 derniers bits
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

// Rate limiting pour endpoints admin sécurité
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

      // Suspicious criteria: multiple failed attempts from same IP or email
      let attempts;
      if (suspiciousOnly) {
        // Get IPs and emails with multiple failed attempts in the last 24 hours
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const failedAttempts = await prisma.loginAttempt.findMany({
          where: {
            success: false,
            createdAt: { gte: oneDayAgo }
          },
          orderBy: { createdAt: 'desc' }
        });

        // Group by IP and email to find suspicious patterns
        const ipCounts = new Map<string, number>();
        const emailCounts = new Map<string, number>();

        for (const attempt of failedAttempts) {
          if (attempt.ip) {
            ipCounts.set(attempt.ip, (ipCounts.get(attempt.ip) || 0) + 1);
          }
          emailCounts.set(attempt.email, (emailCounts.get(attempt.email) || 0) + 1);
        }

        // Filter suspicious IPs (3+ failed attempts) and emails (5+ failed attempts)
        const suspiciousIPs = Array.from(ipCounts.entries())
          .filter(([, count]) => count >= 3)
          .map(([ip]) => ip);
        const suspiciousEmails = Array.from(emailCounts.entries())
          .filter(([, count]) => count >= 5)
          .map(([email]) => email);

        attempts = await prisma.loginAttempt.findMany({
          where: {
            OR: [
              { ip: { in: suspiciousIPs } },
              { email: { in: suspiciousEmails } }
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
      } else {
        attempts = await prisma.loginAttempt.findMany({
          where,
          include: {
            user: {
              select: { id: true, email: true, role: true }
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

      // Pseudonymiser les IPs avant de retourner (conformité RGPD Article 5.1.c)
      const pseudonymizedAttempts = attempts.map(attempt => ({
        ...attempt,
        ip: pseudonymizeIP(attempt.ip)
      }));

      return res.json({
        attempts: pseudonymizedAttempts,
        stats: {
          total,
          failed,
          successRate: successRate.toFixed(2)
        }
      });
    } catch (error) {
      console.error('Admin login attempts error:', error);
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
    const periodParam = typeof req.query.period === 'string' ? req.query.period : '30d';
    const period: AnalyticsPeriod = ['7d', '30d', '90d', '1y'].includes(periodParam)
      ? (periodParam as AnalyticsPeriod)
      : '30d';

    const now = new Date();
    const startDate = new Date();

    switch (period) {
      case '7d':
        startDate.setDate(now.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(now.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(now.getDate() - 90);
        break;
      case '1y':
        startDate.setFullYear(now.getFullYear() - 1);
        break;
      default:
        startDate.setDate(now.getDate() - 30);
    }

    const [
      totalUsers,
      totalRiders,
      riderProfiles,
      ridersWithDisplayName,
      ridersWithDiscipline,
      ridersWithPhoto,
      ridersCompletedOnboarding,
      ridersWithSearch,
      riderDecisionActors,
      riderMessagingSenders,
      newRidersInPeriod,
      newRiderProfilesInPeriod,
      newRidersWithDisciplineInPeriod,
      newRidersWithPhotoInPeriod,
      totalPros,
      proProfiles,
      prosWithOffers,
      prosVerified,
      newProsInPeriod,
      newProProfilesInPeriod,
      newProsWithOfferInPeriod,
      sessionSummaryRaw,
      sessionsPerUser,
      messageByConversation,
      messageSenders,
      searchesRecent,
      searchesWithGeo,
      searchDistanceAverageRaw,
      riderProfilesWithGeo,
      activeOffersCount,
      reportsTotal,
      reportsByReason
    ] = await Promise.all([
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.user.count({ where: { role: 'RIDER', deletedAt: null } }),
      prisma.riderProfile.count({ where: { user: { deletedAt: null } } }),
      prisma.riderProfile.count({ where: { displayName: { not: null }, user: { deletedAt: null } } }),
      prisma.riderProfile.count({ where: { disciplines: { some: {} }, user: { deletedAt: null } } }),
      prisma.riderProfile.count({ where: { photoUrl: { not: null }, user: { deletedAt: null } } }),
      prisma.riderProfile.count({
        where: {
          displayName: { not: null },
          photoUrl: { not: null },
          disciplines: { some: {} },
          user: { deletedAt: null }
        }
      }),
      prisma.lastSearch.count({ where: { user: { role: 'RIDER', deletedAt: null } } }),
      prisma.matchDecision.groupBy({
        by: ['actorUserId'],
        where: {
          createdAt: { gte: startDate },
          actor: { role: 'RIDER', deletedAt: null }
        },
        _count: {
          _all: true
        }
      }),
      prisma.message.groupBy({
        by: ['senderId'],
        where: {
          createdAt: { gte: startDate },
          sender: { role: 'RIDER', deletedAt: null }
        },
        _count: {
          _all: true
        }
      }),
      prisma.user.count({ where: { role: 'RIDER', deletedAt: null, createdAt: { gte: startDate } } }),
      prisma.riderProfile.count({ where: { createdAt: { gte: startDate }, user: { deletedAt: null } } }),
      prisma.riderProfile.count({
        where: {
          user: { deletedAt: null },
          disciplines: { some: {} },
          createdAt: { gte: startDate }
        }
      }),
      prisma.riderProfile.count({
        where: {
          user: { deletedAt: null },
          photoUrl: { not: null },
          updatedAt: { gte: startDate }
        }
      }),
      prisma.user.count({ where: { role: 'PRO', deletedAt: null } }),
      prisma.proProfile.count({ where: { user: { deletedAt: null } } }),
      prisma.proOffer.count({ where: { isActive: true, proProfile: { user: { deletedAt: null } } } }),
      prisma.proProfile.count({ where: { verified: true, user: { deletedAt: null } } }),
      prisma.user.count({ where: { role: 'PRO', deletedAt: null, createdAt: { gte: startDate } } }),
      prisma.proProfile.count({ where: { createdAt: { gte: startDate }, user: { deletedAt: null } } }),
      prisma.proOffer.count({
        where: {
          createdAt: { gte: startDate },
          proProfile: { user: { deletedAt: null } }
        }
      }),
      prisma.$queryRaw<Array<{
        total_sessions: bigint;
        avg_duration_seconds: number | null;
        median_duration_seconds: number | null;
        max_duration_seconds: number | null;
      }>>`
        SELECT
          COUNT(*)::bigint as total_sessions,
          AVG(EXTRACT(EPOCH FROM ("expiresAt" - "createdAt"))) as avg_duration_seconds,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("expiresAt" - "createdAt"))) as median_duration_seconds,
          MAX(EXTRACT(EPOCH FROM ("expiresAt" - "createdAt"))) as max_duration_seconds
        FROM "Session"
        WHERE "createdAt" >= ${startDate}
      `,
      prisma.session.groupBy({
        by: ['userId'],
        where: { createdAt: { gte: startDate } },
        _count: {
          _all: true
        }
      }),
      prisma.message.groupBy({
        by: ['conversationId'],
        where: { createdAt: { gte: startDate } },
        _count: {
          _all: true
        }
      }),
      prisma.message.groupBy({
        by: ['senderId'],
        where: { createdAt: { gte: startDate } },
        _count: {
          _all: true
        }
      }),
      prisma.lastSearch.count({ where: { updatedAt: { gte: startDate } } }),
      prisma.lastSearch.count({ where: { updatedAt: { gte: startDate }, lat: { not: null }, lng: { not: null } } }),
      prisma.lastSearch.aggregate({
        _avg: {
          distanceKm: true
        },
        where: {
          updatedAt: { gte: startDate },
          distanceKm: { not: null }
        }
      }),
      prisma.riderProfile.count({ where: { lat: { not: null }, lng: { not: null }, user: { deletedAt: null } } }),
      prisma.proOffer.count({ where: { isActive: true } }),
      prisma.profileReport.count({ where: { createdAt: { gte: startDate } } }),
      prisma.profileReport.groupBy({
        by: ['reason'],
        where: { createdAt: { gte: startDate } },
        _count: {
          _all: true
        }
      })
    ]);

    const sessionSummary = sessionSummaryRaw?.[0];
    const totalSessions = Number(sessionSummary?.total_sessions ?? 0);
    const avgSessionDuration = sessionSummary?.avg_duration_seconds ? Number(sessionSummary.avg_duration_seconds) : 0;
    const medianSessionDuration = sessionSummary?.median_duration_seconds ? Number(sessionSummary.median_duration_seconds) : 0;
    const maxSessionDuration = sessionSummary?.max_duration_seconds ? Number(sessionSummary.max_duration_seconds) : 0;

    const uniqueSessionUsers = sessionsPerUser.length;
    const totalSessionsComputed = sessionsPerUser.reduce(
      (sum: number, entry: Prisma.SessionGroupByOutputType) => sum + (entry._count?._all ?? 0),
      0
    );
    const avgSessionsPerUser = uniqueSessionUsers > 0 ? totalSessionsComputed / uniqueSessionUsers : 0;

    const sessionDistributionMap = new Map<number, number>();
    for (const entry of sessionsPerUser) {
      const count = entry._count?._all ?? 0;
      sessionDistributionMap.set(count, (sessionDistributionMap.get(count) ?? 0) + 1);
    }

    const sessionDistribution = Array.from(sessionDistributionMap.entries())
      .sort((a, b) => a[0] - b[0])
      .slice(0, 10)
      .map(([sessions, users]) => ({ sessions, users }));

    const totalMessages = messageByConversation.reduce(
      (sum: number, item: Prisma.MessageGroupByOutputType) => sum + (item._count?._all ?? 0),
      0
    );
    const activeConversations = messageByConversation.length;
    const avgMessagesPerConversation = activeConversations > 0 ? totalMessages / activeConversations : 0;

    const uniqueMessageSenders = messageSenders.length;
    const avgMessagesPerSender = uniqueMessageSenders > 0 ? totalMessages / uniqueMessageSenders : 0;

    const uniqueRiderDecisionActors = riderDecisionActors.length;
    const uniqueRiderMessagingSenders = riderMessagingSenders.length;

    const searchDistanceAverage = searchDistanceAverageRaw._avg?.distanceKm
      ? Number(searchDistanceAverageRaw._avg.distanceKm)
      : null;

    const behaviorAnalytics = {
      period,
      userJourney: {
        totals: {
          users: totalUsers,
          riders: totalRiders,
          pros: totalPros
        },
        riders: {
          profileCreated: riderProfiles,
          displayName: ridersWithDisplayName,
          disciplines: ridersWithDiscipline,
          photo: ridersWithPhoto,
          onboardingComplete: ridersCompletedOnboarding,
          searchConfigured: ridersWithSearch,
          recentNewUsers: newRidersInPeriod,
          recentProfiles: newRiderProfilesInPeriod,
          recentDisciplines: newRidersWithDisciplineInPeriod,
          recentPhotoUpdates: newRidersWithPhotoInPeriod,
          recentDecisions: uniqueRiderDecisionActors,
          recentMessagers: uniqueRiderMessagingSenders
        },
        pros: {
          profileCreated: proProfiles,
          offersPublished: prosWithOffers,
          verified: prosVerified,
          recentNewUsers: newProsInPeriod,
          recentProfiles: newProProfilesInPeriod,
          recentOffers: newProsWithOfferInPeriod
        }
      },
      sessions: {
        totalSessions,
        uniqueUsers: uniqueSessionUsers,
        avgSessionsPerUser,
        avgDurationSeconds: avgSessionDuration,
        medianDurationSeconds: medianSessionDuration,
        maxDurationSeconds: maxSessionDuration,
        distribution: sessionDistribution
      },
      featureUsage: {
        messaging: {
          totalMessages,
          activeConversations,
          uniqueSenders: uniqueMessageSenders,
          avgMessagesPerConversation,
          avgMessagesPerSender
        },
        geolocation: {
          ridersWithLocation: Number(riderProfilesWithGeo),
          searchesWithGeo,
          activeOffers: Number(activeOffersCount),
          geoSearchRate: searchesRecent > 0 ? (searchesWithGeo / searchesRecent) * 100 : 0
        },
        search: {
          totalSearchUpdates: searchesRecent,
          geoSearches: searchesWithGeo,
          avgDistanceKm: searchDistanceAverage,
          uniqueSearchers: searchesRecent, // LastSearch est unique par user
          period
        }
      },
      support: {
        totalReports: reportsTotal,
        reportsByReason: reportsByReason.map((item: Prisma.ProfileReportGroupByOutputType) => ({
          reason: item.reason ?? 'Autre',
          count: item._count?._all ?? 0
        }))
      }
    };

    return res.json(behaviorAnalytics);
  } catch (error) {
    console.error('Analytics behavior error:', error);
    return res.status(500).json({ error: 'Internal error' });
  }
});

// ===== ENDPOINTS RGPD =====

// Rapport de conformité RGPD
adminRouter.get(
  '/gdpr/compliance-report',
  requirePermissions('system.configure'),
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
    console.error('GDPR compliance report error:', error);
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Exécution manuelle de la purge RGPD
adminRouter.post(
  '/gdpr/run-purge',
  requirePermissions('system.configure'),
  audit('admin:gdpr:run-purge', () => 'gdpr:purge'),
  async (req, res) => {
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
    console.error('Manual GDPR purge error:', error);
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
    console.error('Legal archive search error:', error);
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
    console.error('Admin audit logs error:', error);
    return res.status(500).json({ error: 'Internal error' });
  }
});

// GDPR Exports Monitoring Dashboard
adminRouter.get(
  '/gdpr/exports',
  requirePermissions('system.configure'),
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
    const limitNum = parseInt(limit as string, 10);
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
    });

    const topExportersWithEmails = await Promise.all(
      topExporters.map(async (item: Prisma.AuditLogGroupByOutputType) => {
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
    console.error('GDPR exports monitoring error:', error);
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
    const exports = await prisma.auditLog.findMany({
      where: {
        userId,
        action: 'GDPR_EXPORT_REQUESTED',
      },
      orderBy: { createdAt: 'desc' },
    });

    const formattedExports = exports.map((log: Prisma.AuditLog) => {
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
      totalExports: exports.length,
    });
  } catch (error) {
    console.error('GDPR user exports error:', error);
    return res.status(500).json({ error: 'Internal error' });
  }
});
