# Test de restauration (restore drill)

Vérifier qu'un backup PostgreSQL est **réellement restaurable**, sans jamais
toucher la base de production.

## Principe

[`scripts/restore-pg.sh`](../../scripts/restore-pg.sh) restaure le dump dans un
**conteneur PostgreSQL éphémère** (détruit en fin de script). Aucune écriture
sur la prod. Le restore *live* (destructif) est **documenté mais non automatisé**
volontairement (voir l'en-tête du script).

## Procédure (dry-run)

```bash
# 1. Lister les backups disponibles (hôte VPS)
ls -lh "$BACKUP_DIR"/*.sql.gz

# 2. Valider le plus récent dans un container jetable
ENV_FILE=.env.vps ./scripts/restore-pg.sh "$BACKUP_DIR/blobsurf_vps_<...>.sql.gz"
```

Le script :
- vérifie l'intégrité **gzip** avant toute action (fail-fast si corrompu) ;
- démarre un PostgreSQL éphémère, restaure le dump dedans ;
- compte les tables (`>= 5` attendu, sinon échec : dump vide/incomplet) ;
- détruit le conteneur ; **verdict** : BACKUP VALIDE / LISIBLE-avec-erreurs / ÉCHEC.

## Fréquence recommandée

- À chaque changement majeur de schéma (après une migration importante).
- Mensuel a minima en pré-prod.
- Après toute alerte backup `CRITICAL` résolue (confirmer la reprise).

## Restore *live* (destructif — manuel uniquement)

⚠️ `DROP DATABASE`. À n'exécuter qu'après un dry-run réussi et un backup frais.
Procédure pas-à-pas : en-tête de [`scripts/restore-pg.sh`](../../scripts/restore-pg.sh).
**Jamais** `prisma db push --accept-data-loss` en prod (bloqué en CI).

## En cas d'échec du dry-run

| Verdict | Sens | Action |
|---------|------|--------|
| gzip corrompu | fichier illisible | backup inutilisable → investiguer le run de backup, en relancer un |
| < 5 tables | dump vide/incomplet | vérifier que la DB source contenait des données au moment du dump |
| erreurs non-ignorables | incompatibilité schéma | comparer versions PostgreSQL/extensions |
