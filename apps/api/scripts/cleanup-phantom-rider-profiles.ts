/**
 * Script de nettoyage des profils RIDER fantômes
 *
 * Ce script supprime les RiderProfile appartenant à des utilisateurs avec role='PRO'
 * Ces profils ne devraient pas exister car un PRO ne doit pas avoir de riderProfile.
 *
 * IMPORTANT : Exécuter ce script APRÈS avoir corrigé les failles de sécurité dans profile.controller.ts
 *
 * Usage:
 *   npm run cleanup:phantom-riders (dry-run)
 *   npm run cleanup:phantom-riders -- --force (suppression réelle)
 */

import { clientPrisma as prisma } from '@blobinfini/database';

async function main() {
  const isDryRun = !process.argv.includes('--force');

  console.log('🔍 Recherche de profils RIDER appartenant à des PRO...\n');

  // Vérifier les PRO ayant un riderProfile
  const phantomProfiles = await prisma.riderProfile.findMany({
    where: {
      user: {
        role: 'PRO'
      }
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          role: true,
          createdAt: true
        }
      }
    }
  });

  if (phantomProfiles.length === 0) {
    console.log('✅ Aucun profil RIDER fantôme trouvé. Base de données propre !');
    return;
  }

  console.log(`⚠️  ${phantomProfiles.length} profil(s) RIDER fantôme(s) trouvé(s) :\n`);

  // Afficher les détails
  phantomProfiles.forEach((profile, index) => {
    console.log(`${index + 1}. RiderProfile ID: ${profile.id}`);
    console.log(`   User ID: ${profile.user.id}`);
    console.log(`   Email: ${profile.user.email}`);
    console.log(`   Role: ${profile.user.role}`);
    console.log(`   Créé le: ${profile.createdAt.toISOString()}`);
    console.log(`   displayName: ${profile.displayName || 'N/A'}`);
    console.log(`   Location: ${profile.lat ? `(${profile.lat}, ${profile.lng})` : 'N/A'}`);
    console.log('');
  });

  // Vérifier les disciplines associées
  const disciplinesCount = await prisma.riderDiscipline.count({
    where: {
      profile: {
        userId: {
          in: phantomProfiles.map(p => p.userId)
        }
      }
    }
  });

  if (disciplinesCount > 0) {
    console.log(`⚠️  ${disciplinesCount} discipline(s) associée(s) seront également supprimée(s)\n`);
  }

  if (isDryRun) {
    console.log('\n🔒 MODE DRY-RUN : Aucune donnée ne sera supprimée.');
    console.log('Pour effectuer la suppression réelle, exécutez :');
    console.log('  npm run cleanup:phantom-riders -- --force\n');
    return;
  }

  // Confirmation avant suppression
  console.log('⚠️  ATTENTION : Vous êtes sur le point de supprimer ces profils !');
  console.log('Cette action est IRRÉVERSIBLE.\n');

  // En mode --force, on supprime
  console.log('🗑️  Suppression des profils fantômes...\n');

  // Supprimer les disciplines d'abord (foreign key)
  if (disciplinesCount > 0) {
    const deletedDisciplines = await prisma.riderDiscipline.deleteMany({
      where: {
        profile: {
          userId: {
            in: phantomProfiles.map(p => p.userId)
          }
        }
      }
    });
    console.log(`✅ ${deletedDisciplines.count} discipline(s) supprimée(s)`);
  }

  // Supprimer les riderProfiles
  const deleted = await prisma.riderProfile.deleteMany({
    where: {
      userId: {
        in: phantomProfiles.map(p => p.userId)
      }
    }
  });

  console.log(`✅ ${deleted.count} profil(s) RIDER fantôme(s) supprimé(s)`);

  // Créer un audit log
  for (const profile of phantomProfiles) {
    await prisma.auditLog.create({
      data: {
        userId: profile.userId,
        action: 'PHANTOM_RIDER_PROFILE_DELETED',
        resource: 'RiderProfile',
        metadata: {
          riderProfileId: profile.id,
          reason: 'PRO user should not have RiderProfile',
          cleanupDate: new Date().toISOString(),
          email: profile.user.email
        },
        ip: 'script'
      }
    });
  }

  console.log(`✅ ${phantomProfiles.length} audit log(s) créé(s)`);
  console.log('\n✨ Nettoyage terminé avec succès !');
}

main()
  .catch((error) => {
    console.error('❌ Erreur lors du nettoyage:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
