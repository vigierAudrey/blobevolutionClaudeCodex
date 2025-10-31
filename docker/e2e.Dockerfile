# syntax=docker/dockerfile:1.6

FROM mcr.microsoft.com/playwright:v1.48.0-jammy

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages ./packages
COPY playwright.config.ts playwright.global-setup.ts ./
COPY README_ADS.md README_TESTS.md ./ 
COPY docs ./docs
COPY tsconfig.base.json ./

RUN npm install

ENV NODE_ENV=test
ENV E2E_WEB_PORT=3020
ENV E2E_API_PORT=4020

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD curl -f http://localhost:${E2E_WEB_PORT} || exit 1

CMD ["npm", "run", "test:e2e"]
