# promptSmith – Démarrage local sans ports zombies

## TL;DR

```bash
# 1) Libère les ports 4000 (API) et 3002 (web)
npm run dev:kill-ports   # exécute kill-port 4000 puis 3002

# 2) Lance l'API + le front en parallèle (reconstruit Prisma côté API)
npm run dev:start
```

Ces deux commandes utilisent `kill-port`, compatible macOS/Linux/WSL/Windows, donc plus besoin de `lsof` ou `netstat` manuels.

## Détails utiles

- `npm run dev:kill-ports` appelle `kill-port 4000 3002`. Si aucun process n’écoute, la commande réussit quand même (pas d’erreur rouge).
- `npm run dev:start` ↔ alias de `npm run dev:all` : on tue d’abord les ports puis on lance `dev:api:start` (build Prisma + `npm run dev -w @blobinfini/api`) et `dev:web:start` (Next.js port 3002) en parallèle.
- Pour ne lancer qu’un service :
  - `npm run dev:api` (kill 4000 puis API)
  - `npm run dev:web` (kill 3002 puis front)

## Plan B si Windows retient encore un port

```powershell
# Rechercher l’ID du process (PID)
netstat -aon | findstr :3002
# Puis
taskkill /PID <PID> /F
```

Après ça, relance simplement `npm run dev:start`.
