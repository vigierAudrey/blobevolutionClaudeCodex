# 💰 Modèle Économique - Blobinfini

> **Statut juridique prévu** : Association loi 1901 (France)

## 📊 Vision & Stratégie

Blobinfini se positionne comme une **plateforme communautaire gratuite** pour connecter les passionnés de sports de glisse, financée par la publicité et le sponsoring.

### Valeurs de l'association

- ✅ **Gratuit pour tous** : Riders et Pros utilisent la plateforme sans commission
- ✅ **Communauté d'abord** : Fédérer les passionnés de glisse
- ✅ **Transparence** : Modèle publicitaire éthique avec consentement RGPD
- ✅ **Partenariats vertueux** : Sponsors alignés avec les valeurs de la glisse

---

## 🎯 Modèle de Revenus - Phase MVP

### 1. Publicités Display (Actuel)

**Implémentation** :

```typescript
// Configuration publicité RGPD-compliant
interface AdConfig {
  provider: 'Google Adsense' | 'Custom';
  zones: {
    sidebar: boolean;
    betweenResults: boolean;
    articleFooter: boolean;
  };
  consent: {
    required: true;
    optOut: 'easy'; // Doit être facile de refuser
  };
  frequency: 'moderate'; // Ne pas saturer l'UX
}
```

**Emplacements publicitaires** :

| Zone | Format | Fréquence |
|------|--------|-----------|
| **Sidebar desktop** | 300x250 | Statique |
| **Entre résultats matching** | 320x100 | Tous les 10 profils |
| **Articles Blobosphère** | 728x90 | Footer uniquement |
| **Page d'accueil** | 970x250 | Header (optionnel) |

**Règles RGPD strictes** :

```typescript
// Gestion consentement utilisateur
interface UserAdPreferences {
  adsEnabled: boolean;           // Actif par défaut
  personalizedAds: boolean;      // Nécessite consentement explicite
  adProviders: {
    google: boolean;
    facebook: boolean;
    // Contrôle granulaire par provider
  };
  lastUpdated: Date;
}

// Interface de configuration dans le profil
function AdPreferencesSettings() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>🍪 Gestion de la publicité</CardTitle>
        <CardDescription>
          Blobinfini est gratuit grâce à la publicité.
          Vous pouvez désactiver les pubs, mais cela limite nos revenus associatifs.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Switch
          checked={adsEnabled}
          onCheckedChange={handleToggleAds}
          label="Afficher les publicités (soutenir l'association)"
        />
        <Switch
          checked={personalizedAds}
          onCheckedChange={handleTogglePersonalized}
          label="Publicités personnalisées (optionnel)"
        />
      </CardContent>
    </Card>
  );
}
```

**Estimations revenus** (à valider) :

- **CPM moyen** : 2-5€ (sports de niche)
- **Objectif trafic** : 10k visiteurs/mois (M+3)
- **Revenus estimés** : 20-50€/mois initial → 500€+/mois (M+12)

---

## 🤝 Phase 2 - Partenariats & Sponsors (T2 2026)

### 1. Sponsors officiels

**Cibles prioritaires** :

| Catégorie | Marques cibles | Contrepartie |
|-----------|---------------|--------------|
| **Matériel Surf** | Rip Curl, Quiksilver, Billabong | Logo + articles Blobosphère |
| **Matériel Kite** | Duotone, Cabrinha, North | Logo + mise en avant cours |
| **Accessoires** | FCS, Futures, Dakine | Bannière + offres exclusives |
| **Locaux** | Écoles de surf régionales | Profils premium |
| **Tech** | GoPro, Garmin | Concours + reviews matériel |

**Packages sponsor** :

```typescript
enum SponsorTier {
  BRONZE = 'Bronze',   // 500€/an
  SILVER = 'Silver',   // 1500€/an
  GOLD = 'Gold',       // 3000€/an
  PLATINUM = 'Platinum' // 5000€+/an
}

interface SponsorPackage {
  tier: SponsorTier;
  benefits: {
    logoHomepage: boolean;
    featuredArticles: number;        // Articles Blobosphère dédiés
    proProfileHighlight: boolean;    // Mise en avant pros partenaires
    exclusiveOffers: boolean;        // Offres membres
    newsletter: number;              // Mentions newsletter/mois
    analytics: boolean;              // Stats de visibilité
  };
  duration: '12 months';
}

// Exemple GOLD
const goldPackage: SponsorPackage = {
  tier: SponsorTier.GOLD,
  benefits: {
    logoHomepage: true,              // Logo permanent
    featuredArticles: 4,             // 1 article/trimestre
    proProfileHighlight: true,       // Badge "Partenaire officiel"
    exclusiveOffers: true,           // -10% membres Blobinfini
    newsletter: 2,                   // 2 mentions/mois
    analytics: true,                 // Dashboard dédié
  },
  duration: '12 months',
};
```

