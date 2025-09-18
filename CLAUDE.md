# 🤖 Guide de développement Claude - Blobinfini

## 📋 Changements récents importants

### Suppression du champ `partnerPref` (Sept 2025)

**Décision produit** : Simplification du matching en supprimant le critère de préférence de partenaire.

**Changements appliqués :**
- ❌ Supprimé le champ `partnerPref` du modèle `RiderProfile`
- ❌ Supprimé le champ `partner` du modèle `LastSearch`
- ❌ Supprimé complètement l'enum `PartnerPref`
- ✅ Conservé le champ `sex` pour identifier le sexe de l'individu
- 🔄 Mis à jour tous les controllers, tests et le seed
- 📊 Base de données migrée avec `prisma db push`

**Avant :**
```prisma
model RiderProfile {
  // ...
  sex         Sex         @default(UNSPECIFIED)
  partnerPref PartnerPref @default(ALL)  // ❌ SUPPRIMÉ
  // ...
}

enum PartnerPref {  // ❌ SUPPRIMÉ COMPLÈTEMENT
  ALL
  WOMEN
  MEN
}
```

**Après :**
```prisma
model RiderProfile {
  // ...
  sex         Sex         @default(UNSPECIFIED)  // ✅ CONSERVÉ
  // partnerPref supprimé
  // ...
}
```

**Impact sur le matching :**
- Le matching se base maintenant uniquement sur : géolocalisation, sport, niveau, disponibilités
- Plus de filtrage par préférence de genre de partenaire
- Interface simplifiée pour les utilisateurs

### Affichage de la date sélectionnée (Sept 2025)

**Décision produit** : Afficher la date sélectionnée dans les cartes de profils sans l'utiliser dans l'algorithme de matching.

**Changements appliqués :**
- ✅ Ajout de la fonction `formatDateForDisplay()` dans `/apps/web/app/matching/cards/page.tsx`
- ✅ Affichage de la date avec icône 📅 dans chaque carte de profil
- ✅ Formatage intelligent : "Aujourd'hui", "Demain", "Peu importe", ou date formatée

**Comportement :**
- La date sélectionnée est visible dans chaque carte de profil
- Format d'affichage : "Aujourd'hui", "Demain", "Peu importe" ou "mer. 18 sept"
- La date n'influence PAS l'algorithme de recherche (uniquement affichage)
- Permet aux utilisateurs de se rappeler de leur sélection lors du swipe

## 🛠 Commandes essentielles

```bash
# Développement
npm run dev:all         # Lance API (port 4000) + Frontend (port 3002)
npm run dev:api          # API seulement
npm run dev:web          # Frontend seulement

# Base de données
npm run db:migrate       # Applique les migrations
npm run db:seed          # Charge les données de test
npm run db:reset         # Reset complet (drop + migrate + seed)
npm run db:studio        # Interface admin Prisma

# Build et tests
npm run build           # Build de production
npm run type-check      # Vérification TypeScript
```

## 👥 Comptes de test disponibles

Après `npm run db:seed` :

- **20 riders** : `dev+rider1@test.com` à `dev+rider20@test.com`
- **5 pros** : `dev+pro1@test.com` à `dev+pro5@test.com`
- **1 admin** : `dev+admin@test.com`
- **Mot de passe pour tous** : `Passw0rd!`

## 🏗 Architecture actuelle

- **Frontend** : Next.js 14 + TypeScript (port 3002)
- **API** : Express + TypeScript (port 4000)
- **Base de données** : PostgreSQL + Prisma ORM
- **Temps réel** : Socket.io pour le chat
- **Auth** : JWT + Refresh tokens

## 📝 Conventions de code

- **TypeScript strict** partout
- **Validation Zod** sur tous les inputs API
- **Prisma ORM** pour toutes les requêtes DB (pas de SQL brut)
- **Tests** obligatoires pour nouvelles fonctionnalités
- **RGPD** : soft delete, chiffrement données sensibles

## 🚨 Points d'attention

- Toujours tester après changements de schéma : `npm run build && npm run type-check`
- Utiliser `prisma db push` pour appliquer les changements de schéma en dev
- Relancer le seed après changements majeurs : `npm run db:reseed`
- Les serveurs dev tournent en arrière-plan, vérifier les logs si problèmes

## 🔄 Workflow type pour modifications

1. Modifier le schéma Prisma si nécessaire
2. `npm run db:push` pour appliquer à la DB
3. Mettre à jour les controllers/services
4. Corriger les tests
5. `npm run build && npm run type-check`
6. `npm run db:reseed` si nouvelles données nécessaires