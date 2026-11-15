# syntax=docker/dockerfile:1

# Démo Valora CV : un seul processus sert l'API et le front.
#   docker build -t previewpay-demo .
#   docker run -p 3000:3000 --env-file .env previewpay-demo
#
# Build en une étape : le dépôt est un workspace pnpm dont les paquets
# s'importent mutuellement ; copier l'arbre entier évite les liens symboliques
# cassés d'un découpage multi-étapes.

FROM node:22-bookworm-slim
RUN corepack enable \
 && apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY . .
RUN pnpm install --frozen-lockfile

# La clé de simulation est compilée dans le front : elle doit être la même
# qu'au runtime (`PREVIEWPAY_INTERNAL_KEY`), sinon les boutons de démo échouent.
ARG VITE_DEMO_INTERNAL_KEY=dev-internal-key
ENV VITE_DEMO_INTERNAL_KEY=$VITE_DEMO_INTERNAL_KEY
RUN pnpm build \
 && pnpm --filter @previewpay/demo-web build \
 && node scripts/build-api.mjs

ENV NODE_ENV=production \
    PORT=3000 \
    STORAGE=memory \
    PAYMENT_PROVIDER=mock

EXPOSE 3000
CMD ["node", "apps/api/dist/server.mjs"]
