import { Router } from 'express';
import { z } from 'zod';
import { clientPrisma as prisma } from '@blobinfini/database';
import { requireAuth } from '../auth/auth.guard';

export const creditsRouter = Router();

const WELCOME_BONUS_AMOUNT = 100; // 100 crédits de bienvenue pour le MVP

// Service pour gérer les transactions de crédits de manière atomique
async function addCredits(
  userId: string,
  amount: number,
  type: string,
  description?: string,
  metadata?: any
) {
  return await prisma.$transaction(async (tx) => {
    // Récupérer ou créer le wallet
    let wallet = await tx.userWallet.findUnique({ where: { userId } });
    if (!wallet) {
      wallet = await tx.userWallet.create({
        data: { userId, balance: 0 }
      });
    }

    const balanceBefore = Number(wallet.balance);
    const balanceAfter = balanceBefore + amount;

    // Créer la transaction
    const transaction = await tx.creditTransaction.create({
      data: {
        userId,
        type: type as any,
        amount,
        balanceBefore,
        balanceAfter,
        description,
        metadata
      }
    });

    // Mettre à jour le solde
    wallet = await tx.userWallet.update({
      where: { userId },
      data: { balance: balanceAfter }
    });

    return { wallet, transaction };
  });
}

// Récupérer le solde et les dernières transactions
creditsRouter.get('/wallet', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // Récupérer ou créer le wallet
    let wallet = await prisma.userWallet.findUnique({
      where: { userId }
    });

    if (!wallet) {
      wallet = await prisma.userWallet.create({
        data: { userId, balance: 0 }
      });
    }

    // Récupérer les 20 dernières transactions
    const transactions = await prisma.creditTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20
    });

    return res.json({
      wallet: {
        balance: Number(wallet.balance),
        createdAt: wallet.createdAt,
        updatedAt: wallet.updatedAt
      },
      transactions: transactions.map(t => ({
        id: t.id,
        type: t.type,
        amount: Number(t.amount),
        balanceBefore: Number(t.balanceBefore),
        balanceAfter: Number(t.balanceAfter),
        description: t.description,
        metadata: t.metadata,
        createdAt: t.createdAt
      }))
    });
  } catch (err) {
    console.error('Error fetching wallet:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Récupérer l'historique complet des transactions (avec pagination)
creditsRouter.get('/transactions', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      prisma.creditTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit
      }),
      prisma.creditTransaction.count({ where: { userId } })
    ]);

    return res.json({
      transactions: transactions.map(t => ({
        id: t.id,
        type: t.type,
        amount: Number(t.amount),
        balanceBefore: Number(t.balanceBefore),
        balanceAfter: Number(t.balanceAfter),
        description: t.description,
        metadata: t.metadata,
        createdAt: t.createdAt
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error('Error fetching transactions:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Offrir le bonus de bienvenue (appelé automatiquement lors de la première connexion)
creditsRouter.post('/welcome-bonus', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // Vérifier si l'utilisateur a déjà reçu le bonus de bienvenue
    const existingBonus = await prisma.creditTransaction.findFirst({
      where: {
        userId,
        type: 'WELCOME_BONUS'
      }
    });

    if (existingBonus) {
      return res.status(400).json({ error: 'Welcome bonus already claimed' });
    }

    // Ajouter le bonus de bienvenue
    const result = await addCredits(
      userId,
      WELCOME_BONUS_AMOUNT,
      'WELCOME_BONUS',
      `Bonus de bienvenue - Merci de rejoindre Blobinfini ! 🎉`,
      { isFirstTimeUser: true }
    );

    return res.status(201).json({
      message: 'Bonus de bienvenue ajouté !',
      wallet: {
        balance: Number(result.wallet.balance)
      },
      transaction: {
        id: result.transaction.id,
        type: result.transaction.type,
        amount: Number(result.transaction.amount),
        description: result.transaction.description,
        createdAt: result.transaction.createdAt
      }
    });
  } catch (err) {
    console.error('Error adding welcome bonus:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
});

// [ADMIN] Ajouter des crédits à un utilisateur (pour le MVP)
const adminGrantSchema = z.object({
  amount: z.number().min(1).max(1000),
  description: z.string().min(1).max(200).optional()
});

creditsRouter.post('/admin/grant/:userId', requireAuth, async (req, res) => {
  try {
    const adminUserId = (req as any).user?.id as string | undefined;
    if (!adminUserId) return res.status(401).json({ error: 'Unauthorized' });

    // Vérifier que l'utilisateur est admin (pour le MVP, on peut simplifier)
    const adminUser = await prisma.user.findUnique({
      where: { id: adminUserId },
      select: { role: true, email: true }
    });

    if (adminUser?.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const targetUserId = req.params.userId;
    const body = adminGrantSchema.parse(req.body);

    // Vérifier que l'utilisateur cible existe
    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { email: true }
    });

    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Ajouter les crédits
    const result = await addCredits(
      targetUserId,
      body.amount,
      'ADMIN_GRANT',
      body.description || `Crédits offerts par l'équipe Blobinfini`,
      { grantedBy: adminUserId, grantedByEmail: adminUser.email }
    );

    return res.status(201).json({
      message: `${body.amount} crédits ajoutés à ${targetUser.email}`,
      wallet: {
        balance: Number(result.wallet.balance)
      },
      transaction: {
        id: result.transaction.id,
        type: result.transaction.type,
        amount: Number(result.transaction.amount),
        description: result.transaction.description,
        createdAt: result.transaction.createdAt
      }
    });
  } catch (err: any) {
    console.error('Error granting credits:', err);
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', details: err.errors });
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Vérifier si l'utilisateur peut effectuer une transaction (solde suffisant)
creditsRouter.get('/can-spend/:amount', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const amount = Number(req.params.amount);
    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const wallet = await prisma.userWallet.findUnique({
      where: { userId },
      select: { balance: true }
    });

    const balance = Number(wallet?.balance || 0);
    const canSpend = balance >= amount;

    return res.json({
      canSpend,
      currentBalance: balance,
      requestedAmount: amount,
      remainingAfter: canSpend ? balance - amount : null
    });
  } catch (err) {
    console.error('Error checking spending ability:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
});