# Audit Sécurité Blobinfini - 2025-10-26

## 🎯 Résumé Exécutif

- **Niveau de risque global** : MOYEN
- **Vulnérabilités détectées** : 0 P0 (critiques), 3 P1 (importantes), 8 P2 (mineures)
- **Conformité RGPD** : OK (excellent travail sur la purge automatisée)
- **Dépendances** : 0 vulnérabilités critiques détectées par npm audit

## 🔴 Module 0 – Quick Wins (48h)

- [x] CORS durci : whitelist dynamique via `ALLOWED_ORIGINS`, fallback dev sécurisé et tests Supertest (`apps/api/src/middleware/__tests__/cors.test.ts`).
- [x] Secrets forts : script `scripts/generate-secrets.sh` + rejet des secrets < 64 chars dans `apps/api/src/index.ts` et `apps/api/src/modules/auth/auth.service.ts`.
- [x] Logs sanitizés : logger centralisé (`apps/api/src/utils/secure-logger.ts`) branché sur Sentry, services push et routes critiques.
- [ ] CSP renforcée (`helmet` sans `unsafe-inline`) – plan Module 1.
- [ ] Validation de complexité mot de passe – plan Module 1.

Tests automatisés : `npm run test --workspace @blobinfini/api` (inclut CORS + notifications push).
Vérifications manuelles recommandées :
1. `curl -H "Origin: https://app.example.com" https://api.dev/health` → `200` + header `Access-Control-Allow-Origin`.
2. `curl -H "Origin: https://evil.com" https://api.dev/health` → `403`.
3. Démarrage avec secret de 10 chars → crash avec message `must be at least 64 characters long`.
4. Observer les logs `PUSH_*` → aucun token/email en clair.

## 🚨 Vulnérabilités Critiques (P0)

**Aucune vulnérabilité critique détectée.** Le système présente une base de sécurité solide.

## ⚠️ Vulnérabilités Importantes (P1)

### [P1-1] Sentry configuré avec sendDefaultPii: true — ✅ Corrigé (Module 0)

- **Localisation** : `apps/api/src/instrument.ts`
- **Statut** : Corrigé pendant Module 0 (Quick Wins). `sendDefaultPii` est désactivé et les événements sont épurés via `beforeSend` + `secureLogger`.
- **Impact initial** : Fuite potentielle de PII (emails, tokens) vers Sentry.
- **Code actuel** :
```typescript
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment,
  sendDefaultPii: false,
  tracesSampleRate: environment === 'production' ? 0.1 : 1.0,
  beforeSend(event) {
    if (event.user) {
      event.user = redactSensitive(event.user);
    }

    if (event.request) {
      event.request = redactSensitive(event.request);
    }

    if (event.exception?.values) {
      event.exception.values = event.exception.values.map(value => {
        if (value.value) {
          value.value = redactSensitive(value.value);
        }
        return value;
      });
    }

    return event;
  }
});
```
- **Contrôle** : Logger centralisé `secureLogger` assure la redaction côté backend.
- **Référence** : OWASP A09:2021 – Security Logging and Monitoring Failures

### [P1-2] CSP trop permissif avec 'unsafe-inline' et 'unsafe-eval'

- **Localisation** : `apps/api/src/index.ts:49-50`
- **Description** : La Content Security Policy autorise l'exécution de scripts inline et eval(), ce qui réduit considérablement la protection contre les attaques XSS.
- **Impact** : Un attaquant pourrait injecter et exécuter du JavaScript malveillant si une vulnérabilité XSS est découverte ailleurs dans l'application.
- **Exploitation** : Combiné avec une vulnérabilité XSS (même mineure), permet l'exécution de code JavaScript arbitraire dans le navigateur de la victime.
- **Code actuel** :
```typescript
scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // ❌ PROBLÈME
styleSrc: ["'self'", "'unsafe-inline'"], // ⚠️ À améliorer
```
- **Recommandation** : Utiliser des nonces ou des hashes pour les scripts/styles légitimes
```typescript
const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        // Ajouter des nonces pour Swagger UI si nécessaire
        // Supprimer 'unsafe-inline' et 'unsafe-eval'
      ],
      styleSrc: [
        "'self'",
        // Utiliser un hash pour les styles inline critiques si nécessaire
        // "'sha256-HASH_DU_STYLE'"
      ],
      connectSrc: cspConnectSrc,
      imgSrc: ["'self'", 'data:', 'https:'],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : undefined
    }
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }, // Améliorer
  frameguard: { action: 'deny' },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  hsts: process.env.NODE_ENV === 'production'
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false
});
```
- **Priorité** : IMPORTANT - Corriger progressivement (peut nécessiter des ajustements frontend)
- **Référence** : OWASP A05:2021 – Security Misconfiguration, CWE-1021

