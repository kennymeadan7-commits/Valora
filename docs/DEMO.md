# Démo PreviewPay — API + interface

Deux processus : l'API NestJS (port 3000) et le front Vite (port 5173).
La démo tourne **sans réseau** et sans clé FedaPay (`PAYMENT_PROVIDER=mock`).

Deux persistances au choix, par variable d'environnement :

| `STORAGE` | Effet |
| --- | --- |
| `memory` (défaut) | `MemoryStorage` — rien à installer |
| `prisma` | `PrismaStorage` sur PostgreSQL (`docker compose up -d db`, puis `pnpm --filter @previewpay/storage-prisma migrate`) |

`GET /demo/health` renvoie `{ status, provider, storage }` : c'est le moyen le
plus rapide de vérifier sur quel backend la démo tourne.

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

## Métriques de validation

`GET /demo/metrics` (en-tête `x-internal-key` si `PREVIEWPAY_INTERNAL_KEY` est
défini) renvoie les cinq métriques du PRD calculées par `computeMetrics()` du
cœur :

```json
{
  "previewed": 3, "paid": 1, "rejected": 1,
  "conversionRate": 0.3333, "rejectionRate": 0.3333,
  "paymentAttempts": 2, "paymentFailures": 1, "paymentFailureRate": 0.5,
  "averageTimeToPaymentMs": 18, "averagePrice": 200,
  "marginPerDeliverable": 160, "aiCostPerDeliverable": 40,
  "generatedAt": "2026-11-14T12:35:17.570Z"
}
```

La marge dépend de `DEMO_AI_COST_PER_DELIVERABLE` (XOF entiers). Variable
absente ou vide → `marginPerDeliverable: null` et « — » dans l'interface : le
SDK n'invente pas de coût. Le panneau « Métriques » de la démo web affiche les
mêmes valeurs et se rafraîchit après chaque action.

## Simulation Mobile Money (mode mock uniquement)

```sh
curl -X POST http://localhost:3000/demo/simulate/<id>/approved \
  -H "x-internal-key: $PREVIEWPAY_INTERNAL_KEY"
```

Statuts acceptés : `pending`, `approved`, `declined`, `canceled`, `expired`.
`declined`, `canceled` et `expired` ramènent le livrable à `previewed` :
il est relançable sans frais.

## Interface web

`http://localhost:5173` — formulaire, aperçu filigrané, paywall, et un bloc
« mode démo » pour simuler Approuver / Refuser / Expirer. Le front appelle
l'API en même origine via le proxy Vite (`/deliverables`, `/demo`).

## Preuve de bout en bout avec FedaPay sandbox

```sh
pnpm --filter @previewpay/demo-api build
STORAGE=prisma PAYMENT_PROVIDER=fedapay node --env-file=.env apps/api/dist/server.mjs
pnpm tsx --env-file=.env scripts/fedapay-watch.ts   # crée, paie, suit l'état
```

Le script affiche la page de paiement à ouvrir puis suit l'état jusqu'à
`unlocked`, en imprimant chaque transition horodatée. Il attend un tunnel
public (voir `docs/fedapay-sandbox.md`) pour recevoir les webhooks.

## ⚠️ Tests et base de démo

Les tests PostgreSQL (`packages/storage-prisma`, `apps/api`) **vident** les
tables `Deliverable`, `JournalEntry` et `PaymentEvent` entre deux cas. Ne lance
pas `pnpm test` pendant que tu observes la démo sur `STORAGE=prisma` : les
données affichées disparaissent. Utilise une base séparée si tu as besoin des
deux en même temps (`DATABASE_URL=…/previewpay_demo`).

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
