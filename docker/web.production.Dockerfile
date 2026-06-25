# Web (Next.js) — image production pré-VPS
# output: standalone dans next.config.mjs → binaire autonome.
# NEXT_PUBLIC_API_URL doit être passé au build (variable public baked-in).

FROM node:22-bullseye AS builder

WORKDIR /workspace

RUN corepack enable \
    && corepack prepare pnpm@10.28.2 --activate

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/ packages/
COPY apps/web/ apps/web/
COPY apps/api/ apps/api/
COPY types/ types/

RUN pnpm install --frozen-lockfile

# NEXT_PUBLIC_* est substituée au build — doit correspondre au domaine pré-VPS
ARG NEXT_PUBLIC_API_URL=https://api.blobinfini.local
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

# Firebase Cloud Messaging (push navigateur) — variables PUBLIQUES baked-in au build.
# Volontairement vides par défaut : aucune valeur demo n'est injectée ici. Sans valeurs
# réelles, le front reste fail-closed (cf. apps/web/lib/firebase.ts) et n'appelle jamais
# getToken. Les vraies clés (projet Firebase de TEST) sont fournies via build.args du
# compose de staging, jamais committées. Ce ne sont PAS des secrets serveur — les secrets
# (FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY) restent côté API uniquement.
ARG NEXT_PUBLIC_FIREBASE_API_KEY=
ENV NEXT_PUBLIC_FIREBASE_API_KEY=${NEXT_PUBLIC_FIREBASE_API_KEY}
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
ENV NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=${NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN}
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID=
ENV NEXT_PUBLIC_FIREBASE_PROJECT_ID=${NEXT_PUBLIC_FIREBASE_PROJECT_ID}
ARG NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
ENV NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=${NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET}
ARG NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
ENV NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=${NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID}
ARG NEXT_PUBLIC_FIREBASE_APP_ID=
ENV NEXT_PUBLIC_FIREBASE_APP_ID=${NEXT_PUBLIC_FIREBASE_APP_ID}
ARG NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=
ENV NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=${NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID}
ARG NEXT_PUBLIC_FIREBASE_VAPID_KEY=
ENV NEXT_PUBLIC_FIREBASE_VAPID_KEY=${NEXT_PUBLIC_FIREBASE_VAPID_KEY}

RUN pnpm --filter @blobinfini/web build

# Runtime : standalone Next.js
FROM node:22-bullseye-slim

WORKDIR /app

# Le build standalone contient tout le nécessaire
COPY --from=builder /workspace/apps/web/.next/standalone ./
COPY --from=builder /workspace/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /workspace/apps/web/public ./apps/web/public

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# server.js généré par Next.js standalone
CMD ["node", "apps/web/server.js"]
