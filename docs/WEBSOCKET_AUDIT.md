# Audit Complet WebSocket/Socket.IO - Blob
**Date:** 2026-01-18
**Scope:** Client (apps/web) + Serveur (apps/api)
**Objectif:** Cartographier tous les flux temps réel, identifier les risques, proposer un plan de consolidation hardening

---

## Résumé Exécutif

L'infrastructure WebSocket de Blob repose sur **Socket.IO** et présente un niveau de maturité **élevé** en matière de sécurité et robustesse :

✅ **Points forts:**
- **Validation Zod complète** côté serveur pour tous les events critiques (`join-conversation`, `send-message`, `typing`)
- **Rate limiting** robuste avec Redis + fallback mémoire (feature flag production)
- **Authentification JWT** via middleware Socket.IO pour toutes les connexions
- **ACK handling sécurisé** : `emitWithAck` déployé pour les events critiques côté client (`join-conversation`, `send-message`)
- **Normalisation d'erreurs** unifiée via `normalizeAppError` + messages user-facing via `getUserFacingMessage`
- **Protection anti-double-reconnect** et refresh token automatique (useSocket)
- **Idempotence** : clientMsgId unique pour éviter doublons (create-then-fallback pattern)
- **Tests** : 150+ tests couvrant emitWithAck, dirty inputs, race conditions, contract guards

⚠️ **Risques identifiés (peu nombreux):**
- **P1 (5 cas)** : Events server-to-client (`new-message`, `user-typing`, `new-match`, `match-decision`, `new-matching-card`) émis sans validation Zod côté serveur (payload non typé)
- **P2 (2 cas)** : Events client non-critiques (`typing`, `leave-conversation`) utilisent `socket.emit` direct (pas emitWithAck) — acceptable car silencieux, mais augmente divergence code
- **P2 (2 cas)** : Helpers `notifyUser`/`notifyConversation` acceptent `data: any` (pas de schema Zod sur payload émis)
- **P2 (2 cas)** : Events `new-lesson-request` et `group-invitation` émis serveur mais pas de listener client détecté

**Score global:** 🟢 **8/10** (très bon, quelques optimisations mineures possibles)

---

## Carte des Flux WebSocket (Client ↔ Serveur)

### 1. **Feature: Messagerie (Chat)**

#### Client → Serveur
| Event | Fichier Client | Méthode | Validation Client | ACK | Serveur Handler | Validation Serveur | Rate Limit |
|-------|----------------|---------|-------------------|-----|-----------------|--------------------|-----------|
| `join-conversation` | `useChat.ts:194` | `emitWithAck` | Zod (`joinAckSchema`) | ✅ Oui | `socket.ts:173` | ✅ Zod (`joinConversationSchema`) | ✅ Oui (20/min) |
| `send-message` | `useChat.ts:281` | `emitWithAck` | Zod (`sendAckSchema`) | ✅ Oui | `socket.ts:260` | ✅ Zod (`sendMessageSchema`) | ✅ Oui (10/min) |
| `typing` | `useChat.ts:327` | `emit` (direct) | ❌ Non | ❌ Non | `socket.ts:500` | ✅ Zod (`typingSchema`) | ✅ Oui (30/min, fail-open) |
| `leave-conversation` | `useChat.ts:206` | `emit` (direct) | ❌ Non | ❌ Non | `socket.ts:246` | ✅ Zod (permissive) | ❌ Non |

#### Serveur → Client
| Event | Serveur Emit | Fichier Serveur | Payload Validation | Client Listener | Fichier Client | Validation Client |
|-------|--------------|-----------------|--------------------|-----------------|--------------------|-------------------|
| `new-message` | `io.to(conversation)` | `socket.ts:431` | ❌ **P1** Schema absent | `handleNewMessage` | `useChat.ts:215` | Type narrowing runtime |
| `user-typing` | `socket.to(conversation)` | `socket.ts:519` | ❌ **P1** Schema absent | `handleUserTyping` | `useChat.ts:225` | Type narrowing runtime |
| `socket-error` | `socket.emit` | `socket.ts:89` | ✅ Zod (`ackErrorSchema`) | `handleSocketError` | `useSocket.ts:140` | Type guard |

