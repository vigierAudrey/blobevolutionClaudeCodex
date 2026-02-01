# Architecture Temps Réel

**Version**: 1.0
**Date**: 2026-02-01
**Status**: Production

---

## Règle d'Or Globale

### ❌ INTERDIT

- Polling pour simuler du temps réel (< 10s)
- WebSocket ouvert en permanence "au cas où"
- WebSocket global à l'échelle app (pas de singleton connecté partout)
- Temps réel sans utilisateur actif regardant l'information

### ✅ OBLIGATOIRE

- Temps réel **uniquement** quand utilisateur regarde l'information
- WebSocket **page-scoped** (connexion au mount, déconnexion au unmount)
- Sinon: push notification / refresh à l'entrée / fetch à l'action
- Justification produit + documentation charge serveur pour toute nouvelle feature temps réel

---

## Décision Produit → Décision Technique

| Fonction | Besoin Temps Réel | Solution Actuelle | Pourquoi | Fichiers |
|----------|-------------------|-------------------|----------|----------|
| **Messagerie** | ✅ Oui (< 1s) | WebSocket page-scoped | Messages instantanés = valeur produit | `apps/web/app/messages/[id]/page-websocket.tsx`<br>`apps/web/hooks/useChat.ts`<br>`apps/api/src/lib/socket.ts` |
| **Dashboard Unread** | ❌ Non | Polling optimisé (60s) | Économie serveur, données non-critiques | `apps/web/app/dashboard/page.tsx`<br>`docs/ARCHITECTURE_POLLING_DASHBOARD.md` |
| **Réservations (Rider)** | ❌ Non | Fetch à l'ouverture page | Statut change rarement (< 1x/jour) | `apps/web/app/reservations/` |
| **Réservations (Pro)** | ⚠️ Potentiel | Push notification hors app<br>Fetch au focus app | Besoin notif immédiate si pro offline<br>Pas de WS permanent | *(à implémenter)* |
| **Blobomap** | ❌ Non | Fetch on interaction | Carte exploratoire, pas monitoring temps réel | `apps/web/app/pro/map/` |
| **Matching Cards** | ❌ Non | Fetch à l'ouverture | Cartes statiques jusqu'à action user | `apps/web/app/matching/` |

**Règle décision**: Si besoin < 5s latence + utilisateur regarde activement → WebSocket page-scoped. Sinon → fetch/polling/push.

---

## Messagerie — Temps Réel Strict

### Principe

WebSocket **UNIQUEMENT** quand page messages ouverte. Pas de connexion permanente.

### Cycle de Vie

```typescript
// apps/web/app/messages/[id]/page-websocket.tsx

useEffect(() => {
  // Mount → Connexion WS
  const { connected, sendMessage, setTyping, otherUserTyping, lastError } = useChat({
    conversationId: id,
    token: accessToken,
    onNewMessage: (msg) => setMessages(prev => [...prev, msg])
  });

  // Unmount → Déconnexion WS (automatique dans useChat cleanup)
  return () => {
    // useChat cleanup: disconnect socket
  };
}, [id, accessToken]);
```

**Garanties**:
- ✅ Connexion **seulement** si page `/messages/[id]` ouverte
- ✅ Déconnexion immédiate au `unmount` (navigation, fermeture tab)
- ✅ Pas de WebSocket si user sur dashboard/profil/autre

### Events WebSocket

**Envoyés par client**:
- `join-conversation` (conversationId)
- `send-message` (content, type, meta, clientMsgId)
- `typing` (conversationId, isTyping)
- `leave-conversation` (conversationId)

**Reçus du serveur**:
- `new-message` (message complet)
- `user-typing` (userId, isTyping)
- `conversation-update` (conversationId, updates)
- `socket-error` (code, message, details)

**Trace**: `apps/api/src/lib/socket.ts:170-350`

### Fallback HTTP

Si WebSocket fail (timeout, erreur réseau), `useChat` bascule sur HTTP:

