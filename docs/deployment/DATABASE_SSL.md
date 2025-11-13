# Database SSL Configuration

## Pourquoi SSL est obligatoire en production

En production, toutes les communications avec la base de données PostgreSQL **DOIVENT** être chiffrées via SSL/TLS pour :

1. **Confidentialité** : Protéger les données en transit (mots de passe, emails, PII)
2. **Intégrité** : Empêcher la modification des requêtes SQL
3. **Authentification** : Vérifier l'identité du serveur PostgreSQL
4. **Conformité RGPD** : Article 32 - Chiffrement des données personnelles

## Configuration

### Format DATABASE_URL

```bash
# Production - SSL OBLIGATOIRE
DATABASE_URL=postgresql://user:password@host:port/database?sslmode=require

# Alternative avec validation du certificat serveur (plus sécurisé)
DATABASE_URL=postgresql://user:password@host:port/database?sslmode=verify-full&sslrootcert=/path/to/ca.crt
```

### Modes SSL disponibles

| Mode | Description | Sécurité |
|------|-------------|----------|
| `disable` | Pas de SSL | ❌ INTERDIT en production |
| `prefer` | SSL si disponible | ⚠️ Non recommandé (fallback non chiffré) |
| `require` | SSL obligatoire | ✅ **MINIMUM requis** |
| `verify-ca` | SSL + vérification CA | ✅ Recommandé |
| `verify-full` | SSL + vérification hostname | ✅ Recommandé si certificats disponibles |

### Validation automatique

L'API vérifie automatiquement au démarrage que `sslmode=require` (ou plus strict) est présent en production :

```typescript
// packages/database/src/client.ts
function validateDatabaseSSL(): void {
  if (process.env.NODE_ENV === 'production') {
    const hasSSLMode = dbUrl.includes('sslmode=require') ||
                       dbUrl.includes('sslmode=verify-full');
    if (!hasSSLMode) {
      throw new Error('DATABASE_URL must include "?sslmode=require"...');
    }
  }
}
```

**Résultat** : L'API **refusera de démarrer** si SSL n'est pas activé en production.

## Configuration par provider

### Clever Cloud

```bash
# Clever Cloud fournit une DATABASE_URL avec SSL activé par défaut
# Vérifier que l'URL contient bien sslmode=require
DATABASE_URL=postgresql://user:pass@postgres.clever-cloud.com:5432/db?sslmode=require
```

### Heroku

```bash
# Heroku ajoute ?sslmode=require automatiquement depuis 2023
# Vérifier dans Dashboard > Settings > Config Vars
DATABASE_URL=postgres://user:pass@ec2-xxx.compute-1.amazonaws.com:5432/db?sslmode=require
```

### AWS RDS

```bash
# Activer "Force SSL" dans RDS Security Group
DATABASE_URL=postgresql://user:pass@mydb.rds.amazonaws.com:5432/db?sslmode=require
```

### DigitalOcean Managed Database

```bash
# Télécharger le CA certificate depuis le dashboard
DATABASE_URL=postgresql://user:pass@db-postgresql-nyc3.ondigitalocean.com:25060/db?sslmode=verify-full&sslrootcert=/app/ca-certificate.crt
```

## Tests

### Vérifier la connexion SSL

```bash
# Test 1: Démarrer l'API en production sans SSL (doit crasher)
NODE_ENV=production DATABASE_URL=postgresql://user:pass@host:5432/db npm start
# Attendu: Error: DATABASE_URL must include "?sslmode=require"

# Test 2: Démarrer avec SSL (doit réussir)
NODE_ENV=production DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require npm start
# Attendu: [Database] SSL mode validated: connection will be encrypted

# Test 3: Vérifier dans PostgreSQL que la connexion utilise SSL
psql -h host -U user -d database -c "SELECT ssl, version FROM pg_stat_ssl JOIN pg_stat_activity ON pg_stat_ssl.pid = pg_stat_activity.pid WHERE usename = 'user';"
# Attendu: ssl = t (true)
```

### Tests automatisés

```bash
npm test -- packages/database/src/__tests__/client.test.ts
```

## Troubleshooting

### Erreur: "SSL is not enabled on the server"

**Solution** : Activer SSL sur le serveur PostgreSQL :

```bash
# postgresql.conf
ssl = on
ssl_cert_file = '/path/to/server.crt'
ssl_key_file = '/path/to/server.key'
```

### Erreur: "certificate verify failed"

**Solution** : Télécharger le CA certificate et utiliser `sslmode=verify-full` :

```bash
DATABASE_URL=postgresql://...?sslmode=verify-full&sslrootcert=/app/ca.crt
```

### Performance: SSL ralentit les requêtes ?

**Impact réel** : < 5% de overhead (chiffrement matériel moderne)
**Gain sécurité** : 100% des données protégées

**Conclusion** : Le coût performance est négligeable face au risque.

## Conformité

### RGPD - Article 32

> Le responsable du traitement et le sous-traitant mettent en œuvre [...] le chiffrement des données à caractère personnel.

**Certification** : SSL/TLS pour les données en transit est une exigence minimale.

### Code Pénal Français - Article 323-1

> Le fait d'accéder ou de se maintenir, frauduleusement, dans tout ou partie d'un système de traitement automatisé de données est puni de deux ans d'emprisonnement et de 60 000 € d'amende.

**Dissuasion** : SSL protège contre les attaques de type "Man-in-the-Middle" sur les connexions réseau.

## Checklist pré-production

- [ ] DATABASE_URL contient `?sslmode=require` (minimum)
- [ ] Validation SSL testée en local (NODE_ENV=production)
- [ ] Tests unitaires passent (`client.test.ts`)
- [ ] Connexion SSL vérifiée sur serveur PostgreSQL (`pg_stat_ssl`)
- [ ] Certificat CA téléchargé (si sslmode=verify-full)
- [ ] Documentation déploiement mise à jour

## Références

- [PostgreSQL SSL Support](https://www.postgresql.org/docs/current/libpq-ssl.html)
- [OWASP Transport Layer Protection Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Transport_Layer_Protection_Cheat_Sheet.html)
- [RGPD Article 32](https://www.cnil.fr/fr/reglement-europeen-protection-donnees/chapitre4#Article32)
- [ROADMAP.md Phase 2](../../ROADMAP.md) (lignes 147-165)