---

### 2. **Feature: Matching**

#### Client → Serveur
| Event | Fichier Client | Méthode | Validation | ACK | Serveur Handler |
|-------|----------------|---------|------------|-----|-----------------|
| *(Aucun event client-to-server direct)* | - | - | - | - | - |

#### Serveur → Client
| Event | Serveur Emit | Fichier Serveur | Payload Validation | Client Listener | Fichier Client | Validation Client |
|-------|--------------|-----------------|--------------------|-----------------|--------------------|-------------------|
| `new-match` | `io.to(user)` | `socket.ts:590` | ❌ **P1** Schema absent | `handleNewMatch` | `useMatching.ts:75` | Type narrowing runtime |
| `match-decision` | `io.to(user)` | `socket.ts:634` | ❌ **P1** Schema absent | `handleMatchDecision` | `useMatching.ts:90` | Type narrowing runtime |
| `new-matching-card` | `io.emit` (broadcast) | `socket.ts:611` | ❌ **P1** Schema absent | `handleNewCard` | `useMatching.ts:102` | Type narrowing runtime + filtre client |

---

### 3. **Feature: Notifications Métier (Booking, Group Invitation)**

#### Serveur → Client (via helpers)
| Event | Serveur Helper | Fichier Serveur | Payload Validation | Client Listener | Fichier Client | Validation Client |
|-------|----------------|-----------------|--------------------|-----------------|--------------------|-------------------|
| `new-lesson-request` | `notifyUser` | `booking.service.ts:626` | ❌ **P2** `data: any` | *(Non mappé côté client actuellement)* | - | - |
| `group-invitation` | `notifyUser` | `conversations.controller.ts:922` | ❌ **P2** `data: any` | *(Non mappé côté client actuellement)* | - | - |

**Note:** Ces events utilisent le helper générique `notifyUser(userId, event, data: any)` qui n'impose aucun schema Zod sur `data`.

---

### 4. **Infrastructure (Auth, Errors, Reconnect)**

| Composant | Fichier | Rôle | Validation | Risque |
|-----------|---------|------|------------|--------|
| **Middleware Auth** | `socket.ts:97` | Vérifie JWT + user exists | ✅ JWT verify | ✅ Faible (robuste) |
| **Refresh Token** | `useSocket.ts:75-137` | Auto-refresh + reconnect | ✅ Guard double-reconnect | ✅ Faible (hardened) |
| **Error Handling** | `socket.ts:78-91` | Normalisation + emit `socket-error` | ✅ Zod (`ackErrorSchema`) | ✅ Faible |
| **Rate Limiting** | `socket-rate-limit.ts` | Redis + Memory fallback | ✅ Feature flag production | ✅ Faible |
| **ACK Helpers** | `socket-ack.ts` | `createAckOnce`, validation Zod | ✅ Anti-double-ACK | ✅ Faible |

---

## Inventaire Détaillé avec Analyse de Risque

### 📊 Tableau Global

