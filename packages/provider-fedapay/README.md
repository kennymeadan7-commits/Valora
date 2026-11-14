# @previewpay/provider-fedapay

`PaymentProvider` [FedaPay](https://fedapay.com) pour [PreviewPay](../core) :
transactions en XOF, paiement Mobile Money direct (MTN, Moov Bénin) ou page de
paiement en repli, webhooks vérifiés sur le corps brut.

```sh
npm install @previewpay/core @previewpay/provider-fedapay
```

```ts
import { FedaPayProvider } from "@previewpay/provider-fedapay";

const provider = new FedaPayProvider({
  secretKey: process.env.FEDAPAY_SECRET_KEY!,         // sk_sandbox_… / sk_live_…
  webhookSecret: process.env.FEDAPAY_WEBHOOK_SECRET!, // wh_sandbox_… (propre à l'endpoint)
  environment: "sandbox",                              // "live" pour l'argent réel
  callbackUrl: process.env.FEDAPAY_CALLBACK_URL,
  phoneCountry: "bj",
});
```

| Option | Rôle | Défaut |
| --- | --- | --- |
| `secretKey` | clé API FedaPay (serveur uniquement) | requis |
| `webhookSecret` | secret de l'endpoint webhook | requis |
| `environment` | `sandbox` ou `live` | `sandbox` |
| `callbackUrl` | retour après la page de paiement | — |
| `phoneCountry` | pays du numéro client | `bj` |
| `description` | libellé de la transaction | `PreviewPay <id du livrable>` |
| `toleranceSeconds` | fenêtre anti-rejeu du webhook (s) | 300 |

## Points importants

- **Corps brut obligatoire** : la signature `X-FEDAPAY-SIGNATURE`
  (`t=…,s=…`, HMAC-SHA256 de `"<t>.<corps brut>"`) ne se vérifie pas sur un JSON
  re-sérialisé. Avec NestJS : `NestFactory.create(AppModule, { rawBody: true })`.
- **Un webhook ne débloque jamais seul** : le cœur relit la transaction
  (`GET /v1/transactions/:id`) avant de passer à `unlocked`.
- `eventId = "<name>:<entity.id>"` (FedaPay n'envoie pas d'identifiant
  d'événement) ; `merchant_reference` = id du livrable.
- Correspondance des statuts : `approved` / `transferred` → débloqué ;
  `declined`, `canceled`, `expired` → relançable. `refunded` est provisoirement
  traité comme `approved` (question ouverte).
- Les webhooks exigent une URL HTTPS publique (un tunnel en développement).

État : adaptateur testé contre des réponses et webhooks sandbox réels ; le
déblocage de bout en bout en sandbox reste à rejouer quand le compte sandbox
FedaPay sera de nouveau opérationnel.
