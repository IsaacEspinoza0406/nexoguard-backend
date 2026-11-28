ARG NEXOGUARD_IMAGE_ROLE=runtime
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

# The generated client runs without Prisma CLI or its optional peer toolchain.
# Keep the CLI (patched by the scoped override) only in build/migration stages.
FROM build AS production-deps
RUN npm prune --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund \
    && node -e "for(const p of ['prisma','@prisma/config','effect','typescript','jest']){try{require.resolve(p);throw Error('TOOL_PRESENT:'+p)}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e}};require('argon2');require('@prisma/adapter-mariadb');require('./dist/infrastructure/prisma/prisma.service.js')"

FROM base AS transport
RUN apt-get update && apt-get install -y --no-install-recommends iptables util-linux && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY docker/transport-entrypoint.sh /app/docker/transport-entrypoint.sh
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3002
# Requires NET_ADMIN ONLY during firewall initialization. Node loses every capability.
ENTRYPOINT ["sh", "/app/docker/transport-entrypoint.sh"]

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=production-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]

# Railway selects the role through an explicit non-secret build argument.
# Defaults to the same runtime as local Compose; no duplicated build instructions.
FROM ${NEXOGUARD_IMAGE_ROLE} AS release
