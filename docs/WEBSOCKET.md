# 🔌 WebSocket / Socket.io - Documentation

## Vue d'ensemble

Blob utilise **Socket.io** pour la messagerie temps réel et les notifications instantanées.

### Architecture

```
Frontend (Next.js)
    ↓ WebSocket (Socket.io-client)
Backend API (Express + Socket.io)
    ↓ Prisma
PostgreSQL
```

## 🚀 Démarrage rapide

### Backend (API)

Le serveur WebSocket démarre automatiquement avec l'API :

```bash
npm run dev:api
```

Logs attendus :
```
[API] Server ready on http://localhost:4000
[WebSocket] Socket.io ready on ws://localhost:4000
```

### Frontend (Next.js)

```typescript
import { useChat } from '@/hooks/useChat';

function ChatComponent({ conversationId, token }) {
  const { connected, sendMessage, otherUserTyping } = useChat({
    conversationId,
    token,
    onNewMessage: (message) => {
      console.log('Nouveau message:', message);
    }
  });

  return (
    <div>
      <p>Statut: {connected ? '✅ Connecté' : '❌ Déconnecté'}</p>
      {otherUserTyping && <p>L'autre utilisateur écrit...</p>}
      <button onClick={() => sendMessage('Hello!')}>
        Envoyer
      </button>
    </div>
  );
}
```

## 📡 Événements Socket.io

### Événements serveur → client

| Événement | Description | Données |
|-----------|-------------|---------|
| `new-message` | Nouveau message dans une conversation | `Message` |
| `user-typing` | Un utilisateur est en train d'écrire | `{ userId, isTyping }` |
| `error` | Erreur côté serveur | `{ message }` |

### Événements client → serveur

| Événement | Description | Données requises |
|-----------|-------------|------------------|
| `join-conversation` | Rejoindre une conversation | `conversationId` |
| `leave-conversation` | Quitter une conversation | `conversationId` |
| `send-message` | Envoyer un message | `{ conversationId, content, type }` |
| `typing` | Indicateur de frappe | `{ conversationId, isTyping }` |

## 🔐 Authentification

Chaque connexion WebSocket nécessite un **JWT valide**.

### Côté frontend

```typescript
import { useSocket } from '@/hooks/useSocket';

const { connected } = useSocket({
  token: accessToken, // JWT depuis /auth/login
  autoConnect: true
});
```

### Côté backend

Le middleware `authenticateSocket` vérifie :
1. Présence du token
2. Validité du JWT
3. Existence de l'utilisateur en DB

## 🧪 Test de connexion

### Méthode 1 : Composant de test

```tsx
import { SocketTestComponent } from '@/components/SocketTestComponent';

export default function TestPage() {
  const accessToken = '...'; // Récupérer depuis le store auth

  return <SocketTestComponent token={accessToken} />;
}
```

### Méthode 2 : Console navigateur

1. Ouvrir la console dev (F12)
2. Vérifier les logs :
   ```
   [WebSocket] Connected to server
   ```

### Méthode 3 : Network tab

1. Ouvrir l'onglet Network
2. Filtrer sur "WS" (WebSocket)
3. Vérifier la connexion à `ws://localhost:4000`

## 📦 Hooks disponibles

### `useSocket`

Hook bas niveau pour gérer la connexion Socket.io.

```typescript
const {
  socket,       // Instance Socket.io
  connected,    // État de connexion (boolean)
  connect,      // Se connecter manuellement
  disconnect,   // Se déconnecter
  emit,         // Émettre un événement
  on,           // Écouter un événement
  off           // Arrêter d'écouter
} = useSocket({ token, autoConnect: true });
```

### `useChat`

Hook haut niveau spécialisé pour les conversations.

```typescript
const {
  connected,        // État de connexion
  sendMessage,      // Envoyer un message
  setTyping,        // Indicateur de frappe
  otherUserTyping   // L'autre utilisateur écrit
} = useChat({
  conversationId,
  token,
  onNewMessage: (msg) => { /* ... */ }
});
```

## 🌐 Environnements

### Développement local

```env
# .env
NEXT_PUBLIC_API_URL=http://localhost:4000
```

Le WebSocket utilise automatiquement la même URL.

### Production (VPS Hetzner + Caddy)

