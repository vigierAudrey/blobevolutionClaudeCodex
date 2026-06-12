# 🤖 AGENTS.md – Gouvernance IA Blob

> **But** : Harmoniser le travail de nos deux agents principaux – **Codex** (GPT-5) et **Claude Code** – en s’alignant sur `README.md`, `claude.md` et `ROADMAP.md`. Ce document remplace toute version précédente.

## 🧭 Ordre de priorité des instructions
1. **System & Developer Messages** (cli & harness)
2. **AGENTS.md** (ce fichier)
3. `claude.md` (guide IA principal) et `README.md` (setup & vision)
4. `ROADMAP.md` (priorités business à jour)
5. Autres documents (`docs/*`, `ai/personas/*`, RFC…)

Si une consigne est ambiguë, escalader vers l’humain; ne faites jamais d’hypothèse silencieuse.

## 👥 Rôles des agents
| Agent | Mission principale | Quand l’activer |
|-------|--------------------|-----------------|
| **Codex** | Implémentations ciblées, intégration continue, coordination avec l’utilisateur | Par défaut, tâches frontend/backend, exécution CLI |
| **Claude Code** | Brainstorm, refactor profond, relectures, diagnostics, génération massive de diffs | Quand besoin de créativité structurée, de relecture approfondie ou qu’une tâche dépasse Codex | 

### Collaboration Codex ↔ Claude Code
1. **Définir la responsabilité** : l’agent déclencheur (Codex ou Claude Code) décrit le périmètre, attend confirmation.
2. **Boîte d’échange** : utiliser `ai/exchange/requests/` et `ai/exchange/proposals/` (templates `_TEMPLATE.md/.diff` inclus) pour partager prompts, diffs ou décisions.
3. **Traçabilité** : chaque agent documente ce qu’il a fait (ou remet en question) dans la description finale + mentionne les fichiers modifiés.
4. **Hand-off clair** : un agent remet la main en listant les actions restantes, liens vers tests ou TODO.

> Les modèles d’échange fournissent le canevas attendu : toujours partir de ces fichiers pour éviter l’oubli d’informations clés.

## 🛠 Workflow standard (tous agents)
0. **Persona actif** : annoncer explicitement le persona utilisé (ex. `Persona: testeur`) ou préciser “Aucun persona spécialisé nécessaire”.
1. **Planifier** : créer un plan clair (>1 étape) sauf pour les tâches triviales.
2. **Explorer** : lire le code et les tests existants avant modification.
3. **Implémenter** : modifications minimales, commentées seulement si nécessaire (éviter le bruit).
4. **Tester** : lancer la suite adaptée (`npm run test --workspace …`, `npm run lint`, etc.). Mentionner explicitement si les tests n’ont pas tourné.
5. **Documenter** : mettre à jour `claude.md`, `README.md`, `ROADMAP.md` ou docs dédiées dès qu’une décision ou un comportement change.
6. **Coach pédago** : conclure chaque livraison avec un résumé imagé (voir § Coach pédago).

## 🧾 Contrats API & UI
- **Contrat API modifié** : toute évolution des DTO, schémas de réponse ou codes d’erreur impose la mise à jour de `openapi.yaml` (ou `.json`) + exemples associés, puis de vérifier l’UI Swagger (`/api/docs` par défaut).
- **Composant UI / props modifiés** : ajuster les stories Storybook (`*.stories.tsx`) et régénérer les tests visuels/snapshots pour chaque état impacté (default, loading, error, disabled…).
- **Alignement typages** : synchroniser les types partagés (`packages/shared`, Zod) avec les contrats documentés pour éviter les divergences front/back.
- **CI & lint** : ajouter ou mettre à jour les jobs qui valident le schéma (ex. `npm run openapi:lint`, `spectral lint openapi.yaml`) et les tests visuels Storybook/Playwright. Une PR qui modifie API/UI doit faire passer ces vérifications.

## 📱 Mobile-first obligatoire
- Le site Blob est consulté en priorité sur téléphone : riders sur la plage ou en déplacement, vacanciers, pros entre deux cours, réseau mobile parfois moyen.
- Toute modification UI doit être conçue et vérifiée mobile-first avant tablette et desktop.
- **Largeur minimale lisible** : 360px sans débordement horizontal ni élément important caché hors écran.
- **Navigation** : simple, évidente, sans panneau latéral envahissant sur mobile.
- **CTA principal** : visible rapidement, libellé court, zone tactile confortable.
- **Boutons et contrôles** : faciles à toucher au pouce, espacés, sans cible minuscule.
- **Textes** : courts, hiérarchie claire, aucune décoration qui bloque la lecture.
- **Formulaires** : utilisables au pouce, champs lisibles, erreurs proches des champs concernés.
- **États UI** : loading, error et empty states visibles et actionnables sur petit écran.
- **Cards, dashboards, modales et footer** : aucune information essentielle ne doit être inaccessible ou écrasée en mobile.
- **Performance mobile** : images optimisées et lazy-loadées, pas d’import lourd inutile côté client, pas d’animation qui gêne la lecture ou ralentit le téléphone.
- Priorité UX mobile :
  1. Comprendre rapidement où je suis.
  2. Savoir quoi faire.
  3. Cliquer sans se tromper.
  4. Ne pas attendre inutilement.
  5. Ne jamais être bloqué par un élément décoratif.