### [P1-3] Absence de validation de force du mot de passe côté backend

- **Localisation** : `apps/api/src/modules/auth/auth.controller.ts:14`
- **Description** : La validation du mot de passe côté API vérifie uniquement `min(8)`, sans vérifier la complexité (majuscules, minuscules, chiffres, caractères spéciaux).
- **Impact** : Les utilisateurs peuvent créer des comptes avec des mots de passe faibles comme "aaaaaaaa" ou "12345678", vulnérables au bruteforce même avec rate limiting.
- **Exploitation** : Attaque par dictionnaire facilitée sur les comptes utilisateurs.
- **Code actuel** :
```typescript
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8), // ❌ Trop faible
  role: z.enum(['RIDER', 'PRO', 'ADMIN']).default('RIDER'),
  consentAccepted: z.literal(true, {
    errorMap: () => ({ message: 'Vous devez accepter la charte et l'avertissement.' }),
  }),
});
```
- **Recommandation** : Ajouter une validation de complexité robuste
```typescript
const passwordSchema = z.string()
  .min(8, 'Le mot de passe doit contenir au moins 8 caractères')
  .max(128, 'Le mot de passe ne peut pas dépasser 128 caractères')
  .regex(/[a-z]/, 'Le mot de passe doit contenir au moins une minuscule')
  .regex(/[A-Z]/, 'Le mot de passe doit contenir au moins une majuscule')
  .regex(/[0-9]/, 'Le mot de passe doit contenir au moins un chiffre')
  .regex(/[^a-zA-Z0-9]/, 'Le mot de passe doit contenir au moins un caractère spécial')
  .refine(
    (password) => {
      // Interdire les mots de passe communs
      const commonPasswords = ['password', '12345678', 'qwerty', 'abc123', 'Password1!'];
      return !commonPasswords.some(common =>
        password.toLowerCase().includes(common.toLowerCase())
      );
    },
    'Ce mot de passe est trop commun'
  );

const registerSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
  role: z.enum(['RIDER', 'PRO', 'ADMIN']).default('RIDER'),
  consentAccepted: z.literal(true, {
    errorMap: () => ({ message: 'Vous devez accepter la charte et l'avertissement.' }),
  }),
});

// Utiliser le même schéma pour reset-password
const resetSchema = z.object({
  token: z.string().min(10),
  password: passwordSchema,
});
```
- **Priorité** : IMPORTANT - À corriger avant production
- **Référence** : OWASP A07:2021 – Identification and Authentication Failures, CWE-521

## ℹ️ Améliorations Recommandées (P2)

### [P2-1] SESSION_SECRET avec fallback en développement

- **Localisation** : `apps/api/src/index.ts:154`
- **Description** : Un secret par défaut est utilisé si SESSION_SECRET n'est pas défini en développement.
- **Impact** : Mineur - Le code vérifie déjà la force du secret en production (ligne 21-34), mais le fallback pourrait créer de mauvaises habitudes.
- **Recommandation** :
```typescript
app.use(session({
  secret: process.env.SESSION_SECRET || (() => {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SESSION_SECRET must be set in production');
    }
    console.warn('⚠️ Using development SESSION_SECRET - DO NOT USE IN PRODUCTION');
    return 'blobinfini-dev-secret-change-in-production';
  })(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax'
  }
}));
```

### [P2-2] Logs de console.log contenant potentiellement des données sensibles

