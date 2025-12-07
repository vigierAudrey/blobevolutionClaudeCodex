# 🚀 Scripts utilitaires Blobinfini

## `ci-local.sh` - Pipeline CI en local

Script automatisé pour exécuter toute la pipeline CI localement avant de pousser sur GitHub.

### 📋 Ce que fait le script

1. ✅ **Docker** - Démarre PostgreSQL, Redis, MinIO et Mailpit
2. ✅ **Wait** - Attend que tous les services soient prêts
3. ✅ **Install** - Installe les dépendances (`npm ci`)
4. ✅ **Migrate** - Applique les migrations de base de données
5. ✅ **Seed** - Remplit la base avec des données de test
6. ✅ **Lint** - OpenAPI + Web linting
7. ✅ **Type-check** - Vérification TypeScript
8. ✅ **Test** - API tests + Web tests + Storybook tests

### 🔗 Services Docker démarrés

| Service | Port | URL | Identifiants |
|---------|------|-----|--------------|
| **PostgreSQL** | 5432 | `postgresql://postgres:postgres@localhost:5432/blobinfini` | postgres / postgres |
| **Redis** | 6379 | `redis://localhost:6379` | Voir `.env` pour password |
| **MinIO** | 9000, 9001 | http://localhost:9001 | minioadmin / minioadmin |
| **Mailpit** | 1025, 8025 | http://localhost:8025 | (interface web emails) |

### 🎯 Usage

```bash
# Depuis la racine du projet
./scripts/ci-local.sh
```

### ⏱️ Temps d'exécution

Environ **3-5 minutes** selon votre machine.

### 🛑 En cas d'erreur

Le script s'arrête automatiquement à la première erreur et affiche un message clair.

**Erreurs courantes :**

| Erreur | Cause | Solution |
|--------|-------|----------|
| `Docker services failed` | Docker non démarré | `systemctl start docker` ou Docker Desktop |
| `PostgreSQL timeout` | Port 5432 occupé | Vérifier avec `docker ps` |
| `npm ci failed` | package-lock corrompu | Supprimer `node_modules/` et `package-lock.json` |
| `Type check failed` | Erreurs TypeScript | Corriger les erreurs affichées |
| `Tests failed` | Tests en échec | Vérifier les logs de tests |

### 🧹 Nettoyage après tests

```bash
# Arrêter les services Docker
docker compose down

# Supprimer les volumes (reset complet de la DB)
docker compose down -v
```

### 🔧 Options avancées

**Exécuter seulement certaines étapes :**

```bash
# Seulement linting
npm run openapi:lint
npm run lint --workspace @blobinfini/web

# Seulement type-check
npm run type-check

# Seulement tests API
npm run test --workspace @blobinfini/api -- --runInBand

# Seulement tests Web
npm run test --workspace @blobinfini/web -- --runInBand
```

### 📊 Sortie attendue

```
🚀 Running Local CI Pipeline
===================================================

Step 1/8: Starting Docker services (postgres, redis, minio, mailpit)...
✅ Docker services started

Step 2/8: Waiting for services to be ready...
  → Waiting for PostgreSQL...
✅ PostgreSQL is ready
  → Waiting for Redis...
✅ Redis is ready
  → Checking MinIO...
✅ MinIO is running
  → Checking Mailpit...
✅ Mailpit is running
✅ All services are ready

Step 3/8: Installing dependencies...
✅ Dependencies installed

Step 4/8: Running migrations...
✅ Database migrations completed

Step 5/8: Seeding database...
✅ Database seeded successfully

Step 6/8: Running linters...
✅ All linters passed

Step 7/8: Type checking...
✅ Type checks passed

Step 8/8: Running tests...
✅ All tests passed

===================================================
🎉 CI Pipeline completed successfully!
⏱️  Total time: 4m 32s
===================================================
```

### 🤝 Intégration dans votre workflow

**Avant chaque commit :**
```bash
./scripts/ci-local.sh && git add . && git commit -m "..."
```

**Avant chaque push :**
```bash
./scripts/ci-local.sh && git push
```

**Git hook (optionnel) :**
```bash
# .git/hooks/pre-push
#!/bin/bash
./scripts/ci-local.sh
```

---

**Créé le :** 2025-10-14
**Auteur :** Claude Code
**Version :** 1.0.0
