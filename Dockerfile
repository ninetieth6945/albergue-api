# Imagen de producción para Render (plan Free). Node 22 LTS, sin archivos persistentes:
# los comprobantes se guardan en la base (Neon) para que no se pierdan al reiniciar el contenedor.
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

# El esquema debe estar presente para que "prisma generate" funcione.
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
  && npx prisma generate

COPY src ./src

# Render inyecta PORT; el valor por defecto solo aplica en local.
EXPOSE 3004
CMD ["node", "src/index.js"]