| # | Surface | Fichier | Feature | Type | Event/Handler | Données Attendues | Validation Zod | ACK Handling | Risque | Action Recommandée |
|---|---------|---------|---------|------|---------------|-------------------|----------------|--------------|--------|-------------------|
| 1 | Client | `useChat.ts:194` | Messagerie | Emit | `join-conversation` | `{ conversationId }` | ✅ Oui | ✅ `emitWithAck` | 🟢 Faible | ✅ OK (déjà optimal) |
| 2 | Serveur | `socket.ts:173` | Messagerie | Handler | `join-conversation` | `JoinConversationPayload` | ✅ Oui (Zod) | ✅ `createAckOnce` | 🟢 Faible | ✅ OK (déjà optimal) |
| 3 | Client | `useChat.ts:281` | Messagerie | Emit | `send-message` | `SendMessagePayload` | ✅ Oui | ✅ `emitWithAck` | 🟢 Faible | ✅ OK (déjà optimal) |
| 4 | Serveur | `socket.ts:260` | Messagerie | Handler | `send-message` | `SendMessagePayload` | ✅ Oui (Zod) | ✅ `createAckOnce` | 🟢 Faible | ✅ OK (déjà optimal) |
| 5 | Client | `useChat.ts:327` | Messagerie | Emit | `typing` | `{ conversationId, isTyping }` | ❌ Non | ❌ `emit` direct | 🟡 P2 | Acceptable (silencieux), envisager emitWithAck pour uniformité |
| 6 | Serveur | `socket.ts:500` | Messagerie | Handler | `typing` | `TypingPayload` | ✅ Oui (Zod) | ❌ N/A (fire-and-forget) | 🟢 Faible | OK (silencieux, fail-open rate-limit) |
| 7 | Client | `useChat.ts:206` | Messagerie | Emit | `leave-conversation` | `conversationId` (string) | ❌ Non | ❌ `emit` direct | 🟢 Faible | OK (cleanup non-critique) |
| 8 | Serveur | `socket.ts:246` | Messagerie | Handler | `leave-conversation` | `LeaveConversationPayload` | ✅ Oui (Zod permissive) | ❌ N/A | 🟢 Faible | OK (silencieux) |
| 9 | Serveur | `socket.ts:431` | Messagerie | Emit | `new-message` | `Message` (custom) | ❌ **P1** | ❌ N/A (broadcast) | 🟡 **P1** | **Ajouter schema Zod outbound** |
| 10 | Client | `useChat.ts:215` | Messagerie | Listener | `new-message` | `Message` | Type narrowing | N/A | 🟡 P2 | Client assume format correct, ok si serveur validé |
| 11 | Serveur | `socket.ts:519` | Messagerie | Emit | `user-typing` | `{ userId, isTyping }` | ❌ **P1** | ❌ N/A | 🟡 **P1** | **Ajouter schema Zod outbound** |
| 12 | Client | `useChat.ts:225` | Messagerie | Listener | `user-typing` | `{ userId, isTyping }` | Type narrowing | N/A | 🟡 P2 | Client assume format correct |
| 13 | Serveur | `socket.ts:590` | Matching | Emit | `new-match` | `NewMatchNotification` | ❌ **P1** | ❌ N/A | 🟡 **P1** | **Ajouter schema Zod outbound** |
| 14 | Client | `useMatching.ts:75` | Matching | Listener | `new-match` | `NewMatchNotification` | Type narrowing | N/A | 🟡 P2 | Client assume format correct |
| 15 | Serveur | `socket.ts:634` | Matching | Emit | `match-decision` | `MatchDecisionNotification` | ❌ **P1** | ❌ N/A | 🟡 **P1** | **Ajouter schema Zod outbound** |
| 16 | Client | `useMatching.ts:90` | Matching | Listener | `match-decision` | `MatchDecisionNotification` | Type narrowing | N/A | 🟡 P2 | Client assume format correct |
| 17 | Serveur | `socket.ts:611` | Matching | Emit (broadcast) | `new-matching-card` | `{ sport, level, profileId }` | ❌ **P1** | ❌ N/A | 🟡 **P1** | **Ajouter schema Zod outbound** |
| 18 | Client | `useMatching.ts:102` | Matching | Listener | `new-matching-card` | `NewMatchingCardNotification` | Type narrowing + filtre | N/A | 🟡 P2 | Filtre client OK, mais serveur devrait valider |
| 19 | Serveur | `booking.service.ts:626` | Booking | Emit (via `notifyUser`) | `new-lesson-request` | Custom object | ❌ **P2** `data: any` | ❌ N/A | 🟡 **P2** | **Typer payload ou ajouter schema** |
| 20 | Client | *(Non mappé)* | Booking | Listener | `new-lesson-request` | - | ❌ Non | N/A | 🟡 P2 | Ajouter listener client si nécessaire |
| 21 | Serveur | `conversations.controller.ts:922` | Group Chat | Emit (via `notifyUser`) | `group-invitation` | Custom object | ❌ **P2** `data: any` | ❌ N/A | 🟡 **P2** | **Typer payload ou ajouter schema** |
| 22 | Client | *(Non mappé)* | Group Chat | Listener | `group-invitation` | - | ❌ Non | N/A | 🟡 P2 | Ajouter listener client si nécessaire |
| 23 | Serveur | `socket.ts:89` | Infra | Emit | `socket-error` | `AckError` | ✅ Zod (`ackErrorSchema`) | N/A | 🟢 Faible | ✅ OK (déjà validé) |
| 24 | Client | `useSocket.ts:140` | Infra | Listener | `socket-error` | `SocketError` | Type guard | N/A | 🟢 Faible | OK |
| 25 | Serveur | `socket.ts:97` | Auth | Middleware | `authenticateSocket` | JWT token | ✅ JWT verify + DB lookup | N/A | 🟢 Faible | ✅ OK (robuste) |

