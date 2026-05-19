# Git branches status

## Contexte
Un nettoyage prudent des branches locales a deja ete effectue.
Une branche objectivement redondante a deja ete supprimee localement.
Les branches restantes ont ete classees pour eviter toute suppression hative.
Ce document sert de repere local pour les humains et les IA.

## Branche deja supprimee
`sauvegarde/local-avant-retour-main-20260313-1943` a ete supprimee localement apres preuve qu'elle etait incluse dans `origin/main` et sans commit unique utile.

## Branches locales restantes
| branche | categorie | statut | raison courte | regle pratique |
|---|---|---|---|---|
| `main` | WORKTREE_PINNED | intouchable | branche canonique locale alignee, attachee au worktree principal | ne jamais supprimer ni manipuler hors maintenance normale |
| `pr/geo-hardening-clean` | WORKTREE_PINNED | intouchable | branche liee a un worktree actif dedie | ne pas supprimer tant que le worktree existe |
| `archive-purge` | ACTIVE_WORK | a conserver | lot chat/archive/purge distinct non inclus dans origin/main | ne pas supprimer sans arbitrage explicite |
| `feat/mvp-seo-ia-static` | ACTIVE_WORK | a conserver | vraie branche feature SEO/IA avec travail propre | ne pas toucher sans revue produit |
| `feat/system-universal-seoia-scaffold` | ACTIVE_WORK | a conserver | vraie branche feature/scaffold SEO/IA | ne pas toucher sans revue dediee |
| `backup/local-main-pre-align` | BACKUP_SNAPSHOT | revoir plus tard | backup local avant alignement, contenu inclus dans `wip/mixed-changes` | ne pas supprimer sans decision explicite sur la politique de backup |
| `fix/hardening-booking-p0` | BACKUP_SNAPSHOT | revoir plus tard | snapshot local monocommit mais volumineux, avant realignement | ne pas confondre avec une vraie branche metier malgre son nom |
| `sauvegarde/local-main-20260313-1943` | MERGE_VAULT | revoir plus tard | merge-snapshot contenant `archive-purge` | ne pas supprimer sans decision explicite d'archivage |
| `wip/mixed-changes` | REVIEW_LATER | revue ciblee ulterieure | superset mixte utile, pas un simple dechet | ne pas supprimer sans nouvelle analyse dediee |

## Noms ambigus a surveiller
- `backup/local-main-pre-align`
- `fix/hardening-booking-p0`
- `sauvegarde/local-main-20260313-1943`
- `sauvegarde/local-avant-retour-main-20260313-1943` (deja supprimee, a ne pas confondre avec la precedente)

Ces noms peuvent provoquer de mauvaises suppressions si on agit trop vite.

## Regle operatoire
- aucune suppression supplementaire sans preuve Git explicite
- toute branche attachee a un worktree est intouchable
- les branches de backup/snapshot/merge-vault doivent etre revues avant toute action destructive