```typescript
// apps/web/hooks/useChat.ts:250-280

const sendMessage = async (content: string, ...) => {
  if (connected) {
    // Tenter WS avec emitWithAck (timeout 5s)
    try {
      const ack = await emitWithAck(socket, 'send-message', payload, 5000);
      return { success: true, transport: 'WS', clientMsgId };
    } catch (wsError) {
      // WS fail → fallback HTTP
    }
  }

  // Fallback HTTP si WS down ou erreur
  const msg = await apiClient.sendMessage(conversationId, payload);
  return { success: true, transport: 'HTTP', clientMsgId };
};
```

**Garanties**:
- ✅ Message TOUJOURS envoyé (WS ou HTTP)
- ✅ Pas de perte si WS temporairement down
- ✅ UX dégradée gracieuse (latence +200ms)

### Sécurité

**Auth obligatoire** (middleware serveur):
```typescript
// apps/api/src/lib/socket.ts:102-130

async function authenticateSocket(socket, next) {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication required'));

  const decoded = jwt.verify(token, JWT_SECRET);
  const user = await prisma.user.findUnique({ where: { id: decoded.sub } });

  if (!user) return next(new Error('User not found'));

  socket.user = { id: user.id, role: user.role };
  next();
}
```

**Ownership conversation** (vérification serveur):
```typescript
// apps/api/src/lib/socket.ts:220-240

socket.on('join-conversation', async (payload, ack) => {
  const { conversationId } = payload;

  // Vérifier que user appartient à la conversation
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      participants: { some: { id: socket.user.id } }
    }
  });

  if (!conversation) {
    return ackError(ack, 'FORBIDDEN', 'Not a participant');
  }

  // Joindre room Socket.io (conversationId)
  socket.join(conversationId);
});
```

**Broadcast ciblé** (pas de broadcast global):
```typescript
// apps/api/src/lib/socket.ts:280-290

// ❌ INTERDIT: broadcast global
io.emit('new-message', message); // Tous les clients reçoivent!

// ✅ CORRECT: broadcast à une room (conversation)
io.to(conversationId).emit('new-message', message); // Seulement participants
```

### Observabilité

**Compteur connexions** (à ajouter):
```typescript
// apps/api/src/lib/socket.ts:160

io.on('connection', (socket) => {
  const connectedCount = io.sockets.sockets.size;
  if (connectedCount > 1000) {
    secureLogger.warn('HIGH_WS_CONNECTIONS', { count: connectedCount });
  }
});
```

**Alerte connexions par user** (à ajouter):
```typescript
// Limite: max 5 connexions par user (5 tabs/devices)
const userSocketsCount = getUserSocketsCount(socket.user.id);
if (userSocketsCount > 5) {
  secureLogger.warn('TOO_MANY_USER_SOCKETS', { userId: socket.user.id, count: userSocketsCount });
  socket.disconnect(); // Optionnel: forcer déconnexion
}
```

---

## Réservations — Temps Réel Conditionnel

### État Actuel (Sans Temps Réel)

**Rider**:
- Crée demande → HTTP POST `/api/bookings`
- Consulte statut → fetch à l'ouverture page `/reservations`
- Refresh manuel si besoin

**Pro**:
- Reçoit email notification nouvelle demande
- Consulte demandes → fetch à l'ouverture page `/pro/dashboard`
- Accepte/refuse → HTTP POST `/api/bookings/:id/accept`

### Future (Si Besoin Temps Réel Validé)

**Pro uniquement** (pas rider):

**Stratégie A: Push Notification Hors App**
```typescript
// apps/api/src/modules/booking/booking.service.ts

async createBookingRequest(data) {
  const booking = await prisma.booking.create({ data });

  // Notifier pro via push (Firebase Cloud Messaging)
  if (pro.pushToken) {
    await sendPushNotification(pro.pushToken, {
      title: 'Nouvelle demande de cours',
      body: `${rider.displayName} souhaite réserver`,
      data: { bookingId: booking.id, type: 'NEW_BOOKING' }
    });
  }

  // Email fallback
  await sendEmail(pro.email, 'Nouvelle demande', ...);
}
```