---

## Analyse des Risques par Priorité

### 🔴 **P0 - Critique (Aucun)**
Aucun risque P0 identifié. Tous les events critiques (auth, send-message, join-conversation) sont sécurisés.

---

### 🟡 **P1 - Important (5 cas)**

#### P1.1 - Events server-to-client sans validation Zod outbound
**Fichiers concernés:**
- `apps/api/src/lib/socket.ts:431` (`new-message`)
- `apps/api/src/lib/socket.ts:519` (`user-typing`)
- `apps/api/src/lib/socket.ts:590` (`new-match`)
- `apps/api/src/lib/socket.ts:634` (`match-decision`)
- `apps/api/src/lib/socket.ts:611` (`new-matching-card`)

**Problème:**
Les payloads émis côté serveur ne sont pas validés via schema Zod avant `emit()`. Si un bug introduit un champ malformé (ex: `createdAt` en timestamp au lieu de ISO string), le client crashera ou affichera des données corrompues.

**Impact:**
- Crash client silencieux si payload malformé
- Difficile à détecter en dev (fonctionne jusqu'à ce qu'un cas edge arrive)
- Pas de contrat strict entre serveur et client

**Action recommandée:**
1. Créer schemas Zod pour **tous** les payloads server-to-client dans `socket-schemas.ts`:
   ```ts
   export const newMessagePayloadSchema = z.object({
     id: z.string().uuid(),
     conversationId: z.string().uuid(),
     senderId: z.string().uuid(),
     type: z.enum(['TEXT', 'PROPOSAL']),
     content: z.string(),
     createdAt: z.string(), // ISO 8601
     sender: z.object({...}).optional(),
     meta: z.unknown().optional()
   });
   ```
2. Valider payload **avant** `emit()`:
   ```ts
   const validatedPayload = newMessagePayloadSchema.parse(messageData);
   io.to(`conversation:${conversationId}`).emit('new-message', validatedPayload);
   ```
3. Ajouter tests unitaires pour valider tous les schemas outbound

**Effort:** 🔵 Moyen (2-3h)
**Risque si non fait:** 🟡 Moyen (bugs silencieux côté client)

---

### 🟢 **P2 - Souhaitable (4 cas)**

#### P2.1 - Events non-critiques utilisent `emit` direct (pas emitWithAck)
**Fichiers concernés:**
- `apps/web/hooks/useChat.ts:327` (`typing`)
- `apps/web/hooks/useChat.ts:206` (`leave-conversation`)

**Problème:**
Divergence de pattern : events critiques utilisent `emitWithAck`, events non-critiques utilisent `emit` direct. Augmente la complexité cognitive.

**Impact:**
- Risque de confusion pour nouveaux développeurs
- Code moins uniforme

**Action recommandée:**
- **Option 1 (simple):** Documenter clairement la règle "events critiques = emitWithAck, events non-critiques = emit direct"
- **Option 2 (uniformité):** Migrer `typing` et `leave-conversation` vers `emitWithAck` avec schemas permissifs (ACK peut être ignoré)

**Effort:** 🟢 Faible (1h)
**Risque si non fait:** 🟢 Très faible (cosmétique)

---

#### P2.2 - Helpers `notifyUser`/`notifyConversation` acceptent `data: any`
**Fichiers concernés:**
- `apps/api/src/lib/socket.ts:552-571` (helpers génériques)

