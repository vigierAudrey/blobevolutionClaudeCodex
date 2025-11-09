---
description: Audit RGPD complet et conformité CNIL française
---

🇫🇷 **CONFORMITÉ RGPD FRANÇAISE** : Audit et mise en conformité selon CNIL

## Contexte de la commande
- **Arguments fournis** : $ARGUMENTS
- **Projet** : Blobinfini (plateforme éducative française)
- **Juridiction** : France (CNIL) + Union Européenne (RGPD)
- **Checklist de référence** : `/ai/checklists/rgpd.md`
- **Niveau d'exigence** : Conformité TOTALE avant production

## Ton rôle

Délègue cette tâche à l'agent **cybersecurite** qui va auditer la conformité RGPD :

1. **Analyser les arguments** :
   - Si aucun argument → **AUDIT RGPD COMPLET**
   - Si "cookies" → Audit consentement cookies et tracking
   - Si "data" → Audit collecte, stockage, traitement données personnelles
   - Si "rights" → Audit droits utilisateurs (accès, rectification, suppression, portabilité)
   - Si "consent" → Audit mécanismes de consentement
   - Si "breach" → Procédure de notification violation de données (72h CNIL)
   - Si "dpo" → Checklist DPO (Délégué à la Protection des Données)
   - Si "privacy-policy" → Générer/auditer politique de confidentialité
   - Si "cnil" → Préparer registre des traitements CNIL

2. **Vérifier les 7 principes RGPD** :

   ### 1. Licéité, loyauté, transparence
   - [ ] Base légale claire pour chaque traitement (consentement, contrat, intérêt légitime)
   - [ ] Politique de confidentialité accessible et compréhensible
   - [ ] Information claire sur collecte, usage, durée de conservation
   - [ ] Pas de collecte cachée ou trompeuse

   ### 2. Limitation des finalités
   - [ ] Données collectées uniquement pour usage déclaré
   - [ ] Pas de réutilisation pour autre finalité sans nouveau consentement
   - [ ] Documentation des finalités dans code/config

   ### 3. Minimisation des données
   - [ ] Collecter UNIQUEMENT données nécessaires au service
   - [ ] Pas de champs "optionnels" abusifs
   - [ ] Géolocalisation : consentement EXPLICITE si non indispensable
   - [ ] Suppression des champs inutilisés

   ### 4. Exactitude
   - [ ] Mécanisme de mise à jour des données par l'utilisateur
   - [ ] Correction des données inexactes dans les 30 jours
   - [ ] Validation des données lors de la saisie

   ### 5. Limitation de la conservation
   - [ ] Durée de conservation définie et documentée
   - [ ] Suppression automatique après expiration (soft delete + purge)
   - [ ] Logs anonymisés ≤ 30 jours
   - [ ] Comptes inactifs : archivage/suppression automatique

   ### 6. Intégrité et confidentialité (sécurité)
   - [ ] Chiffrement des données sensibles au repos (AES-256)
   - [ ] HTTPS obligatoire en production (TLS 1.3)
   - [ ] Hashing mots de passe (bcrypt ≥ 12 rounds)
   - [ ] Accès aux données restreint (principe du moindre privilège)
   - [ ] Logs d'accès aux données personnelles (qui, quand, quoi)
   - [ ] Pseudonymisation/anonymisation quand possible

   ### 7. Responsabilité (accountability)
   - [ ] Registre des traitements tenu à jour
   - [ ] Documentation des mesures de sécurité
   - [ ] Procédure de notification violation (CNIL 72h + utilisateurs)
   - [ ] Analyses d'impact (AIPD) si traitement à risque élevé

3. **Vérifier les droits utilisateurs (Art. 12-23)** :

   ### Droit d'accès (Art. 15)
   - [ ] Endpoint `/api/users/me/export` fonctionnel
   - [ ] Export JSON/CSV de TOUTES les données utilisateur
   - [ ] Délai de réponse ≤ 1 mois (gratuit, 1ère demande)
   - [ ] Format machine-readable (JSON recommandé)

   ### Droit de rectification (Art. 16)
   - [ ] Interface de modification profil utilisateur
   - [ ] Validation des modifications (Zod)
   - [ ] Correction sous 30 jours si demande écrite

   ### Droit à l'effacement / "Droit à l'oubli" (Art. 17)
   - [ ] Endpoint `/api/users/me/delete` (soft delete immédiat)
   - [ ] Purge définitive après 30 jours (cron job)
   - [ ] Conservation minimale légale respectée (compta, litiges)
   - [ ] Notification de suppression par email
   - [ ] Cascade de suppression (contenus, logs, sessions)

   ### Droit à la limitation du traitement (Art. 18)
   - [ ] Possibilité de "geler" le compte sans supprimer
   - [ ] Désactivation temporaire du traitement

   ### Droit à la portabilité (Art. 20)
   - [ ] Export dans format réutilisable (JSON standard)
   - [ ] Possibilité de transférer vers autre service

   ### Droit d'opposition (Art. 21)
   - [ ] Refus du marketing/profilage à tout moment
   - [ ] Opt-out simple et clair
   - [ ] Pas de pénalité si refus

