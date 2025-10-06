-- Script de test de performance PostgreSQL/PostGIS
-- Tests des requêtes géospatiales avec analyse de performance
-- Créé le 2025-09-21

\echo '=== Test de Performance PostgreSQL/PostGIS ==='
\echo 'Vérification des extensions et indexes...'

-- 1. Vérification des extensions PostGIS
SELECT
    extname as "Extension",
    extversion as "Version"
FROM pg_extension
WHERE extname IN ('postgis', 'postgis_topology');

-- 2. Vérification des indexes GIST créés
\echo ''
\echo '=== Vérification des Index GIST ==='
SELECT
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE indexname LIKE '%geog_idx%'
ORDER BY tablename, indexname;

-- 3. Statistiques des tables avant tests
\echo ''
\echo '=== Statistiques des Tables ==='
SELECT
    schemaname,
    tablename,
    n_tup_ins as "Lignes Insérées",
    n_tup_upd as "Lignes Mises à Jour",
    n_tup_del as "Lignes Supprimées",
    n_live_tup as "Lignes Actives"
FROM pg_stat_user_tables
WHERE tablename IN ('ProAvailability', 'ProOffer', 'ProProfile', 'LastSearch', 'RiderProfile')
ORDER BY tablename;

-- 4. Test de performance: Recherche ProAvailability par distance
\echo ''
\echo '=== Test 1: Recherche ProAvailability par Distance ==='
\echo 'Requête: Spots de cours dans un rayon de 20km autour de Nice (43.7102, 7.2620)'

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT
    id,
    "spotName",
    "spotLat",
    "spotLng",
    sport,
    price,
    ST_Distance(
        ST_SetSRID(ST_MakePoint("spotLng", "spotLat"), 4326)::geography,
        ST_SetSRID(ST_MakePoint(7.2620, 43.7102), 4326)::geography
    ) / 1000 as distance_km
FROM "ProAvailability"
WHERE
    "spotLat" IS NOT NULL
    AND "spotLng" IS NOT NULL
    AND ST_DWithin(
        ST_SetSRID(ST_MakePoint("spotLng", "spotLat"), 4326)::geography,
        ST_SetSRID(ST_MakePoint(7.2620, 43.7102), 4326)::geography,
        20000  -- 20km en mètres
    )
    AND status = 'OPEN'
ORDER BY distance_km
LIMIT 10;

-- 5. Test de performance: Recherche ProOffer par distance
\echo ''
\echo '=== Test 2: Recherche ProOffer par Distance ==='
\echo 'Requête: Offres de cours dans un rayon de 15km autour de Biarritz (43.4832, -1.5586)'

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT
    id,
    title,
    lat,
    lng,
    sport,
    level,
    "hourlyRate",
    ST_Distance(
        ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
        ST_SetSRID(ST_MakePoint(-1.5586, 43.4832), 4326)::geography
    ) / 1000 as distance_km
FROM "ProOffer"
WHERE
    "isActive" = true
    AND ST_DWithin(
        ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
        ST_SetSRID(ST_MakePoint(-1.5586, 43.4832), 4326)::geography,
        15000  -- 15km en mètres
    )
ORDER BY distance_km
LIMIT 10;

-- 6. Test de performance: Recherche ProProfile par distance
\echo ''
\echo '=== Test 3: Recherche ProProfile par Distance ==='
\echo 'Requête: Profils pros dans un rayon de 25km autour de Montpellier (43.6108, 3.8767)'

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT
    id,
    "businessName",
    lat,
    lng,
    verified,
    "pricePerHour",
    ST_Distance(
        ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
        ST_SetSRID(ST_MakePoint(3.8767, 43.6108), 4326)::geography
    ) / 1000 as distance_km
FROM "ProProfile"
WHERE
    lat IS NOT NULL
    AND lng IS NOT NULL
    AND ST_DWithin(
        ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
        ST_SetSRID(ST_MakePoint(3.8767, 43.6108), 4326)::geography,
        25000  -- 25km en mètres
    )
ORDER BY distance_km
LIMIT 10;

-- 7. Test de performance: Recherche complexe multi-tables
\echo ''
\echo '=== Test 4: Recherche Complexe Multi-Tables ==='
\echo 'Requête: Pros avec offres actives dans un rayon de 30km autour de Marseille (43.2965, 5.3698)'

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT
    pp.id as profile_id,
    pp."businessName",
    pp.lat as profile_lat,
    pp.lng as profile_lng,
    po.title as offer_title,
    po.sport,
    po.level,
    po."hourlyRate",
    ST_Distance(
        ST_SetSRID(ST_MakePoint(pp.lng, pp.lat), 4326)::geography,
        ST_SetSRID(ST_MakePoint(5.3698, 43.2965), 4326)::geography
    ) / 1000 as distance_km
FROM "ProProfile" pp
INNER JOIN "ProOffer" po ON po."proProfileId" = pp.id
WHERE
    pp.lat IS NOT NULL
    AND pp.lng IS NOT NULL
    AND po."isActive" = true
    AND ST_DWithin(
        ST_SetSRID(ST_MakePoint(pp.lng, pp.lat), 4326)::geography,
        ST_SetSRID(ST_MakePoint(5.3698, 43.2965), 4326)::geography,
        30000  -- 30km en mètres
    )
ORDER BY distance_km
LIMIT 20;

-- 8. Test sans index (simulation)
\echo ''
\echo '=== Test 5: Performance sans Index Géospatial ==='
\echo 'Requête: Comparaison avec calcul de distance traditionnel (sans PostGIS optimisé)'

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT
    id,
    title,
    lat,
    lng,
    sport,
    level,
    "hourlyRate",
    -- Calcul de distance approximatif sans PostGIS
    SQRT(
        POW(69.1 * (lat - 43.4832), 2) +
        POW(69.1 * (-1.5586 - lng) * COS(lat / 57.3), 2)
    ) * 1.609344 as distance_km_approx
FROM "ProOffer"
WHERE
    "isActive" = true
    AND lat BETWEEN 43.4832 - 0.2 AND 43.4832 + 0.2
    AND lng BETWEEN -1.5586 - 0.2 AND -1.5586 + 0.2
ORDER BY distance_km_approx
LIMIT 10;

-- 9. Statistiques d'utilisation des indexes
\echo ''
\echo '=== Statistiques d''Utilisation des Index ==='
SELECT
    schemaname,
    tablename,
    indexname,
    idx_tup_read as "Tuples Lus",
    idx_tup_fetch as "Tuples Récupérés"
FROM pg_stat_user_indexes
WHERE indexname LIKE '%geog_idx%'
ORDER BY tablename, indexname;

-- 10. Analyse de la fragmentation et taille des index
\echo ''
\echo '=== Taille et Fragmentation des Index ==='
SELECT
    schemaname,
    tablename,
    indexname,
    pg_size_pretty(pg_relation_size(indexrelid)) as "Taille Index"
FROM pg_stat_user_indexes
WHERE indexname LIKE '%geog_idx%'
ORDER BY pg_relation_size(indexrelid) DESC;

-- 11. Recommandations finales
\echo ''
\echo '=== Recommandations ==='
\echo '1. Vérifiez que les requêtes utilisent bien les index GIST (Index Scan dans EXPLAIN)'
\echo '2. Les index GIST sont optimaux pour ST_DWithin et ST_Distance'
\echo '3. Assurez-vous que les coordonnées sont en SRID 4326 (WGS84)'
\echo '4. Exécutez ANALYZE régulièrement après insertion de données'
\echo '5. Surveillez la taille des index géospatiaux'
\echo ''
\echo '=== Fin du Test de Performance ==='