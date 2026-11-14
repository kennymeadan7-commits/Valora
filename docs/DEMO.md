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

## Parcours (interface « Valora CV »)

1. **Vos infos** — on importe un CV existant en PDF (`POST /demo/cv/import`,
   champ multipart `file`, 5 Mo max) ou on remplit le formulaire. L'import
   extrait le texte **sur le serveur** (`unpdf`, sans réseau ni service tiers),
   repère les rubriques FR/EN (profil, expériences, formation, compétences,
   langues, centres d'intérêt) et pré-remplit le formulaire, que la personne
   relit. Rien n'est stocké à cette étape. Un PDF d'exemple est fourni :
   `docs/samples/cv-exemple.pdf` (`pnpm sample:cv` pour le régénérer).
2. **Aperçu** — `POST /demo/cv` stocke les données structurées (`cv/v1`) et
   confie le livrable au SDK. La `CvPreviewStrategy` produit côté serveur le
   **vrai gabarit A4** dont les parties payantes (réalisations, formation,
   coordonnées complètes, compétences au-delà de 3…) sont remplacées par des
   barres grises : le texte masqué n'est jamais envoyé au navigateur.
3. **Paiement** — `POST /deliverables/:id/pay` passe à `payment_pending`. FedaPay
   sandbox étant indisponible, un **simulateur Mobile Money maison** (téléphone
   MTN / Moov avec code secret) répond à la demande : *Valider* → `approved`,
   *Annuler* → `declined`, ou demande expirée. La réponse passe par
   `POST /demo/simulate/:id/:statut` et le SDK **revérifie le statut par appel
   API** avant de débloquer, comme avec FedaPay.
4. **Téléchargement** — `GET /deliverables/:id/download` renvoie un lien signé
   (402 avant), puis `GET /deliverables/:id/content?token=…` sert le CV :
   - `format=html` (défaut) : document A4 autonome, CSP stricte, imprimable en
     PDF (« Télécharger en PDF » ouvre l'impression du navigateur) ;
   - `format=md` : version texte Markdown ;
   - `toolbar=1` : ajoute la barre « Imprimer / PDF » pour l'ouverture en onglet.

Quatre couleurs de modèle (`theme` : `emeraude`, `indigo`, `ardoise`,
`terracotta`). Le contenu est stocké structuré et le HTML recalculé à la
lecture : une amélioration du gabarit profite aussi aux CV déjà payés.

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

`http://localhost:5173` — import PDF ou formulaire, aperçu A4 caviardé,
paiement via le simulateur Mobile Money, CV final (PDF / .html / .md) et un
panneau repliable « Tableau de bord intégrateur » pour les métriques. Le front appelle
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
