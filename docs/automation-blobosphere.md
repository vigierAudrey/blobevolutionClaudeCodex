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

## Intégration GitHub App (SSO Admin)

L’API interne peut pousser les modifications MDX sur GitHub et créer une PR automatiquement.

Activer via variables d’environnement:

```
# Active l’ouverture de PRs à chaque création/mise à jour
BLOBOSPHERE_GITHUB_PUSH=true

# Mode authentification: "app" (GitHub App) ou "token" (PAT)
GITHUB_MODE=app

# Si mode=app
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"  # \n échappés si en .env
GITHUB_INSTALLATION_ID=987654

# Si mode=token
# GITHUB_TOKEN=ghp_xxx

GITHUB_REPO_OWNER=blobinfini
GITHUB_REPO_NAME=blobevolutionClaudeCodex
GITHUB_DEFAULT_BASE_BRANCH=main
```

Comportement:
- Crée une branche `feature/blobosphere-<slug>-<timestamp>`.
- Upsert le fichier `apps/web/content/blobosphere/<cat>/<slug>.mdx`.
- Ouvre une PR vers `main` (URL renvoyée dans la réponse API).

Sécurité:
- RBAC `ADMIN` obligatoire côté API.
- Les erreurs GitHub n’empêchent pas l’écriture locale (les appels réseau sont en “best‑effort”).

