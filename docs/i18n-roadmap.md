# Roadmap Internationalisation (i18n) - BlobConnect

**Date de création** : 2025-12-29
**Objectif** : Ajouter support multilingue (FR, EN, ES, DE, NL) avec next-intl
**Durée estimée** : 2-3 jours avec IA
**Approche** : Français par défaut + sélecteur de langue (pas de routing `/[locale]`)

---

## 🎯 Langues supportées

| Langue | Code | Flag | Marché cible |
|--------|------|------|--------------|
| Français | `fr` | 🇫🇷 | Local (défaut) |
| English | `en` | 🇬🇧 | Touristes UK/internationaux |
| Español | `es` | 🇪🇸 | Touristes espagnols |
| Deutsch | `de` | 🇩🇪 | Touristes allemands |
| Nederlands | `nl` | 🇳🇱 | Touristes néerlandais |

---

## 📋 ÉTAPE 1 : Setup next-intl (Configuration de base)

### Checkpoint 1.1 : Installation dépendances

```bash
cd apps/web
npm install next-intl
npm install cookies-next  # Pour stocker la préférence utilisateur
```

**✅ Validation** : Vérifier `package.json` contient `"next-intl"` et `"cookies-next"`

---

### Checkpoint 1.2 : Créer structure des fichiers de traduction

```bash
mkdir -p apps/web/messages
mkdir -p apps/web/i18n
```

**Créer** : `apps/web/messages/.gitkeep` (pour commiter le dossier vide)

**✅ Validation** : Les dossiers `messages/` et `i18n/` existent

---

### Checkpoint 1.3 : Configuration next-intl

**Créer** : `apps/web/i18n/request.ts`

```typescript
import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';

export const LOCALES = ['fr', 'en', 'es', 'de', 'nl'] as const;
export const DEFAULT_LOCALE = 'fr';

export default getRequestConfig(async () => {
  // 1. Vérifier si l'utilisateur a déjà choisi une langue (cookie)
  const cookieStore = cookies();
  const savedLocale = cookieStore.get('NEXT_LOCALE')?.value;

  // 2. Utiliser la langue sauvegardée ou fallback FR
  const locale = (savedLocale && LOCALES.includes(savedLocale as any))
    ? savedLocale
    : DEFAULT_LOCALE;

  // 3. Charger les traductions
  let messages;
  try {
    messages = (await import(`../messages/${locale}.json`)).default;
  } catch (error) {
    // Fallback si fichier de traduction manquant
    messages = (await import(`../messages/fr.json`)).default;
  }

  return {
    locale,
    messages,
  };
});
```

**✅ Validation** : Le fichier compile sans erreur TypeScript

---

### Checkpoint 1.4 : Configurer next.config.mjs

**Modifier** : `apps/web/next.config.mjs`

```javascript
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // ... votre config existante
};

export default withNextIntl(nextConfig);
```

**✅ Validation** : `npm run build` réussit sans erreur

---

### Checkpoint 1.5 : Wrapper le layout avec NextIntlClientProvider

**Modifier** : `apps/web/app/layout.tsx`

```tsx
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <head>
        <ThemeScript />
        {/* ... scripts existants */}
      </head>
      <body className="min-h-screen bg-background text-foreground">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ClientProvider>
            <main className="container-responsive py-6 sm:py-10">{children}</main>
            <CookieConsent />
          </ClientProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```

**⚠️ IMPORTANT** : Si erreur "Cannot use Server Components inside Client Provider", déplacer NextIntlClientProvider APRÈS ClientProvider.

**✅ Validation** : `npm run dev` démarre sans erreur

---

## 📋 ÉTAPE 2 : Extraction des strings (Audit du codebase)

### Checkpoint 2.1 : Scanner les composants pour strings hardcodées

**Script d'extraction** : `scripts/extract-i18n-strings.js`

