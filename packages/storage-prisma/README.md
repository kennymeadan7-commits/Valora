# @previewpay/storage-prisma

`Storage` PostgreSQL pour [PreviewPay](../core), via Prisma. Deux garanties
portées par la base : transition conditionnelle atomique
(`UPDATE … WHERE state = from` + journal dans la même transaction) et
idempotence des webhooks par clé primaire sur l'identifiant d'événement.

```sh
npm install @previewpay/core @previewpay/storage-prisma @prisma/client
npm install -D prisma
```

## 1. Ajouter les modèles à votre schéma

Le paquet utilise **votre** client Prisma. Copiez les trois modèles
(`Deliverable`, `JournalEntry`, `PaymentEvent`) de
`node_modules/@previewpay/storage-prisma/prisma/schema.prisma` dans votre
`schema.prisma` (PostgreSQL), puis :

```sh
npx prisma migrate dev --name previewpay
```

Si votre base est dédiée à PreviewPay, vous pouvez aussi appliquer directement
les migrations fournies :

```sh
npx prisma migrate deploy --schema node_modules/@previewpay/storage-prisma/prisma/schema.prisma
```

## 2. Brancher

```ts
import { PrismaClient } from "@prisma/client";
import { createPrismaStorage } from "@previewpay/storage-prisma";

const storage = createPrismaStorage(new PrismaClient());
// … new PreviewPay({ storage, … })
```

`content` est stocké en `JSONB` et ne sort de l'adaptateur que dans un
`Deliverable` (jamais dans le journal ni les événements). Les dates sont des
`TIMESTAMPTZ(3)`. L'index `(ownerId, createdAt)` sert la limite d'aperçus par
utilisateur.