4. **Cookies et tracking (ePrivacy + RGPD)** :

   ### Consentement (CNIL strict)
   - [ ] Banner de consentement AVANT tout dépôt de cookie non essentiel
   - [ ] Acceptation = action POSITIVE (pas de case pré-cochée)
   - [ ] Refus aussi facile qu'acceptation (même niveau de clic)
   - [ ] Pas de "mur de cookies" bloquant (sauf si gratuit)
   - [ ] Durée de validité consentement ≤ 13 mois
   - [ ] Retrait du consentement aussi facile que don

   ### Cookies exemptés de consentement (strictement)
   - Authentification (session)
   - Panier e-commerce
   - Préférences UI (langue, thème)
   - Équilibrage de charge (technique)

   ### Cookies INTERDITS sans consentement
   - Analytics (Google Analytics, Matomo, etc.)
   - Publicité (Google Ads, Facebook Pixel, etc.)
   - Réseaux sociaux (boutons "partager")
   - A/B testing
   - Heatmaps / Session replay

   ### Implémentation technique
   - [ ] Cookie consent manager conforme CNIL (ex: Tarteaucitron, Axeptio)
   - [ ] Blocage scripts tiers AVANT consentement
   - [ ] `SameSite=Lax` minimum (ou `Strict` si possible)
   - [ ] `Secure` flag en production (HTTPS only)
   - [ ] Expiration cookies ≤ 13 mois

5. **Violations de données (Art. 33-34)** :

   ### Procédure de notification CNIL (72h)
   - [ ] Template de notification pré-rédigé
   - [ ] Contact CNIL identifié
   - [ ] Procédure de détection de violation documentée
   - [ ] Registre des violations tenu à jour

   ### Notification utilisateurs (si risque élevé)
   - [ ] Template d'email de notification
   - [ ] Délai : "dans les meilleurs délais"
   - [ ] Contenu : nature violation, conséquences, mesures prises
   - [ ] Canal sécurisé (email chiffré si sensible)

6. **Hébergement et transferts** :

   ### Localisation des données
   - [ ] Serveurs hébergés dans l'UE (RGPD)
   - [ ] Si hors UE : clauses contractuelles types ou certification
   - [ ] Pas de transfert vers pays "non adéquats" (USA post-Privacy Shield)

   ### Sous-traitants
   - [ ] DPA (Data Processing Agreement) avec TOUS les sous-traitants
   - [ ] Liste des sous-traitants documentée
   - [ ] Vérification conformité RGPD des sous-traitants

## 📋 Sortie attendue

### Format du rapport RGPD