```javascript
#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const glob = require('glob');

const COMPONENTS_DIR = 'apps/web';
const OUTPUT_FILE = 'docs/i18n-strings-extracted.json';

// Patterns pour détecter les strings françaises
const patterns = [
  // JSX text content: <button>Texte</button>
  />([^<>{}]+)</g,
  // Attributs: placeholder="Texte"
  /placeholder=["']([^"']+)["']/g,
  /title=["']([^"']+)["']/g,
  /aria-label=["']([^"']+)["']/g,
  // Strings dans le code
  /['"]([À-ÿa-zéèêëàâäôöùûüïîç\s,!?.'-]{3,})['"](?!\s*:)/gi,
];

function extractStrings() {
  const files = glob.sync(`${COMPONENTS_DIR}/**/*.{tsx,ts}`, {
    ignore: ['**/node_modules/**', '**/.next/**', '**/dist/**']
  });

  const strings = new Map();

  files.forEach(file => {
    const content = fs.readFileSync(file, 'utf-8');
    patterns.forEach(pattern => {
      const matches = [...content.matchAll(pattern)];
      matches.forEach(match => {
        const text = match[1].trim();
        // Filtrer les strings techniques (import paths, etc.)
        if (text && !text.includes('/') && !text.includes('\\') && text.length > 2) {
          if (!strings.has(text)) {
            strings.set(text, []);
          }
          strings.get(text).push({ file, line: getLineNumber(content, match.index) });
        }
      });
    });
  });

  const result = Object.fromEntries(
    Array.from(strings.entries())
      .filter(([text]) => /[À-ÿéèêëàâäôöùûüïîç]/.test(text)) // Garder seulement strings françaises
      .sort()
  );

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2));
  console.log(`✅ ${Object.keys(result).length} strings extraites → ${OUTPUT_FILE}`);
}

function getLineNumber(content, index) {
  return content.substring(0, index).split('\n').length;
}

extractStrings();
```

**Exécution** :

```bash
node scripts/extract-i18n-strings.js
```

**✅ Validation** : Le fichier `docs/i18n-strings-extracted.json` existe et contient des strings françaises

---

### Checkpoint 2.2 : Organiser les strings par namespace

**Créer** : `apps/web/messages/fr.json` (structure de base)

```json
{
  "common": {
    "welcome": "Bienvenue !",
    "loading": "Chargement...",
    "error": "Une erreur est survenue",
    "success": "Opération réussie",
    "cancel": "Annuler",
    "confirm": "Confirmer",
    "save": "Enregistrer",
    "delete": "Supprimer",
    "edit": "Modifier",
    "close": "Fermer"
  },
  "nav": {
    "dashboard": "Tableau de bord",
    "matching": "Matching",
    "messages": "Messages",
    "booking": "Réservations",
    "profile": "Profil",
    "logout": "Déconnexion"
  },
  "auth": {
    "login": "Connexion",
    "register": "Inscription",
    "email": "Adresse email",
    "password": "Mot de passe",
    "forgotPassword": "Mot de passe oublié ?",
    "sessionExpired": "Session expirée, veuillez vous reconnecter"
  },
  "dashboard": {
    "welcome": "Bienvenue !",
    "yourStats": "Vos statistiques",
    "recentActivity": "Activité récente"
  },
  "matching": {
    "findInstructor": "Trouver un moniteur",
    "findStudent": "Trouver des élèves",
    "filters": "Filtres",
    "location": "Localisation",
    "activity": "Activité",
    "level": "Niveau"
  },
  "booking": {
    "book": "Réserver",
    "bookNow": "Réserver maintenant",
    "selectDate": "Choisir une date",
    "selectTime": "Choisir un horaire",
    "confirm": "Confirmer la réservation",
    "cancel": "Annuler la réservation",
    "pending": "En attente",
    "confirmed": "Confirmée",
    "completed": "Terminée"
  },
  "messages": {
    "conversations": "Conversations",
    "newMessage": "Nouveau message",
    "typeMessage": "Tapez votre message...",
    "send": "Envoyer",
    "noConversations": "Aucune conversation"
  },
  "profile": {
    "editProfile": "Modifier le profil",
    "personalInfo": "Informations personnelles",
    "firstName": "Prénom",
    "lastName": "Nom",
    "bio": "Biographie",
    "activities": "Activités",
    "certifications": "Certifications"
  },
  "errors": {
    "generic": "Une erreur est survenue, veuillez réessayer",
    "network": "Erreur de connexion au serveur",
    "unauthorized": "Vous n'êtes pas autorisé à effectuer cette action",
    "notFound": "Page non trouvée",
    "validation": "Veuillez vérifier les informations saisies"
  }
}
```

