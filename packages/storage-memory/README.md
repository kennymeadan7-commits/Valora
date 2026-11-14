# @previewpay/storage-memory

`Storage` en mémoire pour [PreviewPay](../core) : tests, démos et
implémentation de référence du contrat. Les données disparaissent à l'arrêt du
processus — utilisez [`@previewpay/storage-prisma`](../storage-prisma) en production.

```sh
npm install @previewpay/core @previewpay/storage-memory
```

```ts
import { MemoryStorage } from "@previewpay/storage-memory";

const storage = new MemoryStorage();
// … new PreviewPay({ storage, … })

storage.reset(); // vide tout, pratique entre deux tests
```

Les transitions sont atomiques vis-à-vis de la boucle d'événements (vérification
et écriture dans le même tick). Les objets renvoyés sont des copies : les
modifier n'altère pas le stock.