**Stratégie B: WebSocket Page-Scoped (Si Pro Dashboard Ouvert)**
```typescript
// apps/web/app/pro/dashboard/page.tsx

const { connected } = useSocket({ token: accessToken, autoConnect: true });

useEffect(() => {
  if (!connected) return;

  const handleNewBooking = (booking) => {
    setBookings(prev => [booking, ...prev]);
    showNotification('Nouvelle demande de cours');
  };

  socket.on('new-booking', handleNewBooking);

  return () => {
    socket.off('new-booking', handleNewBooking);
  };
}, [connected]);
```

**Règle Importante**: WebSocket **uniquement** si page pro dashboard ouverte. Sinon push notification.

**Pourquoi pas WS permanent?**
- ❌ Pro pas toujours connecté (5-10 demandes/semaine seulement)
- ❌ Coût serveur disproportionné (WS ouvert 24/7 pour 1 event/jour)
- ✅ Push notification suffit (email + notif mobile)

---

## Blobomap — Pas de Temps Réel

### Principe

Carte interactive pour **exploration**, pas **monitoring temps réel**.

### Rafraîchissement

**À l'ouverture page**:
```typescript
// apps/web/app/pro/map/page.tsx

useEffect(() => {
  fetchProsNearby(lat, lng, radius);
}, []); // Une fois au mount
```

**Au déplacement/zoom**:
```typescript
const handleMapMove = debounce((center, zoom) => {
  fetchProsNearby(center.lat, center.lng, getRadius(zoom));
}, 500); // Debounce 500ms évite spam
```

**Sur action utilisateur** (filtres):
```typescript
const handleFilterChange = (filters) => {
  fetchProsNearby(lat, lng, radius, filters);
};
```

### Cache Client

**TTL 60s** (évite refetch inutile):
```typescript
const CACHE_TTL_MS = 60000;
const cache = useRef({ data: null, timestamp: 0 });

const fetchProsNearby = async (...) => {
  const now = Date.now();
  if (cache.current.data && now - cache.current.timestamp < CACHE_TTL_MS) {
    return cache.current.data; // Cache hit
  }

  const data = await apiClient.getProsNearby(...);
  cache.current = { data, timestamp: now };
  return data;
};
```

### Temps Réel Seulement Si Feature Future Validée

**Exemple cas d'usage temps réel** (actuellement **NON** implémenté):
- "Pro vient de se connecter" → badge vert apparaît
- "Nouveau spot ajouté" → pin apparaît sans reload

**Si validé produit**:
- Documenter besoin utilisateur précis
- Estimer charge serveur (combien de users carte ouverte simultanément?)
- WebSocket page-scoped (connexion uniquement si `/map` ouvert)
- Broadcast géospatial (seulement users dans bbox visible)

**Actuellement**: ❌ Pas de WebSocket, ❌ pas de polling continu.

---

## Séparation Stricte des Systèmes (INVARIANT)

### Principe

Polling dashboard et WebSocket temps réel sont **deux systèmes distincts**. Ne JAMAIS mélanger.

### Interdictions Absolues

❌ **INTERDIT #1**: Réutiliser lease/leader pour WebSocket
```typescript
// ❌ FAUX - Ne JAMAIS faire ça
const amILeader = tryAcquireLease();
if (amILeader) {
  socket.connect(); // NON! WS doit être page-scoped, pas leader-scoped
}
```

❌ **INTERDIT #2**: Déclencher WebSocket depuis hook dashboard
```typescript
// ❌ FAUX - dashboard/page.tsx
useEffect(() => {
  if (amILeader()) {
    const socket = getSocket(token);
    socket.connect(); // NON! Dashboard = polling, pas WS
  }
}, []);
```