**⚠️ CHECKPOINT CRITIQUE** : Ce fichier sera la base pour toutes les traductions. Vérifier qu'il couvre tous les cas d'usage principaux.

**✅ Validation** : Lire le fichier et vérifier qu'il compile en JSON valide

---

## 📋 ÉTAPE 3 : Génération des traductions avec IA

### Checkpoint 3.1 : Traduire EN (anglais)

**Prompt pour Claude/GPT** :

```
Voici le fichier de traduction français de mon application de sports de glisse (surf/kite).
Traduis-le en anglais britannique en gardant :
- Le même format JSON exact
- Les mêmes clés (ne traduis QUE les valeurs)
- Le contexte des sports nautiques
- Un ton professionnel mais accessible
- Les termes techniques appropriés (ex: "Blob" reste "Blob" car c'est la marque)

JSON à traduire :
[COLLER apps/web/messages/fr.json]

Réponds UNIQUEMENT avec le JSON traduit, sans commentaires.
```

**Sauvegarder la réponse** dans `apps/web/messages/en.json`

**✅ Validation** :
```bash
node -e "console.log(Object.keys(require('./apps/web/messages/en.json')).length)"
node -e "console.log(Object.keys(require('./apps/web/messages/fr.json')).length)"
# Les deux doivent retourner le même nombre
```

---

### Checkpoint 3.2 : Traduire ES (espagnol)

**Prompt** :

```
Traduis ce fichier en espagnol d'Espagne (pas d'Amérique latine).
Contexte : plateforme de sports de glisse pour touristes espagnols en France.

[COLLER apps/web/messages/fr.json]

Réponds UNIQUEMENT avec le JSON traduit.
```

**Sauvegarder** dans `apps/web/messages/es.json`

**✅ Validation** : Même test que EN

---

### Checkpoint 3.3 : Traduire DE (allemand)

**Prompt** :

```
Traduis ce fichier en allemand standard.
Contexte : plateforme de sports nautiques pour touristes allemands en France.
Utilise le "Sie" (forme polie) pour les textes utilisateur.

[COLLER apps/web/messages/fr.json]

Réponds UNIQUEMENT avec le JSON traduit.
```

**Sauvegarder** dans `apps/web/messages/de.json`

**✅ Validation** : Même test

---

### Checkpoint 3.4 : Traduire NL (néerlandais)

**Prompt** :

```
Traduis ce fichier en néerlandais standard.
Contexte : plateforme de sports de glisse pour touristes néerlandais en France.
Utilise un ton amical et direct (typique du néerlandais).

[COLLER apps/web/messages/fr.json]

Réponds UNIQUEMENT avec le JSON traduit.
```

**Sauvegarder** dans `apps/web/messages/nl.json`

**✅ Validation** : Même test

---

### Checkpoint 3.5 : Validation globale des traductions

**Script de validation** :

