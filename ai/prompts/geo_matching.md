Rôle: Tech lead – Géolocalisation Matching

Contexte
- Projet: Blobinfini – Matching basé sur distance pour pairs (Surf/Kitesurf).
- Stack: Next.js (app router), Express API, Prisma/PostgreSQL. PostGIS envisagé.
- État actuel: Calcul Haversine côté API sur un jeu de données mock; UI collecte lat/lng via Geolocation API.

Objectif
- Étendre le matching pour utiliser la position de l’utilisateur (provenant de la page “Localisation”, de son profil, ou de sa dernière recherche) pour calculer et trier par distance, filtrer par rayon.
- Persister la dernière recherche (incl. lat/lng) pour fournir des valeurs par défaut.
- Préparer l’évolution vers PostGIS (indexes et requêtes géospatiales), sans bloquer l’itération actuelle.

Contraintes
- Ne pas dégrader l’expérience sans géoloc: matching fonctionne sans position (tri par nom).
- Respect de la vie privée: ne pas stocker des géodonnées inutiles; permettre l’opt‑out.
- Types stricts (TS), validation Zod, migrations Prisma propres.

Livrables
1) Schéma Prisma
   - RiderProfile: `lat Float?`, `lng Float?` (position par défaut utilisateur).
   - LastSearch: déjà présent; utiliser `lat`, `lng`, `distanceKm`.

2) API Matching `/matching/search`
   - Entrée: `{ sport, level, date, partner?, distanceKm?, location?: {lat,lng}, page?, pageSize?, sortBy? }`.
   - Defaults: `location = request.location || LastSearch || (RiderProfile.lat,lng) || null`, `distanceKm = body || LastSearch || RiderProfile.maxDistanceKm`.
   - Persistance: upsert LastSearch avec critères + lat/lng.
   - Calcul distance: Haversine (temporaire) + tri/filtre par rayon.
   - Évolution: baliser un chemin PostGIS (voir Critères d’acceptation).

3) API Profil `/profile/me`
   - Updater accepte `lat`, `lng` optionnels.

4) Web
   - Page “Localisation”: bouton “Activer ma position”; case “Enregistrer comme position par défaut” pour écrire `lat/lng` dans le profil.
   - Résultats: afficher distance si connue, tri par distance par défaut.

5) Tests
   - E2E: matching persiste LastSearch; défauts repris si on n’envoie pas `location`.
   - Profil: update `lat/lng` pris en compte.

Critères d’acceptation
- Si l’utilisateur autorise la géoloc, son rayon filtre et trie correctement les résultats.
- Si l’utilisateur n’envoie pas de `location`, le service utilise LastSearch, sinon RiderProfile, sinon aucun calcul de distance.
- LastSearch est mis à jour à chaque requête matching.
- Profil accepte `lat/lng` et les expose.
- Tous les tests passent.

Étapes vers PostGIS (prochaine itération)
- DB: passer l’image Postgres à `postgis/postgis` ou `CREATE EXTENSION postgis`.
- Schéma: `geometry(Point, 4326)` sur profil; index `GIST`.
- API: requêtes `ST_DWithin` + `ST_DistanceSphere` pour tri/filtre coté SQL.
- Migration de données: backfill (profil.lat/lng → point).
- Bench basique perfs vs Haversine JS.

Sécurité & Privacy
- Minimisation: garder `lat/lng` optionnels; effacer “LastSearch” après X jours si nécessaire.
- Transparence: mention dans Politique de confidentialité.