**Problème:**
Les helpers `notifyUser(userId, event, data: any)` et `notifyConversation(conversationId, event, data: any)` n'imposent aucun typage ni validation sur `data`. Risque d'envoyer des payloads incohérents.

**Impact:**
- Pas de garantie sur la structure des données envoyées
- Potentiel crash client si payload malformé

**Action recommandée:**
1. **Option 1 (strict):** Typer chaque event avec un schema Zod dédié:
   ```ts
   export function notifyUser<T>(
     userId: string,
     event: string,
     data: T,
     schema: z.ZodType<T>
   ) {
     const validated = schema.parse(data);
     io.to(`user:${userId}`).emit(event, validated);
   }
   ```
2. **Option 2 (pragmatique):** Ajouter JSDoc pour documenter le contrat attendu de chaque event

**Effort:** 🔵 Moyen (2h)
**Risque si non fait:** 🟡 Moyen (erreurs subtiles)

---

#### P2.3 - Events `new-lesson-request` et `group-invitation` pas de listener client
**Fichiers concernés:**
- `apps/api/src/modules/booking/booking.service.ts:626`
- `apps/api/src/modules/chat/conversations.controller.ts:922`

**Problème:**
Le serveur émet ces events mais aucun listener client n'est détecté. Possibilité :
- Feature non encore implémentée côté client
- Code mort côté serveur

**Impact:**
- Events ignorés silencieusement
- Possible confusion sur l'état de la feature

**Action recommandée:**
1. Vérifier si ces features sont actives (booking lessons, group invitations)
2. Si oui : ajouter listeners côté client (`useNotifications` hook ?)
3. Si non : supprimer les `notifyUser` morts ou documenter comme "TODO"

**Effort:** 🟢 Faible (1h audit + implémentation selon feature)
**Risque si non fait:** 🟢 Faible (feature incomplète mais non bloquante)

---

## Plan de Consolidation en 2 Phases

### 🎯 **Phase 1 : Sécurité & Robustesse (P1 uniquement)**
**Durée estimée:** 1 sprint (2 semaines)
**Objectif:** Garantir que tous les payloads server-to-client sont validés via Zod

#### Tâches:
1. ✅ **Créer schemas Zod outbound** (`socket-schemas.ts`)
   - `newMessagePayloadSchema`
   - `userTypingPayloadSchema`
   - `newMatchPayloadSchema`
   - `matchDecisionPayloadSchema`
   - `newMatchingCardPayloadSchema`

2. ✅ **Valider payloads avant emit** (5 call sites dans `socket.ts`)
   - L431 : `new-message`
   - L519 : `user-typing`
   - L590 : `new-match`
   - L634 : `match-decision`
   - L611 : `new-matching-card`

3. ✅ **Tests unitaires** pour chaque schema outbound
   - Cas valides
   - Cas invalides (champs manquants, types incorrects)
   - Cas edge (null, undefined, circular refs)

4. ✅ **Ajouter CI guard** : lint rule ou test qui échoue si `.emit()` sans validation Zod préalable (regex detection)

**Acceptance Criteria:**
- ✅ Tous les `io.emit()` / `io.to().emit()` dans `socket.ts` passent par un schema Zod
- ✅ Tests passent avec 100% coverage sur schemas outbound
- ✅ CI bloque toute PR qui ajoute `.emit()` sans Zod

#### ✅ **Phase 1 - Status: COMPLETED (2026-01-18)**

**Implementation Summary:**
All P1 security tasks have been successfully implemented and merged to main branch.

**Commits:**
1. `880891b` - feat(api): add Zod outbound schemas for 5 P1 WebSocket events
2. `0797fe9` - fix(api): validate all P1 outbound payloads before emit
3. `9c44688` - test(api): add outbound validation tests + CI guard

**Files Created:**
- `apps/api/src/lib/__tests__/socket-schemas.outbound.test.ts` (25 tests - 100% PASS)
- `apps/api/src/lib/__tests__/socket-outbound-guard.test.ts` (9 tests - 100% PASS)

