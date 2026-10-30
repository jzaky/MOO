# Stoke API. Build from the repository root: docker build -t stoke-api .
ARG NODE_IMAGE=node:22-slim
FROM ${NODE_IMAGE}

RUN apt-get update \
  && apt-get install -y --no-install-recommends unzip ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
# The lockfile covers the whole workspace; the app's manifest is enough for pnpm to resolve it.
COPY apps/mobile/package.json apps/mobile/package.json
RUN pnpm install --frozen-lockfile --filter "@stoke/api..."

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    STORAGE_DIR=/data/storage
EXPOSE 4000
WORKDIR /app/apps/api
CMD ["node", "--import", "tsx", "src/prod.ts"]
