# 🗑️ GDPR Account Cleanup System

Système automatisé de nettoyage des comptes supprimés conformément au RGPD Article 17 (Droit à l'effacement).

> **📖 Voir aussi** : [GDPR_EXPORT_PSEUDONYMIZATION.md](./GDPR_EXPORT_PSEUDONYMIZATION.md) - Pseudonymisation des emails dans l'export GDPR (Article 5.1.c)

## 📋 Vue d'ensemble

Ce système implémente la **suppression finale** des comptes après la période de grâce de 30 jours conformément aux recommandations de la CNIL.

### Flux de suppression complet

```
1️⃣ Demande utilisateur
   └─> POST /profile/delete-account
       └─> Champ deletedAt rempli
           └─> Compte désactivé immédiatement

2️⃣ Période de grâce (30 jours)
   └─> L'utilisateur peut annuler
       └─> POST /profile/cancel-deletion
           └─> deletedAt remis à null

3️⃣ Après 30 jours (automatique)
   └─> Cron job quotidien (2h du matin)
       └─> Script cleanup-deleted-accounts.ts
           └─> Anonymisation des données
               └─> Log dans AuditLog
```

## 🔧 Architecture

### Fichiers

```
apps/api/
├── scripts/
│   ├── cleanup-deleted-accounts.ts  # Script principal de nettoyage
│   ├── cleanup-cron.sh             # Wrapper bash pour Docker
│   └── test-cleanup.sh             # Script de test en mode DRY-RUN
├── crontab                         # Configuration cron (2h quotidien)
├── Dockerfile.cron                 # Dockerfile pour service cron
└── logs/                           # Logs d'exécution (créé automatiquement)
    ├── cleanup-YYYY-MM-DD.log     # Logs quotidiens
    └── cron.log                    # Log général du cron
```

### Service Docker

Le service `api-cron` dans `docker-compose.yml` :
- Utilise Alpine Linux avec dcron
- Exécute quotidiennement à 2h du matin
- Logs persistants dans `./apps/api/logs`
- Accès à la base PostgreSQL
- Mode production par défaut

## 🚀 Utilisation

### Démarrer le service cron

```bash
# Construire et démarrer le service cron
docker-compose up -d api-cron

# Vérifier les logs
docker-compose logs -f api-cron

# Vérifier que le cron est actif
docker exec blobevolutionclaudecodex-api-cron-1 crontab -l
```

### Tester manuellement (recommandé avant production)

```bash
# Test en mode DRY-RUN (simulation, aucune modification)
cd apps/api
./scripts/test-cleanup.sh

# Test réel (modifie la base de données !)
DRY_RUN=false npx ts-node scripts/cleanup-deleted-accounts.ts
```

### Exécution manuelle immédiate

```bash
# Exécuter le cleanup immédiatement dans le conteneur
docker exec blobevolutionclaudecodex-api-cron-1 /app/scripts/cleanup-cron.sh
```

## 📊 Ce qui est anonymisé/supprimé

### Données anonymisées (conservées pour traçabilité)

- **Email** : `deleted_<userId>_<timestamp>@anonymized.blobsurf.com`
- **Password** : Remplacé par hash invalide `DELETED`
- **RiderProfile** :
  - `displayName` → `"Utilisateur supprimé"`
  - `bio` → `null`
  - `photoUrl` → `null`
  - `lat/lng/city` → `null`
- **ProProfile** :
  - `businessName` → `"Professionnel supprimé"`
  - `bio` → `null`
  - `photoUrl` → `null`

### Données supprimées définitivement

- ✅ Messages envoyés par l'utilisateur (contenu personnel)
- ✅ Tokens push (notifications)
- ✅ Tokens de vérification email
- ✅ Reset tokens (mot de passe)
- ✅ Refresh tokens (JWT)
- ✅ Sessions Redis (expiration automatique)

### Données conservées (obligations légales)

- ✅ **AuditLog** : Traçabilité complète pour conformité RGPD
  - Actions de suppression/annulation
  - Suppression finale avec metadata
- ✅ **Champ deletedAt** : Date de la demande initiale
- ✅ **Matches/Bookings** : Relations conservées (anonymisées)

## 🔐 Sécurité & Conformité

### RGPD

- ✅ **Article 17** : Droit à l'effacement respecté
- ✅ **Article 5(1)(e)** : Conservation limitée (30 jours + anonymisation)
- ✅ **Recommandation CNIL** : Période de grâce 30 jours
- ✅ **Traçabilité** : Logs d'audit conservés pour conformité

### Mode DRY-RUN

Pour tester sans risque :

```bash
export DRY_RUN=true
npx ts-node scripts/cleanup-deleted-accounts.ts
```

Le script affiche :
```
⚙️  Mode: SIMULATION (DRY-RUN)
[DRY-RUN] Would anonymize user abc123...
```

## 📝 Logs

### Logs quotidiens

Chaque exécution génère un log daté :

```
apps/api/logs/cleanup-2025-11-02.log
```

Contenu :
- ✅ Comptes trouvés et traités
- ✅ Statistiques (succès/erreurs)
- ✅ Détails de chaque anonymisation
- ✅ Horodatage complet

### Rétention des logs

Les logs sont **automatiquement nettoyés** après 30 jours par le script `cleanup-cron.sh`.

## 🧪 Tests

### Test manuel complet

```bash
# 1. Créer un compte test
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test123!"}'

# 2. Demander la suppression
curl -X POST http://localhost:4000/api/profile/delete-account \
  -H "Authorization: Bearer <TOKEN>"

# 3. Vérifier le statut
curl -X GET http://localhost:4000/api/profile/deletion-status \
  -H "Authorization: Bearer <TOKEN>"

# 4. Modifier deletedAt manuellement (pour test immédiat)
# Dans PostgreSQL :
UPDATE "User" SET "deletedAt" = NOW() - INTERVAL '31 days'
WHERE email = 'test@example.com';

# 5. Exécuter le cleanup en DRY-RUN
./scripts/test-cleanup.sh

# 6. Vérifier les logs
cat logs/cleanup-$(date +%Y-%m-%d).log
```

### Tests unitaires

TODO: Ajouter tests Jest pour `cleanup-deleted-accounts.ts`

```typescript
describe('GDPR Cleanup', () => {
  it('should find expired accounts', async () => {
    // Test logic
  });

  it('should anonymize user data', async () => {
    // Test logic
  });

  it('should skip already anonymized accounts', async () => {
    // Test logic
  });
});
```

## 🛠️ Configuration

### Variables d'environnement

```bash
# .env
DATABASE_URL=postgresql://...
NODE_ENV=production
DRY_RUN=false  # true pour simulation
```

### Modifier la fréquence d'exécution

Editer `apps/api/crontab` :

```cron
# Tous les jours à 2h du matin (par défaut)
0 2 * * * /app/scripts/cleanup-cron.sh

# Exemples alternatifs :
# Toutes les 6 heures : 0 */6 * * *
# Tous les lundis à 3h : 0 3 * * 1
# Chaque heure : 0 * * * *
```

Puis reconstruire le service :

```bash
docker-compose up -d --build api-cron
```

## 🚨 Troubleshooting

### Le cron ne s'exécute pas

```bash
# Vérifier que le service tourne
docker ps | grep api-cron

# Vérifier les logs du conteneur
docker logs blobevolutionclaudecodex-api-cron-1

# Vérifier que cron est actif
docker exec blobevolutionclaudecodex-api-cron-1 ps aux | grep cron

# Tester manuellement
docker exec blobevolutionclaudecodex-api-cron-1 /app/scripts/cleanup-cron.sh
```

### Erreur "Prisma Client not generated"

```bash
# Reconstruire le conteneur
docker-compose build api-cron
docker-compose up -d api-cron
```

### Les logs ne sont pas créés

```bash
# Vérifier les permissions
ls -la apps/api/logs/

# Créer le dossier manuellement si nécessaire
mkdir -p apps/api/logs
chmod 755 apps/api/logs
```

## 📈 Monitoring

### Vérifier les exécutions

```bash
# Voir les dernières exécutions
tail -f apps/api/logs/cron.log

# Compter les comptes traités aujourd'hui
grep "Traités avec succès" apps/api/logs/cleanup-$(date +%Y-%m-%d).log
```

### Alertes recommandées

- ⚠️ Si `errors > 0` dans les logs
- ⚠️ Si le script ne s'exécute pas pendant 24h+
- ⚠️ Si beaucoup de comptes expirés s'accumulent

## 🔄 Maintenance

### Nettoyage manuel des vieux logs

```bash
# Supprimer logs de plus de 30 jours
find apps/api/logs -name "cleanup-*.log" -mtime +30 -delete
```

### Mise à jour du script

1. Modifier `cleanup-deleted-accounts.ts`
2. Reconstruire le conteneur :
   ```bash
   docker-compose build api-cron
   docker-compose up -d api-cron
   ```

## 💰 Coût

**Totalement GRATUIT** ✅
- Utilise Docker local (pas de service cloud payant)
- Pas de limites d'exécution
- Logs stockés localement

## 📚 Ressources

- [RGPD Article 17 - Droit à l'effacement](https://www.cnil.fr/fr/reglement-europeen-protection-donnees/chapitre3#Article17)
- [Recommandations CNIL sur la suppression](https://www.cnil.fr/fr/les-durees-de-conservation-des-donnees)
- [Docker Cron Best Practices](https://docs.docker.com/config/containers/multi-service_container/)

---

**Dernière mise à jour** : 2 novembre 2025
**Auteur** : Équipe Blob
**Conformité** : RGPD + CNIL