### 2. Offres partenaires intégrées

**Marketplace "Bons plans Glisse"** :

```typescript
// Modèle d'offre partenaire
interface PartnerOffer {
  id: string;
  partnerId: string;
  partner: {
    name: string;
    logo: string;
    verified: boolean;
  };

  // Détails offre
  title: string;
  description: string;
  discount: number;              // % de réduction
  category: 'MATERIEL' | 'COURS' | 'VOYAGE' | 'ACCESSOIRES';

  // Conditions
  minPurchase?: number;
  validUntil: Date;
  codePromo: string;

  // Tracking
  clickCount: number;
  redemptionCount: number;

  // Affiliation (si applicable)
  affiliateLink?: string;
  commissionRate?: number;      // Future source de revenus
}

// Page dédiée /offres-partenaires
function PartnerOffersPage() {
  return (
    <div>
      <h1>🎁 Bons plans Glisse</h1>
      <p>Nos partenaires vous offrent des réductions exclusives</p>

      <OfferGrid>
        {offers.map(offer => (
          <OfferCard
            key={offer.id}
            offer={offer}
            onClick={() => trackOfferClick(offer.id)}
          />
        ))}
      </OfferGrid>
    </div>
  );
}
```

**Avantages** :

- ✅ **Gratuit pour utilisateurs** : Aucun abonnement premium
- ✅ **Valeur ajoutée** : Réductions réelles pour la communauté
- ✅ **Win-win** : Sponsors gagnent en visibilité, riders économisent
- ✅ **Futur revenu** : Affiliation possible (commission sur ventes)

---

## 🏛️ Statut Association - Avantages & Contraintes

### Avantages

1. **Fiscalité** :
   - Exonération de TVA (sous conditions)
   - Exonération impôts sur les sociétés (activité non lucrative)
   - Dons défiscalisables pour sponsors

2. **Image** :
   - Crédibilité auprès de la communauté
   - Positionnement "intérêt général" vs commercial
   - Facilite partenariats institutionnels (mairies, régions)

3. **Subventions** :
   - Éligible subventions publiques (sports, numérique)
   - Fonds européens (innovation sociale)
   - Mécénat d'entreprise facilité

### Contraintes

1. **Gestion** :
   - Bureau associatif obligatoire (président, trésorier, secrétaire)
   - Assemblée Générale annuelle
   - Comptabilité rigoureuse (même si simplifiée)

2. **Lucrativité** :
   - Pas de redistribution de bénéfices
   - Réserves limitées (sauf projets futurs)
   - Rémunérations encadrées (dirigeants bénévoles)

3. **Publicité** :
   - Activité publicitaire possible mais limitée
   - Ne doit pas être l'activité principale
   - Transparence sur les revenus obligatoire

---

## 📋 Roadmap Monétisation

### Phase 1 - MVP (T4 2025)

- [x] Plateforme gratuite fonctionnelle
- [ ] Intégration Google Adsense
- [ ] Interface gestion cookies/pub dans profil
- [ ] Conformité RGPD stricte
- [ ] Création association loi 1901

**Objectif** : Valider l'adoption (1000 utilisateurs M+6)

### Phase 2 - Sponsoring (T2 2026)

- [ ] Packages sponsors définis
- [ ] Page /sponsors sur le site
- [ ] Démarchage marques surf/kite (5 sponsors)
- [ ] Articles Blobosphère sponsorisés
- [ ] Newsletter mensuelle (sponsor dans footer)

**Objectif** : 5k€/an de sponsors (couvrir hébergement + dev)

### Phase 3 - Offres Partenaires (T3 2026)

- [ ] Marketplace /offres-partenaires
- [ ] Système de codes promo
- [ ] Tracking analytics pour partenaires
- [ ] Programme affiliation (optionnel)

**Objectif** : 20+ offres actives, 10k clics/mois

### Phase 4 - Pérennisation (2027+)

- [ ] Subventions publiques (DRAJES, Région)
- [ ] Événements physiques sponsorisés
- [ ] Boutique associative (goodies)
- [ ] Cours premium (reverse 100% aux pros, frais gestion minimes)

**Objectif** : Association autonome financièrement

---

