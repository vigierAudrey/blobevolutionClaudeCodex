# 📊 Guide Déploiement AdSense - Nouveau Domaine

## 🎯 **Checklist Complète Déploiement**

### **Phase 1 : Préparation Domaine (Jour J-7)**

**1. Nom de domaine :**
- [ ] Acheter domaine (ex: `surfconnect.fr`, `ridemates.fr`, `blobsurf.com`)
- [ ] Configurer DNS vers l'IP du VPS Hetzner
- [ ] Vérifier HTTPS/SSL via Caddy + Let's Encrypt
- [ ] Redirection www → domaine principal

**2. Contenu minimum requis :**
- [ ] **Page d'accueil** complète avec valeur ajoutée
- [ ] **Pages légales** : CGU, Politique confidentialité, Mentions légales
- [ ] **Page "À propos"** expliquant le concept
- [ ] **Contenu original** (pas de Lorem Ipsum)
- [ ] **Navigation claire** entre les pages

**3. Standards Google :**
- [ ] **Meta descriptions** sur toutes les pages
- [ ] **Titles** uniques et descriptifs
- [ ] **Images optimisées** avec attributs alt
- [ ] **Temps de chargement** <3 secondes
- [ ] **Mobile-friendly** (responsive design)

### **Phase 2 : Inscription AdSense (Jour J)**

**1. Compte Google AdSense :**
- [ ] Aller sur https://www.google.com/adsense/
- [ ] Créer compte avec email principal
- [ ] Ajouter votre domaine : `https://votre-domaine.fr`
- [ ] Sélectionner pays : **France**
- [ ] Type de compte : **Particulier**

**2. Informations personnelles :**
```
✅ À préparer :
- Nom complet (identité officielle)
- Adresse postale complète
- Téléphone
- RIB (IBAN français de préférence)
- Pièce d'identité (scan/photo)
```

**3. Code AdSense automatique :**
- [ ] Google fournit un code HTML à ajouter dans `<head>`
- [ ] **NE PAS l'ajouter** (on a déjà notre système)
- [ ] Dire "J'ajouterai le code plus tard"

### **Phase 3 : Configuration Technique (Jour J+1)**

**1. Variables d'environnement production :**
```bash
# .env.vps ou secrets de deploiement front
NEXT_PUBLIC_ADSENSE_CLIENT_ID=ca-pub-VOTRE-VRAIE-ID
NEXT_PUBLIC_ADSENSE_ENABLED=true
```

**2. Test en staging :**
- [ ] Déployer sur domaine de test
- [ ] Vérifier affichage emplacements pub
- [ ] Test responsive mobile/desktop
- [ ] Vérifier script AdSense chargé

**3. Déploiement production :**
- [ ] Push code avec vraies variables
- [ ] Laisser GitHub Actions `Deploy VPS` livrer la stack après CI verte
- [ ] Vérifier Caddy et le frontend sur le domaine principal
- [ ] Test final sur domaine principal

### **Phase 4 : Validation Google (Jour J+1 à J+14)**

**1. Soumission pour révision :**
- [ ] Dans AdSense, cliquer "Demander examen"
- [ ] Google analyse le site (1-14 jours)
- [ ] **Attendre sans modifier le code**

**2. Critères d'acceptation :**
```yaml
Contenu:
  ✅ Original et de qualité
  ✅ Utile pour les visiteurs
  ✅ Suffisamment de contenu (>10 pages)
  ✅ Pas de contenu pour adultes

Technique:
  ✅ Navigation claire
  ✅ Mobile-friendly
  ✅ Temps de chargement correct
  ✅ Pas d'erreurs 404 majeures

Trafic:
  ✅ Visiteurs organiques (pas que des bots)
  ✅ Engagement réel (temps sur site >30s)
  ✅ Sources de trafic variées
```

