# @previewpay/express

Routeur [Express](https://expressjs.com) (4 et 5) de [PreviewPay](../core) :
les mêmes six endpoints et les mêmes garanties que
[`@previewpay/nestjs`](../nestjs), sans NestJS. Le paywall
[`@previewpay/react`](../react) fonctionne à l'identique avec l'un ou l'autre.

```sh
npm install @previewpay/express @previewpay/core express
```

## Brancher

```ts
import express from "express";
import { PreviewPay } from "@previewpay/core";
import { createPreviewPayRouter } from "@previewpay/express";
import { createPrismaStorage } from "@previewpay/storage-prisma";
import { FedaPayProvider } from "@previewpay/provider-fedapay";

const previewPay = new PreviewPay({
  storage: createPrismaStorage(),
  provider: new FedaPayProvider({
    secretKey: process.env.FEDAPAY_SECRET_KEY!,
    webhookSecret: process.env.FEDAPAY_WEBHOOK_SECRET!,
  }),
  pricing: { cv: 200 },
  preview: myPreviewStrategy, // aperçu produit côté serveur
  download: { secret: process.env.PREVIEWPAY_DOWNLOAD_SECRET!, baseUrl: "https://api.example.com" },
  limits: { previewsPerOwnerPerDay: 5 },
});

const app = express();

// ⚠️ Montez le routeur AVANT express.json() : le webhook a besoin du corps brut.
app.use(
  createPreviewPayRouter({
    previewPay,
    internalApiKey: process.env.PREVIEWPAY_INTERNAL_KEY, // protège POST /deliverables
    serveContent: (deliverable, _req, res) => {
      // Appelé seulement après vérification du jeton signé et de l'identifiant.
      res.type("application/pdf").send(renderPdf(deliverable.content));
    },
  }),
);

app.use(express.json()); // le reste de votre application
app.listen(3000);
```

Le moteur reste accessible directement : `await previewPay.create({ type, content, ownerId })`
depuis le code de votre agent, sans passer par HTTP.

## Endpoints

```
POST   /deliverables                création côté serveur (x-internal-key)
GET    /deliverables/:id            statut, prix, aperçu — jamais le contenu
POST   /deliverables/:id/pay        { phone, operator } → payment_pending
POST   /deliverables/:id/reject     { reason } → régénère, sinon rejette
GET    /deliverables/:id/download   lien signé, 402 avant paiement
POST   /webhooks/fedapay            signature vérifiée sur le corps brut
GET    /deliverables/:id/content    seulement si `serveContent` est fourni
```

## Options

| Option | Rôle | Défaut |
| --- | --- | --- |
| `previewPay` | moteur `PreviewPay` du cœur | requis |
| `internalApiKey` | garde `x-internal-key` sur la création | désactivée |
| `rateLimit` | `{ max, windowMs }` sur `/pay`, ou `false` | `{ max: 5, windowMs: 60000 }` |
| `webhookPath` | chemin du webhook | `/webhooks/fedapay` |
| `serveContent` | `(deliverable, req, res)` : sert le contenu débloqué | route absente |
| `jsonLimit` | taille max des corps | `1mb` |

Les options métier (prix, limites d'aperçus, réconciliation des paiements en
attente, régénérations) se règlent sur le moteur `PreviewPay`.

## Corps brut du webhook

Le routeur installe `express.raw()` sur la route du webhook. Si votre
application monte `express.json()` **avant** le routeur, le corps est déjà
consommé : le webhook répond `500 RAW_BODY_UNAVAILABLE` avec la marche à suivre.
Deux solutions : monter le routeur avant `express.json()`, ou conserver le corps
brut :

```ts
app.use(express.json({ verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));
```

## Erreurs

Réponses JSON `{ statusCode, code, message }`, identiques au module NestJS :
404 `DELIVERABLE_NOT_FOUND`, 409 `INVALID_TRANSITION` / `CONFLICT`,
402 `PAYMENT_REQUIRED`, 400 `INVALID_SIGNATURE` / `BAD_REQUEST`,
401 `INVALID_INTERNAL_KEY`, 429 `RATE_LIMITED` / `PREVIEW_LIMIT_REACHED`
(avec `Retry-After`), 500 sinon.

La limitation de débit est en mémoire : sur plusieurs instances, placez un
limiteur partagé devant le routeur.