❌ **INTERDIT #3**: Polling dans page avec WebSocket
```typescript
// ❌ FAUX - messages/[id]/page.tsx
useEffect(() => {
  const interval = setInterval(() => {
    fetchNewMessages(); // NON! Si WS ouvert, pas de polling
  }, 5000);
}, []);
```

### Séparation par Périmètre

| Système | Périmètre | Fichiers | Déclencheur |
|---------|-----------|----------|-------------|
| **Polling Dashboard** | `apps/web/app/dashboard/page.tsx` | - `dashboard/page.tsx`<br>- Leader lease logic | `useEffect` avec leader election |
| **WebSocket Messagerie** | `apps/web/app/messages/[id]/` | - `messages/[id]/page-websocket.tsx`<br>- `hooks/useChat.ts`<br>- `hooks/useSocket.ts`<br>- `lib/socket.ts` | `useChat({ conversationId })` mount |
| **WebSocket Future (Réservations Pro)** | `apps/web/app/pro/dashboard/page.tsx` | *(à créer si validé)* | `useSocket({ autoConnect: true })` mount |

**Règle**: Chaque système vit dans son périmètre. Pas de code partagé sauf utilitaires bas niveau (types, schemas).

---

## Garde-fous Anti-Régression (BLOQUANTS)

### Checklist PR Review

Avant merge toute PR modifiant temps réel ou polling:

- [ ] ✅ Aucun polling < 10s (sauf polling leader 60s dashboard)
- [ ] ✅ Aucun WebSocket global (`io.emit()` serveur → doit être `io.to(room).emit()`)
- [ ] ✅ Aucun WebSocket permanent (autoConnect dans `_app.tsx` interdit)
- [ ] ✅ WebSocket connexion au mount + déconnexion au unmount
- [ ] ✅ Justification produit documentée (pourquoi temps réel nécessaire?)
- [ ] ✅ Charge serveur estimée (combien de connexions max simultanées?)
- [ ] ✅ Stratégie offline documentée (push/email/refresh au focus)
- [ ] ✅ Tests vérifiés (WS connecté seulement si page ouverte)

**Si 1 item fail → REJECT PR.**

### Interdictions Code Review

#### INTERDIT #1: Polling Temps Réel Simulé

```typescript
// ❌ INTERDIT
setInterval(() => {
  fetchMessages(); // Polling < 10s pour "simuler" temps réel
}, 3000);

// ✅ CORRECT
const { connected, sendMessage } = useChat({ conversationId, token });
// WebSocket ou rien (+ fallback HTTP si WS fail)
```

#### INTERDIT #2: WebSocket Global App

```typescript
// ❌ INTERDIT - apps/web/app/layout.tsx
export default function RootLayout({ children }) {
  useEffect(() => {
    const socket = getSocket(token);
    socket.connect(); // NON! Connexion permanente toute l'app
  }, []);
}

// ✅ CORRECT - apps/web/app/messages/[id]/page.tsx
export default function ConversationPage() {
  const { connected } = useChat({ conversationId, token }); // Page-scoped
}
```

#### INTERDIT #3: Temps Réel Sans Utilisateur Actif

```typescript
// ❌ INTERDIT
if (document.visibilityState === 'hidden') {
  socket.connect(); // NON! User pas sur l'onglet
}

// ✅ CORRECT
if (document.visibilityState === 'visible') {
  socket.connect(); // WS seulement si user regarde
} else {
  socket.disconnect(); // Déconnexion immédiate si hidden
}
```

#### INTERDIT #4: Broadcast Global Serveur

```typescript
// ❌ INTERDIT - apps/api/src/lib/socket.ts
io.emit('new-message', message); // Tous les clients reçoivent!

// ✅ CORRECT
io.to(conversationId).emit('new-message', message); // Room ciblée
```

### Règles Ajout Nouvelle Feature Temps Réel

**Avant d'implémenter**, répondre à ces questions (dans issue/RFC):

