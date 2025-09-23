# 🧪 Guide de Test AdSense & RGPD

## 📋 Tests Manuels à Effectuer

### 1. **Test Initial : Aucun Consentement**

**Steps :**
1. Ouvrir http://localhost:3002 dans un nouvel onglet privé
2. Attendre 2 secondes

**Résultat attendu :**
- ✅ Bannière de consentement RGPD s'affiche
- ✅ Deux options visibles : "Publicités basiques" et "Publicités personnalisées"
- ✅ Aucune publicité visible sur la page

### 2. **Test : Consentement Essentiel**

**Steps :**
1. Cliquer sur "Continuer avec les pubs basiques"
2. Naviguer vers `/matching`
3. Aller vers `/matching/cards` (après avoir défini sport/niveau)

**Résultat attendu :**
- ✅ Bannière disparaît
- ✅ Publicités basiques affichées (bordure bleue avec texte "Espace partenaire surf/kite")
- ✅ Mention "Publicité non personnalisée" visible
- ✅ Petit bouton cookie (🍪) en bas à droite

### 3. **Test : Consentement Personnalisé**

**Steps :**
1. Cliquer sur le bouton cookie (🍪) en bas à droite
2. Sélectionner "J'accepte les pubs personnalisées"
3. Rafraîchir la page
4. Naviguer sur différentes pages avec ads

**Résultat attendu :**
- ✅ Éléments `<ins class="adsbygoogle">` présents dans le DOM
- ✅ Scripts AdSense chargés dans `<head>`
- ✅ Consentement Google mis à jour (check console)
- ✅ `data-npa="0"` pour publicités personnalisées

### 4. **Test : AdSense Désactivé**

**Steps :**
1. Modifier `.env` : `NEXT_PUBLIC_ADSENSE_ENABLED=false`
2. Redémarrer le serveur web
3. Ouvrir l'app dans un nouvel onglet privé

**Résultat attendu :**
- ✅ Aucune bannière de consentement
- ✅ Aucune publicité visible
- ✅ Pas de script AdSense dans `<head>`

## 🔍 Console Debugging

### Variables à Vérifier

```javascript
// Dans la console du navigateur
localStorage.getItem('cookie-consent')  // 'none', 'essential', 'personalized'
window.adsbygoogle                     // Array d'objets push AdSense
document.querySelectorAll('.adsbygoogle').length  // Nombre d'éléments pub
```

### Network Tab
- ✅ Requête vers `pagead2.googlesyndication.com` seulement si consentement personnalisé
- ✅ Pas de requête tracking si consentement essentiel seulement

## 📱 Tests Mobile

### Responsive Design
1. Ouvrir DevTools → Toggle device toolbar
2. Tester sur différentes tailles d'écran
3. Vérifier que la bannière RGPD s'adapte bien

**Résultat attendu :**
- ✅ Bannière responsive sur mobile
- ✅ Boutons accessibles au pouce
- ✅ Publicités s'adaptent à la largeur

## 🎯 Pages Avec Publicités

### Pages à Tester :
- `/matching` - AdBannerFeed après sélection sport/niveau
- `/matching/cards` - AdBannerFeed en fin de stack
- Pages où vous avez ajouté des `<AdBanner*>` components

### Format des Publicités :
- **Feed** : Rectangle (entre contenu)
- **Sidebar** : Vertical (caché sur mobile)
- **Article** : Auto (adaptatif)

## 🚨 Points de Vigilance

### RGPD Compliance
- ✅ Pas de cookies/tracking avant consentement
- ✅ Option claire pour refuser le tracking
- ✅ Possibilité de changer d'avis
- ✅ Données utilisateur respectées

### AdSense Guidelines
- ✅ Maximum 3 pubs par page
- ✅ Contenu de qualité autour des pubs
- ✅ Pas de clic incitation
- ✅ Labels clairs ("Publicité")

### Performance
- ✅ Pas de ralentissement notable
- ✅ Chargement progressif des scripts
- ✅ Pas d'erreurs console

## 🔧 Debugging Issues

### Problème : Bannière ne s'affiche pas
```bash
# Vérifier env vars
echo $NEXT_PUBLIC_ADSENSE_ENABLED
echo $NEXT_PUBLIC_ADSENSE_CLIENT_ID

# Vérifier localStorage
localStorage.clear()  # Dans console
```

### Problème : AdSense ne charge pas
```bash
# Vérifier le client ID format
# Doit être : ca-pub-XXXXXXXXXXXXXXXX (16 chiffres)

# Vérifier CSP headers
# Autoriser pagead2.googlesyndication.com
```

### Problème : Publicités vides
```javascript
// Normal en développement avec faux client ID
// AdSense a besoin d'un vrai compte validé pour afficher
console.log('Test mode - pubs factices OK');
```

## 📊 Métriques à Surveiller

Une fois en production avec vrai AdSense :
- **CTR** (Click-Through Rate) > 1%
- **RPM** (Revenue Per Mille) selon audience
- **Viewability** > 70%
- **Core Web Vitals** non dégradés

---

**Note :** Ce guide couvre les tests en environnement de développement. En production, vous aurez besoin d'un vrai compte AdSense avec domaine vérifié.