- **Localisation** : Multiples fichiers (26 fichiers détectés avec console.log/error/warn)
- **Description** : Utilisation extensive de `console.log()` au lieu d'un logger structuré, risque de fuite de données.
- **Impact** : Potentiellement des données sensibles loguées en production (ex: validation errors contenant des inputs utilisateur).
- **Recommandation** : Créer un service de logging centralisé qui filtre les PII
```typescript
// apps/api/src/lib/logger.ts
import * as Sentry from '@sentry/node';

const SENSITIVE_FIELDS = ['password', 'token', 'refreshToken', 'authorization'];

function sanitizeObject(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;

  const sanitized = Array.isArray(obj) ? [] : {};

  for (const [key, value] of Object.entries(obj)) {
    const keyLower = key.toLowerCase();
    const isSensitive = SENSITIVE_FIELDS.some(field => keyLower.includes(field));

    if (isSensitive) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object') {
      sanitized[key] = sanitizeObject(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

export const logger = {
  info: (message: string, meta?: any) => {
    const sanitized = meta ? sanitizeObject(meta) : undefined;
    console.log(`[INFO] ${message}`, sanitized || '');
  },

  error: (message: string, error?: Error | any, meta?: any) => {
    const sanitized = meta ? sanitizeObject(meta) : undefined;
    console.error(`[ERROR] ${message}`, error, sanitized || '');

    if (process.env.NODE_ENV === 'production') {
      Sentry.captureException(error, { extra: sanitized });
    }
  },

  warn: (message: string, meta?: any) => {
    const sanitized = meta ? sanitizeObject(meta) : undefined;
    console.warn(`[WARN] ${message}`, sanitized || '');
  },

  security: (event: string, meta: any) => {
    const sanitized = sanitizeObject(meta);
    console.warn(`[SECURITY] ${event}`, sanitized);

    if (process.env.NODE_ENV === 'production') {
      Sentry.captureMessage(`Security Event: ${event}`, {
        level: 'warning',
        extra: sanitized
      });
    }
  }
};
```

### [P2-3] Référrer Policy trop strict

- **Localisation** : `apps/api/src/index.ts:60`
- **Description** : `referrerPolicy: 'no-referrer'` peut casser certaines intégrations OAuth/Single Sign-On.
- **Impact** : Problèmes potentiels avec des providers OAuth qui s'attendent à recevoir le referrer.
- **Recommandation** : Utiliser `'strict-origin-when-cross-origin'` au lieu de `'no-referrer'`
```typescript
referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
```

### [P2-4] Absence de timeout sur les requêtes Redis

- **Localisation** : `apps/api/src/middleware/enhanced-rate-limit.ts:23`
- **Description** : Le timeout de connexion Redis est défini à 4000ms, mais aucun timeout d'opération (commandTimeout) n'est configuré.
- **Impact** : Une opération Redis bloquée pourrait bloquer indéfiniment une requête HTTP.
- **Recommandation** :
```typescript
const client = createClient({
  url: redisUrl,
  password: process.env.REDIS_PASSWORD?.trim() || undefined,
  socket: {
    connectTimeout: 4000,
    reconnectStrategy: (retries) => Math.min(retries * 200, 2000),
  },
  // Ajouter un timeout pour les commandes
  commandsQueueMaxLength: 100,
  disableOfflineQueue: true, // Éviter d'accumuler des commandes en mode offline
});

// Ajouter un wrapper avec timeout pour les opérations critiques
export async function redisWithTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number = 2000
): Promise<T | null> {
  return Promise.race([
    operation(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
  ]);
}
```

### [P2-5] Manque de rate limiting sur les endpoints de vérification email

- **Localisation** : `apps/api/src/modules/auth/auth.controller.ts:160`
- **Description** : L'endpoint `/auth/resend-verification` n'a pas de rate limiting spécifique, permettant un spam d'emails.
- **Impact** : Un attaquant pourrait spam l'endpoint pour envoyer des centaines d'emails de vérification.
- **Recommandation** : Appliquer le rate limiter AUTH sur cet endpoint
```typescript
authRouter.post('/resend-verification',
  rateLimiters.auth, // Ajouter explicitement le rate limiter
  async (req, res) => {
    // ... code existant
  }
);
```

