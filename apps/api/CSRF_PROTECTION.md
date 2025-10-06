# 🔒 Protection CSRF - Guide d'Utilisation

## Vue d'ensemble

La protection CSRF (Cross-Site Request Forgery) a été implémentée pour sécuriser tous les endpoints sensibles de l'API Blobinfini. Cette protection empêche les attaques malveillantes où un site tiers tenterait d'exécuter des actions non autorisées au nom d'un utilisateur authentifié.

## 🚀 Fonctionnement

### **Méthodes protégées**
- **POST** - Création de ressources
- **PUT** - Mise à jour complète
- **PATCH** - Mise à jour partielle
- **DELETE** - Suppression

### **Méthodes exemptées**
- **GET** - Lecture seulement
- **HEAD** - Métadonnées
- **OPTIONS** - Préflight CORS
- **Endpoint** `/health` - Monitoring

## 📡 Utilisation Côté Client

### **1. Récupérer un token CSRF**

```javascript
// Récupération du token
const response = await fetch('/csrf-token', {
  method: 'GET',
  credentials: 'include' // Important pour les cookies de session
});

const { csrfToken } = await response.json();
```

### **2. Inclure le token dans les requêtes**

**Option A: Header X-CSRF-Token (Recommandé)**
```javascript
fetch('/api/profile', {
  method: 'POST',
  credentials: 'include',
  headers: {
    'Content-Type': 'application/json',
    'X-CSRF-Token': csrfToken
  },
  body: JSON.stringify(data)
});
```

**Option B: Header X-XSRF-Token**
```javascript
headers: {
  'X-XSRF-Token': csrfToken
}
```

**Option C: Corps de la requête**
```javascript
body: JSON.stringify({
  ...data,
  _csrf: csrfToken
})
```

**Option D: Paramètre URL**
```javascript
fetch(`/api/profile?_csrf=${encodeURIComponent(csrfToken)}`, {
  method: 'POST',
  // ...
});
```

### **3. Utilisation avec le helper `apiRequest`**

```javascript
import { apiRequest } from '../lib/csrf';

// Le token CSRF est ajouté automatiquement
const response = await apiRequest('/profile', {
  method: 'POST',
  body: JSON.stringify(profileData)
});
```

## ⚡ Intégration Frontend

### **React/Next.js - Setup initial**

```jsx
// app/layout.tsx ou _app.tsx
import { preloadCSRFToken } from '../lib/csrf';

export default function RootLayout({ children }) {
  useEffect(() => {
    preloadCSRFToken(); // Précharge le token au démarrage
  }, []);

  return children;
}
```

### **Hook personnalisé pour les formulaires**

```jsx
// hooks/useCSRFProtectedForm.ts
import { csrfManager } from '../lib/csrf';

export function useCSRFProtectedForm() {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submitForm = async (url: string, data: any) => {
    setIsSubmitting(true);
    try {
      const headers = await csrfManager.getHeaders();
      const response = await fetch(url, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify(data)
      });
      return response;
    } finally {
      setIsSubmitting(false);
    }
  };

  return { submitForm, isSubmitting };
}
```

## 🔧 Configuration Serveur

### **Variables d'environnement**

```env
# .env
SESSION_SECRET=your-super-secret-session-key-change-in-production
NODE_ENV=production # Activera HTTPS-only cookies
```

### **Configuration session**

```javascript
// Configuré dans src/index.ts
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // HTTPS uniquement en prod
    httpOnly: true, // Pas d'accès JS côté client
    maxAge: 24 * 60 * 60 * 1000, // 24 heures
    sameSite: 'strict' // Protection contre CSRF
  }
}));
```

## 📊 Monitoring et Logs

### **Erreurs CSRF courantes**

| Code | Erreur | Solution |
|------|--------|----------|
| `CSRF_NO_SECRET` | Session sans secret | Rafraîchir la page |
| `CSRF_NO_TOKEN` | Token manquant | Ajouter header/body |
| `CSRF_INVALID_TOKEN` | Token invalide | Récupérer nouveau token |

### **Surveillance des erreurs**

```javascript
// Middleware de logging (déjà implémenté)
export function csrfErrorLogger(err, req, res, next) {
  if (err.code?.startsWith('CSRF_')) {
    console.warn(`CSRF Error: ${err.code} from ${req.ip}`, {
      userAgent: req.get('User-Agent'),
      referer: req.get('Referer'),
      path: req.path
    });
  }
  next(err);
}
```

## 🧪 Tests et Validation

### **Tests automatisés**

```bash
# Exécuter les tests CSRF
npm test -- --testPathPattern=csrf.test.ts

# Résultats attendus: 20 tests passants
# ✓ Protection méthodes unsafe
# ✓ Exemption méthodes safe
# ✓ Validation tokens
# ✓ Gestion sessions
```

### **Test manuel de l'API**

```bash
# 1. Récupérer un token
curl -c cookies.txt http://localhost:4000/csrf-token

# 2. Utiliser le token
curl -b cookies.txt \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: VOTRE_TOKEN" \
  -d '{"email":"test@example.com"}' \
  http://localhost:4000/auth/login
```

## 🎯 Bonnes Pratiques

### **Sécurité**
1. **Ne jamais exposer** le token dans l'URL (logs serveur)
2. **Utiliser HTTPS** en production
3. **Régénérer** les tokens régulièrement
4. **Valider** côté serveur uniquement

### **Performance**
1. **Cache** le token côté client
2. **Précharge** au démarrage de l'app
3. **Retry automatique** en cas d'expiration

### **UX**
1. **Gestion transparente** pour l'utilisateur
2. **Messages d'erreur** explicites
3. **Rafraîchissement automatique** des tokens

## 🔄 Migration depuis l'ancienne API

Si vous migrez du code existant sans CSRF :

```javascript
// Avant (sans CSRF)
fetch('/api/profile', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data)
});

// Après (avec CSRF)
import { apiRequest } from '../lib/csrf';

apiRequest('/profile', {
  method: 'POST',
  body: JSON.stringify(data)
});
```

## 📞 Support

En cas de problème avec la protection CSRF :

1. **Vérifier** les logs de l'API
2. **Tester** avec curl/Postman
3. **Consulter** les tests unitaires
4. **Contacter** l'équipe de développement

---

**Implémentation terminée le 20 septembre 2025**
**Couverture de tests : 20/20 tests passants**
**Endpoints protégés : 170+ endpoints sensibles**