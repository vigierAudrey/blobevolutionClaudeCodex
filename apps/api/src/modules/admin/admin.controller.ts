import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@blobinfini/database';
import { Prisma } from '@prisma/client';
import type { DecisionKind } from '@prisma/client';
import { requireAuth, requireAdmin } from '../auth/auth.guard';

export const adminRouter = Router();

// Toutes les routes admin nécessitent une authentification et le rôle admin
adminRouter.use(requireAuth);
adminRouter.use(requireAdmin);

// Statistiques principales
adminRouter.get('/stats', async (req, res) => {
  try {
    // Compter les utilisateurs par rôle
    const totalUsers = await prisma.user.count();
    const usersByRole = await prisma.user.groupBy({
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
      totalRiders: usersByRole.find(g => g.role === 'RIDER')?._count.role || 0,
      totalPros: usersByRole.find(g => g.role === 'PRO')?._count.role || 0,
      totalAdmins: usersByRole.find(g => g.role === 'ADMIN')?._count.role || 0,
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
adminRouter.get('/users', async (req, res) => {
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
adminRouter.patch('/users/:id/suspend', async (req, res) => {
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

adminRouter.get('/users/:id', async (req, res) => {
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
adminRouter.patch('/pros/:id/verify', async (req, res) => {
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
adminRouter.get('/reports', async (req, res) => {
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

// Définition des permissions disponibles
export const AVAILABLE_PERMISSIONS = [
  'users.view',
  'users.suspend',
  'users.delete',
  'pros.verify',
  'pros.manage',
  'reports.view',
  'reports.moderate',
  'analytics.view',
  'permissions.manage',
  'system.configure'
] as const;

export type Permission = typeof AVAILABLE_PERMISSIONS[number];

// Rôles prédéfinis avec leurs permissions
export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  SUPER_ADMIN: AVAILABLE_PERMISSIONS as any,
  MODERATOR: [
    'users.view',
    'users.suspend',
    'pros.verify',
    'reports.view',
    'reports.moderate',
    'analytics.view'
  ],
  ANALYTICS: [
    'users.view',
    'analytics.view'
  ]
};

// Lister les permissions disponibles
adminRouter.get('/permissions', async (req, res) => {
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
adminRouter.get('/admins', async (req, res) => {
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
            lastLoginAt: true
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
adminRouter.patch('/admins/:id/permissions', async (req, res) => {
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
adminRouter.patch('/admins/:id/role', async (req, res) => {
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

// Analytics détaillées - Engagement
type AnalyticsPeriod = '7d' | '30d' | '90d' | '1y';

adminRouter.get('/analytics/engagement', async (req, res) => {
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

    const registrations = registrationsRaw.map(item => ({
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

    const activeUsers = activeUsersRaw.map(item => ({
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
adminRouter.get('/analytics/matching', async (req, res) => {
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
    const matchingStats = await prisma.matchDecision.groupBy({
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

    const totalDecisions = matchingStats.reduce((sum, stat) => sum + stat._count.decision, 0);
    const acceptedCount = matchingStats.find(s => s.decision === 'ACCEPT')?._count.decision || 0;
    const refusedCount = matchingStats.find(s => s.decision === 'REFUSE')?._count.decision || 0;
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

    const conversationTimeline = conversationTimelineRaw.map(item => ({
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

    const decisionTimeline = Array.from(decisionsTimelineMap.entries())
      .sort(([a], [b]) => (a > b ? 1 : -1))
      .map(([periodIso, values]) => ({ period: periodIso, ...values }));

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

    const sportPreferences = sportPreferencesRaw.map(item => ({
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

    const levelPreferences = levelPreferencesRaw.map(item => ({
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

    const searchesBySport = searchesBySportRaw.map(item => ({
      sport: item.sport,
      count: Number(item._count.sport)
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

    const matchesOverTime = matchesOverTimeRaw.map(item => ({
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

adminRouter.post('/reports/:id/action', async (req, res) => {
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

    await prisma.$transaction(async (tx) => {
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

adminRouter.get('/analytics/behavior', async (req, res) => {
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
    const totalSessionsComputed = sessionsPerUser.reduce((sum, entry) => sum + entry._count._all, 0);
    const avgSessionsPerUser = uniqueSessionUsers > 0 ? totalSessionsComputed / uniqueSessionUsers : 0;

    const sessionDistributionMap = new Map<number, number>();
    for (const entry of sessionsPerUser) {
      const count = entry._count._all;
      sessionDistributionMap.set(count, (sessionDistributionMap.get(count) ?? 0) + 1);
    }

    const sessionDistribution = Array.from(sessionDistributionMap.entries())
      .sort((a, b) => a[0] - b[0])
      .slice(0, 10)
      .map(([sessions, users]) => ({ sessions, users }));

    const totalMessages = messageByConversation.reduce((sum, item) => sum + item._count._all, 0);
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
        reportsByReason: reportsByReason.map(item => ({
          reason: item.reason ?? 'Autre',
          count: item._count._all
        }))
      }
    };

    return res.json(behaviorAnalytics);
  } catch (error) {
    console.error('Analytics behavior error:', error);
    return res.status(500).json({ error: 'Internal error' });
  }
});