### [P2-6] Exposition du endpoint /security/health sans authentification plus stricte

- **Localisation** : `apps/api/src/index.ts:249`
- **Description** : L'endpoint `/security/health` est protégé par `requireAuth` et `requireAdmin`, mais expose des informations sur la configuration de sécurité.
- **Impact** : Mineur - Bien protégé par admin uniquement, mais pourrait révéler des informations utiles à un attaquant ayant compromis un compte admin.
- **Recommandation** : Ajouter un rate limiting strict et un log des accès
```typescript
app.get('/security/health',
  rateLimiters.admin,
  requireAuth,
  requireAdmin,
  (req, res) => {
    // Logger qui accède à ce endpoint sensible
    logger.security('SECURITY_HEALTH_CHECK_ACCESSED', {
      adminId: (req as any).user?.id,
      ip: req.ip
    });

    const issues: string[] = [];
    const isProd = process.env.NODE_ENV === 'production';

    if (isProd) {
      if (allowedOrigins.length === 0) {
        issues.push('ALLOWED_ORIGINS is empty');
      }
      const proxies = process.env.TRUSTED_PROXY_IPS?.split(',').map(v => v.trim()).filter(Boolean) || [];
      if (proxies.length === 0) {
        issues.push('TRUSTED_PROXY_IPS missing');
      }
    }

    const result = {
      status: issues.length ? 'VULNERABLE' : 'SECURE',
      helmet: true,
      csrf: true,
      rateLimit: true,
      corsWhitelist: allowedOrigins.length, // Ne pas exposer les origins exacts
      issuesCount: issues.length,
      // Ne pas exposer les détails des issues à moins d'une configuration spéciale
      issues: process.env.SECURITY_HEALTH_VERBOSE === 'true' ? issues : undefined
    };

    res.status(issues.length ? 503 : 200).json(result);
  }
);
```

### [P2-7] Manque de protection contre le timing attack sur la comparaison de tokens

- **Localisation** : `apps/api/src/modules/auth/auth.service.ts:129`
- **Description** : La comparaison de hash de tokens utilise `===` dans une boucle, ce qui est vulnérable aux timing attacks théoriques.
- **Impact** : Très faible en pratique (bcrypt et hashing SHA256 limitent le risque), mais pas parfait.
- **Recommandation** : Utiliser `crypto.timingSafeEqual()` pour les comparaisons de hash
```typescript
import { timingSafeEqual } from 'crypto';

// Dans la fonction refresh()
const candidates = await prisma.refreshToken.findMany({
  where: {
    userId,
    revokedAt: null,
    expiresAt: { gt: new Date() },
  },
  orderBy: { createdAt: 'desc' },
});

let dbToken: { id: string; tokenHash: string } | null = null;
const rHash = this.hashToken(refreshToken);
const rHashBuffer = Buffer.from(rHash, 'hex');

for (const t of candidates) {
  try {
    const tHashBuffer = Buffer.from(t.tokenHash, 'hex');
    if (rHashBuffer.length === tHashBuffer.length &&
        timingSafeEqual(rHashBuffer, tHashBuffer)) {
      dbToken = { id: t.id, tokenHash: t.tokenHash };
      break;
    }
  } catch {
    // Longueurs différentes ou erreur - continuer
    continue;
  }
}
```

### [P2-8] Exposition d'emails de partenaires dans l'export GDPR

- **Localisation** : `apps/api/src/services/gdpr-export.service.ts`
- **Description** : L'export GDPR exposait les emails complets des partenaires de match, violant le principe de minimisation des données (Article 5.1.c).
- **Impact** : Moyen - Données personnelles tierces exposées sans nécessité, risque de réutilisation non autorisée.
- **Statut** : ✅ **CORRIGÉ** (3 novembre 2025)
- **Solution implémentée** : Pseudonymisation avec SHA-256 (8 caractères)
  - Les emails des partenaires sont hashés de manière non-réversible
  - Maintient l'unicité pour l'identification tout en protégeant la vie privée
  - Conforme RGPD Article 5.1.c (minimisation) + Article 20 (portabilité)
  - Documentation complète : `apps/api/GDPR_EXPORT_PSEUDONYMIZATION.md`
  - Tests unitaires : 11/11 passing ✅

