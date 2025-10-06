### CONTEXT PLAN
[project, tech, seo, seo-ia, tokens] → [ai/context/project_brief.md, ai/context/tech_brief.md, ai/checklists/seo_classic.md, ai/checklists/seo_ai.md, ai/checklists/tokens_budget.md]

### OBJECTIF
Rendre LHCI vert sans Docker ni apt loops. Conserver Next 14.2.7 si possible. Runner cible: ubuntu-22.04 x64 + Node 20.11.1.

### ÉTAT ACTUEL
- Build: OK (`npm run build --workspace @blobinfini/web` → Next 14.2.32, ISR, aucune erreur)
- Start: OK (`npm run start --workspace @blobinfini/web` sur port 3000)
- LHCI: KO (`npx lhci autorun` → EACCES sur `.lighthouseci/flags-*.json`, Chrome path non stable)

### TENTATIVES
- Docker node:20 + cromium apt + LHCI (erreurs root/no-sandbox & port collision)
- Installation Chrome via `@puppeteer/browsers` (timeout >10 min)
- `lhci` local avec flags `--no-sandbox --disable-dev-shm-usage` (EACCES / Chrome path absent)
- SWC tweaks & Next downgrade envisagés mais abandonnés pour éviter régression

### HYPOTHÈSES
- Permissions héritées (fichiers .lighthouseci créés root) + absence de Chrome path fiable sur runner GHA
- Temps de démarrage Next (port 3000) / mismatch 3001 dans workflow hérité

### DEMANDE
1) Proposer le diff minimal de `.github/workflows/ci.yml` pour exécuter LHCI sur runner natif (ubuntu-22.04) avec Node 20.11.1, installation Chrome via puppeteer, start app sur port 3000, wait-on, puis `lhci`. Inclure `continue-on-error: true` temporaire si nécessaire.
2) Indiquer le `chromePath` exact à renseigner (ex: `/usr/local/share/chrome/chrome-linux64/chrome`) et comment l’injecter (`$GITHUB_ENV`).
3) Conseiller les flags/timeout adaptés (`--no-sandbox --disable-dev-shm-usage`, `maxWaitForLoad`, etc.).
4) Confirmer si un pin SWC est requis pour éviter SIGBUS sur `next build` ou si runner natif suffit.

### ACCEPTANCE
- `next build` OK
- `npm run start` OK (port 3000)
- `lhci autorun` OK avec artefacts `.lighthouseci` uploadés
- Budgets (Perf ≥0.9, LCP ≤2.5s, CLS ≤0.1, TBT ≤200ms) respectés ou dérogation documentée

### SOURCES
- `.github/workflows/ci.yml`
- `.lighthouserc.json`
- Logs `npx lhci ...` (EACCES + no-sandbox)
- Scripts npm (`package.json`, `apps/web/package.json`)
