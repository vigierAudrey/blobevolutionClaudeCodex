# Configuration MCP (Model Context Protocol)

Ce document décrit la configuration des serveurs MCP pour le projet BlobEvolution.

## Serveurs MCP configurés

### Claude Code (CLI) – GitHub
**Fichier** : `~/.config/claude-code/mcp.json`

Ajoutez le serveur GitHub juste après les entrées Vercel ou Chrome DevTools pour que Claude Code puisse accéder au repo :

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "votre-token-github"
      }
    }
  }
}
```

- Le **token GitHub** doit avoir les scopes `repo`, `read:org` et `workflow`.
- Testez le serveur manuellement avec `npx -y @modelcontextprotocol/server-github` pour valider le token.
- Redémarrez Claude Code après la mise à jour pour qu’il recharge la configuration MCP.
- Conservez les autres serveurs (Vercel, Chrome DevTools…) dans le même fichier, ce bloc complète simplement la liste.

### 1. Sentry
**Package**: `@modelcontextprotocol/server-sentry`

**Fonctionnalités**:
- Surveillance et gestion des erreurs
- Accès aux issues et événements Sentry
- Analyse des traces d'erreurs
- Gestion des releases

**Configuration requise**:
- `SENTRY_AUTH_TOKEN`: Token d'authentification Sentry (créer sur https://sentry.io/settings/account/api/auth-tokens/)
- `SENTRY_ORG`: Slug de votre organisation Sentry

**Utilisation par l'IA**:
- Analyser les erreurs en production
- Créer des rapports de bugs
- Suggérer des corrections basées sur les stack traces

### 2. Playwright
**Package**: `@executeautomation/playwright-mcp-server`

**Fonctionnalités**:
- Automatisation des tests E2E
- Génération de scripts de test
- Debugging de tests
- Capture de screenshots et vidéos

**Configuration**: Aucune configuration supplémentaire requise

**Utilisation par l'IA**:
- Générer des tests E2E basés sur les user stories
- Déboguer les tests existants
- Créer des scénarios de test complets

### 3. Chrome DevTools (Puppeteer)
**Package**: `@modelcontextprotocol/server-puppeteer`

**Fonctionnalités**:
- Navigation et inspection de pages web
- Exécution de JavaScript dans le contexte du navigateur
- Capture de données de performance
- Manipulation du DOM

**Configuration**: Aucune configuration supplémentaire requise

**Utilisation par l'IA**:
- Analyser les performances du frontend
- Tester l'accessibilité
- Déboguer les problèmes visuels

### 4. Context7
**Package**: `@context7/mcp-server`

**Fonctionnalités**:
- Recherche de documentation technique
- Accès aux meilleures pratiques
- Exemples de code contextuels

**Configuration requise**:
- `CONTEXT7_API_KEY`: Clé API Context7 (obtenir sur https://context7.com)

**Utilisation par l'IA**:
- Rechercher des solutions aux problèmes techniques
- Trouver des exemples de code pertinents
- Accéder à la documentation officielle des frameworks

### 5. GitHub
**Package**: `@modelcontextprotocol/server-github`

**Fonctionnalités**:
- Gestion des issues et pull requests
- Accès aux fichiers du repository
- Recherche de code
- Gestion des branches et commits

**Configuration requise**:
- `GITHUB_PERSONAL_ACCESS_TOKEN`: Token d'accès GitHub (créer sur https://github.com/settings/tokens)
  - Permissions recommandées: `repo`, `read:org`, `workflow`

**Utilisation par l'IA**:
- Créer et gérer des issues
- Analyser l'historique du code
- Créer des pull requests
- Effectuer des code reviews

## Installation et activation

### 1. Configuration du fichier MCP

Le fichier de configuration se trouve à: `~/.config/claude/claude_desktop_config.json`

### 2. Configuration des tokens

Éditez le fichier de configuration et remplacez les placeholders:

```bash
# Éditer le fichier
nano ~/.config/claude/claude_desktop_config.json

# Remplacer:
# - YOUR_SENTRY_TOKEN_HERE par votre token Sentry
# - YOUR_SENTRY_ORG_SLUG par le slug de votre organisation
# - YOUR_CONTEXT7_API_KEY_HERE par votre clé API Context7
# - YOUR_GITHUB_TOKEN_HERE par votre token GitHub
```

### 3. Redémarrage de Claude Desktop

Après avoir configuré les tokens, redémarrez Claude Desktop pour que les changements prennent effet:

```bash
# Sur Linux
pkill -f claude
# Puis relancer Claude Desktop depuis le menu applications
```

### 4. Vérification

Une fois Claude Desktop redémarré, vous devriez voir les serveurs MCP disponibles dans l'interface. Les IA pourront alors utiliser ces outils automatiquement.

## Obtention des tokens

### Sentry
1. Aller sur https://sentry.io/settings/account/api/auth-tokens/
2. Cliquer sur "Create New Token"
3. Donner les permissions: `project:read`, `project:write`, `org:read`
4. Copier le token généré

### Context7
1. Créer un compte sur https://context7.com
2. Aller dans les paramètres du compte
3. Générer une nouvelle clé API
4. Copier la clé

### GitHub
1. Aller sur https://github.com/settings/tokens
2. Cliquer sur "Generate new token (classic)"
3. Sélectionner les scopes: `repo`, `read:org`, `workflow`
4. Générer et copier le token

## Sécurité

**Important**: Les tokens d'API sont sensibles. Ne les commitez jamais dans le repository.

- Le fichier `claude` est local à votre machine
- Assurez-vous que les permissions du fichier sont restrictives:
  ```bash
  chmod 600 ~/.config/claude/claude_desktop_config.json
  ```

## Utilisation avec l'IA

Une fois configurés, les serveurs MCP sont automatiquement disponibles pour l'IA. Vous pouvez:

- Demander à l'IA d'analyser les erreurs Sentry
- Lui faire générer des tests Playwright
- Lui demander de rechercher de la documentation via Context7
- Lui faire créer des issues GitHub ou analyser le code du repository

L'IA saura automatiquement quels outils MCP utiliser en fonction de votre demande.

## Dépannage

### Les serveurs MCP ne sont pas détectés
- Vérifier que le fichier de configuration est valide (JSON bien formé)
- Redémarrer Claude Desktop
- Vérifier les logs: `~/.config/claude/logs/`

### Erreurs d'authentification
- Vérifier que les tokens sont corrects et n'ont pas expiré
- Vérifier les permissions accordées aux tokens
- Régénérer les tokens si nécessaire

### npx ne trouve pas les packages
- S'assurer que Node.js et npm sont installés
- Vérifier la connexion internet
- Les packages sont téléchargés automatiquement au premier usage avec `-y`
