# 🔄 Migration du Chat : Polling → WebSocket

## Changements apportés

### ❌ AVANT (Polling - inefficace)

```typescript
// Polling toutes les 10 secondes
pollingRef.current = window.setInterval(() => {
  void loadMessages();
}, 10000);
```

**Problèmes :**
- ⚠️ Latence minimum de 10 secondes
- ⚠️ Requêtes HTTP inutiles même sans nouveaux messages
- ⚠️ Consomme de la bande passante
- ⚠️ Pas d'indicateurs de frappe

### ✅ APRÈS (WebSocket - temps réel)

```typescript
const { connected, sendMessage, setTyping, otherUserTyping } = useChat({
  conversationId: id,
  token: accessToken,
  onNewMessage: (newMessage) => {
    setMessages(prev => [...prev, formattedMessage]);
    scrollToBottom();
  }
});
```

**Avantages :**
- ✅ Messages instantanés (<200ms)
- ✅ Pas de polling inutile
- ✅ Indicateurs de frappe en temps réel
- ✅ Fallback sur REST si WebSocket indisponible

## 📋 Plan de migration

### Étape 1 : Backup de l'ancienne version

```bash
# Sauvegarder la version actuelle
cp apps/web/app/messages/[id]/page.tsx apps/web/app/messages/[id]/page-polling-backup.tsx
```

### Étape 2 : Remplacer par la nouvelle version

```bash
# Remplacer par la version WebSocket
cp apps/web/app/messages/[id]/page-websocket.tsx apps/web/app/messages/[id]/page.tsx
```

### Étape 3 : Gérer le token d'accès

**Option A : Via Context API (Recommandé)**

Créer un contexte d'authentification :

```typescript
// app/providers/AuthProvider.tsx
'use client';

import { createContext, useContext, useState, useEffect } from 'react';

interface AuthContextType {
  accessToken: string | null;
  setAccessToken: (token: string | null) => void;
}

const AuthContext = createContext<AuthContextType>({
  accessToken: null,
  setAccessToken: () => {}
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);

  useEffect(() => {
    // Charger depuis localStorage au montage
    const token = localStorage.getItem('accessToken');
    setAccessToken(token);
  }, []);

  return (
    <AuthContext.Provider value={{ accessToken, setAccessToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
```

Puis dans `app/layout.tsx` :

```typescript
import { AuthProvider } from './providers/AuthProvider';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
```

Enfin dans `page.tsx` :

```typescript
import { useAuth } from '@/app/providers/AuthProvider';

export default function ConversationPage() {
  const { accessToken } = useAuth();

  const { connected } = useChat({
    conversationId: id,
    token: accessToken || '',
    // ...
  });
}
```

**Option B : Via localStorage (Version actuelle - simple)**

```typescript
// Dans le composant
const [accessToken, setAccessToken] = useState<string>('');

useEffect(() => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    setAccessToken(token);
  }
}, []);
```

### Étape 4 : Tester

1. **Ouvrir 2 onglets** (ou 2 navigateurs)
2. **Se connecter** avec 2 comptes différents
3. **Ouvrir la même conversation**
4. **Envoyer un message** dans l'onglet 1
5. **Vérifier** que l'onglet 2 reçoit instantanément

## 🎨 Nouvelles fonctionnalités

### 1. Indicateur de connexion WebSocket

```tsx
{connected ? (
  <span className="inline-flex items-center gap-1 rounded-full bg-green-100 text-green-700 px-2 py-1 text-xs">
    <Wifi size={12}/> Temps réel
  </span>
) : (
  <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 text-gray-700 px-2 py-1 text-xs">
    <WifiOff size={12}/> Hors ligne
  </span>
)}
```

### 2. Indicateur de frappe

```tsx
{otherUserTyping && (
  <div className="text-xs text-muted-foreground italic">
    {conversationInfo?.otherDisplayName} est en train d'écrire...
  </div>
)}
```