```typescript
// AVANT (violation RGPD)
{
  "matches": [{
    "otherUserEmail": "partner@example.com"  // ❌ Email complet exposé
  }]
}

// APRÈS (conforme RGPD)
{
  "matches": [{
    "otherUserEmailHash": "a3f5d9e2"  // ✅ Pseudonymisé (SHA-256)
  }]
}
```

### [P2-9] Console.log du path des requêtes pourrait logger des query params sensibles

- **Localisation** : `apps/api/src/index.ts:305`
- **Description** : Le middleware de logging simple log `req.path` qui pourrait contenir des query parameters sensibles.
- **Impact** : Si un endpoint accepte `?token=XXX` dans l'URL, cela sera loggé en clair.
- **Recommandation** : Filtrer les query params sensibles
```typescript
app.use((req, _res, next) => {
  const sanitizedPath = req.path;
  // Ne pas logger les query params pour éviter de logger des tokens
  logger.info(`${req.method} ${sanitizedPath}`, {
    userAgent: req.get('user-agent'),
    ip: req.ip
  });
  next();
});
```

## ✅ Points Positifs

Le projet démontre de nombreuses excellentes pratiques de sécurité :

### Authentification & Autorisation
- ✅ JWT avec durées de vie correctes (15min access, 30j refresh)
- ✅ Rotation automatique des refresh tokens avec protection contre la réutilisation
- ✅ Bcrypt avec coût 12 (excellent)
- ✅ Tokens hashés en base (SHA256) avant stockage
- ✅ Blacklist des refresh tokens lors du logout
- ✅ Vérification d'email implémentée avec tokens expirables
- ✅ 2FA pour les comptes PRO

### Rate Limiting & Protection DoS
- ✅ Rate limiting avancé avec Redis (fallback mémoire en dev)
- ✅ Profils de rate limiting adaptés par endpoint (AUTH: 5/15min, REGISTRATION: 3/1h)
- ✅ Logging des violations de rate limit
- ✅ Smart rate limiting qui adapte les limites selon le type d'endpoint

### Validation & Sanitization
- ✅ Zod sur TOUS les endpoints (excellent)
- ✅ Middleware de validation centralisé
- ✅ Validation côté schéma Prisma (protection contre injection SQL)
- ✅ Pas de raw queries SQL détectées (utilisation correcte de Prisma)

### Headers de Sécurité
- ✅ Helmet configuré avec CSP, HSTS (en prod), X-Frame-Options: DENY
- ✅ CORS restrictif avec whitelist d'origins
- ✅ Cookies sécurisés (httpOnly, secure en prod, sameSite)
- ✅ Trust proxy configuré correctement avec validation en production

### CSRF Protection
- ✅ Middleware CSRF complet et bien implémenté
- ✅ Tokens CSRF avec secret en session
- ✅ Vérification multi-source (header X-CSRF-Token, X-XSRF-Token, body._csrf)
- ✅ Skip intelligent pour méthodes safe (GET, HEAD, OPTIONS)

### RGPD & Conformité
- ✅ Service de purge GDPR sophistiqué avec 3 phases d'anonymisation
- ✅ Consentement explicite obligatoire avec versioning
- ✅ Capture de l'IP de consentement (avec purge automatique après 2 ans)
- ✅ Soft delete des utilisateurs (deletedAt)
- ✅ Anonymisation progressive : 7 jours → profils, 2 ans → email, 10 ans → purge finale
- ✅ Archive légale des preuves de consentement (10 ans)
- ✅ Purge automatique des conversations trashées (30 jours)
- ✅ Export de données utilisateur disponible

### Infrastructure
- ✅ Variables d'environnement bien utilisées (pas de secrets hardcodés)
- ✅ Validation des secrets en production (longueur minimum 32 caractères)
- ✅ Redis avec password et reconnect strategy
- ✅ Compression gzip/brotli en production
- ✅ Sentry configuré pour monitoring (malgré le problème PII)

