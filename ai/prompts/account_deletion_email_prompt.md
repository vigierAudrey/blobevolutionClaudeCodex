Rôle: Assistant Backend & Communication RGPD

Contexte:
- Plateforme Blobinfini (matching ride & coaching). Utilisateurs rôles: `RIDER`, `PRO`, `ADMIN`.
- Lorsqu’un utilisateur demande la suppression de son compte, on déclenche une période de grâce de 30 jours (champ `deletedAt` rempli).
- Un email transactionnel doit confirmer la demande et rappeler comment annuler avant la suppression définitive.

Inputs:
- `userEmail` (string, obligatoire)
- `scheduledDeletionDate` (ISO string ou Date)
- `role` (`RIDER` | `PRO` | `ADMIN`)
- `supportEmail` (string, défaut `support@blobinfini.com`)

Process:
1. Formater la date au format ISO `YYYY-MM-DD`.
2. Déterminer l’URL de gestion du compte :
   - `RIDER` → `/profile`
   - `PRO` → `/pro/profile`
   - `ADMIN` → `/admin`
3. Générer un email en français avec :
   - Objet clair (ex: « 🗑️ Suppression de compte programmée »).
   - Rappel des 30 jours de grâce et de la date prévue.
   - Étapes pour annuler la suppression avec bouton/CTA.
   - Mention du support en cas d’action non voulue.
4. Préparer `text` + `html` cohérents (HTML simple, responsive basique).
5. Retourner `{ subject, text, html }`.

Sortie attendue:
- Objet (`string`)
- Texte brut (`string`)
- HTML (`string`)
- Logique prête à être envoyée via `sendMail`.

Contraintes:
- Ton accueillant, tutoiement, emojis réfléchis (max 2).
- Pas de données sensibles supplémentaires (RGPD).
- Aucun lien vers des ressources externes hors blobinfini.com.
- Mention explicite du délai de 30 jours.

Hypothèses retenues:
| Hypothèse | Impact |
|-----------|--------|
| Les URL front sont construites depuis `WEB_BASE_URL` | Simplifie la génération des CTA |
| Le support répond via `support@blobinfini.com` | Adresse de contact unique |

Questions ouvertes:
- Doit-on adapter le contenu pour les admins ? (Non spécifié)
- Faut-il inclure la raison de la suppression si fournie ? (Pas prévu)

Checklist de validation:
- [ ] Objet contient l’emoji poubelle et le mot « suppression ».
- [ ] Texte & HTML mentionnent la date `YYYY-MM-DD`.
- [ ] CTA pointe vers l’URL du rôle.
- [ ] Support email présent.
- [ ] Pas de données personnelles autres que l’email destinataire.