### 3. Fallback REST automatique

```typescript
if (connected) {
  sendMessage(input.trim(), 'TEXT');
} else {
  // Fallback sur REST API
  await apiClient.sendMessage(id, payload);
}
```

## 🐛 Résolution de problèmes

### Problème 1 : "Cannot read property 'token' of undefined"

**Cause :** Le token n'est pas disponible au montage du composant

**Solution :**

```typescript
const { connected } = useChat({
  conversationId: id,
  token: accessToken || '', // ⚠️ Toujours fournir une string (vide si pas de token)
  onNewMessage: (msg) => { /* ... */ }
});
```

### Problème 2 : Messages en double

**Cause :** Le callback `onNewMessage` ajoute sans vérifier les doublons

**Solution :** Déjà implémentée dans la nouvelle version

```typescript
onNewMessage: (newMessage) => {
  setMessages(prev => {
    // Éviter les doublons
    if (prev.some(m => m.id === formattedMessage.id)) {
      return prev;
    }
    return [...prev, formattedMessage];
  });
}
```

### Problème 3 : WebSocket ne se connecte pas

**Checklist :**

1. ✅ L'API est démarrée ? (`npm run dev:api`)
2. ✅ Le token est valide ? (vérifier dans localStorage)
3. ✅ `NEXT_PUBLIC_API_URL` est correct ? (`.env`)
4. ✅ Pas d'erreur CORS ? (vérifier console navigateur)

**Debug :**

```typescript
// Activer les logs Socket.io
useEffect(() => {
  localStorage.debug = 'socket.io-client:*';
}, []);
```

### Problème 4 : "Authentication required"

**Cause :** Le token JWT est expiré ou invalide

**Solution :**

```typescript
// Rafraîchir le token avant de se connecter
const refreshToken = async () => {
  try {
    const response = await apiClient.refreshToken();
    localStorage.setItem('accessToken', response.accessToken);
    setAccessToken(response.accessToken);
  } catch (err) {
    // Rediriger vers login si refresh échoue
    router.push('/login');
  }
};
```

## 📊 Comparaison performances

| Métrique | Polling (avant) | WebSocket (après) |
|----------|----------------|-------------------|
| Latence message | 5-10 secondes | <200ms |
| Requêtes HTTP/min | 6 (même sans messages) | 0 (sauf envoi) |
| Bande passante | ~100 KB/min | ~1 KB/message |
| CPU backend | Moyen (polling constant) | Faible (événements) |
| UX indicateur frappe | ❌ Impossible | ✅ Temps réel |

## 🚀 Prochaines améliorations

1. **Accusés de lecture** (messages lus/non lus en temps réel)
2. **Notifications push** quand message reçu et app fermée
3. **Réaction rapide** (👍 sur messages)
4. **Statut en ligne** de l'autre utilisateur
5. **Partage de fichiers** (images/vidéos)

## 📝 Checklist de migration

- [ ] Backup de l'ancienne version
- [ ] Remplacer par `page-websocket.tsx`
- [ ] Configurer la gestion du token (Context ou localStorage)
- [ ] Tester avec 2 comptes différents
- [ ] Vérifier l'indicateur de connexion
- [ ] Tester l'indicateur de frappe
- [ ] Tester le fallback REST (couper le serveur WebSocket)
- [ ] Vérifier qu'il n'y a pas de doublons de messages
- [ ] Déployer en staging
- [ ] Monitorer les erreurs Sentry

## 💡 Notes importantes

- ⚠️ **Ne pas supprimer le fallback REST** : certains réseaux bloquent WebSocket
- ⚠️ **Toujours afficher l'état de connexion** : l'utilisateur doit savoir s'il est en temps réel
- ⚠️ **Gérer la reconnexion** : le hook `useChat` le fait automatiquement
- ⚠️ **Tester sur mobile** : certains navigateurs mobiles gèrent différemment les WebSockets
