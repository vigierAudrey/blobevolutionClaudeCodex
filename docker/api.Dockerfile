FROM node:22-bullseye

WORKDIR /workspace

RUN corepack enable \
    && corepack prepare pnpm@10.28.2 --activate

CMD ["npm", "run", "dev:api"]
