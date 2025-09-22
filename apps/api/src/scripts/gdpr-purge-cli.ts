#!/usr/bin/env tsx

/**
 * CLI pour gestion RGPD
 *
 * Usage:
 *   npm run gdpr:report         # Rapport de conformité
 *   npm run gdpr:purge          # Purge complète
 *   npm run gdpr:archive <id>   # Recherche archive légale
 */

import { gdprPurgeService } from '../services/gdpr-purge.service';

async function main() {
  const command = process.argv[2];
  const argument = process.argv[3];

  console.log('🛡️  Blobinfini GDPR Management CLI\n');

  try {
    switch (command) {
      case 'report':
        console.log('📊 Génération du rapport de conformité RGPD...\n');
        const report = await gdprPurgeService.getGDPRComplianceReport();

        console.log('=== RAPPORT DE CONFORMITÉ RGPD ===');
        console.log(`📅 Date: ${new Date().toISOString()}\n`);

        console.log('🔍 ÉTAT ACTUEL:');
        console.log(`• Sessions expirées: ${report.expiredSessionsCount}`);
        console.log(`• Tokens expirés: ${report.expiredTokensCount}`);
        console.log(`• Utilisateurs supprimés non anonymisés: ${report.unanonymizedDeletedUsers}`);
        console.log(`• Anciens utilisateurs (>10 ans) à archiver: ${report.oldDeletedUsersAwaitingPurge}`);
        console.log(`• Conversations trasher anciennes: ${report.trashedConversationsOld}\n`);

        const isCompliant =
          report.expiredSessionsCount === 0 &&
          report.expiredTokensCount === 0 &&
          report.unanonymizedDeletedUsers < 10 &&
          report.oldDeletedUsersAwaitingPurge < 5;

        if (isCompliant) {
          console.log('✅ CONFORMITÉ: BONNE');
          console.log('   Le système respecte les exigences RGPD');
        } else {
          console.log('⚠️  CONFORMITÉ: À AMÉLIORER');
          console.log('   Recommandation: Exécuter `npm run gdpr:purge`');
        }

        console.log('\n🛡️  PROTECTION JURIDIQUE:');
        console.log('• Archive légale: ACTIVE');
        console.log('• Rétention preuves: 10 ans');
        console.log('• Anonymisation: 7j → 2ans → archivage');
        break;

      case 'purge':
        console.log('🧹 Exécution de la purge RGPD complète...\n');

        const result = await gdprPurgeService.performFullPurge();

        console.log('=== RÉSULTAT DE LA PURGE ===');
        console.log(`📅 Exécutée: ${new Date().toISOString()}\n`);

        console.log('🔧 DONNÉES TECHNIQUES:');
        console.log(`• Sessions supprimées: ${result.technicalData.sessionsDeleted}`);
        console.log(`• Tokens supprimés: ${result.technicalData.tokensDeleted}`);
        console.log(`• Logs anciens supprimés: ${result.technicalData.oldLogsDeleted}\n`);

        console.log('👤 ANONYMISATION UTILISATEURS:');
        console.log(`• Phase 1 (profils détaillés): ${result.userAnonymization.phase1Anonymized}`);
        console.log(`• Phase 2 (emails anonymisés): ${result.userAnonymization.phase2Anonymized}`);
        console.log(`• Phase 3 (archivage légal): ${result.userAnonymization.phase3Purged}\n`);

        console.log('🔗 DONNÉES RELATIONNELLES:');
        console.log(`• Conversations supprimées: ${result.relationalData.conversationsDeleted}`);
        console.log(`• Matches supprimés: ${result.relationalData.matchesDeleted}`);
        console.log(`• Recherches anciennes: ${result.relationalData.oldSearchesDeleted}\n`);

        console.log(`✅ ${result.summary}`);
        break;

      case 'archive':
        if (!argument) {
          console.log('❌ Usage: npm run gdpr:archive <user_id>');
          process.exit(1);
        }

        console.log(`🔍 Recherche archive légale pour l'utilisateur: ${argument}\n`);

        // Simulation de recherche dans l'archive légale
        // En production, ceci interrogerait la table legal_consent_archive
        console.log('=== RECHERCHE ARCHIVE LÉGALE ===');
        console.log('⚠️  Cette fonction nécessite une base de données connectée');
        console.log(`🔍 User ID recherché: ${argument}`);
        console.log('\n📋 INFORMATIONS:');
        console.log('• Cette recherche est réservée aux cas de litige');
        console.log('• Les données sont conservées pour protection juridique');
        console.log('• Consultez le panneau admin pour une recherche complète');
        break;

      default:
        console.log('❌ Commande inconnue. Commandes disponibles:');
        console.log('   npm run gdpr:report        # Rapport de conformité');
        console.log('   npm run gdpr:purge         # Purge complète');
        console.log('   npm run gdpr:archive <id>  # Recherche archive légale');
        process.exit(1);
    }

    console.log('\n🔒 RAPPEL JURIDIQUE:');
    console.log('• Les preuves de consentement sont conservées 10 ans');
    console.log('• Cette durée protège contre les litiges de responsabilité');
    console.log('• L\'anonymisation progressive respecte le RGPD');

  } catch (error) {
    console.error('❌ Erreur lors de l\'exécution:', error);
    process.exit(1);
  }
}

// Ne pas exécuter en mode test
if (process.env.NODE_ENV !== 'test') {
  main();
}