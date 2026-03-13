# Runbook — Release CI Security Gates

**Référence** : `scripts/ci-block-db-push.sh`, `.github/workflows/ci.yml`
**Ownership** : SRE / Security
**Niveau** : GO conditionnel avant tout merge sur `main` + avant tout déploiement prod

---

## Checklist release — gates obligatoires

- [ ] `bash scripts/ci-block-db-push.sh` → exit 0 sur branche à merger
- [ ] `bash scripts/no-skip-critical-check.sh` → exit 0 sur les suites API critiques
- [ ] Tous les poison pills confirmés bloqués (cf. section tests ci-dessous)
- [ ] **GitHub Actions: Allowed Actions whitelist configurée ✅** (voir section dédiée)
- [ ] `pnpm --filter @blobinfini/api exec tsc --noEmit` → 0 erreur
- [ ] Tests forteresse passants (matching, admin, socket, booking gates)
- [ ] `docs/audits/PROD_GO_PROOF_RUNTIME_EXECUTED.md` rempli par le SRE de garde

---

## GitHub Actions : Allowed Actions whitelist (GO conditionnel)

### Pourquoi c'est une condition GO

Une action GitHub tierce peut :
- Exfiltrer `DATABASE_URL`, `JWT_SECRET`, `AWS_*` et autres secrets depuis l'environnement runner
- Écraser les guards de sécurité (`ci-block-db-push.sh`, `no-raw-fetch-check.sh`, etc.)
- Injecter du code malveillant dans le build ou le cache npm/pnpm
- Court-circuiter les gates en modifiant `GITHUB_OUTPUT` / `GITHUB_ENV`

**"Allow all actions" = surface d'attaque supply-chain maximale — interdit en production.**

---

### Configuration — GitHub Org Settings

1. Aller dans **GitHub Org → Settings → Actions → General**
2. Sous "Actions permissions", sélectionner :
   ```
   ○ Allow all actions  (INTERDIT)
   ● Allow select actions
   ```
3. Cocher uniquement :
   - `Allow actions created by GitHub` (si applicable à la whitelist)
   - Ou saisir la liste manuelle explicite (voir ci-dessous)

---

### Whitelist minimale recommandée

```
# Actions officielles GitHub (surface réduite / maintenues par GitHub)
actions/checkout@v4
actions/setup-node@v4
actions/cache@v4
actions/upload-artifact@v4
actions/download-artifact@v4

# Tooling build (vérifier la SHA de chaque release avant ajout)
pnpm/action-setup@v4

# Actions internes BlobConnect (préfixe org)
blobinfini/*
```

**Règles d'ajout :**
- Toute nouvelle action tierce doit être approuvée en PR par un SRE
- Épingler à la SHA de commit (pas à une branche flottante) dès que possible
- Documenter le motif dans ce fichier

---

### Configuration — GitHub Repo Settings (override)

Si les settings repo surchargent l'org :

1. **Repo → Settings → Actions → General**
2. Vérifier que "Allow select actions" est sélectionné (hérité ou override)
3. La repo ne doit PAS avoir une config plus permissive que l'org

---

### Vérification rapide

```bash
# Lister toutes les actions tierces dans les workflows (hors actions/ et blobinfini/)
grep -rh 'uses:' .github/workflows .github/actions \
  | grep -v 'uses: actions/' \
  | grep -v 'uses: blobinfini/' \
  | grep -v '#' \
  | sort -u
```

Chaque ligne de la sortie doit figurer dans la whitelist ci-dessus ou être justifiée.

---

## Guard `ci-block-db-push.sh` — référence rapide

### Patterns bloqués

| Pattern | Description |
|---|---|
| `prisma db push` | Exécution directe (ligne `run:`) |
| `prisma db \` (continuation) | Split multi-ligne pour contourner la regex |
| `db:push:unsafe` | Invocation via script npm/pnpm |

### Exemptions legit (ne pas élargir)

| Exemption | Scope | Motif |
|---|---|---|
| `#` en début de ligne | Partout | Commentaire YAML |
| `echo` en début de ligne | Partout | Diagnostic, non exécuté |
| `_poison_check` | **ci.yml uniquement** | Self-test harness CI |
| Clés YAML non exécutables : `name:` `description:` `with:` `uses:` `env:` `id:` `if:` `shell:` `working-directory:` | Partout | Métadonnées déclaratives — ne peuvent pas exécuter de commande |

> ⚠️ `run:` est intentionnellement **absent** de la liste des exemptions.

### Tests poison pills (à exécuter avant chaque release)

```bash
# 1. Repo clean → doit passer
bash scripts/ci-block-db-push.sh
echo "exit: $?"   # attendu: 0

# 2. Fixture abuse (P0-2) — doit reporter UNIQUEMENT la ligne run:
mkdir -p /tmp/sneaky-test/.github/actions/sneaky
cat > /tmp/sneaky-test/.github/actions/sneaky/action.yml <<'EOF'
name: sneaky
description: this action does not run prisma db push (just mentions it)
runs:
  using: composite
  steps:
    - run: _poison_check prisma db push
      shell: bash
EOF
# Le guard (lancé depuis le repo) ne doit PAS flagger la ligne description:
# Il DOIT flagger la ligne run: si ce fichier était dans .github/actions/
```

---

## Post-mortem

Si une action tierce non whitelistée est détectée en prod :

1. Révoquer les secrets concernés immédiatement (DATABASE_URL, JWT_SECRET, AWS_*)
2. Auditer les logs runner GitHub pour exfiltration (`Settings → Actions → Logs`)
3. Ouvrir un incident P0 dans `docs/audits/`
4. Re-générer tous les tokens (Prisma, Redis, S3, Firebase)

---

*Runbook créé le 2026-03-02 — Phase hardening P0 BlobConnect*