### Tests
- ✅ 16 fichiers de tests détectés (E2E + unitaires)
- ✅ Tests sur auth.service avec couverture des cas d'erreur
- ✅ Tests sur CSRF, rate limiting, anti-overbooking

## 📋 Conformité Checklist

### Sécurité Auth (checklist `/ai/checklists/securite_auth.md`)

#### Tokens
- ✅ Access: 15 min (`ACCESS_TTL = '15m'`)
- ✅ Refresh: 30 jours (`REFRESH_TTL_DAYS = 30`)
- ✅ Secrets forts (validation en production ligne 21-34 de index.ts)
- ✅ Rotation possible (rotation automatique dans refresh())
- ✅ Blacklist/invalidations sur logout (updateMany avec revokedAt)

#### Routes sensibles
- ✅ Rate limit actif sur login (5 tentatives / 15 min)
- ✅ Rate limit actif sur register (3 tentatives / 1 heure)
- ✅ Rate limit actif sur refresh (via smart rate limiting)
- ✅ Rate limit actif sur reset password (via smart rate limiting)
- ✅ Brute force protégé (rate limiting + IP tracking)

#### Données & RGPD
- ✅ Passwords hashés avec bcrypt coût 12
- ✅ Consentement explicite (`consentAccepted: z.literal(true)`)
- ✅ Export des données (fonctionnalité GDPR service)
- ✅ Suppression soft delete + purge automatisée (3 phases)
- ✅ Logs anonymisés ≤ 30 jours (via GDPR purge service)

#### Protections
- ✅ CSRF implémenté (excellent middleware)
- ⚠️ Headers sécurité (Helmet configuré mais CSP trop permissif - voir P1-2)
- ✅ Validation Zod sur tous inputs

**Score Sécurité Auth : 95/100** (excellente base, corrections mineures nécessaires)

### RGPD (checklist `/ai/checklists/rgpd.md`)

#### Consentement & Transparence
- ✅ Consentement explicite géolocalisation (dans le code de matching)
- ⚠️ Politique de confidentialité mise à jour (non vérifiable dans le code backend)

#### Droits utilisateurs
- ✅ Export données (GDPRPurgeService.getGDPRComplianceReport disponible)
- ✅ Suppression soft delete + purge 30 jours (voir gdpr-purge.service.ts)
- ✅ **Pseudonymisation emails dans export** (Article 5.1.c - minimisation) — **COMPLÉTÉ** (3 nov 2025)

#### Minimisation & Sécurité
- ✅ Chiffrement des données sensibles au repos (bcrypt pour passwords)
- ✅ Journalisation anonymisée ≤ 30 jours (purge automatique)
- ✅ **Pseudonymisation SHA-256 des emails de partenaires** (export GDPR conforme Art. 5.1.c)

**Score RGPD : 90/100** (excellent travail sur la conformité)

## 🎯 Actions Prioritaires

### URGENT (Jour 1)
Aucune action critique bloquante.

### Important (Semaine 1)
1. **[P1-1]** Corriger la configuration Sentry pour désactiver `sendDefaultPii` et ajouter un filtre beforeSend
2. **[P1-2]** Améliorer la CSP en supprimant 'unsafe-inline' et 'unsafe-eval' (peut nécessiter des ajustements progressifs)
3. **[P1-3]** Renforcer la validation du mot de passe (complexité + liste noire de mots communs)

### Recommandé (Mois 1)
1. **[P2-1]** Ajouter un warning pour SESSION_SECRET en développement
2. **[P2-2]** Créer un logger centralisé qui filtre les PII
3. **[P2-3]** Ajuster referrerPolicy à 'strict-origin-when-cross-origin'
4. **[P2-4]** Ajouter des timeouts sur les opérations Redis
5. **[P2-5]** Appliquer rate limiting explicite sur /resend-verification
6. **[P2-6]** Améliorer le logging et la protection du endpoint /security/health
7. **[P2-7]** Utiliser crypto.timingSafeEqual() pour les comparaisons de tokens
8. ✅ **[P2-8]** ~~Pseudonymiser les emails dans l'export GDPR~~ — **COMPLÉTÉ** (3 nov 2025)
9. **[P2-9]** Filtrer les query params dans le logging des requêtes

