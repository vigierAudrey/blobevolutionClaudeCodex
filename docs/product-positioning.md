# Positionnement produit Blob — Source de vérité MVP

> **Ce document est la référence officielle du périmètre fonctionnel de Blob MVP.**
> En cas de divergence avec d'autres documents, **ce document prime sur tout le reste**.
> Il doit être lu par toute IA avant d'implémenter une fonctionnalité liée à la mise en relation, au matching, au contact pro/rider, ou à la monétisation.
>
> Dernière mise à jour : 2026-05-31

## Territoire pilote et positionnement

| Élément | Valeur |
|---|---|
| Communes pilote | Hourtin, Carcans, Lacanau (Médoc Atlantique) |
| Bassin d'acquisition | Bordeaux Métropole |
| Extension nationale | Post-pilot uniquement — pas d'objectif national dans le MVP |

**Blob est d'abord une communauté surf & kite locale.**
Le matching, les pros, la BlobMap, les guides et les promotions sont au service de cette communauté.
Blob n'est ni une marketplace nationale, ni une plateforme avec paiement, ni une plateforme gamifiée.

---

## Ce que Blob FAIT (périmètre MVP)

- **Publication de demandes géolocalisées** : un particulier publie une intention de cours (surf/kitesurf) avec ses préférences (sport, niveau, zone géographique).
- **Matching géospatial** : les professionnels configurent un périmètre kilométrique et voient les demandes locales dans leur zone d'activité.
- **Consultation réciproque des profils** : les deux parties peuvent consulter la fiche de l'autre avant de prendre contact.
- **Messagerie intégrée** : prise de contact libre entre particulier et professionnel — aucun workflow imposé par la plateforme.
- **BloboMap** : outil de visualisation à destination des professionnels pour identifier les demandes géolocalisées dans leur zone. Pas de partage de spots, pas de tracking communautaire live.
- **Blobosphère** : hub éditorial (articles, interviews, contenus surf/kite) pour le SEO et la visibilité de Blob.

## Ce que Blob NE FAIT PAS (hors scope MVP)

Ces fonctionnalités sont **volontairement exclues**. Toute proposition les réintroduisant est hors scope MVP sauf décision produit explicite et documentée.

| Fonctionnalité exclue | Pourquoi exclue |
|----------------------|-----------------|
| Réservation orchestrée par la plateforme | L'organisation du cours se fait librement hors plateforme |
| Calendrier partagé rider/pro | Complexité sans validation marché |
| Synchronisation Google Calendar / Apple Calendar | Hors scope |
| Gestion transactionnelle de créneaux (create/update/delete slots) | Hors scope |
| Statuts confirmed / cancelled / completed | Hors scope — pas de workflow booking |
| Paiement intégré | Pas de transaction monétaire sur la plateforme |
| Commission sur cours | Pas de modèle transactionnel |
| Escrow / dépôt de garantie | Hors scope |
| Facturation automatique | Hors scope |
| Stripe Connect actif | Non intégré dans le MVP |
| Workflow booking complet (request → confirm → complete) | Hors scope |
| Marketplace transactionnelle | Blob est une plateforme de mise en relation, pas une marketplace transactionnelle |

## Le parcours utilisateur réel

```
Rider                               Pro
  │                                  │
  │  1. Publie une demande de cours   │
  │     (géolocalisée, sport/niveau)  │
  │                                  │
  │                    2. Voit les demandes locales
  │                       sur la BloboMap / matching
  │                                  │
  │  3. Les deux parties              │
  │     consultent mutuellement       │
  │     les profils                   │
  │                                  │
  │  4. Prise de contact             │
  │     via messagerie intégrée       │
  │                                  │
  │  5. Organisation du cours         │
  │     librement, hors plateforme    │
  │                                  │
```

## Modèle économique MVP

- **Gratuit** pour riders et professionnels.
- **Revenus actuels** : publicité (Google AdSense) + sponsors surf/kite.
- **Pas de commission** sur les cours ou les transactions.
- **Structure** : Association loi 1901.

## Hypothèses futures (exploratoires — hors scope actuel)

Si le MVP valide un intérêt marché suffisant, certaines fonctionnalités professionnelles avancées pourraient éventuellement être envisagées à titre exploratoire :

- Accès premium aux demandes géolocalisées.
- Visibilité renforcée dans les résultats.
- Outils de prospection locale avancés.
- Modèle abonnement pro éventuel.

**Ces hypothèses ne font pas partie du scope actuel et ne doivent pas être implémentées sans décision produit explicite.**

---

## Vocabulaire métier officiel

### Termes recommandés

| Terme | Signification dans Blob |
|-------|-------------------------------|
| Demande de cours | Ce qu'un rider publie pour trouver un pro |
| Intention de cours | Synonyme de demande de cours |
| Mise en relation | L'action centrale de la plateforme |
| Contact professionnel | Prise de contact via messagerie |
| Demande géolocalisée | Demande visible des pros dans leur périmètre |
| Prospection locale | Ce que fait un pro en consultant la BloboMap |
| BloboMap | Carte de visualisation des demandes locales (usage pro uniquement) |

### Termes à éviter (hors contexte technique historique)

| Terme à éviter | Pourquoi | Alternative |
|---------------|----------|-------------|
| booking | Implique une réservation orchestrée | demande de cours |
| reservation | Implique une transaction plateforme | mise en relation |
| availability / slot | Implique un calendrier transactionnel | n/a (hors scope) |
| confirmed / cancelled / completed | Implique des statuts booking | n/a (hors scope) |
| booking flow | Implique un workflow orchestré | parcours de mise en relation |
| marketplace transactionnelle | Incorrect — pas de transaction | plateforme de mise en relation |
| marketplace nationale | Incorrect — Blob est d'abord une communauté locale | communauté surf & kite locale |
| Stripe actif | Non actif dans le MVP | hors scope MVP |
| calendrier partagé | Hors scope | n/a |
| planning pro | Suggère un calendrier géré par la plateforme | zone d'activité, périmètre pro |

> **Note** : les termes `booking`, `availability`, `slot` peuvent apparaître dans des noms de fichiers, modules, routes API, tests ou migrations historiques (`apps/api/src/modules/booking/`, `/booking/availability/search`, etc.). Ces occurrences techniques sont acceptables et ne doivent **pas** être renommées en masse. Seule la documentation produit et les textes UI doivent utiliser le vocabulaire recommandé.

---

## Règle anti-réintroduction pour les IA

Toute proposition réintroduisant les éléments suivants est **hors scope MVP** et doit être refusée sauf demande explicite avec validation produit documentée :

- Réservation orchestrée par la plateforme
- Calendrier transactionnel partagé (rider/pro)
- Paiement intégré ou Stripe actif
- Gestion complète des disponibilités (création/mise à jour/suppression de créneaux)
- Workflow booking complet (request → confirm → cancel → complete)
- Statuts confirmed / cancelled / completed
- Commission, escrow ou facturation
- Synchronisation calendrier externe (Google Calendar, Apple Calendar)

**Procédure si une telle demande est reçue :**
1. Signaler explicitement que c'est hors scope MVP.
2. Proposer l'alternative dans le modèle actuel (messagerie / mise en relation).
3. Demander confirmation explicite et validation produit avant d'implémenter quoi que ce soit.

---

*Voir aussi : [README.md — Vision Produit](../README.md#-vision-produit) · [ROADMAP.md](../ROADMAP.md)*
