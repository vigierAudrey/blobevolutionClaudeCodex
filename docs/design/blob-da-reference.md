# Blob — Design System Reference

> Référence de direction artistique validée par Audrey Vigier — 2026-06-04.
> Le fichier image `blob-home-reference-dark-sand-yellow.png` doit être placé
> dans ce répertoire (non servi par Next.js, usage interne uniquement).

---

## 1. Palette officielle

| Token CSS            | Valeur HSL         | Hex approx | Usage                              |
|----------------------|--------------------|------------|------------------------------------|
| `--blob-yellow`      | `43 96% 53%`       | `#FBBF24`  | Action prioritaire, accent marque  |
| `--blob-yellow-dark` | `38 92% 44%`       | `#D97706`  | Hover sur jaune                    |
| `--blob-black`       | `220 14% 10%`      | `#15171C`  | Fond sombre, texte principal       |
| `--blob-sand`        | `40 30% 94%`       | `#F2EDE4`  | Fond sections respirantes          |
| `--blob-sand-deep`   | `36 20% 86%`       | `#DDD5C6`  | Séparateurs, accents sable         |

### Proportions à respecter
- 45–55 % : blanc cassé / sable (`blob-sand`)
- 25–35 % : noir profond / sombre (`blob-black`)
- 10–18 % : jaune Blob (`blob-yellow`)
- Reste : photos, textures, détails

---

## 2. Modes de section

### Dark Ocean
- Fond `blob-black`, texte `white`
- Accents `blob-yellow` (nombres, titres clés, séparateurs)
- Photos/vidéos avec filtre sombre + grain
- Usage : hero, footer, cards immersives, sections émotionnelles

### Sand Paper
- Fond `blob-sand`, texte `blob-black`
- Accents `blob-yellow` discrets
- Texture grain légère en background
- Usage : "Pourquoi Blob ?", guides, sections SEO, respiration

### Yellow Signal
- Fond `blob-yellow`, texte `blob-black`
- Boutons `blob-black`
- Usage : bandes d'action courtes, badges, CTA fort
- **Ne jamais en faire le fond majoritaire du site**

---

## 3. BlobButton — hiérarchie validée

| Variant           | Fond          | Texte        | Bordure       | Usage                                  |
|-------------------|---------------|--------------|---------------|----------------------------------------|
| `primaryYellow`   | blob-yellow   | blob-black   | none          | Action prioritaire (hero rider, navbar) |
| `dark`            | blob-black    | white        | blob-black    | CTA secondaire sur fond clair          |
| `outlineLight`    | transparent   | white        | white         | Secondaire sur fond sombre (hero pro)  |
| `outlineDark`     | transparent   | blob-black   | blob-black    | Secondaire sur fond sable              |
| `yellowSignalDark`| blob-black    | white        | blob-black    | Bouton sur fond jaune (Yellow Signal)  |

### Règle de hiérarchie (non négociable)
- **Jaune = action prioritaire** (toujours)
- **Noir/outline = action secondaire** (toujours)
- Ne jamais inverser sans justification UX explicite
- Boutons côte à côte sur desktop, empilés sur mobile
- Style : uppercase, tracking-widest, bold, border-radius minimal (pas SaaS pastel)

### Exemples de disposition validée
```
Hero :    [JE SUIS RIDER ←jaune]  [JE SUIS PRO ←outline]
Navbar :  [Se connecter ←outline] [Rejoindre la communauté ←jaune]
Cards :   [CTA principal ←dark]   sur fond sable
Yellow :  [Voir les offres ←yellowSignalDark] sur fond jaune
```

---

## 4. Typographie

- **Display** : `AdleryPro` (font-display) — titres forts, titres hero
- **Body** : system-ui — texte courant, descriptions
- Style : uppercase + tracking-widest sur les CTAs et titres de section
- Titres hero : gros, gras, condensé — style affiche surf / magazine

---

## 5. Effets visuels

- **Brush divider** : SVG path organique entre sections (voir `BlobBrushDivider`)
- **Grain** : texture sable très légère sur sections Sand Paper
- **Filtre média** : overlay noir + grain léger sur toutes les photos/vidéos (voir `BlobMediaFrame`)
- **Bords irréguliers** : via SVG brush, pas de clip-path complexe
- **Pas de dépendance d'animation** (pas de Framer Motion, pas de GSAP)

---

## 6. Composants du design system

| Composant          | Fichier                           | Rôle                                    |
|--------------------|-----------------------------------|-----------------------------------------|
| `BlobButton`       | `components/blob/BlobButton.tsx`  | 5 variants, hiérarchie jaune/noir       |
| `BlobSection`      | `components/blob/BlobSection.tsx` | Wrapper section dark/sand/yellow        |
| `BlobCard`         | `components/blob/BlobCard.tsx`    | Card avec image filtrée, 3 modes        |
| `BlobMediaFrame`   | `components/blob/BlobMediaFrame.tsx` | Filtre grain+contraste sur médias    |
| `BlobBrushDivider` | `components/blob/BlobBrushDivider.tsx` | SVG brush entre sections           |

---

## 7. Assets à générer (via ChatGPT)

### P0 — Hero
- `hero-poster.webp` — 1280×720, surf/kite Médoc, lumière dorée, tons sombres
- `hero-poster-mobile.webp` — 750×950, même scène recadrée vertical

### P1 — Cards
- `card-ride-a-deux.webp` — 800×600, deux surfers, lumière dramatique, grain
- `card-avec-un-pro.webp` — 800×600, moniteur kite + élève, contre-jour
- `card-bons-plans.webp` — 800×500, matos surf/kite sur sable humide

### P2 — Textures & UI
- `texture-grain-sand.png` — 200×200, grain papier sable, tileable
- `badge-ride.svg`, `badge-share.svg`, `badge-respect.svg` — 120×120, style tampon

---

## 8. Stratégie vidéo hero

- Desktop uniquement (masquée en CSS sous 1024px)
- Poster WebP obligatoire (`hero-poster.webp`)
- Sources : WebM AV1 → WebM VP9 → MP4 H.264
- `prefers-reduced-motion` : vidéo masquée, poster seul

### Commandes ffmpeg
```bash
# Poster
ffmpeg -i surf-kite-full.webm -ss 00:00:02 -frames:v 1 -vf "scale=1280:-2" -quality 85 hero-poster.webp

# AV1 (cible ≤1.8 MB)
ffmpeg -i surf-kite-full.webm -c:v libaom-av1 -crf 40 -b:v 0 -vf "scale=1280:-2,fps=24" -an -cpu-used 4 -row-mt 1 surf-kite-desktop.webm

# VP9 (cible ≤2.5 MB, fallback)
ffmpeg -i surf-kite-full.webm -c:v libvpx-vp9 -crf 33 -b:v 0 -vf "scale=1280:-2,fps=24" -an -deadline good -cpu-used 2 -row-mt 1 surf-kite-desktop-vp9.webm

# H.264 MP4 (cible ≤4 MB, fallback Safari <16)
ffmpeg -i surf-kite-full.webm -c:v libx264 -crf 28 -preset slow -vf "scale=1280:-2,fps=24" -an -movflags +faststart surf-kite-desktop.mp4
```