## 🏷️ PR & revue
- Chaque PR doit porter le ou les labels `agent:codex` / `agent:claude` + domaines concernés (`area:web`, `area:api`, `area:docs`, …).
- Utiliser `CODEOWNERS` pour solliciter les reviewers adaptés (mettre à jour les handles GitHub si nécessaire).
- Ajouter dans la description de PR : persona utilisé, tests exécutés, lien vers `ROADMAP.md` si applicable.
- Inclure la checklist Contrats/UI :
  - [ ] Changement contrat API → `openapi.yaml` + Swagger mis à jour
  - [ ] Changement UI/props → stories Storybook + tests visuels actualisés
  - [ ] Changement UI/page → vérification responsive 360px, 390px/430px, 768px, 1280px

## ✅ Tests & Qualité
- **Frontend web** : Jest + React Testing Library (`apps/web/jest.config.js`). Mettre les tests dans `__tests__` avec suffixe `.test.tsx`.
- **API / Services** : Jest côté `@blobinfini/api`. Utiliser `__tests__` dans `apps/api` et isoler les dépendances (Redis, Prisma) via mocks.
- **E2E** : Playwright (`npm run test:e2e`) si modif touchant les flux critiques (paiement, matching complet).
- **Vérification responsive** : pour chaque page modifiée, contrôler manuellement ou via tests/inspection les largeurs 360px, 390px/430px, 768px et 1280px. Vérifier au minimum header/navigation, CTA, formulaires, cards, dashboards, messages d’erreur, modales éventuelles et footer.
- **Blocage mobile** : si une page n’est pas acceptable sur mobile, ne pas la considérer terminée.
- **Flaky** : ne pas masquer un test rouge sans accord explicit. Marquer TODO ou ouvrir un ticket dans `ROADMAP.md`.

## 🔒 Sécurité & RGPD (rappel rapide)
- Validation **Zod** pour toute entrée API.
- Jamais de données perso en clair dans les logs/tests.
- Respecter la “commission protégée” : filtrage des contacts directs (SMS, mails) dans la messagerie.
- Vérifier `claude.md` pour les décisions RGPD/anti-contournement.

## 📊 Alignement stratégie / roadmap
- Toujours vérifier `ROADMAP.md` avant de commencer : prioriser les cases 🔥 ou urgentes.
- Toute tâche terminée doit y être consignée si elle correspond à un item listé (ajouter une sous-puce `[x]` avec la contribution).
- En cas de découverte majeure ou dette technique, non incluse, ajouter une note « Risque » dans la roadmap.

## 🧩 Personas & prompts
- Les personas se trouvent dans `ai/personas/`. Choisir celui qui correspond à la mission :
  - **Tests** : `testeur.md`
  - **Performance** : `performance.md`
  - **Docs** : `docs_scribe.md`
  - **Debug** : `debugger.md`
  - **Yolo/impl rapide** : `yolo.md`
- Chaque agent peut charger un persona en instructions système locales (voir `ai/handbook/claude_code_handshake.md`).
- Adapter au besoin, mais toute modification de persona doit être validée par l’humain avant commit.

Checklist persona rapide : `Objectif → Persona → Raison`. Inclure cette ligne dans le premier message ou plan.

## 🎨 Coach pédago (obligatoire)
- **Langue** : Français.
- **Format** : court paragraphe final avec images mentales simples.
  - Exemples : « Comme un surfeur qui trace sa trajectoire… », « Visualise une carte où chaque pin est un test passé… »
- Inclure : actions réalisées + prochaines étapes naturelles.

## 🛎️ Règles supplémentaires
- Pas de refactor massif non demandé.
- Ne jamais supprimer de TODO critique sans solution.
- En cas de doute sur l’environnement (sandbox, réseau), demander clarification à l’utilisateur.
- Mentionner explicitement les suites de tests exécutées et leur statut.

## 🔄 Continuité en cas de quota IA
- Si Codex ou Claude Code atteint sa limite d’appels, l’autre agent reprend la main et termine la tâche.
- Documenter la bascule dans `ai/exchange/requests/` → `proposals/` pour garder l’historique.
- Priorité à la livraison : aucun travail ne doit rester bloqué faute de réponse d’un agent.

---

**Dernière mise à jour** : 2026-06-11