```bash
# Vérifier que tous les fichiers ont les mêmes clés
node -e "
const fr = require('./apps/web/messages/fr.json');
const en = require('./apps/web/messages/en.json');
const es = require('./apps/web/messages/es.json');
const de = require('./apps/web/messages/de.json');
const nl = require('./apps/web/messages/nl.json');

const frKeys = JSON.stringify(Object.keys(fr).sort());
const errors = [];

if (JSON.stringify(Object.keys(en).sort()) !== frKeys) errors.push('EN');
if (JSON.stringify(Object.keys(es).sort()) !== frKeys) errors.push('ES');
if (JSON.stringify(Object.keys(de).sort()) !== frKeys) errors.push('DE');
if (JSON.stringify(Object.keys(nl).sort()) !== frKeys) errors.push('NL');

if (errors.length > 0) {
  console.error('❌ Clés manquantes dans : ' + errors.join(', '));
  process.exit(1);
} else {
  console.log('✅ Toutes les traductions sont cohérentes');
}
"
```

**✅ Validation** : Le script affiche "✅ Toutes les traductions sont cohérentes"

---

## 📋 ÉTAPE 4 : Composant LanguageSelector

### Checkpoint 4.1 : Créer le composant

**Créer** : `apps/web/components/i18n/LanguageSelector.tsx`

