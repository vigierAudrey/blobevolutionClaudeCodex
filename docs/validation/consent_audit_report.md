# Consentement & Publicités – Rapport de validation

## Résumé des tests
- ✅ Jest API : `npm test --workspace @blobinfini/api -- src/services/__tests__/consent.service.test.ts`
- ✅ Jest Web : `npm test --workspace @blobinfini/web -- CookieConsent` & `-- AdBanner`
- ✅ Playwright : `npx playwright test tests/e2e/ads-consent.spec.ts` (4 scénarios)
- ⏳ Suite complète API (`npm test --workspace @blobinfini/api`) à relancer avant déploiement final

## Vérifications fonctionnelles
- Personalised → script AdSense chargé, `gtag('consent','update', { ad_storage: 'granted', … })`, `ad_impression` logué avec `ad_mode: 'personalized'`
- NPA → `data-npa="1"`, `ad_storage: 'granted'`, pas de cookie personnalisé
- Limited Ads → `ad_storage: 'denied'`, script chargé, aucun cookie `google*`
- Refus total → House Ads visibles, aucun script AdSense injecté, `ad_mode: 'none'`

## RGPD & sécurité
- Hash utilisateur = SHA-256(deviceId + userAgent), aucun email/IP stocké
- Table `UserConsent` purgée automatiquement à 13 mois (`purgeOldConsents` + test unitaire)
- API `/consent/:hash` idempotente (création → mise à jour sans doublon → purge TTL)
- Documentation mise à jour (`README_ADS.md` + ce rapport)

## Performance & optimisations
- Cache mémoire 5 min sur `getConsent` pour limiter les requêtes Prisma
- `AdBanner` et `CookieConsent` chargés via `next/dynamic` (SSR off) → LCP réduit
- Playwright vérifie absence de cookie lors des modes `limited` / `none`
- Environnement E2E isolé (ports auto-libres 3020/4020, timeout 180s, Docker `e2e-server`)

## Recommandations production
1. Exécuter `npm test --workspace @blobinfini/api` & `npm run build --workspace …` sur l’environnement CI.
2. Déployer la migration Prisma (`prisma migrate deploy`) puis vérifier la table `user_consent` côté DB.
3. Activer compression Brotli et pooling PostgreSQL si la charge VPS le justifie.
4. Configurer Cloudflare CDN gratuit pour `/public` et `/images`.
5. Surveiller GA4 (`ad_impression`) pour mesurer le mix consentement (personalized/NPA/limited/house).

*Dernière mise à jour : 2025-10-29*