```markdown
# Audit RGPD - Blobinfini - [Date]

## Résumé exécutif
- **Statut global** : [CONFORME / NON-CONFORME / PARTIELLEMENT CONFORME]
- **Blockers avant production** : X éléments critiques
- **Risque d'amende CNIL** : [ÉLEVÉ/MOYEN/FAIBLE]
- **Score de conformité** : X/100

## 1. Principes RGPD (Art. 5)
- [✅] Licéité, loyauté, transparence
- [❌] Limitation des finalités → **BLOCKER** : [détails]
- [⚠️] Minimisation des données → Amélioration requise : [détails]
- ...

## 2. Droits utilisateurs (Art. 12-23)
- [❌] Droit d'accès (export données) → **BLOCKER** : endpoint manquant
- [✅] Droit à l'effacement → Implémenté
- ...

## 3. Cookies et tracking
- [❌] Consentement cookies → **BLOCKER** : pas de banner conforme
- [❌] Blocage scripts tiers → **BLOCKER** : GA chargé avant consentement
- ...

## 4. Violations de données
- [⚠️] Procédure de notification CNIL → Template à rédiger
- ...

## 5. Hébergement
- [✅] Serveurs UE (Vercel Frankfurt)
- [⚠️] DPA sous-traitants → À vérifier : Sentry, Resend
- ...

## 📍 BLOCKERS avant production (CRITIQUE)

### [P0] Absence de consentement cookies
- **Localisation** : `apps/web/app/layout.tsx`
- **Problème** : Google Analytics chargé sans consentement préalable
- **Impact** : Violation Art. 82 Loi Informatique et Libertés + RGPD
- **Amende potentielle** : Jusqu'à 20M€ ou 4% CA mondial
- **Correction** :
```typescript
// Code de correction avec Tarteaucitron ou Axeptio
```

### [P0] Absence d'export des données utilisateur
- **Localisation** : `apps/api/src/modules/users/`
- **Problème** : Pas d'endpoint pour droit d'accès (Art. 15)
- **Impact** : Non-respect droit fondamental RGPD
- **Correction** :
```typescript
// Endpoint /api/users/me/export
```

## 📊 Actions requises

### Immédiates (avant production)
1. [ ] Implémenter cookie consent manager conforme CNIL
2. [ ] Créer endpoint export données (Art. 15)
3. [ ] Rédiger politique de confidentialité
4. [ ] ...

### Court terme (J+30)
1. [ ] Signer DPA avec sous-traitants
2. [ ] Créer registre des traitements
3. [ ] ...

### Moyen terme (J+90)
1. [ ] Nommer DPO si > 250 employés ou traitement sensible
2. [ ] Réaliser AIPD si nécessaire
3. [ ] ...

## 📄 Documents à créer/mettre à jour

1. **Politique de confidentialité** (obligatoire)
   - Localisation : `/legal/privacy-policy.md`
   - Contenu : [template fourni]

2. **Mentions légales** (obligatoire)
   - Éditeur, hébergeur, DPO contact

3. **Registre des traitements** (obligatoire si > 250 employés)
   - Template CNIL : [lien]

4. **Procédure de violation de données**
   - Notification CNIL 72h
   - Notification utilisateurs

## 🇫🇷 Checklist CNIL spécifique France

- [ ] Déclaration CNIL si traitement sensible (santé, justice, etc.)
- [ ] Cookies : conformité recommandations CNIL 2020
- [ ] Hébergement données santé : certification HDS si applicable
- [ ] Transferts hors UE : vérifier décision d'adéquation
- [ ] DPO : coordonnées publiées si désigné
- [ ] Droit d'opposition démarchage : liste Bloctel respectée

## 📚 Ressources CNIL

- Guide RGPD du développeur : https://www.cnil.fr/fr/guide-rgpd-du-developpeur
- Recommandations cookies : https://www.cnil.fr/fr/cookies-et-autres-traceurs
- Modèles de clauses : https://www.cnil.fr/fr/modeles
- Registre des traitements : https://www.cnil.fr/fr/RGDP-le-registre-des-activites-de-traitement
- Notification violation : https://www.cnil.fr/fr/notifier-une-violation-de-donnees-personnelles

## ⚖️ Risques juridiques

### Amendes CNIL (Art. 83 RGPD)
- **Violations mineures** : Jusqu'à 10M€ ou 2% CA mondial
- **Violations majeures** : Jusqu'à 20M€ ou 4% CA mondial

### Responsabilité pénale
- Code Pénal Art. 226-16 : Atteinte à la vie privée (5 ans + 300k€)

### Jurisprudence CNIL récente
- Google Analytics : Transfert USA = non conforme (fév. 2022)
- Cookies : Refus doit être aussi simple qu'acceptation (2020)
```

## Exemples d'utilisation

```bash
/rgpd                    # Audit RGPD complet du projet
/rgpd cookies            # Audit consentement cookies uniquement
/rgpd data               # Audit collecte et traitement données
/rgpd rights             # Vérifier implémentation droits utilisateurs
/rgpd breach             # Procédure de notification violation
/rgpd privacy-policy     # Générer politique de confidentialité
/rgpd cnil               # Préparer registre des traitements CNIL
```

---

**ACTION IMMÉDIATE** : Lance l'agent cybersecurite avec le Task tool :

```
Task tool:
- subagent_type: cybersecurite
- description: Audit RGPD conformité CNIL française
- prompt: "Effectue un audit RGPD complet avec les arguments : '$ARGUMENTS'.

Si aucun argument :
- Audit COMPLET des 7 principes RGPD (Art. 5)
- Vérification des 6 droits utilisateurs (Art. 12-23)
- Conformité cookies et tracking (ePrivacy + CNIL)
- Procédure de violation de données (Art. 33-34)
- Hébergement et transferts de données
- Score de conformité /100
- Liste des BLOCKERS avant production

Si argument spécifique :
- 'cookies' → Audit consentement cookies CNIL
- 'data' → Audit collecte, stockage, traitement données
- 'rights' → Audit droits utilisateurs (accès, rectification, suppression, portabilité)
- 'consent' → Audit mécanismes de consentement
- 'breach' → Procédure de notification violation (72h CNIL)
- 'privacy-policy' → Générer/auditer politique de confidentialité
- 'cnil' → Préparer registre des traitements CNIL

Références :
- Checklist: /ai/checklists/rgpd.md
- CNIL Guide développeur : https://www.cnil.fr/fr/guide-rgpd-du-developpeur
- RGPD Art. 5, 12-23, 33-34, 83

Produis un rapport ACTIONNABLE avec :
1. Score de conformité /100
2. Liste des BLOCKERS critiques avant production
3. Code de correction pour chaque non-conformité
4. Templates de documents légaux (privacy policy, etc.)
5. Roadmap de mise en conformité si nécessaire

**EXIGENCE** : Conformité TOTALE avant déploiement production."
```
