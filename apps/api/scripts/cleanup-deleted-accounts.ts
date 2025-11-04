#!/usr/bin/env ts-node
/**
 * Cron job pour suppression finale des comptes après 30 jours
 * Conformité RGPD Article 17 (Droit à l'effacement)
 *
 * Exécution recommandée : Quotidien à 2h du matin
 * Cron expression : 0 2 * * *
 */

import { clientPrisma as prisma } from '@blobinfini/database';

// Constantes
const GRACE_PERIOD_DAYS = 30;
const DRY_RUN = process.env.DRY_RUN === 'true'; // Mode simulation

interface DeletedAccount {
  id: string;
  email: string;
  role: string;
  deletedAt: Date;
}

/**
 * Anonymise les données personnelles d'un utilisateur
 * Conserve les données nécessaires pour les obligations légales
 */
async function anonymizeUserData(userId: string, email: string, role: string) {
  const timestamp = Date.now();
  const anonymizedEmail = `deleted_${userId.substring(0, 8)}_${timestamp}@anonymized.blobinfini.com`;

  console.log(`📝 Anonymisation compte: ${email} (${role})`);

  if (DRY_RUN) {
    console.log(`   [DRY-RUN] Would anonymize user ${userId}`);
    return;
  }

  try {
    // 1. Anonymiser le compte utilisateur principal
    await prisma.user.update({
      where: { id: userId },
      data: {
        email: anonymizedEmail,
        password: 'DELETED', // Hash invalide pour empêcher connexion
        emailVerified: false,
        twoFactorEnabled: false,
        // On conserve deletedAt pour traçabilité
      },
    });

    // 2. Anonymiser profil rider si existe
    const riderProfile = await prisma.riderProfile.findUnique({
      where: { userId },
    });

    if (riderProfile) {
      await prisma.riderProfile.update({
        where: { userId },
        data: {
          displayName: 'Utilisateur supprimé',
          bio: null,
          photoUrl: null,
          lat: null,
          lng: null,
        },
      });
    }

    // 3. Anonymiser profil pro si existe
    const proProfile = await prisma.proProfile.findUnique({
      where: { userId },
    });

    if (proProfile) {
      await prisma.proProfile.update({
        where: { userId },
        data: {
          businessName: 'Professionnel supprimé',
          bio: null,
          photoUrl: null,
        },
      });
    }

    // 4. Supprimer messages envoyés (contenu personnel)
    const deletedMessages = await prisma.message.deleteMany({
      where: { senderId: userId },
    });
    console.log(`   🗑️  Supprimé ${deletedMessages.count} messages`);

    // 5. Supprimer tokens de vérification email
    await prisma.emailVerificationToken.deleteMany({
      where: { userId },
    });

    // 6. Supprimer reset tokens
    await prisma.passwordResetToken.deleteMany({
      where: { userId },
    });

    // 7. Supprimer refresh tokens
    await prisma.refreshToken.deleteMany({
      where: { userId },
    });

    // 8. Supprimer sessions
    await prisma.session.deleteMany({
      where: { userId },
    });

    // Note: Les sessions Redis expireront automatiquement

    // 9. Logger la suppression finale dans AuditLog
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'ACCOUNT_PERMANENTLY_DELETED',
        resource: 'User',
        metadata: {
          originalEmail: email,
          role,
          anonymizedEmail,
          deletionCompletedAt: new Date().toISOString(),
          gracePeriodDays: GRACE_PERIOD_DAYS,
        },
        ip: 'CRON_JOB',
      },
    });

    console.log(`   ✅ Compte anonymisé avec succès`);
  } catch (error) {
    console.error(`   ❌ Erreur lors de l'anonymisation:`, error);
    throw error;
  }
}

/**
 * Trouve et traite tous les comptes éligibles à la suppression
 */
async function processExpiredAccounts() {
  const now = new Date();
  const cutoffDate = new Date(now.getTime() - GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);

  console.log(`\n🕒 Recherche des comptes supprimés avant le ${cutoffDate.toISOString()}`);
  console.log(`📅 Date actuelle: ${now.toISOString()}`);
  console.log(`⚙️  Mode: ${DRY_RUN ? 'SIMULATION (DRY-RUN)' : 'PRODUCTION'}\n`);

  // Récupérer tous les comptes marqués pour suppression depuis plus de 30 jours
  const expiredAccounts = await prisma.user.findMany({
    where: {
      deletedAt: {
        lte: cutoffDate,
        not: null,
      },
      // S'assurer que le compte n'a pas déjà été anonymisé
      email: {
        not: {
          contains: '@anonymized.blobinfini.com',
        },
      },
    },
    select: {
      id: true,
      email: true,
      role: true,
      deletedAt: true,
    },
  });

  console.log(`📊 Trouvé ${expiredAccounts.length} compte(s) à traiter\n`);

  if (expiredAccounts.length === 0) {
    console.log('✅ Aucun compte à supprimer. Terminé.\n');
    return { processed: 0, errors: 0 };
  }

  let processed = 0;
  let errors = 0;

  for (const account of expiredAccounts) {
    const daysSinceDeletion = Math.floor(
      (now.getTime() - account.deletedAt!.getTime()) / (1000 * 60 * 60 * 24)
    );

    console.log(`\n📌 Compte: ${account.email}`);
    console.log(`   ID: ${account.id}`);
    console.log(`   Rôle: ${account.role}`);
    console.log(`   Supprimé il y a: ${daysSinceDeletion} jours`);

    try {
      await anonymizeUserData(account.id, account.email, account.role);
      processed++;
    } catch (error) {
      console.error(`❌ Échec traitement compte ${account.email}:`, error);
      errors++;
    }
  }

  console.log(`\n📊 Résumé:`);
  console.log(`   ✅ Traités avec succès: ${processed}`);
  console.log(`   ❌ Erreurs: ${errors}`);
  console.log(`   📋 Total: ${expiredAccounts.length}\n`);

  return { processed, errors };
}

/**
 * Point d'entrée principal
 */
async function main() {
  console.log('🚀 Démarrage du script de nettoyage des comptes supprimés\n');
  console.log('=' .repeat(60));

  try {
    const stats = await processExpiredAccounts();

    if (stats.errors > 0) {
      console.error(`\n⚠️  Script terminé avec ${stats.errors} erreur(s)`);
      process.exit(1);
    }

    console.log('\n✅ Script terminé avec succès');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Erreur fatale:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Exécuter le script
if (require.main === module) {
  main();
}

export { processExpiredAccounts, anonymizeUserData };
