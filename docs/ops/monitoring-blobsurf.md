# Monitoring BlobSurf — Bêta Privée

Périmètre : VPS Hetzner Ubuntu, stack active `docker-compose.vps.yml` (`name: blobconnect-vps`).
Niveau : opérationnel minimal — pas de Loki/Grafana pour la bêta.

Note legacy : `docker-compose.blobsurf.yml` existe encore dans le dépôt pour historique,
mais ne doit pas être utilisé comme cible des commandes d'exploitation VPS actuelles.

---

## 1. Monitors UptimeRobot

Créer les 3 monitors suivants sur [uptimerobot.com](https://uptimerobot.com) (free tier suffisant) :

| # | Type | URL | Intervalle | Alerte |
|---|------|-----|------------|--------|
| 1 | HTTP(S) | `https://blobsurf.com` | 5 min | Email immédiat |
| 2 | HTTP(S) | `https://api.blobsurf.com/health` | 5 min | Email immédiat |
| 3 | HTTP(S) | `https://storage.blobsurf.com/minio/health/live` | 5 min | Email immédiat |

Configuration monitor API (`/health`) :
- Expected status code : `200`
- Keyword (optionnel) : `ok`
- Alert after : 1 échec (pas de grâce — la bêta est petite)

---

## 2. Logs Docker — commandes utiles

```bash
# Tous les services en temps réel
docker compose -f docker-compose.vps.yml logs -f

# API uniquement (pour les erreurs applicatives)
docker compose -f docker-compose.vps.yml logs -f api

# 500 dernières lignes de l'API
docker compose -f docker-compose.vps.yml logs --tail=500 api

# PostgreSQL
docker compose -f docker-compose.vps.yml logs --tail=200 postgres

# Redis
docker compose -f docker-compose.vps.yml logs --tail=200 redis

# Filtrer les erreurs dans les logs API
docker compose -f docker-compose.vps.yml logs api 2>&1 | grep -i '"level":"error"'

# Filtrer les accès 5xx
docker compose -f docker-compose.vps.yml logs api 2>&1 | grep '"event":"HTTP_ACCESS"' | grep '"status":5'
```

---

## 3. Surveillance disque

### Commandes de vérification

```bash
# Espace global
df -h /var/lib/docker

# Volumes Docker (données persistantes)
du -sh /var/lib/docker/volumes/blobconnect-vps_pgdata-vps/
du -sh /var/lib/docker/volumes/blobconnect-vps_miniodata-vps/
du -sh /var/lib/docker/volumes/blobconnect-vps_caddy-data/

# Répertoire des backups
du -sh ~/backups/blobsurf/
ls -lh ~/backups/blobsurf/
```

### Seuils d'alerte

| Seuil | Action |
|-------|--------|
| > 70% `/var/lib/docker` | Purger les images Docker inutilisées : `docker system prune -f` |
| > 80% `/var/lib/docker` | Augmenter le disque ou archiver les photos MinIO anciennes |
| > 90% | **CRITIQUE** — l'API peut commencer à rejeter les uploads |
| > 95% | **URGENCE** — PostgreSQL peut refuser d'écrire |

### Nettoyage des images Docker obsolètes

```bash
# Voir les images inutilisées
docker images -f dangling=true

# Nettoyer (safe — ne supprime pas les images des services actifs)
docker system prune -f --volumes=false
```

---

## 4. Runbook : API retourne des 500

1. **Vérifier les logs immédiats** :
   ```bash
   docker compose -f docker-compose.vps.yml logs --tail=100 api | grep '"level":"error"'
   ```

2. **Vérifier que PostgreSQL répond** :
   ```bash
   docker compose -f docker-compose.vps.yml exec postgres pg_isready -U "${POSTGRES_USER:-blobinfini_vps}"
   ```

3. **Vérifier que Redis répond** :
   ```bash
   docker compose -f docker-compose.vps.yml exec redis redis-cli -a "$REDIS_PASSWORD" ping
   ```

4. **Vérifier l'état des containers** :
   ```bash
   docker compose -f docker-compose.vps.yml ps
   ```

5. **Redémarrer l'API uniquement** (sans toucher DB/Redis) :
   ```bash
   docker compose -f docker-compose.vps.yml restart api
   # Attendre ~30s pour le healthcheck
   docker compose -f docker-compose.vps.yml ps api
   ```

6. Si le problème persiste → regarder si c'est une migration manquante :
   ```bash
   docker compose -f docker-compose.vps.yml run --rm api \
     sh -c "pnpm --filter @blobinfini/database exec prisma migrate status"
   ```

---

## 5. Runbook : upload photo échoue

1. **Vérifier MinIO** :
   ```bash
   docker compose -f docker-compose.vps.yml logs --tail=50 minio
   curl -sf https://storage.blobsurf.com/minio/health/live && echo "MinIO OK" || echo "MinIO KO"
   ```

2. **Vérifier l'espace disque** (upload = stockage physique) :
   ```bash
   df -h /var/lib/docker
   du -sh /var/lib/docker/volumes/blobconnect-vps_miniodata-vps/
   ```

3. **Vérifier les logs API pour les erreurs S3** :
   ```bash
   docker compose -f docker-compose.vps.yml logs api 2>&1 | grep -i "s3\|upload\|minio\|presign"
   ```

4. **Accéder à la console MinIO** (via tunnel SSH) :
   ```bash
   # Sur le VPS :
   ssh -L 9001:localhost:9001 user@vps-ip
   # Puis ouvrir http://localhost:9001 dans le navigateur
   ```

5. **Vérifier que le bucket existe** :
   ```bash
   docker compose -f docker-compose.vps.yml exec minio \
     mc ls "local/${S3_BUCKET:-blobinfini-vps}/" 2>/dev/null || echo "Bucket absent ou MinIO non configuré"
   ```

---

## 6. Backup — vérification manuelle

```bash
# Lancer un backup manuel immédiat
./scripts/backup-blobsurf.sh

# Valider le dernier backup (dry-run sur container éphémère)
LAST=$(ls -t ~/backups/blobsurf/blobsurf_vps_*.sql.gz 2>/dev/null | head -1)
[[ -n "$LAST" ]] && ./scripts/restore-blobsurf.sh "$LAST" || echo "Aucun backup trouvé"

# Lister les backups disponibles
ls -lh ~/backups/blobsurf/
```

### Cron recommandé (3h UTC)

Ajouter via `crontab -e` :

```cron
0 3 * * * DC_PROJECT=blobconnect-vps ENV_FILE=/home/audrey/blob-app/.env.vps BACKUP_DIR=$HOME/backups/blobsurf BACKUP_PREFIX=blobsurf_vps /home/audrey/blob-app/scripts/backup-blobsurf.sh >> $HOME/backups/blobsurf/cron.log 2>&1
```

---

## 7. Métriques internes API

```bash
# Snapshot des métriques (nécessite METRICS_INTERNAL_TOKEN)
METRICS_TOKEN=$(grep METRICS_INTERNAL_TOKEN /home/audrey/blob-app/.env.vps | cut -d= -f2)
curl -sf -H "X-Internal-Token: $METRICS_TOKEN" https://api.blobsurf.com/internal/metrics | python3 -m json.tool
```

Champs utiles : `http.requests_total`, `http.errors_5xx_total`, `http.error_5xx_rate`, `http.latency_p95_ms`.

---

## 8. Contacts et escalade

| Situation | Action |
|-----------|--------|
| API down > 5 min | Redémarrer API (§4), vérifier logs |
| DB inaccessible | Vérifier postgres container, espace disque |
| Disk > 90% | Purge Docker images, contacter Hetzner pour resize |
| Let's Encrypt cert expiré | Redémarrer Caddy (il renouvelle auto) : `docker compose -f docker-compose.vps.yml restart caddy` |
