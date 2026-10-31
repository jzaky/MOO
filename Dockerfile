# Stoke: API + website in one image. Build from the repository root:
#   docker build -t stoke .
ARG NODE_IMAGE=node:22-slim

# 1. Website: the app's web build, calling the API on its own origin ("/").
FROM ${NODE_IMAGE} AS web
RUN corepack enable
WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile
RUN cd apps/mobile && EXPO_PUBLIC_API_URL=/ npx expo export -p web --output-dir /web

# 2. Server.
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
COPY --from=web /web /app/web

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    STORAGE_DIR=/data/storage \
    WEB_DIR=/app/web
EXPOSE 4000
WORKDIR /app/apps/api
CMD ["node", "--import", "tsx", "src/prod.ts"]
