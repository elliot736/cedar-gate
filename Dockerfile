FROM node:22-alpine AS builder

WORKDIR /build

# Copy package files first for better layer caching
COPY package.json package-lock.json ./

# Replace local cedar-ts reference with published version for Docker builds.
# In development, cedar-ts is linked via file:../cedar-ts. In production,
# it should be published to npm and referenced by version.
# For now, we copy cedar-ts into the build context using the build script.
RUN npm ci --ignore-scripts 2>/dev/null || true

# If cedar-ts needs to be built from source (for local builds),
# use: docker build -f Dockerfile -t cedar-gate ../
# This sets the build context to the parent directory.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Production image ─────────────────────────────────────────────────
FROM node:22-alpine

RUN addgroup -S gate && adduser -S gate -G gate

WORKDIR /app

COPY --from=builder /build/dist ./dist
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/package.json ./

# Default policies directory (mount your own)
RUN mkdir -p /app/policies && chown -R gate:gate /app
COPY policies ./policies
COPY entities.json ./entities.json

USER gate

ENV PORT=8080
ENV ADMIN_PORT=8081
ENV POLICIES_DIR=/app/policies
ENV ENTITIES_FILE=/app/entities.json
ENV LOG_LEVEL=info
ENV HOT_RELOAD=true

EXPOSE 8080 8081

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:8081/health || exit 1

CMD ["node", "dist/server.js"]