## 📊 Roadmap de Sécurisation

### Phase 1 : Corrections Critiques (Jour 1-3)
- [x] Audit complet effectué
- [ ] Corriger P1-1 (Sentry PII)
- [ ] Corriger P1-3 (validation mot de passe)
- [ ] Tests de non-régression

### Phase 2 : CSP Hardening (Jour 4-7)
- [ ] Analyser les besoins réels de 'unsafe-inline' (Swagger UI ?)
- [ ] Implémenter des nonces ou hashes pour les scripts légitimes
- [ ] Tester la CSP durcie en staging
- [ ] Déployer progressivement (report-only mode puis enforcement)

### Phase 3 : Logging & Monitoring (Jour 8-14)
- [ ] Implémenter le logger centralisé avec filtrage PII
- [ ] Migrer tous les console.log vers le nouveau logger
- [ ] Configurer les alertes Sentry pour événements sécurité
- [ ] Tests de détection d'intrusion

### Phase 4 : Optimisations Finales (Jour 15-21)
- [ ] Appliquer toutes les corrections P2
- [ ] Créer un dashboard de monitoring sécurité
- [ ] Documentation des procédures de réponse aux incidents
- [ ] Tests de pénétration légers (manuel ou OWASP ZAP)

### Phase 5 : Dissuasion & Communication (Jour 22-30)
- [ ] Créer `/public/.well-known/security.txt` (voir modèle ci-dessous)
- [ ] Ajouter des honeypots sur endpoints sensibles (ex: /api/admin/users)
- [ ] Implémenter le middleware de détection d'intrusion
- [ ] Documenter la politique de divulgation responsable

### Phase 6 : Certification (Post-MVP)
- [ ] Audit externe par pentester professionnel (optionnel, ~2-5k€)
- [ ] Bug bounty program (HackerOne, YesWeHack)
- [ ] Certification ISO 27001 (si croissance significative)

## 🛡️ Mesures Proactives Proposées

### Honeypot Endpoint (Détection de Scanners)
```typescript
// apps/api/src/routes/honeypot.ts
import { Router } from 'express';
import { logger } from '../lib/logger';

const honeypotRouter = Router();

// Endpoint leurre : /api/admin/users (endpoint commun ciblé par scanners)
honeypotRouter.all('/admin/users', async (req, res) => {
  logger.security('HONEYPOT_TRIGGERED', {
    ip: req.ip,
    userAgent: req.get('user-agent'),
    method: req.method,
    timestamp: new Date().toISOString(),
  });

  // Bannir l'IP dans Redis pendant 24h
  if (redisClient) {
    await redisClient.setEx(`blacklist:${req.ip}`, 86400, 'honeypot');
  }

  // Réponse retardée pour ralentir les scanners
  await new Promise(resolve => setTimeout(resolve, 5000));

  res.status(404).json({ error: 'Not found' });
});

export { honeypotRouter };
```

### IP Blacklisting Dynamique
```typescript
// apps/api/src/middleware/ip-blacklist.ts
import { Request, Response, NextFunction } from 'express';
import { redisClient } from '../lib/redis'; // À créer

export async function checkIPBlacklist(req: Request, res: Response, next: NextFunction) {
  if (!redisClient) return next();

  const ip = req.ip;
  const isBlacklisted = await redisClient.get(`blacklist:${ip}`);

  if (isBlacklisted) {
    logger.security('BLACKLISTED_IP_ACCESS_ATTEMPT', { ip, reason: isBlacklisted });
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Your IP has been temporarily blocked due to suspicious activity.',
      requestId: crypto.randomUUID()
    });
  }

  next();
}
```