1. **Besoin produit**: Pourquoi temps réel nécessaire? (< 5s latence critique?)
2. **Alternative**: Pourquoi fetch/polling/push insuffisant?
3. **Charge serveur**: Combien de connexions WS simultanées max? (estimer users actifs)
4. **Stratégie offline**: Que se passe-t-il si user ferme app? (push, email, refresh au retour)
5. **Périmètre**: Quelle page exactement? (WebSocket page-scoped obligatoire)
6. **Rooms**: Comment isoler broadcast? (pas de `io.emit()` global)
7. **Tests**: Comment prouver WS connecté seulement si page ouverte?

**Si réponses floues → PAUSE, clarifier avant code.**

---

## Sécurité & Charge Serveur

### Authentification WebSocket

**Middleware obligatoire** (déjà implémenté):
```typescript
// apps/api/src/lib/socket.ts:102-130

io.use(authenticateSocket); // Vérifie JWT avant connexion
```

**Vérification**:
- ✅ Token JWT vérifié à la connexion
- ✅ User existant en DB
- ✅ `socket.user` attaché (id, role)
- ❌ Pas de connexion anonyme

### Isolation par Room

**Room par ressource** (conversation, booking):
```typescript
// Join room
socket.join(conversationId); // Socket appartient à 1+ rooms

// Broadcast ciblé
io.to(conversationId).emit('new-message', message); // Seulement room
```

**Vérification ownership** (avant join):
```typescript
const conversation = await prisma.conversation.findFirst({
  where: {
    id: conversationId,
    participants: { some: { id: socket.user.id } } // User doit être participant
  }
});

if (!conversation) return ackError(ack, 'FORBIDDEN', 'Not a participant');
```

### Rate Limiting WebSocket

**Limiters par event** (déjà implémenté):
```typescript
// apps/api/src/lib/socket-rate-limit.ts

const sendMessageLimiter = getSendMessageLimiter(); // 20 msg/min
const typingLimiter = getTypingLimiter(); // 10 typing/30s
const joinLimiter = getJoinLimiter(); // 5 join/min
```

**Vérification**:
```typescript
socket.on('send-message', async (payload, ack) => {
  const rateLimitResult = await checkRateLimit(sendMessageLimiter, socket.user.id);

  if (!rateLimitResult.allowed) {
    return ackError(ack, 'RATE_LIMITED', 'Too many messages', {
      retryAfter: rateLimitResult.retryAfter
    });
  }

  // Traiter message...
});
```

### Nettoyage Connexions

**Disconnect au unmount** (automatique):
```typescript
// apps/web/hooks/useSocket.ts:200-220

useEffect(() => {
  return () => {
    if (socket) {
      socket.disconnect(); // Cleanup React
    }
  };
}, []);
```

**Timeout serveur inactif** (à ajouter):
```typescript
// apps/api/src/lib/socket.ts

const INACTIVE_TIMEOUT_MS = 300000; // 5min

socket.on('connection', (socket) => {
  let lastActivity = Date.now();

  const checkInactive = setInterval(() => {
    if (Date.now() - lastActivity > INACTIVE_TIMEOUT_MS) {
      secureLogger.info('SOCKET_INACTIVE_TIMEOUT', { userId: socket.user.id });
      socket.disconnect();
      clearInterval(checkInactive);
    }
  }, 60000); // Check toutes les 1min

  socket.onAny(() => {
    lastActivity = Date.now(); // Reset timer sur tout event
  });
});
```

### Observabilité (à implémenter)

**Métriques à tracker**:
- Connexions WS actives (`io.sockets.sockets.size`)
- Connexions par user (map `userId → socket[]`)
- Events/sec par type (`send-message`, `typing`, etc.)
- Latence ack moyenne
- Taux erreur WS (auth fail, rate limit)

**Alertes**:
- \> 1000 connexions simultanées
- \> 5 connexions/user
- \> 100 events/sec (spike suspect)
- Taux erreur WS > 5%

---

## Tests

### Messagerie

