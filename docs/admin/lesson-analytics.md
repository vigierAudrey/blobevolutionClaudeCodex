# Métriques du dashboard admin — Demandes de cours

> Ce document décrit chaque KPI affiché dans la section **"Performance des demandes de cours"**
> et dans la section **"Demandes de cours"** du dashboard admin (`/admin/analytics`).
> Il s'adresse aux administrateurs et développeurs qui lisent les chiffres sans ouvrir le code.

---

## Sources de données

Deux tables alimentent ces métriques :

| Table | Rôle |
|---|---|
| `LessonFanout` | Trace chaque déclenchement de fan-out (envoi de notifications) avec le nombre de pros trouvés, notifiés, et les échecs. |
| `RiderProfile` | Etat courant des demandes de cours (snapshot). Champ clé : `wantsLesson`, `lessonSport`, `lessonStudentCount`, `updatedAt`. |

---

## Section "Performance des demandes de cours" (LessonFanout, 7 jours glissants)

Ces métriques couvrent **les 7 derniers jours** (fenêtre glissante depuis `now - 7 * 24h`).
Elles mesurent la **santé opérationnelle du moteur de notification** : combien de demandes déclenchent
des fan-outs, combien aboutissent à des pros trouvés et notifiés.

---

### `requests7d` — Rider-jours actifs sur 7 jours

**Définition métier**
Nombre de "rider-jours actifs" : chaque combinaison (rider, jour UTC) ayant déclenché au moins un fan-out
compte pour 1. Un rider qui a une demande active 3 jours = 3 dans ce compteur.

**Formule**
```sql
COUNT(DISTINCT lessonRequestId)
FROM LessonFanout
WHERE createdAt >= now - 7 days
```

`lessonRequestId` est calculé comme `sha256(riderId + UTC-date)[:16]` — il est stable pour un rider
sur une même journée UTC mais change chaque jour, ce qui donne la sémantique "rider-jours".

**Source de données**
Table `LessonFanout`, fonction `getLessonPerformanceMetrics()` dans
`apps/api/src/services/lesson-fanout.repository.ts`.

**Limites**
- Ce n'est **pas** le nombre de riders uniques (voir `uniqueRiders7d` ci-dessous).
- Un rider très actif (plusieurs déplacements par semaine) peut gonfler ce chiffre
  sans que le nombre de demandes distinctes augmente.
- Les fan-outs déclenchés avant la migration du champ `triggerReason` (2026-05-20)
  ont `triggerReason = null` mais sont bien comptés.

---

### `uniqueRiders7d` — Riders distincts sur 7 jours

**Définition métier**
Nombre de riders ayant eu au moins un fan-out actif dans les 7 derniers jours,
indépendamment du nombre de jours ou de déclenchements.

**Formule**
```sql
COUNT(DISTINCT riderRef)
FROM LessonFanout
WHERE createdAt >= now - 7 days
```

`riderRef` est `sha256(riderId)[:24]` — pseudonyme stable par rider (ne change pas d'un jour à l'autre).

**Source de données**
Même requête que `requests7d`, même table `LessonFanout`.

**Limites**
- `riderRef` est un hash non-réversible. La déduplication est exacte mais le lien
  avec un userId concret nécessite de recalculer le hash côté admin.
- Ne compte que les riders dont la demande a effectivement déclenché un fan-out.
  Un rider avec `wantsLesson=true` mais sans géolocalisation valide n'apparaît pas ici
  (son profil est dans `inactiveRequests30d` ou dans le snapshot, mais pas dans `LessonFanout`).

---

### `matchRate` — Taux de correspondance

**Définition métier**
Pourcentage des fan-outs ayant trouvé au moins 1 pro éligible dans le périmètre géographique du rider.
Un fan-out "sans match" signifie qu'aucun pro vérifié n'est disponible dans la zone.

**Formule**
```sql
ROUND(
  COUNT(*) FILTER (WHERE prosFound > 0)::numeric
  / NULLIF(COUNT(*), 0)
  * 100,
  1
)
FROM LessonFanout
WHERE createdAt >= now - 7 days
```

**Source de données**
Champ `prosFound` de la table `LessonFanout`, agrégé dans `getLessonPerformanceMetrics()`.

**Limites**
- Retourne `null` (affiché "N/A") s'il n'y a aucun fan-out sur la période.
- Ne reflète pas si les pros trouvés ont vu ou répondu à la notification — seulement
  s'ils étaient présents dans le périmètre.
- Un matchRate < 60 % peut indiquer une zone sans pros ou des critères de filtre trop stricts
  (sport, rayon géographique).

---

### `avgProsFound` — Moyenne de pros éligibles par fan-out

**Définition métier**
Nombre moyen de pros dans le périmètre géographique par fan-out déclenché.
Mesure la densité de l'offre autour des demandes actives.

**Formule**
```sql
AVG(prosFound)
FROM LessonFanout
WHERE createdAt >= now - 7 days
```
Arrondi à 1 décimale.

**Source de données**
Champ `prosFound` de la table `LessonFanout`.

**Limites**
- Moyenne arithmétique : une poignée de zones très denses peut tirer la moyenne vers le haut.
- `prosFound` = pros dans le périmètre au moment du fan-out, pas le nombre de pros qui ouvrent
  la notification.

---

### `prosNotified` / `prosNotified7d` — Pros notifiés

**Définition métier**
Nombre total de notifications envoyées aux pros sur 7 jours (somme, pas distinct).
Un même pro peut être notifié plusieurs fois (plusieurs riders dans son périmètre).

**Formule**
```sql
COALESCE(SUM(prosNotified), 0)
FROM LessonFanout
WHERE createdAt >= now - 7 days
```

**Source de données**
Champ `prosNotified` de la table `LessonFanout`.

