FROM node:22-bullseye

WORKDIR /workspace

CMD ["npm", "run", "dev:api"]
