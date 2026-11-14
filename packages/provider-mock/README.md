# @previewpay/provider-mock

`PaymentProvider` simulé pour [PreviewPay](../core) : aucun réseau, statuts
pilotables, webhooks signés en HMAC-SHA256 comme un vrai fournisseur. Pour les
tests et les démos (simulateur Mobile Money), jamais pour encaisser.

```sh
npm install @previewpay/core @previewpay/provider-mock
```

```ts
import { MockPaymentProvider } from "@previewpay/provider-mock";

const provider = new MockPaymentProvider({ secret: process.env.MOCK_WEBHOOK_SECRET });

// Après previewPay.pay(id, …), le livrable porte un paymentId (« mock_pay_1 »…).
provider.setStatus(paymentId, "approved"); // ou declined / canceled / expired

// Soit on rejoue un webhook signé…
const { rawBody, headers } = provider.buildWebhook(paymentId);
await previewPay.handleWebhook(rawBody, headers);
// …soit on réconcilie directement par appel « API ».
await previewPay.syncPayment(deliverableId);
```

Le déblocage suit exactement le même chemin qu'avec FedaPay : le cœur relit
toujours `getPaymentStatus` avant de passer à `unlocked`.

| Méthode | Rôle |
| --- | --- |
| `setStatus(paymentId, status)` | fixe ce que renverra `getPaymentStatus` |
| `buildWebhook(paymentId, { status?, eventId? })` | corps brut + en-tête `x-mock-signature` |
| `getPaymentInput(paymentId)` | montant, téléphone, opérateur reçus |
