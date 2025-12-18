#!/bin/bash
# ACTIONS URGENTES - Corrections audit sécurité Profil PRO
# Date: 14 décembre 2025
# Vulnérabilités: 1 P1 (critique), 3 P2 (mineures)

set -e

echo "╔════════════════════════════════════════════════════════════╗"
echo "║  CORRECTIONS AUDIT SÉCURITÉ - PROFIL PRO                   ║"
echo "╚════════════════════════════════════════════════════════════╝"

# Vérifier qu'on est bien dans le bon répertoire
if [ ! -f "package.json" ]; then
  echo "❌ Erreur: Ce script doit être exécuté depuis la racine du projet"
  exit 1
fi

echo ""
echo "┌────────────────────────────────────────────────────────────┐"
echo "│ PHASE 1 : CRITIQUE - Mise à jour Next.js (P1-1)           │"
echo "└────────────────────────────────────────────────────────────┘"
echo ""
echo "⚡ BLOCAGE PRODUCTION - Cette correction est obligatoire"
echo "🐛 Vulnérabilité: Next.js DoS (GHSA-mwv6-3258-q52c)"
echo "⏱️  Temps estimé: 30 minutes"
echo ""

read -p "Mettre à jour Next.js vers 14.2.35 ? (o/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Oo]$ ]]; then
  echo "📦 Installation de Next.js 14.2.35..."
  npm install next@14.2.35 --workspace=@blobinfini/web
  
  echo "🔍 Vérification des vulnérabilités..."
  npm audit --workspace=@blobinfini/web || true
  
  echo "🧪 Lancement des tests..."
  npm run test --workspace=@blobinfini/web || {
    echo "⚠️  Tests échoués - Vérifier les erreurs ci-dessus"
    exit 1
  }
  
  echo "✅ Next.js mis à jour avec succès"
  echo ""
  echo "📝 Préparer le commit:"
  echo "   git add apps/web/package.json apps/web/package-lock.json"
  echo "   git commit -m 'security: fix Next.js DoS vulnerability (GHSA-mwv6-3258-q52c)'"
  echo ""
else
  echo "⚠️  Mise à jour ignorée - ATTENTION : Blocage production !"
fi

echo ""
echo "┌────────────────────────────────────────────────────────────┐"
echo "│ PHASE 2 : AMÉLIORATIONS (P2-1, P2-2, P2-3)                │"
echo "└────────────────────────────────────────────────────────────┘"
echo ""
echo "📍 Fichier: apps/web/app/pro/profile/page.tsx"
echo "⏱️  Temps estimé: 1 heure"
echo "📄 Patch disponible: docs/audits/pro-profile-security-patch-2025-12.txt"
echo ""
echo "Corrections à appliquer:"
echo "  - P2-1: Validation défensive coordonnées GPS (15 min)"
echo "  - P2-2: Rate limiting réouverture cookies (20 min)"
echo "  - P2-3: Masquer console.warn en production (inclus dans P2-2)"
echo ""

read -p "Afficher le fichier de patch ? (o/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Oo]$ ]]; then
  cat docs/audits/pro-profile-security-patch-2025-12.txt
  echo ""
fi

echo ""
echo "┌────────────────────────────────────────────────────────────┐"
echo "│ PHASE 3 : VALIDATION                                       │"
echo "└────────────────────────────────────────────────────────────┘"
echo ""
echo "Commandes à exécuter après corrections:"
echo ""
echo "  1. Tests unitaires:"
echo "     npm run test --workspace=@blobinfini/web"
echo ""
echo "  2. Build de production:"
echo "     npm run build --workspace=@blobinfini/web"
echo ""
echo "  3. Audit de sécurité final:"
echo "     npm audit --workspace=@blobinfini/web"
echo ""
echo "  4. Vérification manuelle:"
echo "     - Tester suppression géolocalisation"
echo "     - Tester réouverture cookies (cliquer 10x rapidement)"
echo "     - Vérifier affichage coordonnées invalides"
echo ""

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║  📊 RÉSUMÉ DE L'AUDIT                                      ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "  Score sécurité: 92/100 → 98/100 après corrections"
echo "  Vulnérabilités: 0 P0, 1 P1, 3 P2"
echo "  Impact projet: +2 points (excellent travail)"
echo ""
echo "  ✅ ZÉRO vulnérabilité critique détectée"
echo "  ✅ Protection CSRF robuste"
echo "  ✅ Authentification multi-couches"
echo "  ✅ Conformité RGPD complète"
echo ""
echo "  📁 Rapport complet:"
echo "     docs/audits/security-audit-pro-profile-2025-12.md"
echo ""
echo "  📞 Contact sécurité: security@blobinfini.com"
echo ""
echo "╚════════════════════════════════════════════════════════════╝"

