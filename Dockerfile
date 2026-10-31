FROM node:24.22.2-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

FROM base AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig*.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
RUN DATABASE_URL='mysql://placeholder:placeholder@localhost:3306/placeholder' npm run prisma:generate && npm run build

FROM build AS migration
COPY docker/migrate.mjs ./docker/migrate.mjs
USER node
CMD ["node", "docker/migrate.mjs"]

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3001
CMD ["npm", "start"]
