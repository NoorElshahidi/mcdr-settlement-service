FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY apps/web/package.json ./apps/web/package.json
RUN npm install --omit=optional
COPY apps/web ./apps/web
WORKDIR /app/apps/web
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
# The standalone server.js binds process.env.PORT (default 3000) regardless of
# EXPOSE — without this it silently listens on 3000 while compose forwards
# host traffic to the container's 3001, and nothing ever answers.
ENV PORT=3001
ENV HOSTNAME=0.0.0.0
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
# `output: standalone` never bundles public/ (a documented Next.js gotcha) — without
# this, silent-check-sso.html 404s and silent Keycloak re-auth silently breaks on
# every reload, forcing a fresh login each time.
COPY --from=build /app/apps/web/public ./apps/web/public
EXPOSE 3001
CMD ["node", "apps/web/server.js"]
