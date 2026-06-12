# 🤖 Configuration MCP (Model Context Protocol)

Ce document détaille la configuration des serveurs MCP pour enrichir les capacités des IA travaillant sur Blob.

## 📚 Table des matières

- [Qu'est-ce que MCP ?](#quest-ce-que-mcp-)
- [Configuration Claude Code (CLI)](#configuration-claude-code-cli)
- [Configuration Claude Desktop (App)](#configuration-claude-desktop-app)
- [Obtention des tokens](#obtention-des-tokens)
- [Cas d'usage MCP](#cas-dusage-mcp)

## Qu'est-ce que MCP ?

**Model Context Protocol** permet aux IA d'accéder à des services externes (GitHub, Sentry, navigateur, etc.) pour enrichir leur contexte et leurs capacités.

## Configuration Claude Code (CLI)

**Fichier** : `~/.config/claude-code/mcp.json`

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "<GITHUB_TOKEN_WITH_REQUIRED_SCOPES>"
      }
    }
  }
}
```

### Serveurs disponibles

| Serveur | Usage |
|---------|-------|
| **Chrome DevTools MCP** | Tests navigateur, debugging, screenshots, performance |
| **GitHub MCP** | Accéder au repo, créer/modifier issues et PRs depuis Claude Code |

## Configuration Claude Desktop (App)

**Fichier** : `~/.config/claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "sentry": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sentry"],
      "env": {
        "SENTRY_AUTH_TOKEN": "token",
        "SENTRY_ORG": "vigier"
      }
    },
    "playwright": {
      "command": "npx",
      "args": ["-y", "@executeautomation/playwright-mcp-server"]
    },
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-puppeteer"]
    },
    "context7": {
      "command": "npx",
      "args": ["-y", "@context7/mcp-server"],
      "env": {
        "CONTEXT7_API_KEY": "clé"
      }
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "<GITHUB_TOKEN_WITH_REQUIRED_SCOPES>"
      }
    }
  }
}
```

### Serveurs disponibles

| Serveur | Usage |
|---------|-------|
| **Sentry** | Analyse erreurs production, stack traces, rapports bugs |
| **Playwright** | Tests E2E automatisés, génération scripts |
| **Chrome DevTools (Puppeteer)** | Navigation web, inspection DOM |
| **Context7** | Recherche documentation technique, exemples code |
| **GitHub** | Gestion issues/PRs, recherche code, historique |

## Obtention des tokens

### Sentry
- URL : https://sentry.io/settings/account/api/auth-tokens/
- Scopes : `org:read`, `project:read`, `event:read`

### GitHub
- URL : https://github.com/settings/tokens
- Scopes : `repo`, `read:org`, `workflow`

### Context7
- URL : https://context7.com
- Créer un compte et générer une clé API

## Cas d'usage MCP

### Pour les IA

Les IA peuvent désormais :

1. **Analyser les erreurs production** (Sentry)
   - Stack traces complètes
   - Fréquence des erreurs
   - Contexte utilisateur

2. **Générer des tests E2E** (Playwright)
   - Basés sur user stories
   - Scénarios de validation
   - Tests de régression

3. **Rechercher de la documentation** (Context7)
   - Exemples de code
   - Patterns recommandés
   - Solutions aux problèmes courants

4. **Gérer GitHub** (GitHub MCP)
   - Créer/modifier issues
   - Analyser PRs
   - Rechercher dans le code

5. **Déboguer le frontend** (Chrome DevTools)
   - Inspecter le DOM
   - Analyser les performances
   - Capturer des screenshots

## Troubleshooting

### Le serveur MCP ne se lance pas

```bash
# Vérifier la syntaxe JSON
cat ~/.config/claude-code/mcp.json | jq .

# Tester le serveur manuellement
npx -y @modelcontextprotocol/server-github
```

### Token invalide

- Vérifiez que le token n'a pas expiré
- Assurez-vous que les scopes sont corrects
- Régénérez le token si nécessaire

### Permissions insuffisantes

- Vérifiez les scopes du token
- Pour GitHub : besoin de `repo` pour accéder aux repos privés
- Pour Sentry : besoin de `org:read` minimum

## Ressources

- [MCP Documentation officielle](https://modelcontextprotocol.io)
- [MCP Servers Registry](https://github.com/modelcontextprotocol/servers)
- [Claude Code MCP Guide](https://docs.claude.com/en/docs/claude-code/mcp)
