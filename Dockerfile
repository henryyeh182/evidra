# Remote-ready target. It is built from the same source release as the MCPB;
# the image never downloads rules at startup.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run release:validate && BUNDLE_ENTRY=apps/mcp-server/src/http-entry.js npm run build:bundle

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787
COPY --from=build /app/dist/evidra-server.mjs ./dist/evidra-server.mjs
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/manifest.json ./manifest.json
COPY --from=build /app/release-manifest.json ./release-manifest.json
COPY --from=build /app/data/seeds ./data/seeds
COPY --from=build /app/data/fixtures ./data/fixtures
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD node --input-type=module -e 'const m=JSON.parse(await import("node:fs").then(({readFileSync})=>readFileSync("release-manifest.json","utf8"))); if (!m.releaseVersion || !m.engineVersion || !m.libraryChecksum) process.exit(1);'
ENTRYPOINT ["node", "dist/evidra-server.mjs"]
