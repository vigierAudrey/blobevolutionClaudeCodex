# 📊 Système de Publicité AdSense

## 🚀 Configuration Rapide

### 1. **Inscription AdSense**
1. Aller sur https://www.google.com/adsense/
2. Créer un compte avec votre domaine
3. Récupérer votre ID client (format: `ca-pub-XXXXXXXXXX`)

### 2. **Configuration Variables**
```bash
# Dans .env
NEXT_PUBLIC_ADSENSE_CLIENT_ID=ca-pub-VOTRE-VRAIE-ID
NEXT_PUBLIC_ADSENSE_ENABLED=true
```

### 3. **Utilisation**
```typescript
import { AdBannerFeed, AdBannerSidebar, AdBannerArticle } from '@/components/ads/AdBanner';

// Dans le feed (entre contenus)
<AdBannerFeed slot="unique-slot-name" />

// Sidebar desktop
<AdBannerSidebar slot="sidebar-slot" />

// Dans un article
<AdBannerArticle slot="article-slot" />
```

## 📍 **Emplacements Actuels**

- **Matching selection** (`/matching`) - Entre les cartes de sélection
- **Matching end feed** (`/matching/cards`) - Quand plus de profils
- **Future** : Dashboard, messages, profil

## 🎯 **Slots AdSense Recommandés**

Créer ces slots dans votre compte AdSense :

1. **matching-selection** : Rectangle 300x250
2. **matching-end-feed** : Rectangle responsive
3. **dashboard-sidebar** : Vertical 160x600
4. **article-content** : Rectangle dans articles
5. **footer-banner** : Horizontal 728x90

## 📊 **Analytics Prévues**

- Revenue par slot
- CTR par page
- Performance mobile vs desktop
- Données pour négocier partenariats directs

## 🔧 **Désactiver en Dev**

```bash
# Pour désactiver complètement
NEXT_PUBLIC_ADSENSE_ENABLED=false
```

Les composants ne s'afficheront pas si AdSense est désactivé.

## 💰 **Stratégie Revenue**

**Phase 1 (MVP)** : AdSense uniquement
- Apprentissage audience + CPM
- Revenus 50-200€/mois

**Phase 2 (Growth)** : Hybride AdSense + Partenariats
- AdSense sur pages secondaires
- Partenariats directs sur pages premium
- Objectif 500-2000€/mois