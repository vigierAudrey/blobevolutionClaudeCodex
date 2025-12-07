# 🔌 WebSocket / Socket.io - Documentation

## Vue d'ensemble

Blobinfini utilise **Socket.io** pour la messagerie temps réel et les notifications instantanées.

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

### Production (Clever Cloud)

```env
# Variables d'environnement Vercel
NEXT_PUBLIC_API_URL=https://api.blobinfini.cleverapps.io
```

⚠️ **HTTPS automatique** : Clever Cloud gère le WSS (WebSocket Secure) automatiquement.

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

Sur Clever Cloud, les WebSockets apparaissent dans :
- **Logs applicatifs** : connexions/déconnexions
- **Métriques réseau** : nombre de connexions actives
- **RAM** : légère augmentation (connexions persistantes)

## 🚀 Déploiement

### Clever Cloud

**Aucune configuration supplémentaire nécessaire !**

Clever Cloud supporte WebSocket nativement :
- ✅ WSS (WebSocket Secure) automatique
- ✅ Sticky sessions gérées
- ✅ Load balancing compatible

### Variables d'environnement requises

```bash
# Production uniquement
ALLOWED_ORIGINS=https://blobinfini.vercel.app
```

## 💰 Coûts

**0€ supplémentaire** sur Clever Cloud.

Les WebSockets utilisent le même conteneur que l'API REST.

Impact ressources estimé (MVP < 1000 users) :
- RAM : +10-20 MB
- CPU : négligeable
- Bande passante : ~1 KB/message

## 📚 Ressources

- [Documentation Socket.io](https://socket.io/docs/v4/)
- [Socket.io avec React](https://socket.io/how-to/use-with-react)
- [Clever Cloud WebSocket](https://www.clever-cloud.com/doc/develop/websockets/)
