> ## ⚠️ DOCUMENT HISTORIQUE — HORS SCOPE MVP
>
> Ce document décrit une spécification UX de réservation **qui n'a pas été implémentée** et qui **ne correspond plus au modèle produit de BlobConnect**.
>
> **À ne pas utiliser comme source de vérité produit.**
>
> **Pourquoi ce document est obsolète :**
> - BlobConnect MVP ne fournit **pas** de moteur de réservation.
> - Il n'existe **pas** de calendrier partagé entre riders et pros.
> - Il n'existe **pas** de gestion transactionnelle de créneaux.
> - Il n'existe **pas** de statuts `Confirmé / En attente / Refusé` orchestrés par la plateforme.
> - L'organisation du cours se fait librement **hors plateforme** après mise en relation via la messagerie.
>
> **Le modèle produit réel :** un particulier publie une demande de cours géolocalisée ; les professionnels dans leur périmètre voient les demandes locales ; la messagerie permet la prise de contact ; le reste se passe hors plateforme.
>
> **Référence officielle :** [docs/product-positioning.md](./product-positioning.md) et [README.md — Vision Produit](../README.md#-vision-produit).
>
> *Document conservé pour mémoire historique uniquement. Ne pas implémenter.*

---

# UX Spec – Réservation Riders ↔ Pros (Phase 1) — HISTORIQUE

## Objectif et portée

- Mettre à disposition un parcours de réservation rider → pro **sans paiement immédiat** : la demande crée un `BookingRequest` que le pro accepte ou refuse.
- Première itération centrée sur l’expérience utilisateur (rider & pro) : nous cadrons les écrans, interactions et états sans implémentation back.
- La réservation confirmée se matérialise par l’ajout du rider au planning du pro ; les autres riders voient les miniatures mises à jour.

## Flow Rider – “Réserver un cours”

1. **Entrée** – depuis le dashboard rider, CTA visible « Réserver un cours ».
2. **Step 1 – Préférences**
   - Sélection du sport (Surf / Kitesurf) via boutons icônes.
   - Sélection du niveau (Débutant / Intermédiaire / Confirmé) avec chips exclusives.
   - CTA « Étape suivante » + breadcrumb (1/3).
3. **Step 2 – Localisation**
   - Géolocalisation : bouton « Utiliser ma position » (permission navigateur) + champ adresse avec auto-complétion.
   - Slider distance (5 → 100 km, pas de 5 km) avec affichage de la valeur.
   - Checkbox consentement à l’utilisation de la position (RGPD).
   - CTA « Voir les pros ».
4. **Résultats**
   - Vue hybride carte + liste (switch sur mobile).
   - Chaque tuile pro affiche : avatar, nom + note moyenne, badges sport/niveau enseignés, distance, tarif indicatif et prochains créneaux libres (chips horaires).
   - Miniatures riders inscrits sur le créneau (max 4 visibles + compteur si >4). Clic sur miniature → modal profil rider (photo, bio courte, sport/niveau, bouton « Retour aux résultats »).
   - Filtres supplémentaires (sport, niveau, distance) accessibles en sticky bar.
   - Empty state : message + CTA élargir la distance / changer filtre.
5. **Demande**
   - Sélection d’un créneau → écran récap : pro choisi, date/heure, spot, riders déjà positionnés.
   - Champ message optionnel (« Présente-toi / attentes »).
   - CTA principal « Envoyer une demande ».
6. **Confirmation**
   - Écran feedback : illustration + message « Demande envoyée au pro ».
   - Deux CTA : « Voir mes demandes » (future page) et « Retour au planning » (retour dashboard matching).

## Flow Pro – “Planning & demandes”

1. **Planning principal**
   - Vue calendrier (hebdo) + vue liste (mobile) avec créneaux colorés par statut (Libre / En attente / Confirmé).
   - CTA « Ajouter un créneau » accessible en haut.
2. **Création de créneau**
   - Form modal : sport(s) enseigné(s), niveau(s), date, heure, durée, capacité, spot (adresse + carte), prix indicatif.
   - Option « Réservations automatiques closes à X h avant » (future LOC).
3. **Demandes entrantes**
   - Badge notifications dans le header + panneau latéral « Demandes » listant les riders.
   - Carte demande : avatar rider, sport/niveau, message, créneau cible, boutons « Accepter » / « Refuser ».
   - Accepter = rider ajouté au créneau (statut passe à Confirmé). Refuser = demande archivée.
4. **Gestion / édition**
   - Sur un créneau, menu contextuel : « Ajouter un rider manuellement », « Fermer le créneau », « Supprimer ».
   - Historique : onglet « Demandes passées » (schéma table) pour traçabilité.

## Principes UX transverses

- Navigation multi-step avec breadcrumb + boutons précédent/suivant.
- Carte responsive (Leaflet/Mapbox). Fallback liste sur mobile < 480px.
- Modales profil rider/pro : fond semi-opaque, close via ESC, boutons « Retour » explicites.
- Typed states : loading (squelettes), empty (messages), error (CTA retry).
- Accessibilité : focus state, navigation clavier, contrastes AA, animations 200 ms max.

## Données & états (Phase 1)

- `BookingRequest` (pending → accepted/rejected) créé à l’envoi rider.
- `Booking` matérialise l’acceptation du pro (rider ajouté au planning).
- Notifications : badge UI + message (email optionnel en lot ultérieur).
- Analytics : timestamp demande/acceptation + provenance filtrage.

## Livrables attendus (Checkpoint 1)

- Wireframes haute-fidélité (desktop + mobile) :
  - Flow rider (3 étapes + résultats + confirmation).
  - Flow pro (planning, demandes entrantes, création créneau).
  - Modales profil rider/pro + états vides.
- Diagramme d’état `BookingRequest → Booking` (BPMN/State chart).
- Inventaire des composants UI (ci-dessous) validant la faisabilité front.

## Inventaire composants / pages

### Parcours Rider

- `ReservationCTA` (bouton sur dashboard).
- `ReservationStepper` (header multi-step + breadcrumb + CTA prev/next).
- `ReservationPreferencesStep`
- `ReservationLocationStep` (géoloc + slider distance + consent).
- `ReservationResults`
  - `ResultsFiltersBar`
  - `ProCard` (avatar, rating, badges, distance, prix, créneaux).
  - `RiderMiniaturesStrip` (miniatures + modal résumé rider).
  - `MapResults` (pins pro + clustering).
- `ReservationSummary` (recap + champ message).
- `ReservationConfirmation` (feedback + CTA).

### Module Planning Pro

- `ProPlanningHeader` (CTA + filtres).
- `ProCalendarView` (desktop) + `ProListView` (mobile).
- `ProSlotCard` (statut, riders, actions).
- `AvailabilityModal` (création/édition créneau).
- `RequestsPanel`
  - `RequestCard` (message, actions, mini profil).
- `AddRiderModal`
- `HistoryTable` (demandes passées).

### Composants partagés

- `ProfileModal` (rider/pro) – réutilisable.
- `GeoPicker` (input adresse + bouton GPS).
- `DistanceSlider`.
- `BadgeStatus` (Libre / En attente / Confirmé).
- `EmptyState` (texte + CTA).

---

👉 **Étape suivante** : validation de ce document par Coach Pédago & l’équipe UX. Après go, on enchaîne sur le checkpoint 2 (modélisation & contrats API).