## 🎯 KPIs Monétisation

| Indicateur | Objectif M+6 | Objectif M+12 | Objectif M+24 |
|------------|--------------|---------------|---------------|
| **Utilisateurs actifs** | 1 000 | 5 000 | 20 000 |
| **Pages vues/mois** | 10 000 | 50 000 | 200 000 |
| **Revenus pub/mois** | 50€ | 250€ | 1 000€ |
| **Sponsors actifs** | 0 | 3 | 10 |
| **Revenus sponsors/an** | 0€ | 5 000€ | 20 000€ |
| **Offres partenaires** | 0 | 10 | 50 |
| **Clics offres/mois** | 0 | 1 000 | 10 000 |

---

## 💡 Pitch Sponsors

### Proposition de valeur

> **"Blobinfini, la communauté française des sports de glisse"**
>
> Nous connectons **10 000+ passionnés de surf et kitesurf** chaque mois.
> Votre marque peut :
> - Toucher une **audience qualifiée et engagée**
> - Associer votre image à une **initiative communautaire**
> - Bénéficier d'une **visibilité ciblée** (vs pub généraliste)
> - Soutenir le **développement du sport local**

### Arguments clés

1. **Audience premium** :
   - Pratiquants réguliers (2-3 sessions/semaine)
   - Budget équipement : 500-2000€/an
   - Influenceurs locaux (écoles, clubs)

2. **ROI mesurable** :
   - Dashboard analytics sponsor
   - Tracking clics/conversions codes promo
   - Reporting mensuel détaillé

3. **Engagement communautaire** :
   - Association vs société = image positive
   - Contenus éditoriaux de qualité (Blobosphère)
   - Événements physiques futurs

---

## 🔐 Sécurité Juridique

### Déclaration association

**Démarches** :

1. Rédiger statuts associatifs
2. Déclaration préfecture (ou en ligne)
3. Publication Journal Officiel
4. Ouverture compte bancaire asso
5. Obtenir numéro RNA (Répertoire National des Associations)

**Statuts à inclure** :

- Objet : "Développer la pratique des sports de glisse"
- Moyens : "Plateforme numérique, événements, partenariats"
- Ressources : "Cotisations, dons, subventions, publicité"

### Conformité publicité

**Règles CNIL/RGPD** :

```typescript
// Consentement obligatoire pour pub personnalisée
const adConsentFlow = {
  step1: 'Afficher banner cookies au premier accès',
  step2: 'Expliquer clairement usage publicité',
  step3: 'Permettre refus facile (1 clic)',
  step4: 'Stocker consentement (durée 13 mois max)',
  step5: 'Permettre révocation à tout moment (profil)',
};

// Ne PAS faire
❌ Cookies pub avant consentement
❌ Pré-cocher "J'accepte"
❌ Refus compliqué (dark patterns)
❌ Partage données sans info claire

// FAIRE
✅ Banner explicite au premier accès
✅ Opt-in réel pour pub personnalisée
✅ Interface de gestion dans profil utilisateur
✅ Liste exhaustive des providers
✅ Export données pub (RGPD)
```

---

## 📞 Contacts Potentiels Sponsors

### Marques surf

- **Rip Curl France** : sponsoring@ripcurl.fr
- **Quiksilver Europe** : marketing@quiksilver.com
- **Billabong France** : contact@billabong.fr

### Marques kitesurf

- **Duotone** : info@duotonesports.com
- **Cabrinha** : europe@cabrinhakites.com
- **North Kiteboarding** : info@northkb.com

### Locaux (Nouvelle-Aquitaine)

- **Écoles de surf Biarritz/Hossegor**
- **Shops locaux** (Board Riders, Surf Session)
- **Offices de tourisme** (promotion destinations)

---

## 🚀 Prochaines Actions

### Immédiat (M0-M1)

- [ ] Créer association loi 1901
- [ ] Ouvrir compte bancaire asso
- [ ] Implémenter Google Adsense sur MVP
- [ ] Configurer gestion cookies RGPD

### Court terme (M2-M6)

- [ ] Créer page /sponsors
- [ ] Préparer pitch deck sponsors
- [ ] Contacter 10 marques (surf + kite)
- [ ] Lancer newsletter mensuelle

### Moyen terme (M7-M12)

- [ ] Implémenter marketplace offres partenaires
- [ ] Organiser premier événement physique sponsorisé
- [ ] Demander subventions (DRAJES, Région)

---

**Responsable** : Audrey (Présidente Association)
**Dernière mise à jour** : 07/11/2025
