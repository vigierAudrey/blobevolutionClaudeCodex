# 🎯 Système de Matching - Blobinfini

> Documentation technique complète du système de matching entre riders (surf/kitesurf)

## Table des matières

1. [Vue d'ensemble](#vue-densemble)
2. [Critères de matching](#critères-de-matching)
3. [Règles de filtrage](#règles-de-filtrage)
4. [Géolocalisation](#géolocalisation)
5. [Architecture technique](#architecture-technique)
6. [Conformité RGPD](#conformité-rgpd)

---

## Vue d'ensemble

Le système de matching permet aux riders de trouver des binômes pour leurs sessions de surf ou kitesurf selon des critères précis : sport, niveau, date et distance géographique.

### Flux utilisateur

```
1. Sélection Sport & Niveau (/matching)
   ↓
2. Sélection Date & Géolocalisation (/matching/date)
   ↓
3. Visualisation des profils (/matching/cards ou /matching/results)
   ↓
4. Décisions (ACCEPT/REFUSE)
   ↓
5. Match mutuel → Conversation créée
```

---

## Critères de matching

### 1. Sport (obligatoire)

**Options** :
- Surf
- Kitesurf

**Règle** : Le sport doit correspondre exactement. Un rider surf ne verra jamais de kitesurfeur.

```typescript
// Type Sport
export type Sport = 'surf' | 'kitesurf';
```

### 2. Niveau (obligatoire)

**Options** :
- Débutant (beginner)
- Intermédiaire (intermediate)
- Confirmé (advanced)
- **Peu importe (anytime)** ⭐ Nouveau

**Règles** :
- Chercheur **"peu importe"** → voit tous les niveaux
- Chercheur **niveau spécifique** → voit uniquement ce niveau

```typescript
// Type Level
export type Level = 'beginner' | 'intermediate' | 'advanced' | 'anytime';
```

**Exemples** :

| Chercheur sélectionne | Voit les profils avec niveau |
|----------------------|-------------------------------|
| Débutant | Débutant uniquement |
| Intermédiaire | Intermédiaire uniquement |
| Confirmé | Confirmé uniquement |
| **Peu importe** | Débutant, Intermédiaire, Confirmé, Peu importe |

### 3. Date (obligatoire)

**Options** :
- Aujourd'hui (date du jour)
- Demain (date du lendemain)
- **Peu importe (anytime)**

**Règles** :
- Chercheur **"peu importe"** → voit tous les profils (toutes dates)
- Chercheur **date spécifique** → voit uniquement les profils ayant sélectionné cette date exacte

```typescript
// Format date
date: string; // Format: 'YYYY-MM-DD' ou 'anytime'
```

**Exemples** :

| Chercheur sélectionne | Voit les profils disponibles |
|----------------------|-------------------------------|
| Aujourd'hui | Aujourd'hui uniquement |
| Demain | Demain uniquement |
| **Peu importe** | Aujourd'hui, Demain, Peu importe |

### 4. Distance géographique (obligatoire)

**Configuration** :
- Rayon minimal : 5 km
- Rayon maximal : 200 km
- Rayon par défaut : 20 km

**Règle** : Seuls les profils situés dans le rayon défini sont affichés.

```typescript
// Paramètres de distance
distanceKm?: number;
location: { lat: number; lng: number };
```

---

## Règles de filtrage

### Filtrage combiné

Les 4 critères sont combinés avec un **ET logique** :

```sql
SELECT * FROM RiderProfile rp
JOIN RiderDiscipline rd ON rd.profileId = rp.id
  AND rd.sport = :sport
  AND (rd.level = :level OR :level = 'anytime')
LEFT JOIN LastSearch ls ON ls.userId = rp.userId
WHERE rp.lat IS NOT NULL
  AND rp.lng IS NOT NULL
  AND rp.userId <> :currentUserId
  AND ST_DWithin(
    ST_MakePoint(:lng, :lat)::geography,
    ST_SetSRID(ST_MakePoint(rp.lng, rp.lat), 4326)::geography,
    :distanceKm * 1000
  )
  AND (ls.date = :date OR :date = 'anytime')
  AND NOT EXISTS (
    SELECT 1 FROM MatchDecision md
    WHERE md.actorUserId = :currentUserId
      AND md.targetProfileId = rp.id
  )
ORDER BY ST_Distance(...) ASC
LIMIT 200;
```

### Exclusions automatiques

Le système exclut automatiquement :

1. ✅ Son propre profil
2. ✅ Les profils déjà vus (décision ACCEPT ou REFUSE déjà prise)
3. ✅ Les profils sans géolocalisation
4. ✅ Les profils hors du rayon de distance

### Cache intelligent

Les résultats de recherche sont mis en cache pendant 5 minutes avec clé composite :

```typescript
const cacheKey = `${sport}:${level}:${lat}:${lng}:${radiusKm}:date:${date}`;
```

---

## Géolocalisation

### Conformité RGPD ✅

**Principe** : Géolocalisation **obligatoire** pour le matching, avec **consentement explicite**.

#### Interface utilisateur

```
┌─────────────────────────────────────────┐
│ 📍 Géolocalisation                      │
│                                          │
│ La géolocalisation est nécessaire pour  │
│ utiliser le matching et trouver des     │
│ riders près de chez toi.                │
│                                          │
│ ┌──────────────────────┐                │
│ │  📍 Activer ma position │              │
│ └──────────────────────┘                │
│                                          │
│ Position : 48.8566, 2.3522              │
└─────────────────────────────────────────┘
```

#### Workflow

1. **Utilisateur arrive sur `/matching/date`**
2. **Message informatif** : "La géolocalisation est nécessaire"
3. **Utilisateur clique** sur "Activer ma position"
4. **Navigateur demande** la permission de géolocalisation
5. **Utilisateur accepte/refuse** dans la popup du navigateur
6. **Si acceptée** : Position récupérée et affichée
7. **Bouton "Voir les profils"** s'active uniquement après consentement

#### Code d'implémentation

```typescript
// apps/web/app/matching/date/page.tsx

const [lat, setLat] = useState<number | null>(null);
const [lng, setLng] = useState<number | null>(null);

const getLocation = () => {
  if (!navigator.geolocation) {
    setGeolocError(true);
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const la = pos.coords.latitude;
      const lo = pos.coords.longitude;
      setLat(la);
      setLng(lo);
      // Stockage local pour réutilisation
      localStorage.setItem('matching.lat', String(la));
      localStorage.setItem('matching.lng', String(lo));
    },
    (error) => {
      console.error('Erreur géolocalisation:', error);
      setGeolocError(true);
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
};

// Bouton désactivé sans géolocalisation
<Button
  disabled={!dateISO || lat == null || lng == null}
  onClick={() => router.push('/matching/cards')}
>
  Voir les profils
</Button>
```

#### Gestion des erreurs

Si l'utilisateur refuse la géolocalisation :

```
┌─────────────────────────────────────────┐
│ ⚠️ Autorise la localisation sur Chrome  │
│                                          │
│ 1. Clique sur l'icône 🔒 à gauche de   │
│    l'adresse URL                        │
│ 2. Trouve "Position" ou "Localisation"  │
│ 3. Change de "Bloquer" à "Autoriser"    │
│ 4. Recharge la page avec F5             │
│                                          │
│ La géolocalisation est nécessaire pour  │
│ le matching.                             │
│                                          │
│ ┌──────────────┐                        │
│ │  Réessayer    │                        │
│ └──────────────┘                        │
└─────────────────────────────────────────┘
```

Instructions adaptées au navigateur détecté (Chrome, Firefox, Safari, Edge).

### Technologie PostGIS

Le calcul de distance utilise **PostGIS** avec géométrie sphérique :

```sql
-- Extension PostGIS activée
CREATE EXTENSION IF NOT EXISTS postgis;

-- Calcul distance en mètres
ST_Distance(
  ST_MakePoint(:lng, :lat)::geography,
  ST_SetSRID(ST_MakePoint(rp.lng, rp.lat), 4326)::geography
) AS dist_m

-- Filtrage par rayon
ST_DWithin(
  ST_MakePoint(:lng, :lat)::geography,
  ST_SetSRID(ST_MakePoint(rp.lng, rp.lat), 4326)::geography,
  :distanceKm * 1000  -- Conversion km → m
)
```

---

## Architecture technique

### Frontend (Next.js)

**Pages** :

```
apps/web/app/matching/
├── page.tsx                    # Étape 1: Sélection sport & niveau
├── date/page.tsx              # Étape 2: Date & géolocalisation
├── cards/CardsClient.tsx      # Étape 3: Deck de profils (swipe)
├── results/page.tsx           # Étape 3 bis: Liste détaillée
└── storage.ts                 # Utilitaire reset localStorage
```

**Composants clés** :

1. **Page de sélection** (`/matching/page.tsx`)
   - Choix sport (surf/kitesurf)
   - Choix niveau (débutant/intermédiaire/confirmé/**peu importe**)
   - Validation avant passage à l'étape suivante

2. **Page date & géoloc** (`/matching/date/page.tsx`)
   - Choix date (aujourd'hui/demain/**peu importe**)
   - Activation manuelle géolocalisation
   - Slider distance (5-200 km)
   - Checkbox "Je veux un cours"
   - Bouton désactivé sans géoloc

3. **Page résultats** (`/matching/cards` ou `/matching/results`)
   - Affichage des profils correspondants
   - Système de swipe (accepter/refuser)
   - Création automatique de conversation si match mutuel

### Backend (Express + Prisma)

**Endpoint principal** :

```typescript
// apps/api/src/modules/matching/matching.controller.ts

POST /api/matching/search

// Body
{
  sport: 'surf' | 'kitesurf',
  level: 'beginner' | 'intermediate' | 'advanced' | 'anytime',
  date: 'YYYY-MM-DD' | 'anytime',
  location: { lat: number, lng: number },
  distanceKm: number,
  sortBy?: 'distance' | 'name',
  excludeIds?: string[],
  limit?: number,
  cursor?: string
}

// Response
{
  criteria: { ... },
  results: [
    {
      id: string,
      displayName: string,
      photoUrl: string,
      gender: 'FEMALE' | 'MALE' | 'OTHER',
      sport: string,
      level: string,
      bio: string,
      distanceKm: number,
      wantsLesson: boolean
    }
  ],
  hasMore: boolean,
  nextCursor: string | null
}
```

**Validation Zod** :

```typescript
const searchSchema = z.object({
  sport: z.enum(['surf', 'kitesurf']),
  level: z.enum(['beginner', 'intermediate', 'advanced', 'anytime']),
  date: z.string().regex(/^(\d{4}-\d{2}-\d{2}|anytime)$/),
  distanceKm: z.number().int().min(1).max(500).optional(),
  location: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180)
  }).optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional().default(50)
});
```

### Base de données (PostgreSQL + PostGIS)

**Tables principales** :

```sql
-- Profils riders avec géolocalisation
CREATE TABLE "RiderProfile" (
  id UUID PRIMARY KEY,
  userId UUID REFERENCES "User"(id),
  displayName VARCHAR(100),
  bio TEXT,
  sex VARCHAR(20),
  photoUrl VARCHAR(500),
  lat DOUBLE PRECISION,      -- Latitude
  lng DOUBLE PRECISION,      -- Longitude
  maxDistanceKm INT DEFAULT 20,
  wantsLesson BOOLEAN DEFAULT FALSE,
  ...
);

-- Disciplines pratiquées (sport + niveau)
CREATE TABLE "RiderDiscipline" (
  id UUID PRIMARY KEY,
  profileId UUID REFERENCES "RiderProfile"(id),
  sport VARCHAR(20),         -- 'surf' | 'kitesurf'
  level VARCHAR(20),         -- 'beginner' | 'intermediate' | 'advanced' | 'anytime'
  ...
);

-- Dernière recherche (pour déduire disponibilité)
CREATE TABLE "LastSearch" (
  userId UUID PRIMARY KEY,
  sport VARCHAR(20),
  level VARCHAR(20),
  date TIMESTAMP,            -- NULL si 'anytime'
  distanceKm INT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  ...
);

-- Décisions de matching
CREATE TABLE "MatchDecision" (
  id UUID PRIMARY KEY,
  actorUserId UUID REFERENCES "User"(id),
  targetProfileId UUID REFERENCES "RiderProfile"(id),
  decision VARCHAR(10),      -- 'ACCEPT' | 'REFUSE'
  createdAt TIMESTAMP,
  UNIQUE(actorUserId, targetProfileId)
);

-- Matches mutuels
CREATE TABLE "Match" (
  id UUID PRIMARY KEY,
  userOneId UUID REFERENCES "User"(id),
  userTwoId UUID REFERENCES "User"(id),
  status VARCHAR(20),        -- 'ACTIVE' | 'INACTIVE'
  UNIQUE(userOneId, userTwoId)
);
```

**Index de performance** :

```sql
CREATE INDEX idx_rider_profile_lat_lng ON "RiderProfile"(lat, lng);
CREATE INDEX idx_rider_discipline_sport_level ON "RiderDiscipline"(sport, level);
CREATE INDEX idx_match_decision_actor ON "MatchDecision"(actorUserId);
CREATE INDEX idx_last_search_date ON "LastSearch"(date);
```

---

## Conformité RGPD

### Données personnelles collectées

| Donnée | Finalité | Base légale | Durée conservation |
|--------|----------|-------------|-------------------|
| Position GPS (lat/lng) | Matching géographique | Consentement | Session + 30j en cache |
| Dernière recherche | Déduire disponibilité | Intérêt légitime | Illimitée (lié au compte) |
| Décisions de matching | Éviter doublons | Exécution contrat | Illimitée (lié au compte) |

### Droits utilisateurs

✅ **Droit d'accès** : Export JSON via `/api/gdpr/export-request`
✅ **Droit de rectification** : Modification profil via `/api/profile/me`
✅ **Droit à l'oubli** : Suppression compte via `/api/gdpr/delete-request`
✅ **Droit à la limitation** : Désactivation profil possible

### Stockage géolocalisation

```typescript
// Stockage temporaire localStorage (client)
localStorage.setItem('matching.lat', lat);
localStorage.setItem('matching.lng', lng);

// Stockage serveur (LastSearch)
await prisma.lastSearch.upsert({
  where: { userId },
  create: { userId, lat, lng, ... },
  update: { lat, lng, ... }
});

// Pas de stockage permanent dans RiderProfile
// (position uniquement si l'utilisateur met à jour son profil)
```

### Consentement

Le consentement pour la géolocalisation est :
- ✅ **Libre** : L'utilisateur peut refuser (mais ne peut pas utiliser le matching)
- ✅ **Éclairé** : Message clair "La géolocalisation est nécessaire pour utiliser le matching"
- ✅ **Spécifique** : Demandé uniquement pour le matching
- ✅ **Univoque** : Action positive claire (clic sur "Activer ma position")

---

## Cas d'usage

### Scénario 1 : Rider débutant en surf

```
👤 Alice (Surf, Débutant, Aujourd'hui, Biarritz, 20 km)
   ↓
🔍 Recherche profils :
   - Sport : Surf ✅
   - Niveau : Débutant ✅
   - Date : Aujourd'hui ✅
   - Distance : < 20 km de Biarritz ✅
   ↓
📋 Résultats :
   - Bob (Surf, Débutant, Aujourd'hui, Biarritz 5 km) ✅
   - Charlie (Surf, Débutant, Aujourd'hui, Anglet 12 km) ✅
   - David (Surf, Intermédiaire, Aujourd'hui, Biarritz 3 km) ❌ (niveau différent)
   - Eve (Surf, Débutant, Demain, Biarritz 2 km) ❌ (date différente)
```

### Scénario 2 : Rider flexible

```
👤 François (Kitesurf, Peu importe, Peu importe, Lacanau, 50 km)
   ↓
🔍 Recherche profils :
   - Sport : Kitesurf ✅
   - Niveau : Tous ✅
   - Date : Toutes ✅
   - Distance : < 50 km de Lacanau ✅
   ↓
📋 Résultats :
   - Gisèle (Kitesurf, Débutant, Aujourd'hui, Lacanau 2 km) ✅
   - Henri (Kitesurf, Confirmé, Demain, Soulac 35 km) ✅
   - Isabelle (Kitesurf, Intermédiaire, Peu importe, Cap Ferret 42 km) ✅
   - Julien (Surf, Peu importe, Peu importe, Lacanau 1 km) ❌ (sport différent)
```

### Scénario 3 : Match mutuel

```
👤 Alice accepte Bob
   ↓
💾 Décision enregistrée (ACCEPT)
   ↓
🔄 Vérification réciproque :
   ├─ Bob a-t-il accepté Alice ? ✅
   └─ Si OUI → Match mutuel !
      ↓
      ✅ Création Match en base
      ✅ Création Conversation automatique
      ✅ Notification WebSocket aux deux users
      ✅ Redirection vers /messages/:conversationId
```

---

## Tests

### Tests unitaires

```typescript
// apps/api/src/modules/matching/__tests__/matching.e2e.test.ts

describe('POST /matching/search', () => {
  it('should filter by sport', async () => {
    const response = await request(app)
      .post('/matching/search')
      .send({ sport: 'surf', level: 'beginner', date: 'anytime', location: { lat: 48.8, lng: 2.3 } });

    expect(response.body.results.every(r => r.sport === 'surf')).toBe(true);
  });

  it('should filter by level when not "anytime"', async () => {
    const response = await request(app)
      .post('/matching/search')
      .send({ sport: 'surf', level: 'intermediate', date: 'anytime', location: { lat: 48.8, lng: 2.3 } });

    expect(response.body.results.every(r => r.level === 'intermediate')).toBe(true);
  });

  it('should return all levels when level is "anytime"', async () => {
    const response = await request(app)
      .post('/matching/search')
      .send({ sport: 'surf', level: 'anytime', date: 'anytime', location: { lat: 48.8, lng: 2.3 } });

    const levels = new Set(response.body.results.map(r => r.level));
    expect(levels.size).toBeGreaterThan(1);
  });
});
```

### Tests E2E

```typescript
// apps/web/app/matching/__tests__/matching.e2e.test.ts

describe('Matching Flow', () => {
  it('should complete full matching flow', async () => {
    // 1. Login
    await page.goto('/login');
    await page.fill('[name="email"]', 'test@example.com');
    await page.fill('[name="password"]', 'Password123!');
    await page.click('button[type="submit"]');

    // 2. Select sport & level
    await page.goto('/matching');
    await page.click('button:has-text("Surf")');
    await page.click('button:has-text("Peu importe")');
    await page.click('button:has-text("Continuer")');

    // 3. Select date & enable geolocation
    await page.click('button:has-text("Peu importe")');

    // Mock geolocation
    await page.evaluate(() => {
      navigator.geolocation.getCurrentPosition = (success) => {
        success({ coords: { latitude: 48.8566, longitude: 2.3522 } });
      };
    });

    await page.click('button:has-text("Activer ma position")');
    await page.waitForSelector('text=Position : 48.8566');

    // 4. View profiles
    await page.click('button:has-text("Voir les profils")');
    await page.waitForURL('/matching/cards');

    expect(await page.isVisible('.profile-card')).toBe(true);
  });
});
```

---

## Monitoring & Métriques

### KPIs à suivre

```typescript
// Métriques matching
{
  "matching.searches.total": 1542,           // Nombre de recherches
  "matching.searches.with_results": 1389,    // Recherches avec résultats
  "matching.searches.empty": 153,            // Recherches sans résultats
  "matching.decisions.accept": 456,          // Acceptations
  "matching.decisions.refuse": 892,          // Refus
  "matching.matches.mutual": 89,             // Matches mutuels créés
  "matching.average_distance_km": 18.3,      // Distance moyenne
  "matching.level_anytime.usage_rate": 0.34  // 34% utilisent "peu importe"
}
```

### Logs critiques

```typescript
// Log recherche vide
console.warn('Empty matching results', {
  userId,
  criteria: { sport, level, date, distanceKm },
  timestamp: new Date().toISOString()
});

// Log match mutuel
console.log('Mutual match created', {
  matchId,
  userOneId,
  userTwoId,
  conversationId,
  timestamp: new Date().toISOString()
});
```

---

## Évolutions futures

### Court terme (Q1 2026)

- [ ] Filtrage par genre (homme/femme/mixte)
- [ ] Historique des matchs
- [ ] Notation des sessions passées
- [ ] Favoris/Blocage

### Moyen terme (Q2-Q3 2026)

- [ ] Matching par spot (spot La Nord, Les Cavaliers, etc.)
- [ ] Matching par conditions météo (taille vagues, force vent)
- [ ] Notifications push pour nouveaux profils
- [ ] Statistiques personnalisées

### Long terme (2027+)

- [ ] IA de recommandation (ML)
- [ ] Matching par skills (tricks, niveaux détaillés)
- [ ] Événements de groupe (sessions collectives)
- [ ] Intégration calendrier (Google Calendar, Apple Calendar)

---

## Ressources

### Documentation externe

- [PostGIS Documentation](https://postgis.net/docs/)
- [RGPD - Géolocalisation](https://www.cnil.fr/fr/la-geolocalisation)
- [WebSocket Rooms](https://socket.io/docs/v4/rooms/)

### Fichiers clés du projet

```
apps/
├── api/
│   └── src/modules/matching/
│       ├── matching.controller.ts      # Endpoint /matching/search
│       └── __tests__/matching.e2e.test.ts
├── web/
│   └── app/matching/
│       ├── page.tsx                    # Sélection sport/niveau
│       ├── date/page.tsx               # Sélection date/géoloc
│       ├── cards/CardsClient.tsx       # Deck swipe
│       ├── results/page.tsx            # Liste détaillée
│       └── storage.ts                  # Utils localStorage
├── packages/database/
│   └── prisma/schema.prisma            # Modèles DB
└── types/
    └── matching.ts                     # Types TypeScript
```

---

**Auteur** : Équipe Blobinfini
**Dernière mise à jour** : 16/12/2025
**Version** : 2.0.0 (avec niveau "peu importe" + géoloc obligatoire)
