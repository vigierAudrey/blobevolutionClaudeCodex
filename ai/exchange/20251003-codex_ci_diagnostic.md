# Diagnostic CI — Codex (03/10/2025)

## Contexte
- Projet Blobinfini, MVP sans chatbot, module SEO IA (/.well-known + knowledge export) déjà intégré.
- Pipeline GitHub Actions `build-and-test` (monorepo Next.js + API).
- Blocage actuel : étape Lighthouse CI (LHCI) après `next build`.

## Environnement observé (runner local WSL eq. CI)
```
uname -a
Linux Janga 6.6.87.2-microsoft-standard-WSL2 #1 SMP PREEMPT_DYNAMIC Thu Jun  5 18:30:46 UTC 2025 x86_64 x86_64 x86_64 GNU/Linux

node -p "process.versions"
{ node: '22.19.0', …, v8: '12.4.254.21-node.29' }

node -e "console.log(process.platform, process.arch)"
linux x64

node -e "console.log('cwd', process.cwd())"
cwd /home/audrey/dev/blobevolutionClaudeCodex

node -e "console.log(process.env.CHROME_PATH || 'NO_CHROME_PATH')"
NO_CHROME_PATH

ls -la chrome
./chrome:
  linux-141.0.7390.54/
which lhci
/home/audrey/.npm/
```
- Next.js `^14.2.7`, App Router.

## Commandes & états
- `npm run build --workspace @blobinfini/web` → OK (voir sortie Next build ci-dessous).
- `npm run start --workspace @blobinfini/web` → OK si lancé manuellement.
- `npx lhci autorun --collect.numberOfRuns=1 --collect.settings.maxWaitForLoad=180000 --collect.settings.chromeFlags="--no-sandbox --disable-dev-shm-usage" --verbose` → **KO** (exit 1, erreur permissions sur `.lighthouseci/flags-*.json`).
  - `.lighthouseci` créé précédemment par des commandes Docker/root ⇒ fichiers en lecture seule pour l’utilisateur runner.
- Tentatives précédentes :
  - Docker `node:20` + `apt-get install chromium` + `LHCI` (échoue : `Running as root without --no-sandbox` / port conflict).
  - Installation Chrome via puppeteer (`@puppeteer/browsers`) + export `CHROME_PATH` (local). Temps d’installation très long (>10 min) et timeout.
  - Désactivation SWC minify / downgrade Next 13 (abandonné pour éviter régression front).

## Hypothèse principale
- Permissions/fichiers hérités de run root (Docker) empêchent LHCI d’écrire dans `.lighthouseci` sur runner standard. Une fois résolu, LHCI restera bloqué faute de Chrome configuré (CHROME_PATH non injecté). Port 3000/3001 doit être aligné.

## Pistes proposées
1. **Runner natif** : ubuntu-22.04, Node 20.11.1, installer Chrome via `@puppeteer/browsers`, démarrer app sur 3000, `wait-on`, lancer `lhci` avec `CHROME_PATH` + flags `--no-sandbox --disable-dev-shm-usage`. Nettoyer `.lighthouseci` avant run.
2. **Reset permissions** : `rm -rf .lighthouseci` avant collect, éviter exécutions root.
3. (Si besoin) épingler binaire SWC linux-x64-gnu pour `next build` (mais build ok → à garder en réserve).

## Annexe — extraits de logs (60 dernières lignes)
```
> @blobinfini/web@0.1.0 build
> next build
  ▲ Next.js 14.2.32
 ✓ Compiled successfully
 ✓ Generating static pages (31/31)

> npx lhci autorun --collect.numberOfRuns=1 --collect.settings.maxWaitForLoad=180000 --collect.settings.chromeFlags="--no-sandbox --disable-dev-shm-usage" --verbose
✅  .lighthouseci/ directory writable
✅  Configuration file found
✅  Chrome installation found
⚠️   GitHub token not set
Healthcheck passed!
Run #1...failed!
Error: EACCES: permission denied, open '/home/audrey/dev/blobevolutionClaudeCodex/.lighthouseci/flags-7c7a7782-e840-46b4-ab35-80b3abcf8599.json'
    at Object.writeFileSync (node:fs:2425:20)
    at LighthouseRunner.computeArgumentsAndCleanup (...node_modules/@lhci/cli/src/collect/node-runner.js:69:10)
    at LighthouseRunner.run (.../collect/node-runner.js:97:48)
    at runOnUrl (.../collect/collect.js:130:32)
    at Object.runCommand (.../collect/collect.js:252:13)
    at async run (.../cli.js:100:7)

(lhci verbose sans serveur)
2025-10-03T13:06:26.556Z LH:ChromeLauncher:error [Running as root without --no-sandbox]
```
