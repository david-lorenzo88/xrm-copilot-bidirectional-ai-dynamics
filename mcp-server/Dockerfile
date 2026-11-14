# Build from the repository root (the server bundles the workspace packages):
#   docker build -f mcp-server/Dockerfile -t collections-mcp .
#   docker run -p 3001:3001 -e DATA_MODE=mock collections-mcp

FROM node:20-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/contract/package.json packages/contract/
COPY packages/collections-domain/package.json packages/collections-domain/
COPY packages/collections-ui/package.json packages/collections-ui/
COPY mcp-server/package.json mcp-server/
COPY mock/package.json mock/
COPY pcf/CollectionsBridge/package.json pcf/CollectionsBridge/
# Only the server's dependency tree (skips pcf-scripts, the mock host, etc.).
RUN npm ci --workspace mcp-server --include-workspace-root --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages ./packages
COPY mcp-server ./mcp-server
RUN npm run build -w mcp-server

FROM node:20-alpine AS runtime
ENV NODE_ENV=production PORT=3001
WORKDIR /app
COPY --from=build /repo/mcp-server/dist ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:${PORT}/healthz || exit 1
CMD ["node", "main.js"]
