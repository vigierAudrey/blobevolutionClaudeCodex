# Contact Attribution — Sprint C1

> Note legacy : `/admin/analytics/contact-conversion` est un nom technique
> historique conservé pour compatibilité. La métrique produit affichée côté
> admin est **sollicitation pro**. Ne pas renommer la route sans stratégie de
> dépréciation explicite.

## Pourquoi ce champ existe

`ContactRequest.lessonRequestId` permet de relier un contact pro à une demande de cours
enregistrée dans `LessonFanout`.

Avant ce sprint, les deux tables n'avaient aucune clé commune :
- `LessonFanout` contenait `lessonRequestId = sha256(riderId + UTC-date)[:16]`
- `ContactRequest` ne référençait que la conversation, sans lien vers le fanout

Ce champ rend possible les métriques de conversion Sprint C :
- `contactedRequests7d` : demandes de cours ayant reçu au moins un contact en 7 jours
- `contactRate` : contactedRequests7d / requests7d
- `requestsWithoutContact` : demandes sans aucun contact

## Calcul

`lessonRequestId` est calculé server-side dans `POST /contact/request` via
`makeLessonRequestId(riderId)` (définie dans `lesson-fanout.repository.ts`) :

```
sha256(riderId + UTC-date)[:16]
```

Le riderId est le premier rider de la conversation ayant `wantsLesson=true`,
résolu depuis `Conversation → Match → User`.

Le client ne peut jamais fournir ce champ (schéma `.strict()`).

## Limites

**Les ContactRequest antérieures au 2026-05-21 ont `lessonRequestId = NULL`.**
Le filtre sur les agrégats de conversion doit exclure ou compter séparément
les lignes NULL selon le besoin.

**Attribution par journée UTC, pas par session.**
Un rider avec `wantsLesson=true` peut déclencher N fanouts sur plusieurs jours ;
chaque jour produit un `lessonRequestId` distinct. Un ContactRequest créé à J+2
portera le `lessonRequestId` de J+2, pas celui du premier fanout.

**Conversation multi-riders.**
Si une conversation contient deux riders dont l'un a `wantsLesson=true`,
c'est ce rider qui sert de référence pour le `lessonRequestId`. L'ordre de
résolution est `userOne` puis `userTwo` dans le match.

## Requête de conversion type (Sprint C2)

```sql
SELECT
  COUNT(DISTINCT lf."lessonRequestId")                                  AS requests7d,
  COUNT(DISTINCT cr."lessonRequestId")
    FILTER (WHERE cr."lessonRequestId" IS NOT NULL)                     AS contacted7d,
  ROUND(
    COUNT(DISTINCT cr."lessonRequestId")
      FILTER (WHERE cr."lessonRequestId" IS NOT NULL)::numeric
    / NULLIF(COUNT(DISTINCT lf."lessonRequestId"), 0) * 100, 1
  )                                                                     AS contact_rate_pct
FROM "LessonFanout" lf
LEFT JOIN "ContactRequest" cr
  ON cr."lessonRequestId" = lf."lessonRequestId"
  AND cr."createdAt" >= NOW() - INTERVAL '7 days'
WHERE lf."createdAt" >= NOW() - INTERVAL '7 days';
```

## Fichiers concernés

| Fichier | Rôle |
|---|---|
| `packages/database/prisma/schema.prisma` | Champ `lessonRequestId String?` + `@@index` |
| `packages/database/prisma/migrations/20260521100000_contact_request_lesson_attribution/` | Migration additive |
| `apps/api/src/modules/contact/contact.controller.ts` | Calcul et stockage serveur |
| `apps/api/src/services/lesson-fanout.repository.ts` | `makeLessonRequestId()` (inchangé) |
| `apps/api/src/modules/contact/__tests__/contact.e2e.test.ts` | Tests attribution |