**Test 1: WebSocket connecté uniquement page ouverte**
```typescript
// apps/web/tests/e2e/messaging-websocket.spec.ts

test('should connect WS only when conversation page open', async ({ page }) => {
  await page.goto('/dashboard');

  // Vérifier aucune connexion WS
  const wsConnections = await page.evaluate(() => {
    return (window as any).__socketDebug?.connected || false;
  });
  expect(wsConnections).toBe(false);

  // Naviguer vers conversation
  await page.goto('/messages/conv-123');

  // Attendre connexion WS
  await expect
    .poll(() => page.evaluate(() => (window as any).__socketDebug?.connected))
    .toBe(true);
});
```

**Test 2: WebSocket fermé au leave**
```typescript
test('should disconnect WS when leaving conversation', async ({ page }) => {
  await page.goto('/messages/conv-123');

  // Attendre connexion
  await expect
    .poll(() => page.evaluate(() => (window as any).__socketDebug?.connected))
    .toBe(true);

  // Naviguer ailleurs
  await page.goto('/dashboard');

  // Vérifier déconnexion
  await expect
    .poll(() => page.evaluate(() => (window as any).__socketDebug?.connected))
    .toBe(false);
});
```

**Test 3: Fallback HTTP si WS fail**
```typescript
test('should fallback to HTTP if WS timeout', async ({ page, context }) => {
  // Mock WS timeout (pas de réponse ack 5s)
  await context.route('**/socket.io/**', route => route.abort());

  await page.goto('/messages/conv-123');

  // Envoyer message
  await page.fill('[data-testid="message-input"]', 'Hello');
  await page.click('[data-testid="send-button"]');

  // Vérifier fallback HTTP appelé
  const httpCalls = await page.evaluate(() => {
    return (window as any).__apiDebug?.lastCall || null;
  });
  expect(httpCalls.method).toBe('POST');
  expect(httpCalls.url).toContain('/api/messages');
});
```

### Réservations (Future)

**Test 1: Pro connecté reçoit event**
```typescript
test('should receive new booking event if pro dashboard open', async ({ page }) => {
  await page.goto('/pro/dashboard');

  // Simuler nouvelle demande backend
  await mockWebSocketEvent('new-booking', {
    id: 'booking-123',
    riderId: 'rider-456',
    date: '2026-02-15'
  });

  // Vérifier notification affichée
  await expect(page.locator('[data-testid="booking-notification"]')).toBeVisible();
});
```

**Test 2: Pro offline reçoit push**
```typescript
test('should send push notification if pro offline', async () => {
  // API test (pas Playwright)
  const pro = await createTestPro({ pushToken: 'test-token' });
  const rider = await createTestRider();

  // Créer demande
  await apiClient.createBookingRequest({
    proId: pro.id,
    riderId: rider.id,
    date: '2026-02-15'
  });

  // Vérifier push envoyé
  const pushCalls = await getPushNotificationCalls();
  expect(pushCalls).toContainEqual({
    token: 'test-token',
    title: 'Nouvelle demande de cours',
    data: { type: 'NEW_BOOKING' }
  });
});
```

### Blobomap

**Test: Aucune connexion WS**
```typescript
test('should NOT connect WS on map page', async ({ page }) => {
  await page.goto('/pro/map');

  // Attendre 2s (aucune connexion doit se faire)
  await page.waitForTimeout(2000);

  const wsConnected = await page.evaluate(() => {
    return (window as any).__socketDebug?.connected || false;
  });
  expect(wsConnected).toBe(false);
});
```

**Test: Fetch uniquement à l'interaction**
```typescript
test('should fetch pros only on map interaction', async ({ page }) => {
  await page.goto('/pro/map');

  // Compter requêtes API
  let apiCalls = 0;
  await page.route('**/api/pros/nearby**', route => {
    apiCalls++;
    route.fulfill({ status: 200, body: JSON.stringify([]) });
  });

  // Initial fetch au mount
  await page.waitForTimeout(500);
  expect(apiCalls).toBe(1);

  // Déplacer carte
  await page.locator('[data-testid="map"]').dispatchEvent('moveend');
  await page.waitForTimeout(500);
  expect(apiCalls).toBe(2);

  // Pas de fetch supplémentaire (pas de polling)
  await page.waitForTimeout(5000);
  expect(apiCalls).toBe(2); // Toujours 2
});
```