**Limites**
- Compte les notifications INSERT réussies. Les échecs sont dans `notificationFailures`.
- Ne dit pas combien de pros distincts ont été notifiés (un pro peut recevoir N notifications
  pour N riders dans son périmètre).

---

### `failures` / `notificationFailures` — Erreurs de notifications

**Définition métier**
Nombre d'échecs d'insertion de notification en base sur 7 jours.
Chaque tentative échouée de créer une `Notification` pour un pro est comptée ici.

**Formule**
```sql
COALESCE(SUM(failureCount), 0)
FROM LessonFanout
WHERE createdAt >= now - 7 days
```

**Source de données**
Champ `failureCount` de la table `LessonFanout`, incrémenté dans
`apps/api/src/services/lesson-notification.service.ts` lors des erreurs de création.

**Limites**
- Un `failureCount` élevé peut indiquer une saturation DB, une transaction échouée, ou un
  deadlock sur la table `Notification`. Croiser avec les logs applicatifs.
- Le `notificationSuccessRate` affiché à côté est `prosNotified7d / (prosNotified7d + failures) * 100`.

---

### `bySport` — Répartition par sport (fan-outs)

**Définition métier**
Pour chaque discipline (surf, kitesurf, other), le nombre de rider-jours actifs,
le matchRate et la moyenne de pros trouvés sur 7 jours.

**Formule** (par sport)
```sql
SELECT
  COALESCE(sport, 'other') AS sport,
  COUNT(DISTINCT lessonRequestId) AS requests7d,
  ROUND(COUNT(*) FILTER (WHERE prosFound > 0)::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS matchRate,
  AVG(prosFound) AS avgProsFound
FROM LessonFanout
WHERE createdAt >= now - 7 days
GROUP BY COALESCE(sport, 'other')
```

**Source de données**
Champ `sport` de la table `LessonFanout` (nullable → rangé dans "other" si absent).

**Limites**
- "other" regroupe les sports non reconnus ET les fan-outs sans sport renseigné (champ null).
- Un fan-out sans sport `null` survient si le rider n'a pas renseigné `lessonSport` dans son profil.
  C'est un signal de donnée incomplète, pas une erreur.

---

## Section "Demandes de cours" — Snapshot (RiderProfile)

Ces métriques sont un **snapshot instantané** de l'état courant de la table `RiderProfile`.
Elles ne dépendent pas de la période sélectionnée (sauf `newInPeriod` et les stats de contact pro).

---

### `inactiveRequests30d` — Demandes inactives > 30 jours

**Définition métier**
Nombre de `RiderProfile` avec `wantsLesson=true` dont le champ `updatedAt` est
antérieur à `now - 30 jours`. Ces demandes sont comptées dans `totalActive` mais
le rider n'a pas mis à jour son profil depuis plus d'un mois — la demande est probablement obsolète.

**Formule**
```js
activeProfiles.filter(p => p.updatedAt < now - 30days).length
```
où `activeProfiles` = `RiderProfile.findMany({ where: { wantsLesson: true } })`.

**Source de données**
Champ `updatedAt` de la table `RiderProfile`, calculé dans `computeLessonRequestsAnalytics()`
(`apps/api/src/services/analytics/reports.service.ts`).

**Limites**
- `updatedAt` est mis à jour à chaque modification du profil (pas uniquement `wantsLesson`).
  Un rider qui change son avatar mais pas sa demande de cours réinitialise ce compteur.
  Le chiffre peut donc **sous-estimer** les demandes réellement obsolètes.
- Le seuil "30 jours" est arbitraire. Si ce taux dépasse 30 % du total actif,
  le dashboard l'indique en orange avec "données potentiellement biaisées".
- Il n'existe pas de TTL automatique : les demandes inactives restent dans `totalActive`
  jusqu'à ce que le rider passe `wantsLesson=false`.

---

### `bySport` — Répartition par sport (snapshot)

**Définition métier**
Décompte des demandes actives (`wantsLesson=true`) par discipline, en snapshot.
Différent du `bySport` dans la section "Performance" qui mesure les fan-outs.

**Formule**
```js
// surf
activeProfiles.filter(p => p.lessonSport?.toLowerCase() === 'surf').length
// kitesurf
activeProfiles.filter(p => p.lessonSport?.toLowerCase() === 'kitesurf').length
// other = total - surf - kitesurf
```

**Source de données**
Champ `lessonSport` de `RiderProfile` (nullable).

**Limites**
- Les sports mal orthographiés (`"Surf"`, `"SURF"`) sont normalisés en lowercase avant comparaison.
- `lessonSport = null` (non renseigné) tombe dans "other".
- Ce snapshot peut diverger du `bySport` de la section Performance si des riders activent
  `wantsLesson` sans jamais déclencher de fan-out (ex : pas de géolocalisation valide).

---

## Glossaire

| Terme | Définition |
|---|---|
| **Fan-out** | Déclenchement du moteur de notification : le système recherche les pros dans le périmètre du rider et crée les notifications. |
| **riderRef** | `sha256(riderId)[:24]` — pseudonyme stable, non-réversible. |
| **lessonRequestId** | `sha256(riderId + UTC-date)[:16]` — stable pour un rider sur une journée, change le lendemain. |
| **Rider-jour actif** | Une occurrence de (rider, jour UTC) ayant déclenché au moins un fan-out. |
| **prosFound** | Nombre de pros éligibles trouvés dans le périmètre au moment du fan-out. |
| **prosNotified** | Nombre de notifications effectivement insérées en base pour ce fan-out. |
| **failureCount** | Nombre d'erreurs lors de la création des notifications pour ce fan-out. |
| **wantsLesson** | Flag booléen sur `RiderProfile` — `true` = demande active. |
