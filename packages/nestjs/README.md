# @previewpay/nestjs

Module NestJS de PreviewPay : six endpoints HTTP qui **enveloppent** le cœur
(`@previewpay/core`). Aucune règle métier n'est réécrite ici — transitions,
prix figé, idempotence, signature et liens signés viennent tous du cœur.

```
POST   /deliverables                création côté serveur (garde `x-internal-key`)
GET    /deliverables/:id            statut, prix, aperçu — jamais le contenu
POST   /deliverables/:id/pay        { phone, operator } → payment_pending
POST   /deliverables/:id/reject     { reason } → régénère, sinon rejette
GET    /deliverables/:id/download   402 tant que l'état n'est pas `unlocked`
POST   /webhooks/fedapay            signature vérifiée sur le corps brut
```

## Branchement

```ts
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { PreviewPayModule } from "@previewpay/nestjs";
import { MemoryStorage } from "@previewpay/storage-memory";
import { MockPaymentProvider } from "@previewpay/provider-mock";

@Module({
  imports: [
    PreviewPayModule.forRoot({
      storage: new MemoryStorage(), // storage-prisma en production
      provider: new MockPaymentProvider(), // provider-fedapay en sandbox
      pricing: { cv: 200 },
      preview: myPreviewStrategy,
      // secret et base d'URL des liens signés — jamais en dur
      download: {
        secret: process.env.PREVIEWPAY_DOWNLOAD_SECRET!,
        baseUrl: process.env.PREVIEWPAY_DOWNLOAD_BASE_URL!,
        ttlSeconds: 300,
      },
      // garde de POST /deliverables (désactivée si absente)
      internalApiKey: process.env.PREVIEWPAY_INTERNAL_KEY,
      // limitation de débit sur /pay : 5 tentatives / minute par défaut
      rateLimit: { max: 5, windowMs: 60_000 },
    }),
  ],
})
export class AppModule {}

// ⚠️ rawBody est OBLIGATOIRE : la signature du webhook porte sur le corps brut.
await NestFactory.create(AppModule, { rawBody: true });
```

### `rawBody: true` — pourquoi c'est non négociable

FedaPay signe `HMAC-SHA256(secret, "<t>.<corps brut>")`. Un corps JSON
re-sérialisé par Express (espaces, ordre des clés, échappements) ne produit plus
le même HMAC : la signature serait rejetée pour tous les webhooks légitimes.
Le contrôleur lit `req.rawBody`, que Nest renseigne uniquement quand
l'application est créée avec `{ rawBody: true }`. Sans cette option, le webhook
répond 500 avec un message explicite.

## Options

| Option | Rôle | Défaut |
| --- | --- | --- |
| `storage` | `Storage` du cœur | requis |
| `provider` | `PaymentProvider` du cœur | requis |
| `pricing` | grille `type → prix entier XOF` | requis |
| `preview` | `PreviewStrategy` (aperçu produit côté serveur) | requis |
| `download.secret` | secret HMAC des liens signés | `PREVIEWPAY_DOWNLOAD_SECRET`, sinon démarrage refusé |
| `download.baseUrl` | préfixe des URLs de téléchargement | `PREVIEWPAY_DOWNLOAD_BASE_URL` |
| `download.ttlSeconds` | durée de vie du lien | 300 s (cœur) |
| `maxRegenerations` | régénérations après refus | 2 (cœur) |
| `internalApiKey` | active la garde `x-internal-key` | désactivée |
| `rateLimit` | `{ max, windowMs }` ou `false` | `{ max: 5, windowMs: 60000 }` |
| `now`, `generateId` | horloge / générateur d'id (tests) | cœur |

Les erreurs de configuration (option manquante, secret absent, `rateLimit.max`
invalide) sont levées **au démarrage**, pas à la première requête.

## Erreurs du cœur → HTTP

| Erreur | HTTP | `code` |
| --- | --- | --- |
| `DeliverableNotFoundError` | 404 | `DELIVERABLE_NOT_FOUND` |
| `InvalidTransitionError` | 409 | `INVALID_TRANSITION` |
| `ConflictError` | 409 | `CONFLICT` |
| `PaymentRequiredError` | 402 | `PAYMENT_REQUIRED` |
| `InvalidSignatureError` | 400 | `INVALID_SIGNATURE` |
| autre erreur du cœur (`MissingPriceError`, …) | 500 | code du cœur |
| erreur inattendue | 500 | `INTERNAL_ERROR` |

Corps : `{ "statusCode": 402, "code": "PAYMENT_REQUIRED", "message": "…" }`
(messages en français). `MissingPriceError` reste un 500 : une grille `pricing`
incomplète est un défaut de configuration serveur, pas une faute du client.

Le filtre est installé via `APP_FILTER` par le module : il s'applique à toute
l'application, y compris aux routes de l'hôte.

## Sécurité

- **Le contenu complet ne sort jamais.** `GET /deliverables/:id` renvoie
  `PublicDeliverable` (statut, prix, aperçu), type qui ne possède pas de champ
  `content`. L'aperçu est fabriqué côté serveur par la `PreviewStrategy`.
- **Création serveur uniquement.** `POST /deliverables` exige `x-internal-key`
  dès que `internalApiKey` est configurée (comparaison à temps constant). La
  laisser vide revient à exposer la création à tout porteur d'une URL : à
  réserver au développement local.
- **Téléchargement.** `GET /deliverables/:id/download` renvoie `{ url, expiresAt }`
  — lien HMAC signé, TTL court, généré par le cœur et uniquement pour un
  livrable `unlocked` (402 sinon).
- **Webhook.** Signature vérifiée sur le corps brut par le `PaymentProvider` ;
  un doublon est acquitté en 200 sans effet de bord (idempotence du cœur). Un
  `approved` ne suffit pas : le cœur revérifie le statut par appel API.
- **Limitation de débit** sur `/pay`, par couple (IP, livrable). Implémentation
  en mémoire : sur plusieurs instances, la remplacer par un limiteur partagé.
- **Secrets.** Aucune clé n'est attendue dans le code : `download.secret` et la
  clé FedaPay vivent en variables d'environnement.

## Détails d'implémentation utiles à l'hôte

- L'injection utilise des jetons explicites (`PREVIEWPAY_ENGINE`,
  `PREVIEWPAY_OPTIONS`) avec `@Inject(...)` et **non** `emitDecoratorMetadata` :
  esbuild (donc Vitest) ne l'émet pas, et un module qui ne fonctionne qu'après
  `tsc` serait intestable. `experimentalDecorators` reste nécessaire.
- `PreviewPay` (classe du cœur) est aussi exposé comme jeton, et le module
  exporte `PREVIEWPAY_ENGINE`, `PREVIEWPAY_OPTIONS` et `PreviewPay` : un service
  de l'hôte peut injecter le moteur sans repasser par HTTP.
- Aucun décorateur de validation n'est requis (`class-validator` absent) : les
  corps sont validés à la main, les messages sont en français.

## Tests

```sh
pnpm test        # Vitest, via @nestjs/testing + supertest, sans réseau
pnpm typecheck
```

Les tests montent une vraie application Express avec `rawBody: true`,
`MemoryStorage` et `MockPaymentProvider` (webhooks signés en HMAC) : cycle
complet, 402 avant paiement, doublon de webhook, signature invalide, corps
altéré, fuite de contenu, garde `x-internal-key`, limitation de débit, refus et
régénération.