```env
# .env.vps
NEXT_PUBLIC_API_URL=https://$API_DOMAIN
ALLOWED_ORIGINS=https://$APP_DOMAIN
TRUST_PROXY_MODE=ips
TRUSTED_PROXY_IPS=172.21.0.0/16
```

Caddy termine TLS sur le VPS et proxifie `$API_DOMAIN` vers `api:4000`.
Socket.IO utilise la même origine API que le client HTTP; le WSS est donc servi via
`https://$API_DOMAIN` avec upgrade WebSocket géré par Caddy.

## 🔧 Configuration Socket.io

### Côté serveur (`apps/api/src/lib/socket.ts`)

```typescript
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: origins,
    credentials: true
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,    // 60 secondes
  pingInterval: 25000    // Ping toutes les 25s
});
```

### Côté client (`apps/web/lib/socket.ts`)

```typescript
const socket = io(apiUrl, {
  autoConnect: false,
  withCredentials: true,
  auth: { token },
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionAttempts: 5
});
```

## 🐛 Debugging

### Activer les logs Socket.io

**Backend :**
```typescript
// apps/api/src/lib/socket.ts
import { Server } from 'socket.io';

const io = new Server(httpServer, {
  // ...
});

// Activer les logs de debug
io.engine.on("connection_error", (err) => {
  console.log(err.req);
  console.log(err.code);
  console.log(err.message);
});
```

**Frontend :**
```typescript
localStorage.debug = 'socket.io-client:*';
// Puis recharger la page
```

### Problèmes courants

#### ❌ "Authentication required"

**Cause :** Token JWT manquant ou invalide

**Solution :**
```typescript
// Vérifier que le token est fourni
const { connected } = useSocket({
  token: accessToken  // ⚠️ Doit être défini !
});
```

#### ❌ "CORS origin not allowed"

**Cause :** Origin frontend non autorisée

**Solution :**
```env
# .env (backend)
ALLOWED_ORIGINS=http://localhost:3002,http://localhost:3000
```

#### ❌ "Not a member of this conversation"

**Cause :** L'utilisateur n'est pas membre de la conversation

**Solution :** Vérifier en DB que `ConversationMember` existe.

## 📊 Monitoring

### Logs backend

```bash
# Voir les connexions en temps réel
npm run dev:api

# Logs attendus :
[WebSocket] User abc-123 connected (socket-xyz)
[WebSocket] User abc-123 joined conversation conv-456
[WebSocket] Message sent in conversation conv-456
```

### Métriques production

Sur la stack VPS, les WebSockets se diagnostiquent via :
- **Logs applicatifs** : connexions/déconnexions
- **Logs Caddy** : proxy TLS et upgrades WebSocket
- **RAM** : légère augmentation (connexions persistantes)

## 🚀 Déploiement

### VPS Docker Compose

Le déploiement production passe par `docs/ops/deploy-vps.md` et
`docker-compose.vps.yml`.

Caddy est le reverse proxy officiel et le fichier `docker/Caddyfile` définit le
transport HTTP avec un `read_timeout` long pour Socket.IO.

La configuration actuelle est qualifiée pour une seule réplique API. Ne pas supposer
de load balancing distribué tant qu'un adapter Redis Socket.IO et une stratégie de
session affinity n'ont pas été livrés et testés.

### Variables d'environnement requises

```bash
# Production uniquement
ALLOWED_ORIGINS=https://$APP_DOMAIN

# Trust proxy sûr (IP réelle pour protections pre-auth / per-IP)
TRUST_PROXY_MODE=ips
TRUSTED_PROXY_IPS=172.21.0.0/16

# Rate limiting handshake pre-auth (avant jwt.verify)
WS_PREAUTH_RL_ENABLED=true
WS_PREAUTH_RL_POINTS=30
WS_PREAUTH_RL_WINDOW_MS=10000
WS_PREAUTH_RL_BASE_BAN_MS=60000
WS_PREAUTH_RL_MAX_BAN_MS=600000

# Slow consumer guard (feature flag)
WS_SLOW_CONSUMER_GUARD=on
WS_SLOW_CONSUMER_CHECK_INTERVAL_MS=1000
WS_SLOW_CONSUMER_MAX_STREAK=5
WS_SLOW_CONSUMER_MAX_BUFFERED_PACKETS=128

# Burst amortization (local per-second)
WS_BURST_POINTS_PER_SEC=10
WS_BURST_CAPACITY=20
WS_BURST_STRICT_POINTS_PER_SEC=4
WS_BURST_STRICT_CAPACITY=8
WS_BURST_BLOCK_MS=1000

# Fanout budget
WS_PUSH_PER_MESSAGE_MAX=50
WS_PUSH_QUEUE_MAX_PENDING=500
WS_PUSH_QUEUE_CONCURRENCY=20
WS_CONVERSATION_TOUCH_MIN_INTERVAL_MS=1000
```

