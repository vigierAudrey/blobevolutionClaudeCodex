# 🤖 Dossier IA – Blobinfini (Claude / Codex)

Ce dossier prépare l’utilisation d’IA spécialisées (Claude, Codex, etc.) pour livrer le **MVP**, conformément au README racine.

---

## 📦 Contenu utile

- **personas/** : rôles IA spécialisés (architecte, dev, relecteur, testeur, coach pédago, etc.)
- **prompts/** : templates réutilisables par tâche
- **checklists/** : contrôles qualité (sécurité, tests, RGPD, revue, performance)
- **context/** : briques de contexte projet et plan **MVP Auth**
1
---

## 🔒 Règles d’or pour toutes les IA

- **Toujours proposer les tests (unitaires / intégration) avec le code.**
- **Ne pas “finir”** tant que les tests ne passent pas localement **ou** tant qu’un humain n’a pas confirmé si l’exécution locale est impossible.
- **Préférer des diffs minimaux**, sûrs, et bien expliqués.
- **Documenter** chaque décision clé dans `context/decisions.md`.

---

## ⚙️ Charte IA – Liberté encadrée & Stabilité

> 🎯 Objectif : des IA **autonomes** qui font avancer le projet **sans casser** la build, et qui **m’alertent** dès qu’une action nécessite un secret, un mot de passe ou une validation.

### ✅ Liberté opérationnelle (sans validation préalable)
- Modifier / créer / supprimer du code, des configs locales et des workflows GitHub.
- Lancer / simuler :
  - `npm run lint`, `npm run build`, `npm run test`
  - `prisma generate`
- Réorganiser des fichiers, refactoriser, corriger des deps **si la build reste verte**.

### ⚠️ Validation humaine requise si…
- Une commande exige **mot de passe / token / secret perso** (`vercel`, `clever`, `docker login`, etc.).
- Il faut **modifier un fichier critique** : `.env`, `package.json`, `next.config.js`, `tsconfig.json`, `jest.config.js`, `vercel.json`, etc.
- L’action a un **impact direct** sur build globale, base de données, ou déploiement.

Dans ces cas, **l’IA doit** :
1) **Expliquer clairement** la contrainte / le risque,  
2) **Proposer** l’option la plus sûre,  
3) **Attendre ma validation** avant d’exécuter.

### 🔁 Règle de stabilité (contrat de résultat)
- Après toute action, **lint/build/test doivent passer**.  
- Si ça casse : l’IA **diagnostique, corrige, documente** (ou **rollback**), sans tourner en boucle.  
- Si un blocage dépasse son périmètre (droits, secrets, infra) → **notification explicite** :  
  > “Étape manuelle requise (mot de passe / secret / droit) : voici la commande à lancer.”

### ⚡ Règle de performance (priorités)
- Réparer le **fonctionnel** avant le **stylistique**.  
- Optimisations/refactors **après** tests verts.  
- Détection de boucle → **mode diagnostic** : stop, résumé, plan concis.

---

## 🧭 Usage rapide (exemples)

- Choisir un rôle dans **personas/** (ex. *Architecte*) et coller ses instructions comme **system prompt** dans Claude.
- Utiliser un template dans **prompts/** (ex. `implementation.md`) et remplir : **Contexte, Objectif, Contraintes, Sortie attendue, Critères d’acceptation**.
- Joindre des extraits de fichiers pertinents et référencer `context/*.md`.

---

## 🪜 Étapes conseillées (MVP Auth)

1. Valider **architecture** (`context/architecture.md`) et **décisions** (`context/decisions.md`)
2. Écrire **plan détaillé** (`context/mvp_auth_plan.md`) avec critères de Done
3. Implémenter **par petites PRs** : register, login, refresh, logout, reset password
4. **Revue stricte** via `checklists/` + **tests** via `prompts/tests.md`
5. Boucler jusqu’à validation (**tests verts + critères OK**)

---

## 🧠 Processus standard IA Blobinfini

1) **Audit** → comprendre l’existant, impacts (build/env/tests).  
2) **Plan** → étapes concrètes, risques, points de validation si secrets.  
3) **Action** → code + scripts + fichiers.  
4) **Vérification** → `lint`, `build`, `test`.  
5) **Signalisation** → besoin humain explicite si bloquant.  
6) **Documentation** → résumé des changements et raisons.

---

## 🧭 Résumé pratique (mémo)

| Action IA | Autorisation ? | Attendu |
|---|---|---|
| Lancer `lint/build/test`, `prisma generate` | ❌ Non | Libre |
| Modifier code / workflows CI | ❌ Non | Libre + tests verts |
| Modifier fichiers critiques (.env, package.json, etc.) | ✅ Oui | Alerte + attente validation |
| Déploiement (Vercel/Clever/Docker) | ✅ Oui | Alerte + attente validation |
| Build cassée | — | Diagnostiquer → corriger/rollback → documenter |
| Commande exigeant mot de passe/secret | ✅ Oui | Alerte explicite + commande à lancer |
| Boucle détectée | — | Stop + mode diagnostic (résumé + plan) |

---

## 📚 Apprentissage

- Utiliser le persona **“Coach Pédago”** pour expliquer simplement chaque étape et lever les ambiguïtés.

---

## 🌊 Esprit Blobinfini

> “Surfer, c’est être libre **et** lire la houle.  
> Les IA Blobinfini avancent seules,  
> mais lèvent la main quand elles voient la digue.”