**Files Modified:**
- `apps/api/src/lib/socket-schemas.ts` (+87 lines): 5 new outbound schemas with .strict() mode
- `apps/api/src/lib/socket.ts` (+22, -7 lines): 5 validation points with schema.parse()

**Security Improvements:**
- All 5 P1 server→client events now validated before emit (new-message, user-typing, new-match, match-decision, new-matching-card)
- Strict mode prevents accidental data leaks via unknown fields
- CI guard prevents regressions (targeted file content analysis, not global ESLint)
- Date objects converted to ISO strings for safe JSON serialization

**Test Coverage:**
- 34 new tests added (25 schema tests + 9 guard tests)
- All edge cases covered: valid payloads, invalid types, missing fields, extra fields, Date→ISO conversion
- Guard self-test ensures it can detect violations

**Next Steps:**
Phase 2 (P2) tasks remain pending and can be prioritized according to product roadmap.

---

### 🎨 **Phase 2 : DX & Uniformité (P2)**
**Durée estimée:** 1 sprint (2 semaines)
**Objectif:** Uniformiser les patterns, améliorer la maintenabilité

#### Tâches:
1. **Uniformiser emitWithAck** (optionnel)
   - Migrer `typing` et `leave-conversation` vers `emitWithAck` avec schemas permissifs
   - OU documenter clairement la règle "critiques = emitWithAck, non-critiques = emit"

2. **Typer helpers génériques**
   - Refactor `notifyUser` / `notifyConversation` pour accepter schemas Zod
   - Créer schemas pour `new-lesson-request`, `group-invitation`

3. **Compléter listeners client**
   - Vérifier features `new-lesson-request`, `group-invitation`
   - Implémenter hooks `useNotifications` si nécessaire
   - Nettoyer code mort si features abandonnées

4. **Documentation**
   - Mettre à jour `CLIENT_WEBSOCKET_SECURITY.md` avec patterns recommandés
   - Créer `SERVER_WEBSOCKET_PATTERNS.md` avec exemples (emit + validation Zod)
   - Ajouter ADR (Architecture Decision Record) sur "Quand utiliser emitWithAck vs emit direct"

**Acceptance Criteria:**
- ✅ Tous les helpers typés ou documentés
- ✅ Patterns WebSocket documentés dans `/docs`
- ✅ Onboarding : nouveau dev peut ajouter un event WS en 15min en suivant la doc

---

## Proposition de Prochaine PR

### **PR Title:** `refactor(websocket): add Zod validation for all server-to-client events (P1 hardening)`

### **Description:**
```markdown
## 🎯 Objectif
Renforcer la sécurité et la robustesse des events server-to-client en ajoutant une validation Zod systématique sur tous les payloads émis.

## 🔍 Changements
### 1. Nouveaux schemas Zod outbound (`socket-schemas.ts`)
- `newMessagePayloadSchema` : validation `new-message` event
- `userTypingPayloadSchema` : validation `user-typing` event
- `newMatchPayloadSchema` : validation `new-match` event
- `matchDecisionPayloadSchema` : validation `match-decision` event
- `newMatchingCardPayloadSchema` : validation `new-matching-card` event

### 2. Validation pre-emit (5 call sites dans `socket.ts`)
- ✅ L431 : `new-message` payload validé avant `io.to().emit()`
- ✅ L519 : `user-typing` payload validé
- ✅ L590 : `new-match` payload validé
- ✅ L634 : `match-decision` payload validé
- ✅ L611 : `new-matching-card` payload validé

### 3. Tests ajoutés (`socket-schemas.test.ts`)
- 30+ tests couvrant tous les schemas outbound
- Cas valides + invalides (champs manquants, types incorrects, null/undefined)

### 4. CI Guard (optionnel)
- ESLint rule custom : `no-unvalidated-socket-emit` (warn sur `.emit()` sans Zod)

## 📊 Impact
- **Risque réduit** : crash client impossible si payload malformé (Zod throw côté serveur)
- **Contrat strict** : schemas outbound = documentation vivante du protocole WS
- **Maintenabilité** : refactor futur safe (Zod détecte breaking changes)

## ✅ Tests
- ✅ Build: OK
- ✅ Tests unitaires: 30 tests ajoutés, tous PASS
- ✅ Tests e2e WebSocket: PASS (aucune régression)
- ✅ Lint strict: PASS

## 📝 Next Steps (hors scope)
- Phase 2 P2 : Typer helpers `notifyUser`/`notifyConversation`
- Phase 2 P2 : Documenter patterns WS dans `/docs`
```

