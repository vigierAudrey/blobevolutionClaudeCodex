import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@blobinfini/database';
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
              displayName: true,
              user: {
                select: {
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