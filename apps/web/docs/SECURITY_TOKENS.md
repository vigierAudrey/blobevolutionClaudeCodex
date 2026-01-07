# Token Storage Security (P0 Open Issue)

**Date**: 2026-01-06
**Status**: ⚠️ **OPEN - NOT MITIGATED**
**Risk Level**: 🔴 **CRITICAL (P0)**
**Scope**: apps/web (Next.js client)

---

## 🚨 Risque Actuel

### Vulnérabilité XSS via localStorage

**Fichiers concernés**:
- `apps/web/app/messages/[id]/page-websocket.tsx:105` - `localStorage.getItem('accessToken')`
- `apps/web/lib/apiClient.ts` - Token storage dans localStorage

**Problème**:
Les tokens JWT (accessToken + refreshToken) sont stockés en **plaintext dans localStorage**, accessible via JavaScript. Si un attaquant parvient à injecter du code JavaScript malveillant (attaque XSS), il peut:

```javascript
// Script malveillant injecté via XSS
const accessToken = localStorage.getItem('accessToken');
const refreshToken = localStorage.getItem('refreshToken');
// Envoyer tokens vers serveur attaquant → compromission complète du compte
```

**Impact**:
- Vol de session utilisateur
- Accès complet au compte compromis
- Possibilité d'actions frauduleuses (messages, réservations, etc.)

---

## 🔍 Pourquoi localStorage ?

### Contraintes Techniques

**Next.js SSR + Socket.IO**:
- Socket.IO client nécessite token lors de la connexion WebSocket
- httpOnly cookies **ne sont pas accessibles en JavaScript** → incompatible avec Socket.IO auth
- sessionStorage perd tokens sur refresh page → UX dégradée

**Alternative httpOnly cookie nécessite**:
- Middleware Socket.IO custom côté backend
- Proxy auth via cookie HTTP → complexité additionnelle
- Refactor auth complet (frontend + backend)

**Décision actuelle**: localStorage choisi pour **time-to-market** malgré le risque XSS.

---

## ✅ Mitigations Requises AVANT Production

### Mitigation 1: Content Security Policy (CSP) - **OBLIGATOIRE**

**Objectif**: Bloquer injection de scripts malveillants inline

**Implémentation recommandée** (`apps/web/next.config.js` ou `middleware.ts`):

```javascript
// next.config.js
module.exports = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval'", // Next.js require unsafe-eval (dev)
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              "font-src 'self' data:",
              "connect-src 'self' wss://api.blobinfini.com", // WebSocket endpoint
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'"
            ].join('; ')
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY'
          }
        ]
      }
    ];
  }
};
```

**Garanties CSP**:
- ✅ Bloque `<script>alert(1)</script>` inline
- ✅ Bloque `eval()` malveillant (sauf unsafe-eval pour Next.js)
- ⚠️ **NE BLOQUE PAS** scripts injectés via composants React (dangerouslySetInnerHTML)

---

### Mitigation 2: Input Sanitization - **OBLIGATOIRE**

**Objectif**: Empêcher injection XSS via user input

**Zones critiques à protéger**:
1. Messages chat (apps/web/app/messages/[id]/page-websocket.tsx)
2. Profil utilisateur (displayName, bio)
3. Noms de lieux/dates (propositions session)

**Options de mitigation**:

#### Option A: Text-only rendering (sans dépendances) - **RECOMMANDÉ**
- Interdire tout HTML dans user input (plaintext uniquement)
- React échappe automatiquement les caractères spéciaux via `{message.content}`
- **Avantages**: Aucune dépendance, sécurité maximale, simplicité
- **Inconvénients**: Pas de formatage rich text (gras, italique, etc.)
- **Validation backend**: Déjà fait via Zod schemas ✅

#### Option B: DOMPurify (nécessite dépendance npm)
- Utiliser `DOMPurify` pour sanitize HTML user-generated
- Nécessite installer `dompurify` + `@types/dompurify`
- Utile uniquement si rich text requis (markdown, HTML limité)
- **État actuel**: Non implémenté (hors scope hardening pass)

**Recommandation**: Privilégier **Option A** (text-only) sauf si rich text explicitement requis.

**Action P0**: Vérifier que `dangerouslySetInnerHTML` n'est JAMAIS utilisé avec user input

---

### Mitigation 3: Token Rotation Court - **RECOMMANDÉ**

**Objectif**: Réduire fenêtre d'exploitation si token volé

**Configuration actuelle**:
- accessToken: **15 min** (OK ✅)
- refreshToken: **7 jours** (⚠️ TROP LONG)

**Recommandation**:
- refreshToken: **24h max**
- Force re-login si inactivité > 7 jours
- Logout automatique si refresh token révoqué (déjà implémenté ✅)

---

### Mitigation 4: HttpOnly Cookie Migration - **LONG TERME**

**Alternative robuste** (nécessite refactor):

**Architecture cible**:
```
Client → HTTP request avec httpOnly cookie
Backend API → Valide cookie → Attach token à Socket.IO session côté serveur
Socket.IO → Auth via session ID (pas de token côté client)
```

**Avantages**:
- ✅ Token **jamais accessible en JavaScript** → XSS n'a aucun impact
- ✅ Standard sécurité industry

**Effort estimé**: 2-3 semaines (backend + frontend + tests)

---

## 📋 Checklist Déploiement Production

**Avant déploiement, vérifier**:
- [ ] CSP headers configurés (next.config.js ou middleware)
- [ ] Test manuel: injecter `<script>alert(1)</script>` dans message → doit être bloqué
- [ ] Sanitization user input (DOMPurify ou équivalent)
- [ ] refreshToken TTL <= 24h
- [ ] Monitoring détection XSS (logs CSP violations)
- [ ] Backup plan: migration httpOnly cookie planifiée (roadmap Q2 2026)

---

## 🔗 Références

- **OWASP XSS Prevention**: https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
- **Next.js CSP**: https://nextjs.org/docs/app/building-your-application/configuring/content-security-policy
- **Socket.IO Auth Best Practices**: https://socket.io/docs/v4/middlewares/#sending-credentials

---

**Auteur**: Claude Code (Hardening Pass)
**Reviewed**: ⏳ En attente
**Next Steps**: Implémenter CSP headers AVANT production (P0 bloquant)
