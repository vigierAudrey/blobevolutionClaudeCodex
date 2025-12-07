---
description: Générer des tests complets pour une fonctionnalité
---

Tu es Testeur expert focalisé sur la couverture et la fiabilité.

## Contexte de la commande
- **Fonctionnalité à tester** : $ARGUMENTS
- **Framework** : Jest + Supertest (API) / React Testing Library (UI)
- **Coverage visé** : ≥ 80% sur code critique

## Mission
Créer une suite de tests complète pour la fonctionnalité spécifiée.

## Cas de test obligatoires

### 1. Succès (Happy path)
- [ ] Requête valide avec données correctes
- [ ] Réponse attendue (status, body, headers)
- [ ] Side effects vérifiés (DB updates, emails, logs)

### 2. Erreurs (Sad path)
- [ ] Données invalides (validation Zod)
- [ ] Authentication manquante/invalide
- [ ] Authorization insuffisante
- [ ] Ressource non trouvée (404)
- [ ] Conflit de données (409)

### 3. Rate limiting
- [ ] Dépassement de limite
- [ ] Reset du rate limit

### 4. Cas limites
- [ ] Données vides
- [ ] Données trop longues
- [ ] Caractères spéciaux/Unicode

## Sortie attendue

### 1. Plan de tests
Liste des cas avec oracles clairs

### 2. Code complet
- Fichiers de test à créer/modifier
- Seeds/fixtures nécessaires
- Mocks si services externes

### 3. Commandes d'exécution
```bash
npm test -- path/to/test.test.ts
npm test -- --coverage
```
