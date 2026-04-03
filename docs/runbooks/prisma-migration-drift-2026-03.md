# Runbook — Résolution du drift Prisma (2026-03)

**Incident** : chaîne de migration bloquée. `prisma migrate deploy` bloqué en production.  
**Statut** : résolu le 2026-04-03.  
**Auteur** : Audrey Vigier + Claude Code  

---

## 1. Cause racine

Usage de `prisma db push` en local pour appliquer des changements de schéma directement
en base, contournant le système de migrations.

**Séquence exacte :**

1. `prisma db push` applique la colonne `directKey` sur `Conversation` en local.
2. Plus tard, `prisma migrate dev` génère `20260313120000_add_direct_key_to_conversation`
   et essaie de l'exécuter — échec `42701: column "directKey" already exists`.
3. La migration est insérée dans `_prisma_migrations` avec `finished_at = NULL`,
   `applied_steps_count = 0`. Prisma bloque toutes les migrations suivantes.
4. Pour débloquer l'API en local, les 13 migrations suivantes sont appliquées directement
   via SQL/db push sans jamais être enregistrées dans `_prisma_migrations`.

**Pourquoi le CI ne l'a pas détecté :**  
Le CI démarre avec une DB vide. Sur une DB vide, `20260313120000` passe sans problème
car la colonne `directKey` n'existe pas encore. Le drift était purement local.

---

## 2. Migrations concernées

### Migration FAILED
| Nom | État initial | Raison |
|-----|-------------|--------|
| `20260313120000_add_direct_key_to_conversation` | FAILED (steps=0) | Colonne `directKey` déjà présente via `db push` |

### Migrations LOCAL_ONLY (absentes de `_prisma_migrations`, présentes en DB)
| Nom | Action SQL |
|-----|------------|
| `20260305113000_add_userconsent_created_at_index` | (stub — voir §3) |
| `20260305130000_enforce_proavailability_capacity_invariant` | ADD CONSTRAINT `ProAvailability_bookedCount_lte_capacity_check` |
| `20260305143000_add_booking_availability_status_index` | (stub — voir §3) |
| `20260313130000_add_client_msg_id_to_message` | ADD COLUMN `clientMsgId`, CREATE UNIQUE INDEX |
| `20260313140000_add_pro_availability_interaction` | CREATE TABLE `ProAvailabilityInteraction` |
| `20260313150000_add_user_consent_table` | CREATE TYPE + CREATE TABLE `UserConsent` |
| `20260315113000_chat_rate_limit_support_indexes` | CREATE INDEX × 3 |
| `20260319100000_add_profile_report_review_fields` | ADD COLUMN × 3 sur `ProfileReport` |
| `20260319110000_add_system_alert_occurrence_fields` | ADD COLUMN × 3 sur `SystemAlert` |
| `20260322120000_add_booking_legal_archive` | CREATE TABLE `BookingLegalArchive` |
| `20260324100000_add_booking_cancelled_at` | ADD COLUMN `cancelledAt` sur `Booking` |
| `20260329110000_add_pro_profile_country_code` | ADD COLUMN `countryCode` sur `ProProfile` |
| `20260402120000_add_rider_lesson_latlng` | ADD COLUMN `lessonLat`/`lessonLng` + CHECK + GIST index |

---

## 3. Pourquoi `resolve --applied` et pas un rollback

**Rollback SQL refusé** : aurait nécessité de `DROP COLUMN directKey` sur une table active,
puis de rejouer 13 migrations DDL potentiellement conflictuelles. Risque élevé, fenêtre
d'indisponibilité garantie.

**`prisma migrate resolve --applied` choisi** parce que :
- Tous les objets des 13 migrations étaient déjà présents en DB — seul le registre
  `_prisma_migrations` était désynchronisé.
- `resolve --applied` insère ou met à jour la ligne dans `_prisma_migrations` sans
  ré-exécuter le SQL. Idempotent, non-destructif, réversible.

---

## 4. Cas des deux stubs `SELECT 1` restants

### `20260305113000_add_userconsent_created_at_index`
- **Contenu** : `SELECT 1` (no-op)
- **Raison** : l'index `UserConsent_createdAt_idx` n'existe ni en prod ni dans le schéma
  Prisma actuel (probablement retiré du schéma après ajout). De plus, ce timestamp
  (`20260305`) est antérieur à la création de la table `UserConsent` (`20260313`) — tout
  SQL référençant cette table échouerait sur une DB vide au point d'application de cette
  migration. Le stub `SELECT 1` est la seule forme valide.
- **Impact** : aucun — l'index n'est pas requis par le schéma.

### `20260305143000_add_booking_availability_status_index`
- **Contenu** : `SELECT 1` (no-op)
- **Raison** : l'index ciblé (`Booking` sur colonnes `availabilityId + status`) n'existe
  ni en prod ni dans le schéma Prisma. Le nom de migration est trompeur : l'index n'a
  jamais été matérialisé.
- **Impact** : aucun.

### `20260305130000_enforce_proavailability_capacity_invariant`
- **Contenu initial** : `SELECT 1` (stub, contenait du contenu réel)
- **Restauré le 2026-04-03** avec le vrai SQL :
  `ADD CONSTRAINT "ProAvailability_bookedCount_lte_capacity_check" CHECK ("bookedCount" <= capacity)`
- **Raison de la restauration** : cette contrainte EXISTS en prod mais était absente de la
  migration initiale `20250918_booking_module`. Sans restauration, une DB vide déployée
  via `prisma migrate deploy` n'aurait pas cette contrainte d'intégrité critique.

---

## 5. Procédure de résolution (à reproduire si nécessaire)

```bash
# 1. Backup
docker exec <postgres-container> pg_dump -U postgres <dbname> > backup_$(date +%Y%m%d).sql

# 2. Résoudre la migration FAILED
pnpm --filter @blobinfini/database exec prisma migrate resolve --applied <migration_name>

# 3. Résoudre les migrations LOCAL_ONLY (absentes de _prisma_migrations)
#    Pour chaque migration dont les objets DB existent mais ne sont pas enregistrés :
pnpm --filter @blobinfini/database exec prisma migrate resolve --applied <migration_name>

# 4. Vérifier
pnpm --filter @blobinfini/database exec prisma migrate status
# Attendu : "Database schema is up to date!"

# 5. Preuve sur DB vide
#    Créer une DB de test, activer PostGIS, puis :
DATABASE_URL="postgresql://.../<test_db>" \
  pnpm --filter @blobinfini/database exec prisma migrate deploy
# Attendu : toutes les migrations appliquées, aucune erreur.
```

---

## 6. Prévention — ce qui a changé

| Barrière | État avant | État après |
|----------|------------|------------|
| `prisma db push` bloqué en CI (workflows) | ✅ `ci-block-db-push.sh` | ✅ inchangé |
| `prisma db push` bloqué localement (script `db:push`) | ✅ `safe-db-push.mjs` | ✅ inchangé |
| Replay migrations sur DB vide en CI | ⚠️ advisory (`continue-on-error: true`) | ✅ **bloquant** (`migrate-deploy-fresh` job) |

**Règle opérationnelle** : ne jamais utiliser `db push` ou `psql` direct pour modifier
le schéma en dehors d'un test local isolé. Toute modification de schéma passe par
`prisma migrate dev` + commit du fichier SQL généré.

Si une migration échoue en local :
1. Identifier la cause (objet déjà présent → utiliser `IF NOT EXISTS` ou corriger le SQL).
2. Corriger le fichier de migration.
3. Rejouer via `prisma migrate dev`.
4. Ne jamais contourner via `db push` ou SQL direct.
