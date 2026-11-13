# Image de la console backup365 : serveur API + interface web, en un seul processus.
# Construction : `podman build -t backup365 .` (ou `docker build`), depuis la racine du dépôt.

# --- Étape 1 : construction (dépendances de développement, compilation) ---
FROM node:22.23.4-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d AS build
WORKDIR /src
# La version de pnpm vient du champ packageManager de package.json.
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm run build \
 # Serveur et ses dépendances de production seulement, dans un dossier autonome.
 && pnpm --filter @backup365/server deploy --prod --legacy /out

# --- Étape 2 : exécution (sans pnpm, sans sources, utilisateur non root) ---
FROM node:22.23.4-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    BACKUP365_DATA_DIR=/data \
    BACKUP365_WEB_DIR=/app/web
WORKDIR /app
COPY --from=build /out/ ./
COPY --from=build /src/apps/web/dist/ ./web/
# Dossier des bases SQLite, à monter en volume ; propriété de l'utilisateur non root.
# /anchors : point de montage des ancres du journal d'audit (volume distinct, voir compose.yaml) ;
# BACKUP365_AUDIT_ANCHOR_DIR n'est pas fixé ici : sans montage, l'ancrage ne doit pas paraître actif.
RUN mkdir /data /anchors && chown node:node /data /anchors
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
