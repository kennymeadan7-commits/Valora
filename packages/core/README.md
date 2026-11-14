# @previewpay/core

Cœur de **PreviewPay** : on *voit* un livrable généré par une IA, on le *paie*
en Mobile Money (XOF), on le *débloque*. Aucune dépendance de framework.

```sh
npm install @previewpay/core
```

Le cœur décide de tout ce qui touche à l'argent et au contenu : machine à
états, prix figé, idempotence des webhooks, revérification du paiement, liens
de téléchargement signés. Il dépend de trois interfaces que vous fournissez
(ou que vous prenez dans les paquets `@previewpay/*`).

| Interface | Rôle | Implémentations |
| --- | --- | --- |
| `Storage` | persistance des livrables, journal, événements | `storage-memory`, `storage-prisma` |
| `PaymentProvider` | créer / relire un paiement, vérifier un webhook | `provider-mock`, `provider-fedapay` |
| `PreviewStrategy` | produire l'aperçu **côté serveur** | la vôtre |

## Exemple

```ts
import { PreviewPay } from "@previewpay/core";
import { MemoryStorage } from "@previewpay/storage-memory";
import { MockPaymentProvider } from "@previewpay/provider-mock";

const previewPay = new PreviewPay({
  storage: new MemoryStorage(),
  provider: new MockPaymentProvider(),
  pricing: { cv: 200, presentation: 500 }, // entiers XOF
  preview: {
    // L'aperçu est calculé ici, sur le serveur : jamais masqué côté client.
    async makePreview(content) {
      const text = String(content);
      return { text: text.slice(0, 300), truncated: text.length > 300, watermark: "APERÇU" };
    },
  },
  download: { secret: process.env.PREVIEWPAY_DOWNLOAD_SECRET!, baseUrl: "https://api.example.com" },
  maxRegenerations: 2,
  limits: { previewsPerOwnerPerDay: 5 },
});

// 1. Votre agent a généré le livrable : le SDK le garde et renvoie l'aperçu.
const d = await previewPay.create({ type: "cv", content: fullCv, ownerId: "user_42" });
// d : { id, state: "previewed", price: 200, currency: "XOF", preview, … } — jamais `content`

// 2. L'utilisateur paie.
await previewPay.pay(d.id, { phone: "+22997000000", operator: "mtn_benin" });

// 3. Le fournisseur confirme (webhook) : signature vérifiée, doublon ignoré,
//    statut **revérifié par appel API** avant de passer à `unlocked`.
await previewPay.handleWebhook(rawBody, headers);

// 4. Lien signé à durée courte (402 / PaymentRequiredError avant).
const { url, expiresAt } = await previewPay.download(d.id);

// 5. Votre route de contenu vérifie le jeton avant de servir le fichier.
const unlocked = await previewPay.verifyDownloadToken(token); // Deliverable complet
```

## Machine à états

```
draft ──> previewed ──pay──> payment_pending ──approved──> unlocked
              │                     │
           reject          declined / canceled / expired
              │                     │
              v                     └──> previewed (relançable)
          rejected   (après `maxRegenerations` régénérations)
```

`syncPayment(id)` réconcilie un paiement sans webhook (statut `expired`,
webhook perdu). Chaque transition acceptée écrit une entrée de journal
append-only (`from`, `to`, `at`, `cause`, `eventId` / `paymentId`).

## API

| Méthode | Effet |
| --- | --- |
| `create({ type, content, ownerId?, maxRegenerations? })` | fige le prix, produit l'aperçu, état `previewed` |
| `get(id)` | vue publique (`PublicDeliverable`) |
| `pay(id, { phone, operator })` | crée le paiement, état `payment_pending` |
| `reject(id, reason)` | régénère l'aperçu dans la limite, sinon `rejected` (sans frais) |
| `handleWebhook(rawBody, headers)` | idempotent, revérifie le statut avant tout déblocage |
| `syncPayment(id)` | relit le statut chez le fournisseur et l'applique |
| `download(id)` | `{ url, expiresAt }` signé, seulement si `unlocked` |
| `verifyDownloadToken(token)` | livrable complet si le jeton est valide et le livrable débloqué |
| `computeMetrics({ deliverables, journal, aiCostPerDeliverable? })` | taux de validation, de refus, marge, délais, échecs |

## Limites anti-abus

`limits.previewsPerOwnerPerDay` plafonne les aperçus gratuits par utilisateur
sur 24 h glissantes. Elle s'applique aux créations qui portent un `ownerId`
(identifiant opaque choisi par vous ; il n'est jamais renvoyé au client) et
lève `PreviewLimitError` (`code: "PREVIEW_LIMIT_REACHED"`, `retryAt`) **avant**
de générer l'aperçu. Le comptage n'est pas transactionnel : deux créations
simultanées peuvent dépasser la limite d'une unité.

## Erreurs

Toutes héritent de `PreviewPayError` et portent un `code` stable :
`DELIVERABLE_NOT_FOUND`, `INVALID_TRANSITION`, `CONFLICT`, `PAYMENT_REQUIRED`,
`INVALID_SIGNATURE`, `MISSING_PRICE`, `PREVIEW_LIMIT_REACHED`.

## Écrire un adaptateur

Implémentez `Storage` ou `PaymentProvider`, puis validez-le avec les suites de
contrat de [`@previewpay/testing`](../testing).
