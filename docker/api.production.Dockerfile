# API — image production pré-VPS
# Sobre, pas de multi-stage complexe : installe les deps, compile, démarre.
# Adapté monorepo pnpm workspace.

FROM node:22-bullseye

WORKDIR /workspace

RUN corepack enable \
    && corepack prepare pnpm@10.28.2 --activate

# Copier les fichiers workspace en premier (cache Docker optimisé)
# tsconfig.base.json requis : apps/api/tsconfig.json l'étend avec "extends": "../../tsconfig.base.json"
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/ packages/
COPY apps/api/ apps/api/
COPY types/ types/

# Installer toutes les dépendances (dev incluses pour la compilation)
RUN pnpm install --frozen-lockfile

# Générer le client Prisma
RUN pnpm --filter @blobinfini/database exec prisma generate

# Compiler l'API TypeScript
RUN pnpm --filter @blobinfini/api build

EXPOSE 4000

ENV NODE_ENV=production

# Lance le binaire compilé — pas de tsx, pas de live reload
CMD ["node", "apps/api/dist/index.js"]
