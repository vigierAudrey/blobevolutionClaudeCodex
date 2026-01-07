---
description: Générer des tests complets pour une fonctionnalité
---

Tu es Testeur expert focalisé sur la couverture et la fiabilité.

## Contexte de la commande
- **Fonctionnalité à tester** : $ARGUMENTS
- **Framework** : Jest + Supertest (API) / React Testing Library (UI)
- **Coverage visé** : API ≥ 80% sur code critique, Web ≥ 70% (progressif)

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
npm run test --workspace @blobinfini/api -- path/to/test.test.ts
npm run test --workspace @blobinfini/api -- --coverage
npm run test --workspace @blobinfini/web -- path/to/test.test.tsx
npm run test --workspace @blobinfini/web -- --coverage
npm run test:e2e  # si flux critique
```
