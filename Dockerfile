# Debian slim, not Alpine: sharp (added at M5) has no musl prebuild for every
# architecture, and a native build failing on step 1 is the worst possible
# self-host experience.
FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json* ./
COPY packages/contract/package.json packages/contract/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
COPY packages/contract/package.json packages/contract/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/packages/contract/dist packages/contract/dist
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/web/dist apps/web/dist

RUN mkdir -p /var/prumo/blobs && chown -R node:node /var/prumo
USER node
EXPOSE 3000
CMD ["node", "apps/server/dist/main.js"]
