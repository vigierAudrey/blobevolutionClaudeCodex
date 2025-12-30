# Guide d'utilisation i18n - BlobConnect

## 🌍 **Langues supportées**

- 🇫🇷 **Français** (défaut)
- 🇬🇧 **English**
- 🇪🇸 **Español**
- 🇩🇪 **Deutsch**
- 🇳🇱 **Nederlands**

---

## 📦 **Ce qui a été installé**

### Dépendances
- `next-intl` : Système d'internationalisation pour Next.js 14
- `cookies-next@4.2.1` : Gestion des cookies (compatible Next.js 14)

### Structure des fichiers
```
apps/web/
├── i18n/
│   └── request.ts          # Configuration next-intl
├── messages/
│   ├── fr.json            # Traductions françaises (200+ clés)
│   ├── en.json            # Traductions anglaises
│   ├── es.json            # Traductions espagnoles
│   ├── de.json            # Traductions allemandes
│   └── nl.json            # Traductions néerlandaises
├── components/i18n/
│   └── LanguageSelector.tsx  # Composant sélecteur de langue
├── app/layout.tsx         # Modifié pour inclure NextIntlClientProvider
└── next.config.mjs        # Modifié pour utiliser next-intl plugin
```

---

## 🚀 **Comment utiliser les traductions**

### Dans un Client Component

```tsx
'use client';

import { useTranslations } from 'next-intl';

export function MyComponent() {
  const t = useTranslations('dashboard');

  return (
    <div>
      <h1>{t('welcome')}</h1>
      <button>{t('bookNow')}</button>
    </div>
  );
}
```

### Dans un Server Component

```tsx
import { getTranslations } from 'next-intl/server';

export default async function MyPage() {
  const t = await getTranslations('dashboard');

  return (
    <div>
      <h1>{t('welcome')}</h1>
      <p>{t('yourStats')}</p>
    </div>
  );
}
```

### Avec des variables dynamiques

```tsx
const t = useTranslations('errors');

// Dans fr.json: "minLength": "Minimum {min} caractères requis"
<span>{t('minLength', { min: 8 })}</span>
// Résultat: "Minimum 8 caractères requis"
```

---

## 🎨 **Intégrer le sélecteur de langue**

### Exemple d'intégration dans une navbar

```tsx
import { LanguageSelector } from '@/components/i18n/LanguageSelector';

export function Navbar() {
  return (
    <nav className="flex items-center justify-between p-4">
      <Logo />
      <div className="flex items-center gap-4">
        <Menu />
        <LanguageSelector />  {/* Ajouter ici */}
      </div>
    </nav>
  );
}
```

### Exemple d'intégration dans un footer

```tsx
import { LanguageSelector } from '@/components/i18n/LanguageSelector';

export function Footer() {
  return (
    <footer className="border-t p-6">
      <div className="flex justify-between items-center">
        <p>© 2025 BlobConnect</p>
        <LanguageSelector />  {/* Ajouter ici */}
      </div>
    </footer>
  );
}
```

---

## 📝 **Ajouter de nouvelles traductions**

### 1. Ajouter une clé dans fr.json

```json
{
  "myFeature": {
    "title": "Mon nouveau titre",
    "description": "Ma description",
    "button": "Cliquez ici"
  }
}
```

### 2. Traduire dans les autres langues

Utilisez Claude/GPT pour générer les traductions :

**Prompt** :
```
Traduis ce JSON en anglais/espagnol/allemand/néerlandais :
{
  "myFeature": {
    "title": "Mon nouveau titre",
    "description": "Ma description",
    "button": "Cliquez ici"
  }
}
```

### 3. Utiliser dans un composant

```tsx
const t = useTranslations('myFeature');

<div>
  <h2>{t('title')}</h2>
  <p>{t('description')}</p>
  <button>{t('button')}</button>
</div>
```

---

## 🔧 **Modification du comportement**

### Changer la langue par défaut

Modifier `apps/web/i18n/request.ts` :

```typescript
export const DEFAULT_LOCALE = 'en'; // Au lieu de 'fr'
```

### Ajouter une langue

1. Ajouter le code dans `LOCALES` :
```typescript
export const LOCALES = ['fr', 'en', 'es', 'de', 'nl', 'it'] as const;
```

2. Créer `messages/it.json` avec toutes les traductions

3. Ajouter dans `LanguageSelector.tsx` :
```typescript
const LANGUAGES = [
  { code: 'fr', flag: '🇫🇷', label: 'Français' },
  // ... autres langues
  { code: 'it', flag: '🇮🇹', label: 'Italiano' },
];
```

---

## 🧪 **Tester les traductions**

### En local

1. Démarrer l'app :
```bash
npm run dev
```

2. Ouvrir http://localhost:3000

3. Cliquer sur le sélecteur de langue (🇫🇷 🇬🇧 🇪🇸 🇩🇪 🇳🇱)

4. Vérifier que le contenu change de langue

### En production

```bash
npm run build
npm start
```

---

## 📚 **Structure des namespaces**

Les traductions sont organisées par namespace dans les fichiers JSON :

| Namespace | Utilisation | Exemples |
|-----------|-------------|----------|
| `common` | Éléments génériques | welcome, loading, error, success |
| `nav` | Navigation | dashboard, messages, profile |
| `auth` | Authentification | login, register, password |
| `dashboard` | Tableau de bord | yourStats, recentActivity |
| `matching` | Recherche moniteurs | findInstructor, filters, location |
| `booking` | Réservations | book, confirm, cancel |
| `messages` | Chat | conversations, send, typeMessage |
| `profile` | Profil utilisateur | editProfile, bio, activities |
| `admin` | Administration | analytics, users, gdpr |
| `errors` | Messages d'erreur | generic, network, validation |
| `language` | Sélecteur de langue | select, fr, en, es, de, nl |

---

## 🎯 **Bonnes pratiques**

### ✅ À FAIRE

- Toujours utiliser `useTranslations()` pour les textes utilisateurs
- Grouper les traductions par feature/page
- Utiliser des clés descriptives (`bookNow` plutôt que `btn1`)
- Tester chaque nouvelle traduction dans toutes les langues

### ❌ À ÉVITER

- Ne jamais hardcoder du texte en français dans les composants
- Ne pas traduire les noms de marque ("Blob", "BlobConnect")
- Ne pas traduire les termes techniques internationaux ("Matching", "Pro")
- Ne pas mélanger plusieurs namespaces dans un composant (utiliser le plus spécifique)

---

## 🐛 **Dépannage**

### Erreur : "Locale not found"

**Solution** : Vérifiez que le fichier `messages/{locale}.json` existe

### Erreur : "Translation key not found"

**Solution** : Vérifiez que la clé existe dans le namespace utilisé

```tsx
// ❌ Mauvais
const t = useTranslations('dashboard');
t('login'); // Erreur : 'login' est dans 'auth', pas 'dashboard'

// ✅ Bon
const t = useTranslations('auth');
t('login'); // OK
```

### La langue ne change pas

**Solution** : Vider le cache navigateur ou utiliser mode privé

### Build échoue avec erreur TypeScript

**Solution** : Vérifier que tous les imports next-intl sont corrects

---

## 📖 **Ressources**

- [next-intl documentation](https://next-intl-docs.vercel.app/)
- [Roadmap i18n complète](./i18n-roadmap.md)
- [Issues GitHub next-intl](https://github.com/amannn/next-intl/issues)

---

**✅ Système i18n prêt à l'emploi pour 5 langues (FR, EN, ES, DE, NL)**
