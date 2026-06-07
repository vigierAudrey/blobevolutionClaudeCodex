# Fixtures media Blob

Ces fichiers sont des fixtures de test. Ils servent a valider les uploads,
les URLs publiques de profils pros et le refus de lecture anonyme des medias
riders en local ou en environnement de test.

## Garanties RGPD

- Images synthetiques generees localement, sans vraie personne.
- Aucun visage identifiable, enfant, plaque, marque visible ou spot sensible.
- Noms de fichiers marques `test-fixture`.
- Format WebP uniquement.
- Taille cible respectee : chaque image doit rester sous 300 Ko.
- Ces fichiers ne doivent pas etre utilises pour creer de faux profils
  trompeurs en production.

## Arborescence

```text
apps/api/fixtures/media/
├── pros/
│   ├── pro-avatar-test-fixture.webp   # 512x512
│   ├── pro-cover-test-fixture.webp    # 1600x900
│   └── pro-gallery-test-fixture.webp  # 1200x800
└── users/
    ├── user-avatar-test-fixture.webp   # 512x512
    ├── user-cover-test-fixture.webp    # 1600x900
    └── user-gallery-test-fixture.webp  # 1200x800
```

## Upload local/test

Le script d'upload ne modifie pas la policy MinIO. Il upload les objets puis
verifie les invariants attendus :

- `pros/test-fixtures/*` : lecture anonyme GET attendue en `200`.
- `users/test-fixtures/*` : lecture anonyme GET attendue en `403`.
- listing bucket : attendu en `403`.
- metadata objet : `Content-Type` doit commencer par `image/`.

Commande locale :

```bash
ENV_FILE=.env scripts/upload-media-fixtures-minio.sh
```

Si `.env` n'existe pas encore, le script peut lire `.env.example` pour une stack
MinIO locale standard :

```bash
ENV_FILE=.env.example scripts/upload-media-fixtures-minio.sh
```

Si `pros/*` n'est pas encore public en local/test, appliquer la policy dediee
hors de ce script :

```bash
ENV_FILE=.env scripts/minio-public-prefix-policy.sh --prefix 'pros/*'
```

Ne jamais appliquer `--prefix 'users/*'` pour ces fixtures : les medias riders
doivent rester prives en lecture anonyme.