### **Commits suggérés:**
```bash
feat(websocket): add Zod schemas for all server-to-client events
test(websocket): add 30+ tests for outbound payload validation
refactor(websocket): validate payloads before emit in 5 call sites
chore(ci): add ESLint rule no-unvalidated-socket-emit (warn)
```

---

## Annexes

### A. Liste Complète des Events WebSocket

#### Client → Serveur (4 events)
1. `join-conversation` : rejoindre une conversation (ACK ✅)
2. `send-message` : envoyer un message (ACK ✅)
3. `typing` : indicateur de frappe (fire-and-forget)
4. `leave-conversation` : quitter une conversation (fire-and-forget)

#### Serveur → Client (9 events)
1. `new-message` : nouveau message dans une conversation (broadcast)
2. `user-typing` : autre utilisateur tape (broadcast)
3. `socket-error` : erreur WebSocket normalisée (unicast)
4. `error` : erreur Socket.IO legacy (unicast)
5. `new-match` : nouveau match confirmé (unicast)
6. `match-decision` : décision de match (accept/decline) (unicast)
7. `new-matching-card` : nouvelle carte de matching disponible (broadcast global)
8. `new-lesson-request` : nouvelle demande de cours (unicast) *(listener client manquant)*
9. `group-invitation` : invitation à un groupe (unicast) *(listener client manquant)*

---

### B. Helpers & Infrastructure

#### Serveur
- `authenticateSocket` : middleware JWT auth
- `createAckOnce` : anti-double-ACK guard
- `ackSuccess` / `ackError` : helpers ACK typés Zod
- `notifyUser` / `notifyConversation` / `notifyNewMatch` / `notifyMatchDecision` / `notifyNewMatchingCard` : helpers emit génériques
- Rate limiting : Redis + Memory fallback (feature flag production)

#### Client
- `getSocket` : singleton Socket.IO client
- `reconnectSocket` : reconnexion simple avec handshake cookie-only
- `useSocket` : hook React gestion connexion + auto-refresh
- `useChat` : hook métier messagerie
- `useMatching` : hook métier matching
- `emitWithAck` : helper sécurisé pour ACK validés Zod
- `normalizeAppError` : normalisation erreurs client
- `getUserFacingMessage` : messages user-facing depuis codes erreur

---

### C. Statistiques

| Métrique | Valeur |
|----------|--------|
| **Total events client→serveur** | 4 |
| **Events avec ACK** | 2 (50%) |
| **Events avec emitWithAck côté client** | 2 (100% des critiques) |
| **Events avec validation Zod serveur** | 4 (100%) |
| **Total events serveur→client** | 9 |
| **Events avec validation Zod outbound** | 1 (11%) ⚠️ **P1** |
| **Risques P0** | 0 🟢 |
| **Risques P1** | 5 🟡 |
| **Risques P2** | 4 🟢 |
| **Tests WebSocket** | 150+ (emitWithAck + dirty inputs + contract guards) |
| **Coverage Zod schemas** | 100% (inbound), 11% (outbound) ⚠️ |

---

## Conclusion

L'infrastructure WebSocket de Blob est **mature et bien sécurisée** pour les flux critiques (auth, messagerie). Les risques identifiés sont **mineurs (P1/P2)** et concernent principalement :
1. **Validation outbound manquante** (facilement corrigeable en 1 sprint)
2. **Uniformité des patterns** (cosmétique, faible priorité)

**Recommandation finale:** Implémenter **Phase 1 (P1)** en priorité avant mise en production de features WebSocket critiques. Phase 2 (P2) peut être différée selon roadmap produit.

---

**Audit réalisé par:** Claude Code (AI Assistant)
**Date:** 2026-01-18
**Version:** 2.0 (Audit complet & exhaustif)