---

## Résumé Final (Anti-Confusion)

### Architecture par Feature

| Feature | Système | Fréquence | Déclencheur | Économie Serveur |
|---------|---------|-----------|-------------|------------------|
| **Dashboard Unread** | Polling optimisé leader | 60s | Leader election | ✅ 66% économie (1 poll pour N onglets) |
| **Messagerie** | WebSocket page-scoped | Temps réel | Mount page messages | ✅ Connexion seulement si page ouverte |
| **Réservations Rider** | Fetch | À l'ouverture | Mount page reservations | ✅ Pas de polling/WS inutile |
| **Réservations Pro** | Push notification | Event-driven | Nouvelle demande | ✅ Pas de WS permanent |
| **Blobomap** | Fetch on interaction | Sur action user | Déplacement carte | ✅ Pas de polling/WS |
| **Matching Cards** | Fetch | À l'ouverture | Mount page matching | ✅ Pas de polling/WS |

### Décisions Architecturales

**Temps réel = exception, pas règle**

1. **Dashboard**: Polling 60s suffit (données non-critiques)
2. **Messagerie**: WebSocket justifié (< 1s latence = valeur produit)
3. **Réservations**: Push notification suffit (1-2 demandes/jour, pro rarement connecté)
4. **Blobomap**: Fetch interaction suffit (exploration, pas monitoring)

**Jamais de WebSocket global**

- WebSocket **page-scoped** uniquement
- Connexion au mount, déconnexion au unmount
- Pas de singleton connecté partout

**Polling vs WebSocket**

- Polling: données non-critiques (> 30s latence acceptable)
- WebSocket: données critiques (< 5s latence nécessaire) + utilisateur actif

**Offline Strategy**

- WebSocket down → fallback HTTP (messagerie)
- User offline → push notification (réservations pro)
- Pas de WS → fetch au retour (dashboard, blobomap)

---

## Fichiers Architecture Existante

### Frontend (apps/web)

| Fichier | Rôle | Lignes Clés |
|---------|------|-------------|
| `lib/socket.ts` | Singleton Socket.io client | 1-75 |
| `hooks/useSocket.ts` | Hook connexion WS (auth, reconnect, errors) | 47-200 |
| `hooks/useChat.ts` | Hook messagerie (send, typing, fallback HTTP) | 150-400 |
| `app/messages/[id]/page-websocket.tsx` | Page conversation avec WS | 78-500 |
| `lib/emitWithAck.ts` | Wrapper emit avec timeout ack | 1-100 |
| `lib/socketUtils.ts` | Détection erreurs auth | 1-50 |
| `docs/CLIENT_WEBSOCKET_SECURITY.md` | Doc sécurité WS client | - |

### Backend (apps/api)

| Fichier | Rôle | Lignes Clés |
|---------|------|-------------|
| `src/lib/socket.ts` | Serveur Socket.io (auth, events, rooms) | 1-400 |
| `src/lib/socket-schemas.ts` | Validation Zod payloads inbound/outbound | 1-300 |
| `src/lib/socket-ack.ts` | Schémas ack (ok/error) | 1-100 |
| `src/lib/socket-rate-limit.ts` | Rate limiters par event | 1-150 |

---

## Références Documentation

- **Polling Dashboard**: `docs/ARCHITECTURE_POLLING_DASHBOARD.md`
- **Sécurité WebSocket Client**: `apps/web/docs/CLIENT_WEBSOCKET_SECURITY.md`
- **Contrat clientMsgId**: `apps/web/docs/CLIENT_MSG_ID_CONTRACT.md`
- **Sécurité Générale**: `SECURITY.md`

---

**Auteur**: Architecture Review
**Version**: 1.0
**Dernière MAJ**: 2026-02-01
