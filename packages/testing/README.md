# @previewpay/testing

Suites de contrat [Vitest](https://vitest.dev) pour valider un adaptateur
[PreviewPay](../core). Toute implémentation de `Storage` ou de
`PaymentProvider` doit les passer — ce sont elles qui garantissent les
invariants (transitions atomiques, journal append-only, idempotence, signature).

```sh
npm install -D @previewpay/testing @previewpay/core vitest
```

## Storage

```ts
// storage.contract.test.ts
import { describeStorageContract } from "@previewpay/testing";
import { MyStorage } from "../src/my-storage";

describeStorageContract({
  create: async () => {
    const storage = new MyStorage(/* base vide */);
    await storage.truncateAll();
    return storage;
  },
});
```

## PaymentProvider

```ts
import { describePaymentProviderContract } from "@previewpay/testing";
import { MyProvider } from "../src/my-provider";

describePaymentProviderContract({
  create: () => new MyProvider({ secret: "test" }),
  simulate: (provider) => ({
    setStatus: (paymentId, status) => (provider as MyProvider).forceStatus(paymentId, status),
    webhook: (paymentId, options) => (provider as MyProvider).signedWebhook(paymentId, options),
  }),
});
```

`makeDeliverable(overrides)` fournit un livrable de référence pour vos propres
tests.