**3. Actions pendant l'attente :**
- [ ] **Continuer à ajouter du contenu** (articles Blobosphère)
- [ ] **Générer du trafic** organique (réseaux sociaux)
- [ ] **NE PAS TOUCHER** au code AdSense
- [ ] **Surveiller** les emails Google

### **Phase 5 : Activation et Optimisation (Après validation)**

**1. Première activation :**
- [ ] Email de validation reçu ✅
- [ ] Premières pubs automatiquement affichées
- [ ] Vérifier que pubs s'affichent bien
- [ ] Premier revenus dans les 24-48h

**2. Configuration des emplacements :**
```bash
Créer ces "ad units" dans AdSense :
- matching-selection (Rectangle 300x250)
- matching-end-feed (Rectangle responsive)
- dashboard-sidebar (Vertical 160x600)
- article-content (In-article)
- footer-banner (Leaderboard 728x90)
```

**3. Optimisation revenus :**
- [ ] **Analyser performance** par emplacement
- [ ] **A/B tester** différentes tailles
- [ ] **Surveiller CTR** (>1% = bon)
- [ ] **Bloquer pubs** non pertinentes si besoin

### **Phase 6 : Fiscalité et Légal (Dès premiers revenus)**

**1. Déclaration revenus :**
```yaml
0-200€/mois:
  - Déclarer dans "revenus exceptionnels"
  - Aucune formalité supplémentaire

200€+/mois:
  - Case BNC (Bénéfices Non Commerciaux)
  - Ou auto-entrepreneur recommandé
```

**2. Auto-entrepreneur (optionnel) :**
- [ ] S'inscrire sur https://www.autoentrepreneur.urssaf.fr/
- [ ] Activité : "Conseil en systèmes informatiques"
- [ ] Charges : ~22% du CA
- [ ] Déclaration trimestrielle

**3. Mise à jour légale site :**
- [ ] **Mentions légales** : ajouter revenus publicitaires
- [ ] **Politique confidentialité** : cookies AdSense
- [ ] **CGU** : mention partenariats

## ⚠️ **Points d'Attention Critiques**

### **Erreurs à éviter :**
```yaml
❌ Code AdSense sur site non finalisé
❌ Cliquer sur ses propres pubs (= bannissement)
❌ Pubs sur pages d'erreur ou vides
❌ Traffic artificiel ou acheté
❌ Contenu dupliqué d'autres sites
❌ Plus de 3 pubs par page
```

### **Délais réalistes :**
```yaml
Inscription AdSense: 5 minutes
Validation Google: 3-14 jours
Premiers revenus: 24-48h après validation
Premier paiement: Quand seuil 50€ atteint
Setup auto-entrepreneur: 24-48h
```

## 📈 **Objectifs Revenus Réalistes**

**Mois 1-2 (MVP) :**
- 100-500 visiteurs/mois
- 5-25€ revenus AdSense
- **But = apprentissage**, pas profit

**Mois 3-6 (croissance) :**
- 1000-5000 visiteurs/mois
- 50-300€ revenus AdSense
- Données pour négocier partenariats

**Mois 6+ (scale) :**
- 5000+ visiteurs/mois
- 200-1000€ AdSense + partenariats directs
- Auto-entrepreneur recommandé

## 📋 **Checklist Validation Finale**

**Avant soumission AdSense :**
- [ ] Site 100% fonctionnel sur nouveau domaine
- [ ] Contenu original et de qualité
- [ ] Pages légales complètes
- [ ] Navigation intuitive
- [ ] Mobile parfaitement optimisé
- [ ] Aucune erreur technique majeure
- [ ] Trafic organique (même minimal)

**Après validation :**
- [ ] Pubs s'affichent correctement
- [ ] Revenus commencent à apparaître
- [ ] Analytics configurées
- [ ] Conformité légale mise à jour

---

**📅 Dernière mise à jour :** Septembre 2025
**🎯 Objectif :** Déploiement AdSense sur nouveau domaine
**💰 ROI estimé :** 50-300€/mois après 6 mois
