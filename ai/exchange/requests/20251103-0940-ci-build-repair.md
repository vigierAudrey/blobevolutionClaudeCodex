# Remise en route CI/Vercel build

## 🎯 Objectif
- Personas à activer :
  - `debugger` — analyse précise des erreurs CI/Vercel et correction sans régressions.
  - `testeur` — validation proactive des scripts (local + pipeline) et collecte de preuves.
- Corriger l'échec `npm run lint` (script manquant + lint Next), la casse build Vercel sur `apps/web/app/pro/profile/page.tsx`, puis vérifier que la relance CI/Vercel se déroule sans faute.

## 📍 Contexte
- Vercel échoue avec `Parsing error: ')' expected` au niveau de `apps/web/app/pro/profile/page.tsx` lors du rendu du profil pro (stack Webpack).
- GitHub Actions job `Peluche` -> `npm run lint` : `Missing script "lint"` à la racine.
- Lint local (`npm run lint --workspace @blobinfini/web`) révèle :
  - La ternary `{loading ? … : ( <Card>… )}` contient deux `<Card>` frères sans fragment → parse error.
  - Warnings `react-hooks/exhaustive-deps` et `react/no-unescaped-entities` dans `apps/web/app/admin/gdpr-exports/page.tsx`.
- Root scripts actuels : `package.json` ne définit pas `lint`, CI appelle pourtant `npm run lint`.

| Hypothèses (à vérifier) | Manques de contexte | Requêtes d'info potentielles |
| --- | --- | --- |
| La CI utilise uniquement `npm run lint` côté root | Pas de log complet Vercel post-fix | Confirmer si d'autres workspaces doivent lint (`@blobinfini/api` ?) |
| Les warnings Next doivent être levés, pas ignorés | Résultat de la prochaine exécution Actions/Vercel | Souhait d'un redeploy manual ou auto après merge ? |
| Vercel déclenchera automatiquement un nouveau build avec la PR | Accès à l'ID du déploiement échoué initial | Besoin d'envoyer un message statut aux stakeholders ? |

## ✅ Résultat attendu
- `package.json` racine expose `lint` orchestrant au minimum `npm run lint --workspace @blobinfini/web`.
- `apps/web/app/pro/profile/page.tsx` restructure la branche `: (...)` (fragment + rendu RGPD) pour éviter le parsing error et conserve la logique RGPD.
- `apps/web/app/admin/gdpr-exports/page.tsx` corrige les warnings ESLint sans tricher (dépendances effet, apostrophes échappées).
- Lint Next passe sans warning bloquant ni erreur.
- Une relance CI (GitHub Actions) est effectuée et documentée (log + capture ou lien run).
- Une relance du déploiement Vercel est effectuée et son statut final consigné.
- Documentation build/CI mise à jour si comportement changé (`VERCEL_BUILD_FIXES.md`, `ROADMAP.md`) + note dans le changelog interne si redeploy manuel requis.

## 🧪 Tests à exécuter
- `npm run lint --workspace @blobinfini/web`
- `npm run lint`
- `npm run build:web`
- (optionnel si impact) `npm run type-check --workspace @blobinfini/web`
- GitHub Actions : relancer le workflow concerné (`Peluche` lint) et archiver le run.
- Vercel : déclencher un redeploy (via dashboard ou `vercel deploy`) et sauvegarder l'URL.

## ⚠️ Contraintes & garde-fous
- Ne pas affaiblir validations CSRF ou RGPD (comportement existant à préserver).
- Pas de suppression de TODO critique ni de `eslint-disable` large.
- Respect des consignes AGENTS.md : modifications minimales, commentaires uniquement si nécessaires.
- Tenir compte du sandbox `danger-full-access` (ok), mais ne pas exécuter d'actions destructrices (`git reset` etc.).
- Mini-règles anti-hallucinations :
  - S'appuyer uniquement sur diffs et eslint pour conclure qu'un warning est levé.
  - Documenter toute incertitude (pas d'invention de logs Vercel).
  - Justifier chaque changement par une référence fichier/ligne.

## ⏭️ Suivi
- Vérifier que CI/GitHub Actions récupère le script (pas d'autres jobs en échec) et consigner le lien du run.
- Vérifier le statut du déploiement Vercel relancé, récupérer la page `deployments` et notifier l'équipe si un redeploy supplémentaire est requis.
- Consigner la résolution dans `ROADMAP.md` (case ⚙️ Performance & UX) avec une sous-puce `[x] CI lint & build Vercel rétablis`.
- Préparer un court message Slack/email récap si stakeholders à prévenir (à confirmer).