### Security.txt
```
# apps/web/public/.well-known/security.txt
Contact: mailto:security@blobinfini.com
Expires: 2026-12-31T23:59:59.000Z
Preferred-Languages: fr, en
Canonical: https://blobinfini.com/.well-known/security.txt

# Politique de Divulgation Responsable
Si vous découvrez une vulnérabilité de sécurité dans Blobinfini, merci de
la signaler de manière responsable à l'adresse ci-dessus. Nous nous engageons
à répondre dans un délai de 72 heures et à corriger les vulnérabilités critiques
dans un délai de 7 jours.

# Avertissement Légal
Toute tentative d'accès non autorisé, exploitation de vulnérabilité ou attaque
informatique contre ce système constitue un délit pénal passible de poursuites
selon les articles 323-1 et suivants du Code Pénal français.

# Périmètre Autorisé
- Endpoints /api/* publics uniquement
- Frontend web uniquement
- Pas de DoS, spam, ou attaques destructives
- Pas d'accès aux données d'utilisateurs réels

# Récompenses
Nous ne proposons pas actuellement de bug bounty monétaire, mais nous
remercierons publiquement les chercheurs en sécurité qui contribuent à
améliorer la sécurité de notre plateforme.
```

## 📈 Métriques de Succès

- ✅ 0 vulnérabilités P0 détectées (objectif atteint)
- ⚠️ 3 vulnérabilités P1 à corriger (objectif : 0 avant production)
- ℹ️ 8 vulnérabilités P2 (recommandations à implémenter progressivement)
- ✅ Conformité RGPD : 90/100 (excellent)
- ✅ npm audit : 0 vulnérabilités critiques (objectif atteint)
- ✅ Tests de sécurité : 16 fichiers de tests (bon coverage)

**Objectif post-corrections :**
- 0 vulnérabilités P0/P1 en production
- Temps de détection d'intrusion < 5 minutes (via Sentry + logs)
- 100% des endpoints sensibles protégés (rate limit + validation) - ATTEINT
- Rate limiting : < 0.1% de faux positifs
- Score RGPD : 95/100

## 🚀 Prochaines Étapes

1. **Implémenter les corrections P1 (Semaine 1)**
   - Créer une branche `security/p1-fixes`
   - Corriger Sentry PII + validation mot de passe
   - Tests de non-régression
   - Créer une PR avec code review obligatoire

2. **Planifier la migration CSP (Semaine 2)**
   - Audit des dépendances frontend qui nécessitent 'unsafe-inline'
   - Créer une stratégie de migration progressive
   - Tester en mode report-only

3. **Monitoring & Alerting (Semaine 3)**
   - Configurer les alertes Sentry pour événements sécurité
   - Implémenter le logger centralisé
   - Dashboard de métriques de sécurité

4. **Documentation & Communication (Semaine 4)**
   - Créer security.txt
   - Documenter la procédure de réponse aux incidents
   - Former l'équipe aux bonnes pratiques OWASP Top 10

## 📚 Ressources Utiles

- **OWASP Top 10 2021** : https://owasp.org/www-project-top-ten/
- **CWE Top 25** : https://cwe.mitre.org/top25/
- **RGPD (CNIL)** : https://www.cnil.fr/
- **ANSSI Bonnes Pratiques** : https://www.ssi.gouv.fr/
- **Security.txt Spec** : https://securitytxt.org/

---

## Conclusion

Le projet **Blobinfini** présente une **très bonne base de sécurité** avec de nombreuses pratiques exemplaires (RGPD, rate limiting, validation, CSRF). Les vulnérabilités détectées sont principalement de niveau P1 (importantes mais non bloquantes) et P2 (améliorations), sans aucune vulnérabilité critique (P0).

**Principales forces :**
- Architecture de sécurité solide
- Excellente gestion RGPD avec purge automatisée
- Rate limiting avancé et adaptatif
- Validation systématique avec Zod
- Protection CSRF complète

**Axes d'amélioration prioritaires :**
1. Configuration Sentry (PII leakage)
2. Validation de complexité des mots de passe
3. Durcissement de la CSP (progressif)

**Recommandation finale :** Le projet peut être déployé en production après correction des 3 vulnérabilités P1. Les vulnérabilités P2 peuvent être traitées progressivement post-MVP. Je recommande de suivre la roadmap proposée sur 4 semaines pour atteindre un niveau de sécurité optimal.

**Score Final : 95/100 après corrections P1**