```tsx
'use client';

import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { setCookie } from 'cookies-next';
import { useState } from 'react';

const LANGUAGES = [
  { code: 'fr', flag: '🇫🇷', label: 'Français' },
  { code: 'en', flag: '🇬🇧', label: 'English' },
  { code: 'es', flag: '🇪🇸', label: 'Español' },
  { code: 'de', flag: '🇩🇪', label: 'Deutsch' },
  { code: 'nl', flag: '🇳🇱', label: 'Nederlands' },
] as const;

export function LanguageSelector() {
  const locale = useLocale();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);

  const currentLang = LANGUAGES.find(lang => lang.code === locale) || LANGUAGES[0];

  const handleLanguageChange = (newLocale: string) => {
    // Sauvegarder la préférence (expire dans 1 an)
    setCookie('NEXT_LOCALE', newLocale, {
      maxAge: 365 * 24 * 60 * 60,
      path: '/',
    });

    // Rafraîchir la page pour appliquer la nouvelle langue
    router.refresh();
    setIsOpen(false);
  };

  return (
    <div className="relative">
      {/* Bouton actuel */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 transition-colors"
        aria-label="Changer de langue"
      >
        <span className="text-xl">{currentLang.flag}</span>
        <span className="hidden sm:inline text-sm font-medium">{currentLang.label}</span>
        <svg
          className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <>
          {/* Backdrop pour fermer en cliquant à côté */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />

          {/* Menu des langues */}
          <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-20">
            {LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                onClick={() => handleLanguageChange(lang.code)}
                className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors first:rounded-t-lg last:rounded-b-lg ${
                  locale === lang.code ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                }`}
              >
                <span className="text-2xl">{lang.flag}</span>
                <span className="text-sm font-medium">{lang.label}</span>
                {locale === lang.code && (
                  <svg className="w-4 h-4 ml-auto text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
```

**✅ Validation** : Le fichier compile sans erreur TypeScript

---

### Checkpoint 4.2 : Intégrer dans la navbar

**À DÉTERMINER** : Localisation exacte de votre navbar. Rechercher le composant :

```bash
cd apps/web
grep -r "nav\|Nav\|header\|Header" --include="*.tsx" components/ app/ | grep -i "component\|export"
```

**Une fois trouvé**, ajouter :

```tsx
import { LanguageSelector } from '@/components/i18n/LanguageSelector';

export function Navbar() {
  return (
    <nav className="...">
      {/* ... éléments existants ... */}

      {/* Ajouter le sélecteur */}
      <LanguageSelector />
    </nav>
  );
}
```

**⚠️ ATTENTION** : Si erreur "Cannot use Client Component in Server Component", wrapper uniquement le LanguageSelector avec un boundary client.

**✅ Validation** :
- `npm run dev`
- Ouvrir l'app
- Voir les drapeaux 🇫🇷 🇬🇧 🇪🇸 🇩🇪 🇳🇱 dans la navbar
- Cliquer dessus → menu dropdown s'ouvre

---

## 📋 ÉTAPE 5 : Refactoring des composants

### Checkpoint 5.1 : Identifier les composants prioritaires

**Pages critiques** (parcours utilisateur) :

1. `/dashboard` - Page d'accueil
2. `/matching/*` - Recherche moniteurs/élèves
3. `/booking/*` - Réservations
4. `/messages/*` - Chat
5. `/profile/*` - Profil utilisateur
6. Composants auth (login/register)
7. **NOUVEAUX (feat/storybook-react-webpack5)** :
   - `components/ConversationInvitations.tsx` (~5 strings)
   - `app/admin/analytics/page.tsx` (~50+ strings) **PRIORITAIRE**

**✅ Validation** : Lister tous les fichiers à modifier dans `docs/i18n-refactoring-list.txt`

---

### Checkpoint 5.2 : Pattern de refactoring

**AVANT** (hardcodé) :

```tsx
export function Dashboard() {
  return (
    <div>
      <h1>Bienvenue !</h1>
      <button>Réserver un cours</button>
      <p>Trouvez votre moniteur idéal</p>
    </div>
  );
}
```

**APRÈS** (avec next-intl) :

```tsx
'use client'; // Si composant client
import { useTranslations } from 'next-intl';

export function Dashboard() {
  const t = useTranslations('dashboard');

  return (
    <div>
      <h1>{t('welcome')}</h1>
      <button>{t('bookButton')}</button>
      <p>{t('findInstructor')}</p>
    </div>
  );
}
```

**Pour Server Components** :

```tsx
import { getTranslations } from 'next-intl/server';

export default async function DashboardPage() {
  const t = await getTranslations('dashboard');

  return (
    <div>
      <h1>{t('welcome')}</h1>
      {/* ... */}
    </div>
  );
}
```

---

### Checkpoint 5.3 : Refactoring Dashboard

**Fichier** : `apps/web/app/dashboard/page.tsx`

1. Lire le fichier actuel
2. Identifier toutes les strings FR
3. Ajouter les clés correspondantes dans `messages/fr.json` (namespace `dashboard`)
4. Refactoriser avec `useTranslations('dashboard')`
5. Tester avec chaque langue

**✅ Validation** :
```bash
npm run dev
# Ouvrir /dashboard
# Changer de langue → tout doit se traduire
```

---

### Checkpoint 5.4 : Refactoring Matching

**Fichiers** :
- `apps/web/app/matching/cards/CardsClient.tsx`
- `apps/web/app/matching/results/page.tsx`
- Autres fichiers dans `matching/`

**Process** : Même que 5.3

**✅ Validation** : Parcours complet de matching dans toutes les langues

---

### Checkpoint 5.5 : Refactoring Booking

**Fichiers** : Tous les fichiers dans `apps/web/app/booking/`

**⚠️ ATTENTION** : Vérifier les messages d'erreur de validation (côté API aussi si nécessaire)

**✅ Validation** : Créer une réservation de test dans chaque langue

---

### Checkpoint 5.6 : Refactoring Messages

**Fichiers** :
- `apps/web/app/messages/page.tsx`
- `apps/web/app/messages/[id]/page.tsx`
- `apps/web/components/ConversationMembers.tsx`

**✅ Validation** : Interface de chat complète dans toutes les langues

---

### Checkpoint 5.7 : Refactoring Auth & Erreurs

**Fichiers** :
- Composants de login/register (à identifier)
- Messages d'erreur API (`apps/web/lib/apiClient.ts`)

**⚠️ CRITIQUE** : Les erreurs doivent être cohérentes côté API et front

**Approche** :
```tsx
// API retourne des error codes
{ error: 'SESSION_EXPIRED' }