### Seuils par défaut (backend) et personnalisation

Les valeurs suivantes sont les **defaults effectifs** quand la variable n'est pas définie.
Pour les changer : définir la variable dans l'environnement de déploiement puis redémarrer l'API.

| Variable | Défaut | Rôle |
|----------|--------|------|
| `WS_PREAUTH_RL_ENABLED` | `true` (sauf `false` explicite) | Active le rate-limit pre-auth handshake |
| `WS_PREAUTH_RL_POINTS` | `30` | Requêtes handshake/IP par fenêtre |
| `WS_PREAUTH_RL_WINDOW_MS` | `10000` | Fenêtre de comptage (ms) |
| `WS_PREAUTH_RL_BASE_BAN_MS` | `60000` | Ban initial (ms) |
| `WS_PREAUTH_RL_MAX_BAN_MS` | `600000` | Ban max progressif (ms) |
| `WS_SLOW_CONSUMER_GUARD` | `off` | Active la protection slow-consumer (`on`/`off`) |
| `WS_SLOW_CONSUMER_CHECK_INTERVAL_MS` | `1000` | Fréquence de contrôle congestion (ms) |
| `WS_SLOW_CONSUMER_MAX_STREAK` | `5` | Nombre de checks congestifs avant disconnect |
| `WS_SLOW_CONSUMER_MAX_BUFFERED_PACKETS` | `128` | Seuil de buffer write |
| `WS_BURST_POINTS_PER_SEC` | `10` | Refill token bucket local (normal) |
| `WS_BURST_CAPACITY` | `20` | Capacité burst locale (normal) |
| `WS_BURST_STRICT_POINTS_PER_SEC` | `4` | Refill bucket strict (fallback Redis down) |
| `WS_BURST_STRICT_CAPACITY` | `8` | Capacité burst stricte |
| `WS_BURST_BLOCK_MS` | `1000` | Durée de blocage après burst |
| `WS_PUSH_PER_MESSAGE_MAX` | `50` | Budget max fanout push/message |
| `WS_PUSH_QUEUE_MAX_PENDING` | `500` | File max push en attente |
| `WS_PUSH_QUEUE_CONCURRENCY` | `20` | Concurrence d'exécution des push |
| `WS_CONVERSATION_TOUCH_MIN_INTERVAL_MS` | `1000` | Coalescing min des updates conversation |

### Lancer les tests WebSocket

```bash
# Suite WS hardening (P0/P1)
npm run test --workspace=@blobinfini/api -- --runInBand \
  src/lib/__tests__/socket-preauth-rate-limit.test.ts \
  src/lib/__tests__/socket-slow-consumer-guard.test.ts \
  src/lib/__tests__/socket-sendmessage-burst-rl.test.ts \
  src/lib/__tests__/socket-fanout-budget.test.ts \
  src/lib/__tests__/socket-sendmessage-global-rl.test.ts \
  src/lib/__tests__/socket-typing-flood.test.ts \
  src/lib/__tests__/socket-origin-authz.test.ts \
  src/lib/__tests__/socket-connection-limits.test.ts \
  src/lib/__tests__/socket-reconnection-storm.test.ts \
  src/lib/__tests__/socket-membership-revocation.test.ts \
  src/lib/__tests__/socket-auth-hardening.test.ts \
  src/lib/__tests__/socket-authz-typing.test.ts
```

## 💰 Coûts

**0€ supplémentaire côté service tiers WebSocket.**

Les WebSockets utilisent le même conteneur que l'API REST sur le VPS.

Impact ressources estimé (MVP < 1000 users) :
- RAM : +10-20 MB
- CPU : négligeable
- Bande passante : ~1 KB/message

## 📚 Ressources

- [Documentation Socket.io](https://socket.io/docs/v4/)
- [Socket.io avec React](https://socket.io/how-to/use-with-react)
- [Caddy reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
