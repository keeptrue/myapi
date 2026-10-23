FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM deps AS build
COPY tsconfig.json tsconfig.server.json tsconfig.web.json vite.config.ts tsdown.config.ts index.html ./
COPY src ./src
RUN bun run build

FROM oven/bun:1-alpine AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM node:22-alpine AS runtime
RUN apk add --no-cache ca-certificates tzdata \
 && mkdir -p /data \
 && chown -R node:node /data
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    MYAPI_DATA_DIR=/data \
    TZ=Asia/Shanghai
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN chown -R node:node /app
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server/main.mjs"]