// Front traduit selon la langue
const t = useTranslations('errors');
const errorMessage = t(error.code); // → "Session expirée" / "Session expired"
```

**✅ Validation** : Tester tous les cas d'erreur (session expirée, validation, réseau, etc.)

---

## 📋 ÉTAPE 6 : Gestion de l'API backend

### Checkpoint 6.1 : Localiser les réponses API avec strings FR

**Fichiers à vérifier** :
- `apps/api/src/**/*.ts`
- Chercher les `res.json({ message: "..." })`

**Stratégie recommandée** :
- **API retourne des error codes** (ex: `SESSION_EXPIRED`, `INVALID_CREDENTIALS`)
- **Front traduit** selon la langue utilisateur

**Alternative** (si beaucoup de strings) :
- Ajouter header `Accept-Language` dans les requêtes
- API retourne le texte traduit

**✅ Validation** : Documenter la stratégie choisie dans `docs/i18n-api-strategy.md`

---

## 📋 ÉTAPE 7 : Tests et validation

### Checkpoint 7.1 : Tests manuels complets

**Checklist par langue** (FR, EN, ES, DE, NL) :

- [ ] Changer de langue via le sélecteur
- [ ] La préférence persiste après rechargement
- [ ] Dashboard s'affiche correctement
- [ ] Matching fonctionne (recherche, filtres, résultats)
- [ ] Booking fonctionne (sélection date, confirmation)
- [ ] Messages fonctionnent (liste, envoi, réception)
- [ ] Profil fonctionne (édition, sauvegarde)
- [ ] Login/Register fonctionnent
- [ ] Messages d'erreur s'affichent traduits
- [ ] Les formulaires valident correctement
- [ ] Aucune string FR n'apparaît dans les autres langues

**✅ Validation** : Cocher tous les items pour les 5 langues (25 checks)

---

### Checkpoint 7.2 : Tests de régression

**Vérifier que les fonctionnalités existantes fonctionnent toujours** :

```bash
# Si vous avez des tests
npm run test

# Build de production
npm run build

# Vérifier qu'il n'y a pas d'erreurs TypeScript
npm run type-check
```

**✅ Validation** : Aucune régression détectée

---

### Checkpoint 7.3 : Tests de performance

**Métriques à vérifier** :

- **Taille des bundles** : `npm run build` → vérifier la taille
- **Temps de chargement initial** : Ne doit pas augmenter significativement
- **Switching de langue** : Doit être instantané (< 500ms)

**✅ Validation** : Performances acceptables

---

## 📋 ÉTAPE 8 : Documentation et déploiement

### Checkpoint 8.1 : Mettre à jour README

**Ajouter section** dans `README.md` :

```markdown
## 🌍 Internationalisation

L'application supporte 5 langues :
- 🇫🇷 Français (défaut)
- 🇬🇧 English
- 🇪🇸 Español
- 🇩🇪 Deutsch
- 🇳🇱 Nederlands

### Ajouter une traduction

1. Modifier `apps/web/messages/fr.json`
2. Utiliser Claude/GPT pour générer les autres langues
3. Valider avec `node scripts/validate-translations.js`

### Utiliser les traductions dans un composant

```tsx
import { useTranslations } from 'next-intl';

export function MyComponent() {
  const t = useTranslations('myNamespace');
  return <div>{t('myKey')}</div>;
}
```
```

**✅ Validation** : Documentation claire et complète

---

### Checkpoint 8.2 : Créer script de maintenance

**Créer** : `scripts/validate-translations.js`

```javascript
#!/usr/bin/env node
const fs = require('fs');

const LOCALES = ['fr', 'en', 'es', 'de', 'nl'];

