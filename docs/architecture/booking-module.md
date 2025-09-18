# Architecture – Module « Booking » (Checkpoint 2)

## Positionnement dans le monorepo

- Nouveau module back : `apps/api/src/modules/booking/`
  - `booking.controller.ts` : endpoints REST (`/bookings`, `/availability`, `/requests`).
  - `booking.service.ts` : règles métier (création demandes, validation créneaux, acceptation/refus).
  - `booking.repository.ts` : accès Prisma.
  - `dto/` : schémas Zod (création disponibilité, demande, décision).
  - `booking.events.ts` : émission d’événements (request_created, request_decided, booking_created).
- Front web :
  - Rider flow (`apps/web/app/reservations/*`).
  - Planning pro (`apps/web/app/pro/planning/*`).
  - Composants partagés dans `apps/web/components/reservation/*`.
- Base de données (packages/database) : nouvelles migrations Prisma (tables ci-dessous).
- Tests E2E : nouveaux scénarios dans `apps/api/src/modules/booking/__tests__/`.

## Modèle de données

```
User
│
├─ ProAvailability (créneau)
│   id (UUID)
│   proUserId → User.id
│   sport (enum)
│   levels (text[])
│   startAt / endAt (timestamptz)
│   capacity (int, default 1)
│   bookedCount (int)
│   status (enum: OPEN, CLOSED)
│   spotName (text)
│   spotLat / spotLng (float)
│   price (numeric, nullable)
│   createdAt / updatedAt
│   UNIQUE (proUserId, startAt, endAt)
│
├─ BookingRequest
│   id (UUID)
│   riderUserId → User.id
│   availabilityId → ProAvailability.id
│   message (text?)
│   status (enum: PENDING, ACCEPTED, REJECTED)
│   respondedAt (nullable)
│   createdAt / updatedAt
│   UNIQUE (riderUserId, availabilityId, status = 'PENDING')
│
└─ Booking
    id (UUID)
    availabilityId → ProAvailability.id
    riderUserId → User.id
    status (enum: CONFIRMED, CANCELLED_RIDER, CANCELLED_PRO)
    createdAt / updatedAt
    UNIQUE (availabilityId, riderUserId)
```

- Index géospatial : `ProAvailability` → `gist (spot geography(Point, 4326))` via PostGIS.
- Trigger / check : `bookedCount ≤ capacity` (validé en service + contrainte). Possible unique index partielle.
- Historisation minimaliste : `BookingRequestLog` optionnel (future extension).

## Transactions & règles métier

1. **Création disponibilité pro**
   - Valider chevauchement : `SELECT ... FOR UPDATE` ou contrainte unique (`startAt`/`endAt`).
   - Calculer `spot` (Point) pour requêtes PostGIS.
2. **Demande rider**
   - Vérifier capacité (`bookedCount < capacity`).
   - Vérifier existence de PENDING par ce rider sur cette dispo (sinon erreur 409).
   - Créer `BookingRequest` (status PENDING) et notifier pro.
3. **Acceptation**
   - Transaction : `SELECT availability FOR UPDATE` → vérifier capacité → créer `Booking` → incrémenter `bookedCount` → passer `BookingRequest` à ACCEPTED.
   - Émettre événement `booking_created`.
4. **Refus**
   - Mettre `BookingRequest` à REJECTED + `respondedAt`.
   - Notifier rider.
5. **Ajout manuel rider (pro)**
   - Même transaction que acceptation, sans `BookingRequest`.
6. **Fermeture créneau**
   - Status ` CLOSED`, empêche nouvelles demandes. Si déjà des réservations → avertissement / action manuelle.

## API REST (v1)

Base path `/booking`

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| POST | `/availability` | PRO | Créer un créneau. |
| GET | `/availability/me` | PRO | Lister les créneaux du pro (filtres date, status). |
| PATCH | `/availability/:id` | PRO | Modifier/fermer un créneau. |
| GET | `/availability/search` | RIDER | Rechercher des dispos (param: sport, level, lat, lng, radius, période). |
| POST | `/requests` | RIDER | Créer demande : `{ availabilityId, message? }`. |
| GET | `/requests/me` | RIDER | Suivi des demandes rider. |
| GET | `/requests/inbox` | PRO | Demandes entrantes (status PENDING). |
| POST | `/requests/:id/accept` | PRO | Accepter une demande. |
| POST | `/requests/:id/reject` | PRO | Refuser. |
| POST | `/bookings/manual` | PRO | Ajouter un rider manuellement. |
| GET | `/bookings/me` | PRO | Liste bookings confirmés. |

Notes :
- Toutes les routes protégées par `requireAuth`. Filtre rôle via guard.
- Input validation Zod (+ code HTTP 409 pour conflits).
- Prévoir pagination (cursor) sur listes (inbox, bookings).

## Recherche géospatiale

- Query `search` combine :
  ```sql
  SELECT * FROM "ProAvailability"
  WHERE sport = $sport
    AND $level = ANY(levels)
    AND start_at BETWEEN $start AND $end
    AND ST_DWithin(spot, ST_SetSRID(ST_MakePoint($lng, $lat), 4326), $radiusMeters)
    AND status = 'OPEN'
  ORDER BY ST_Distance(spot, user_point)
  LIMIT $pageSize OFFSET $offset
  ```
- Response : `availability` + `pro` (profil) + `currentRiders` (miniatures) + `bookingStats` (bookedCount/capacity).

## Notifications & analytics

- Événements :
  - `booking.request.created`
  - `booking.request.decided`
  - `booking.created`
- Intégration future : emitter simple (EventEmitter / Redis pubsub) → job email / push.
- Analytics : Track (userId, availabilityId, sport/level, distance, temps réponse).

## Sécurité & limites

- Rate limit : `POST /requests` (ex: 10/min/user).
- Vérification rôles (pas de rider sur `/availability`).
- Contrôles : impossible de réserver un créneau passé, ou d’accepter deux fois la même demande.
- RGPD : stocker consentement géoloc (dans user/location history si besoin). Option purge positions > 90j.

## Livrables checkpoint 2

- Ce document d’architecture pour validation.
- Diagramme entités (peut être intégré dans le doc UX ou en annexe prisma).
- Pistes pour migrations Prisma (fichiers à générer au checkpoint 3).

Après validation : passage au **Checkpoint 3** (squelette back: migrations + service/controller stubs + tests unitaires). 
