# Runbook pré-VPS BlobConnect

> **Périmètre** : cet environnement simule au plus près un déploiement VPS réel, sans VPS loué.
> Il permet de qualifier auth, booking, matching, websocket et DB avant migration sur serveur réel.
> Ce runbook est la référence d'exploitation. Lire entièrement avant de commencer.

---

## Prérequis machine

| Outil | Version minimale | Installation |
|-------|-----------------|-------------|
| Docker | 24+ | [docs.docker.com](https://docs.docker.com/get-docker/) |
| Docker Compose | v2 (plugin) | inclus dans Docker Desktop |
| pnpm | 10.28.2 | `corepack enable && corepack prepare pnpm@10.28.2 --activate` |
| mkcert | 1.4.4+ | voir bootstrap.sh — message d'erreur donne la commande |
| curl + jq | n'importe | `apt install curl jq` / `brew install curl jq` |

---

## 1. Premier démarrage

```bash
# Cloner le repo (déjà fait)
cd /path/to/blobevolutionClaudeCodex

# Générer les secrets forts (résultat à copier dans .env.pre-vps)
./scripts/generate-secrets.sh --pre-vps > secrets.tmp.txt

# Créer .env.pre-vps depuis le template
cp .env.pre-vps.example .env.pre-vps

# Editer .env.pre-vps : remplacer TOUS les CHANGEME par les valeurs de secrets.tmp.txt
# puis effacer secrets.tmp.txt
nano .env.pre-vps
rm -f secrets.tmp.txt

# Ajouter les domaines locaux dans /etc/hosts
# (ou passer --hosts au bootstrap pour le faire automatiquement)
echo "127.0.0.1  api.blobinfini.local app.blobinfini.local" | sudo tee -a /etc/hosts

# Bootstrap complet (build + migrate + seed + démarrage)
./scripts/pre-vps-bootstrap.sh

# Si vous souhaitez que le bootstrap gère /etc/hosts automatiquement :
./scripts/pre-vps-bootstrap.sh --hosts
```

**Durée typique** : 10–20 minutes (build Docker + install deps + migrations).
Ensuite les redémarrages prennent < 2 minutes.

---

## 2. Accès aux services

| Service | URL | Credentials |
|---------|-----|-------------|
| Frontend | https://app.blobinfini.local | comptes ci-dessous |
| API | https://api.blobinfini.local | — |
| API health | https://api.blobinfini.local/health | — |
| Mailpit (emails de qualification locale uniquement) | http://localhost:8025 | — |
| MinIO (console) | http://localhost:9001 | voir `.env.pre-vps` S3_ACCESS_KEY_ID / SECRET |

**Les ports Postgres et Redis ne sont pas exposés sur l'hôte** (sécurité).
Pour accéder à la DB depuis l'hôte : `docker compose -f docker-compose.pre-vps.yml exec postgres psql -U blobinfini_pvps`.

Mailpit reste volontairement présent ici pour les liens de vérification/reset et les codes 2FA en qualification locale. Il ne fait pas partie de la cible VPS réelle.

---

## 3. Comptes de test stables

Ces comptes sont créés par `seed.pre-vps.ts` avec des UUIDs **fixes** référencés dans smoke-test.sh.

| Rôle | Email | Mot de passe | userId |
|------|-------|-------------|--------|
| rider | rider.a@pre-vps.blobinfini.local | RiderAlpha2026!PreVPS | `11111111-1111-4111-a111-111111111111` |
| rider | rider.b@pre-vps.blobinfini.local | RiderBeta2026!PreVPS | `22222222-2222-4222-b222-222222222222` |
| pro | pro.a@pre-vps.blobinfini.local | ProAlpha2026!PreVPS | `33333333-3333-4333-c333-333333333333` |

**Riders A et B sont géolocalisés à ~25km l'un de l'autre (Biarritz/Hossegor) avec maxDistanceKm=50 → se trouvent dans les résultats de matching.**

---

## 4. Qualification smoke test

```bash
# Invocation correcte : exporter TOUTES les vars du .env.pre-vps avant de lancer.
# Sans set -a, REDIS_PASSWORD et POSTGRES_PASSWORD sont absents du sous-process
# ce qui fait échouer les checks [4] Redis et [16] Prisma migrate.
set -a && source .env.pre-vps && set +a && bash scripts/smoke-test.sh

# Résultat attendu : 22/22 — VERDICT : GO ✓
```

> **Note re-run** : si vous relancez le smoke-test immédiatement après un premier passage,
> le rate-limiter du endpoint `/csrf-token` peut être saturé → cascade de 403.
> Attendre l'expiration de la fenêtre de rate-limit (≈ 1 minute) ou flusher Redis :
> ```bash
> REDIS_PASS=$(grep REDIS_PASSWORD .env.pre-vps | cut -d= -f2)
> docker compose -f docker-compose.pre-vps.yml exec -T redis redis-cli -a "$REDIS_PASS" FLUSHDB
> ```

Si un check échoue, voir la section Diagnostic ci-dessous.

---

## 5. Opérations courantes

### Arrêter l'environnement

```bash
docker compose -f docker-compose.pre-vps.yml down
```

### Redémarrer (sans rebuild)

```bash
docker compose -f docker-compose.pre-vps.yml up -d
```

### Voir les logs

```bash
# Tous les services
docker compose -f docker-compose.pre-vps.yml logs -f

# API seulement
docker compose -f docker-compose.pre-vps.yml logs -f api

# Nginx seulement
docker compose -f docker-compose.pre-vps.yml logs -f nginx
```

### Reseed (recréer les comptes de test)

```bash
docker compose -f docker-compose.pre-vps.yml run --rm \
  -e DATABASE_URL="postgresql://blobinfini_pvps:$(grep POSTGRES_PASSWORD .env.pre-vps | cut -d= -f2-)@postgres:5432/blobinfini_pvps" \
  -e APP_ENV=pre-vps \
  -e NODE_ENV=production \
  api \
  sh -c "cd /workspace && APP_ENV=pre-vps pnpm --filter @blobinfini/database exec tsx prisma/seed.pre-vps.ts"
```

### Reset complet (repartir de zéro)

```bash
./scripts/pre-vps-bootstrap.sh --reset
```

**Détruit les volumes pgdata-prevps et miniodata-prevps — toutes les données sont perdues.**

### Rebuild après modification de code

```bash
docker compose -f docker-compose.pre-vps.yml build api
docker compose -f docker-compose.pre-vps.yml up -d api
```

### Ajouter une migration Prisma

```bash
# 1. Créer la migration localement (env dev)
pnpm --filter @blobinfini/database exec prisma migrate dev --name nom_migration

# 2. Relancer le bootstrap (applique migrate deploy)
./scripts/pre-vps-bootstrap.sh --no-build
```

---

## 6. Diagnostic

### L'API ne démarre pas

```bash
docker compose -f docker-compose.pre-vps.yml logs api | tail -50
```

Causes fréquentes :
- Secret manquant → `ENV_VALIDATION_FAILED` dans les logs
- DB pas prête → retry en relançant `up -d api`
- Port 4000 déjà utilisé → `./scripts/free-port.sh`

### Cookies non envoyés (auth échoue)

Vérifier que :
1. mkcert est installé et sa CA est dans le trust store : `mkcert -install`
2. Les certificats existent : `ls docker/certs/pre-vps/`
3. /etc/hosts contient les domaines : `grep blobinfini.local /etc/hosts`
4. Le navigateur accède via `https://app.blobinfini.local` et **non** `http://localhost`

### CORS 403 inattendu

Vérifier `ALLOWED_ORIGINS=https://app.blobinfini.local` dans `.env.pre-vps`.
L'Origin de la requête doit correspondre **exactement** (sans slash final).

### Redis fallback mémoire détecté

Si `/internal/metrics` montre `redis.connected: false`, c'est P0.
```bash
docker compose -f docker-compose.pre-vps.yml ps redis
docker compose -f docker-compose.pre-vps.yml logs redis
```
Le rate-limit, le quota matching et les sessions 2FA seront non distribués — les tests seront faux.

### Matching ne retourne pas rider B

Vérifier :
1. Le seed a bien été exécuté (`[seed.pre-vps] OK` dans les logs du bootstrap)
2. Les UUIDs correspondent : `SELECT id, email FROM "User" WHERE email LIKE '%pre-vps%';`
3. La distance Biarritz↔Hossegor est ~25km dans le rayon de 100km passé au smoke test

### Migrations en attente

```bash
docker compose -f docker-compose.pre-vps.yml run --rm \
  -e DATABASE_URL="postgresql://blobinfini_pvps:PASSWORD@postgres:5432/blobinfini_pvps" \
  api \
  sh -c "cd /workspace && pnpm --filter @blobinfini/database exec prisma migrate status"
```

---

## 7. Ce que cet environnement prouve

| Capacité | Prouvé en pré-VPS | Prouvé uniquement sur VPS réel |
|----------|:-----------------:|:------------------------------:|
| Auth via cookie httpOnly+secure | ✓ (mkcert TLS) | — |
| CORS avec domaine réaliste | ✓ | — |
| Rate-limit Redis distribué | ✓ | ✓ (multi-instances) |
| Trust proxy correct | ✓ (nginx 172.20.0.0/16) | ✓ (IP publique) |
| Matching géo rider↔rider | ✓ | — |
| Ouverture conversation | ✓ | — |
| WebSocket over HTTPS | ✓ | — |
| DB migrations complètes | ✓ (migrate deploy) | — |
| SSL Postgres (en transit) | ✗ (réseau Docker interne) | ✓ |
| Performances réelles | ✗ (machine dev partagée) | ✓ |
| Réseau public (IP réelle) | ✗ | ✓ |
| CDN / edge cache | ✗ | ✓ |
| Scalabilité multi-instances | ✗ | ✓ |
| Failover infra | ✗ | ✓ |
| Backup/restore prod | ✗ | ✓ |

---

## 8. Limites connues (à qualifier sur VPS réel)

1. **SSL Postgres inter-services** : `APP_ENV=pre-vps` bypass le check `sslmode=require` pour le réseau Docker interne. Sur VPS réel, la connexion DB utilisera `sslmode=require` effectivement.

2. **2FA désactivée** : `AUTH_REQUIRE_2FA=false` en pré-VPS. Sur VPS réel, tous les comptes devront passer par TOTP.

3. **Firebase push notifications** : désactivé silencieusement en l'absence de credentials Firebase. Les tests booking/matching n'attendent pas les push.

4. **Rate-limit IP** : l'IP source est `172.20.x.x` (Docker bridge) pour tous les tests. Le comportement avec des IP publiques réelles n'est pas testé.

5. **MinIO vs S3 AWS** : les URLs présignées et la politique de bucket diffèrent légèrement entre MinIO et AWS S3.

6. **Performance** : les builds Docker et l'exécution partagent les ressources de la machine dev. Ne pas interpréter les latences comme représentatives de la prod.

---

## 9. Passage au VPS réel

Checklist delta pré-VPS → VPS :

- [ ] Remplacer `APP_ENV=pre-vps` par rien (supprimer la ligne)
- [ ] Activer `sslmode=require` dans `DATABASE_URL`
- [ ] Configurer `TRUSTED_PROXY_IPS` avec l'IP réelle du reverse proxy
- [ ] Activer `AUTH_REQUIRE_2FA=true`
- [ ] Configurer `AUTH_REQUIRE_VERIFIED=true`
- [ ] Remplacer MinIO par AWS S3 (ou MinIO VPS si auto-hébergé)
- [ ] Configurer Brevo SMTP réel (`smtp-relay.brevo.com`, auth obligatoire, pas Mailpit)
- [ ] Configurer Sentry DSN production
- [ ] Générer nouveaux secrets (ne jamais réutiliser les secrets pré-VPS)
- [ ] Configurer le monitoring `/security/health` avec le token prod
- [ ] Vérifier `CSP_REPORT_ONLY=false` en prod

---

## 10. Sécurité de cet environnement

- `.env.pre-vps` ne doit **jamais** être committé (`.gitignore` doit l'exclure)
- Les certs mkcert dans `docker/certs/pre-vps/` ne doivent pas être commités
- Les comptes de test `@pre-vps.blobinfini.local` ne doivent pas exister en production
- Le script `pre-vps-bootstrap.sh` aborte si `NODE_ENV=production && APP_ENV != pre-vps`
- `smoke-test.sh` aborte dans les mêmes conditions

Vérifier que `.gitignore` contient :
```
.env.pre-vps
docker/certs/pre-vps/
```
