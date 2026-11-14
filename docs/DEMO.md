# Démo PreviewPay — API + interface

Deux processus : l'API NestJS (port 3000) et le front Vite (port 5173).
La démo tourne **sans réseau** et sans clé FedaPay (`PAYMENT_PROVIDER=mock`).

## Lancer

```sh
pnpm install
docker compose up -d db          # seulement si STORAGE=prisma
cp .env.example .env             # puis renseigner PREVIEWPAY_DOWNLOAD_SECRET

pnpm --filter @previewpay/demo-api build
pnpm --filter @previewpay/demo-api start   # → http://localhost:3000
pnpm --filter @previewpay/demo-web dev     # → http://localhost:5173
```

`GET /demo/health` renvoie le fournisseur actif.

## Parcours

1. `POST /demo/cv` génère un CV côté serveur et le confie au SDK : le
   navigateur ne reçoit qu'un aperçu tronqué et filigrané.
2. `POST /deliverables/:id/pay` passe le livrable à `payment_pending`.
3. Le fournisseur confirme (webhook FedaPay, ou `POST /demo/simulate/:id/approved`
   en mode mock) ; le SDK **revérifie le statut par appel API** avant de
   débloquer.
4. `GET /deliverables/:id/download` renvoie un lien signé (402 avant).
5. `GET /deliverables/:id/content?token=…` sert le fichier complet.

## Simulation Mobile Money (mode mock uniquement)

```sh
curl -X POST http://localhost:3000/demo/simulate/<id>/approved \
  -H "x-internal-key: $PREVIEWPAY_INTERNAL_KEY"
```

Statuts acceptés : `pending`, `approved`, `declined`, `canceled`, `expired`.
`declined`, `canceled` et `expired` ramènent le livrable à `previewed` :
il est relançable sans frais.

## Raccourcis utiles

```sh
# bundle + démarrage en un seul appel
pnpm --filter @previewpay/demo-api dev

# arrêter l'API
kill $(lsof -t -i:3000)
```

## Note d'architecture

Les paquets du monorepo exposent leur source TypeScript (`main: ./src/index.ts`),
que Node ne peut pas exécuter directement (imports `.js` + décorateurs Nest).
`scripts/build-api.mjs` produit donc un bundle ESM autonome dans
`apps/api/dist/server.mjs`. En production, on remplacerait ce bundle par une
compilation `tsc` des paquets publiés.