function validateTranslations() {
  const fr = JSON.parse(fs.readFileSync('apps/web/messages/fr.json', 'utf-8'));
  const frKeys = JSON.stringify(Object.keys(fr).sort());

  let hasErrors = false;

  LOCALES.slice(1).forEach(locale => {
    const path = `apps/web/messages/${locale}.json`;
    const data = JSON.parse(fs.readFileSync(path, 'utf-8'));
    const keys = JSON.stringify(Object.keys(data).sort());

    if (keys !== frKeys) {
      console.error(`❌ ${locale.toUpperCase()} : Clés manquantes ou en trop`);
      hasErrors = true;
    } else {
      console.log(`✅ ${locale.toUpperCase()} : OK`);
    }
  });

  if (hasErrors) {
    process.exit(1);
  } else {
    console.log('\n✅ Toutes les traductions sont valides');
  }
}

validateTranslations();
```

**Ajouter** dans `package.json` :

```json
{
  "scripts": {
    "i18n:validate": "node scripts/validate-translations.js"
  }
}
```

**✅ Validation** : `npm run i18n:validate` réussit

---

### Checkpoint 8.3 : Configuration production

**Variables d'environnement** (si nécessaire) :

```bash
# .env.production
NEXT_PUBLIC_DEFAULT_LOCALE=fr
NEXT_PUBLIC_SUPPORTED_LOCALES=fr,en,es,de,nl
```

**✅ Validation** : Build production réussit

---

### Checkpoint 8.4 : Déploiement

```bash
# Build final
npm run build

# Test en local
npm run start

# Tester toutes les langues en production
```

**✅ Validation** : Application fonctionne en production avec toutes les langues

---

## 🆘 EN CAS DE BUG / INTERRUPTION

### Comment reprendre le travail

1. **Lire ce fichier** : `docs/i18n-roadmap.md`
2. **Vérifier la todo list** : Relancer Claude avec "reprends le travail i18n, où en sommes-nous ?"
3. **Identifier le dernier checkpoint validé** : Chercher les ✅ dans les commits
4. **Reprendre au checkpoint suivant**

### Prompt de reprise pour l'IA

```
Je travaillais sur l'implémentation i18n pour BlobConnect.
Consulte le fichier docs/i18n-roadmap.md pour voir la roadmap complète.
Consulte la todo list pour voir où j'en suis.
Analyse les fichiers suivants pour comprendre l'état actuel :
- apps/web/messages/*.json (fichiers de traduction)
- apps/web/i18n/request.ts (configuration)
- apps/web/components/i18n/LanguageSelector.tsx (composant sélecteur)

Dis-moi exactement à quelle étape nous en sommes et ce qu'il reste à faire.
```

---

## 📊 Checklist finale (à cocher avant de merger)

- [ ] Les 5 fichiers de traduction existent (fr, en, es, de, nl)
- [ ] Toutes les clés sont cohérentes entre les fichiers
- [ ] Le LanguageSelector fonctionne et persiste la préférence
- [ ] Tous les composants prioritaires sont refactorisés
- [ ] Aucune string FR hardcodée ne reste dans le code
- [ ] Les messages d'erreur API sont traduits
- [ ] Tests manuels passent pour les 5 langues
- [ ] Build de production réussit
- [ ] Documentation à jour (README, roadmap)
- [ ] Script de validation fonctionne (`npm run i18n:validate`)

---

## 📝 Notes importantes

### Termes à NE PAS traduire

- **"Blob"** → Nom de marque, reste identique
- **"BlobConnect"** → Nom du produit
- **"Pro"** → Peut rester "Pro" dans toutes les langues (terme international)

### Traductions contextuelles

- **"Matching"** :
  - EN : "Matching" ou "Pairing"
  - ES : "Búsqueda" ou "Matching"
  - DE : "Matching" ou "Suche"
  - NL : "Matching" ou "Koppeling"

→ **Recommandation** : Garder "Matching" partout (terme international du produit)

### Formats régionaux (à implémenter plus tard si nécessaire)

- **Dates** : next-intl gère automatiquement
- **Prix** : Format selon locale (12,50 € vs 12.50 €)
- **Distances** : km (Europe) vs miles (si UK)

---

**🚀 FIN DE LA ROADMAP - Bonne implémentation !**
