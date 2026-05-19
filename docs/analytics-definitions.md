# Analytics definitions (RGPD-safe)

## Scope
- Analytics = observabilite passive. Aucun effet de bord produit.
- Tous les chiffres affiches sont agreges et masques si n < 20.
- Segments riders et pros separes.

## Consentement
- Tracking uniquement si consent analytics explicite (consentLevel = personalized ou npa).
- Events publics recus via `POST /analytics/events` avec `consentHash`.
- Events critiques emis cote serveur (demandes de cours, matching, messages, verification).

## Minimisation des donnees
- Pas d'IP, pas de lat/lng brut, pas de PII.
- Pas d'URL complete: seulement `domain` + `campaignId` interne.
- Acteur pseudonymise via hash sale (salt serveur).

## Definition "active day"
Riders (au moins 1 action):
- RIDER_SEARCH_PROS
- RIDER_BOOKING_REQUEST
- RIDER_MATCH_DECISION
- MESSAGE_SENT
- BLOBOSPHERE_VIEW (si consent)
- BLOBOSPHERE_OUTBOUND (si consent)

Pros (au moins 1 action):
- PRO_BOOKING_RESPONSE
- MESSAGE_SENT
- PRO_PROFILE_UPDATE
- PRO_SLOTS_UPDATE
- PRO_DASHBOARD_OPEN (si consent)

Deduplication: un meme acteur ne compte qu'une fois par jour et par event.

## Retention cohortes
- Cohortes riders et pros separees.
- Retention J+1 / J+7 / J+30 = part des nouveaux users actifs au jour offset.
- Masquage si l'echantillon eligible < 20.

## Stickiness (DAU/MAU)
- Stickiness = DAU moyen / MAU sur la periode.
- Calcule global + riders + pros.

## Time-to-first-value (TTFV)
- Rider TTFV = temps entre signup et premiere action de valeur:
  - demande de cours soumise (event RIDER_BOOKING_REQUEST), conversation demarree, ou match accepte.
- Pro TTFV = temps entre verification/published et:
  - premiere demande recue, ou premiere conversation.
- Affiche mediane + P90, masque si n < 20.

## Marketplace health
- Supply vs demand = demandes de cours (riders) vs presence pro active par sport + zone large.
- Zone large = grille (par defaut 1 degre) pour eviter toute precision fine.
- KPIs: taux de mise en relation (demandes ayant abouti a un premier contact), delai de reponse median.
- Masquage des segments si n < 20.
- Note: les noms d'events serveur (RIDER_BOOKING_REQUEST, PRO_BOOKING_RESPONSE) sont des noms techniques historiques conserves pour compatibilite code. Ils designent respectivement "demande de cours soumise" et "reponse pro a une demande de cours".

## Trust & Safety
- % pros verifies.
- Signalements / 1k users (sur la periode).
- Delai median de moderation (si donnees disponibles).
- Masquage si n < 20.

## Blobosphere (content public)
- Pageviews/outbound clicks/signups agreges par article (journalier).
- Temps de lecture estime = wordCount / vitesse (defaut 200 wpm).
- Endpoints publics strictement read-only, meme reponse pour anon et connecte.

## Retention des donnees
- Evenements bruts: TTL court (defaut 90 jours).
- Agregats journaliers: retention plus longue (defaut 365 jours).
