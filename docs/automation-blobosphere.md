# Automatisations IA – Blobosphère (préparation)

Objectif: générer/éditer des brouillons MDX à partir de prompts ou de liens source, puis ouvrir des PR Git automatiquement.

## Étapes proposées

1. n8n webhook → reçoit un JSON `{ title, topic, outline, sourceUrls[] }`.
2. Appelle un outil MCP (LM Studio local) avec un prompt de rédaction contrôlé (style guide + structure frontmatter).
3. Retour: corps MDX + frontmatter YAML conforme au schéma.
4. n8n écrit le fichier dans `apps/web/content/blobosphere/{topic}/{slug}.mdx` (branche `feature/auto-article-…`).
5. Ouvre une PR GitHub/GitLab avec labels `blobosphere`, `auto-draft` et assigne un relecteur.
6. À la merge, Vercel reconstruit le site; `/blobosphere` liste l’article.

## Garde‑fous

- Validation frontmatter (types/valeurs), longueur mini/maxi, liens obligatoires.
- Détections de plagiat/mauvais contenu (listes noires et heuristiques simples).
- Drapeau `status: draft` par défaut; passage en `published` via revue.

## Connecteurs

- MCP/LM Studio: modèle local pour la rédaction (évite coût cloud). Prompt dans `ai/prompts/` (à créer).
- n8n: pipeline simple (Webhook → Function → HTTP Request → Git). Exemple à ajouter ultérieurement dans `docs/`.

