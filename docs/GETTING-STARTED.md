# Démarrer avec PreviewPay

Ce guide branche PreviewPay sur une application NestJS + React en une
vingtaine de minutes. À la fin : votre agent IA produit un livrable, l'utilisateur
en voit un aperçu, paie en Mobile Money, puis télécharge la version complète.

> La démo `apps/` (« Valora CV ») suit exactement ce guide : c'est l'exemple de
> référence à lire en parallèle.

## 1. Installer

Serveur :

```sh
npm install @previewpay/core @previewpay/nestjs @previewpay/storage-prisma @prisma/client
# ou, sans NestJS : npm install @previewpay/core @previewpay/express express
npm install @previewpay/provider-mock        # développement / démo
npm install @previewpay/provider-fedapay     # paiement réel (sandbox puis live)
```

Client :

```sh
npm install @previewpay/react
```

Paquets compilés en ESM + CommonJS avec leurs types ; Node ≥ 20.

## 2. Base de données

Copiez les modèles `Deliverable`, `JournalEntry` et `PaymentEvent` de
`node_modules/@previewpay/storage-prisma/prisma/schema.prisma` dans votre
schéma Prisma (PostgreSQL), puis `npx prisma migrate dev --name previewpay`.

Pour un prototype, `@previewpay/storage-memory` suffit (rien à migrer).

## 3. Décrire l'aperçu

L'aperçu est **toujours** produit sur le serveur : le contenu complet ne doit
jamais partir vers le navigateur pour y être masqué.

```ts
import type { PreviewStrategy } from "@previewpay/core";

export const preview: PreviewStrategy = {
  async makePreview(content, { type }) {
    const text = String(content);
    // Assez pour juger la qualité, pas assez pour servir tel quel.
    return { type, text: text.slice(0, 400), truncated: text.length > 400, watermark: "APERÇU" };
  },
};
```

## 4. Brancher le module NestJS

```ts
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { PrismaClient } from "@prisma/client";
import { PreviewPayModule } from "@previewpay/nestjs";
import { createPrismaStorage } from "@previewpay/storage-prisma";
import { FedaPayProvider } from "@previewpay/provider-fedapay";
import { MockPaymentProvider } from "@previewpay/provider-mock";
import { preview } from "./preview";

const provider =
  process.env.PAYMENT_PROVIDER === "fedapay"
    ? new FedaPayProvider({
        secretKey: process.env.FEDAPAY_SECRET_KEY!,
        webhookSecret: process.env.FEDAPAY_WEBHOOK_SECRET!,
        environment: "sandbox",
      })
    : new MockPaymentProvider();

@Module({
  imports: [
    PreviewPayModule.forRoot({
      storage: createPrismaStorage(new PrismaClient()),
      provider,
      pricing: { cv: 200, presentation: 500 }, // entiers XOF, figés à la création
      preview,
      download: {
        secret: process.env.PREVIEWPAY_DOWNLOAD_SECRET!, // openssl rand -hex 32
        baseUrl: process.env.PREVIEWPAY_PUBLIC_URL!,
        ttlSeconds: 300,
      },
      internalApiKey: process.env.PREVIEWPAY_INTERNAL_KEY, // protège POST /deliverables
      maxRegenerations: 2,
      limits: { previewsPerOwnerPerDay: 5 },
    }),
  ],
  controllers: [ContentController], // voir l'étape 6
})
export class AppModule {}

// rawBody est obligatoire : la signature du webhook porte sur le corps brut.
const app = await NestFactory.create(AppModule, { rawBody: true });
await app.listen(3000);
```

Le module expose :

| Endpoint | Rôle |
| --- | --- |
| `POST /deliverables` | création par **votre serveur** (`x-internal-key`) |
| `GET /deliverables/:id` | statut, prix, aperçu — jamais le contenu |
| `POST /deliverables/:id/pay` | `{ phone, operator }` → `payment_pending` |
| `POST /deliverables/:id/reject` | régénère l'aperçu dans la limite, sinon clôt sans frais |
| `GET /deliverables/:id/download` | lien signé, `402` avant paiement |
| `POST /webhooks/fedapay` | événements du fournisseur, signature vérifiée |

### Vous utilisez Express plutôt que NestJS ?

`@previewpay/express` expose les mêmes endpoints :

```ts
import express from "express";
import { PreviewPay } from "@previewpay/core";
import { createPreviewPayRouter } from "@previewpay/express";

const previewPay = new PreviewPay({ storage, provider, pricing, preview, download, limits });
const app = express();
app.use(createPreviewPayRouter({
  previewPay,
  internalApiKey: process.env.PREVIEWPAY_INTERNAL_KEY,
  serveContent: (d, _req, res) => res.send(renderPdfOrHtml(d.content)), // remplace l'étape 6
}));
app.use(express.json()); // APRÈS le routeur : le webhook lit le corps brut
```

## 5. Créer un livrable depuis votre agent

Côté serveur, après la génération IA — en HTTP :

```ts
await fetch("http://localhost:3000/deliverables", {
  method: "POST",
  headers: { "content-type": "application/json", "x-internal-key": process.env.PREVIEWPAY_INTERNAL_KEY! },
  body: JSON.stringify({ type: "cv", content: generatedCv, ownerId: user.id }),
});
```

…ou directement en injectant le moteur dans un service Nest :

```ts
constructor(@Inject(PREVIEWPAY_ENGINE) private readonly previewPay: PreviewPay) {}
const d = await this.previewPay.create({ type: "cv", content: generatedCv, ownerId: user.id });
// renvoyer d.id au navigateur
```

## 6. Servir le contenu débloqué

Le lien signé pointe vers `/deliverables/:id/content?token=…`. Cette route vous
appartient (vous choisissez le format) et passe obligatoirement par
`verifyDownloadToken` :

```ts
@Controller("deliverables")
export class ContentController {
  constructor(@Inject(PREVIEWPAY_ENGINE) private readonly previewPay: PreviewPay) {}

  @Get(":id/content")
  @Header("cache-control", "no-store")
  async content(@Param("id") id: string, @Query("token") token: string) {
    const d = await this.previewPay.verifyDownloadToken(token);
    if (d.id !== id) throw new ForbiddenException();
    return renderPdfOrHtml(d.content);
  }
}
```

## 7. Afficher le paywall

```tsx
import { PreviewPaywall } from "@previewpay/react";

export function Livrable({ id }: { id: string }) {
  return (
    <PreviewPaywall
      deliverableId={id}
      options={{ baseUrl: "https://api.example.com" }}
      onUnlocked={({ downloadUrl }) => downloadUrl && window.open(downloadUrl)}
    />
  );
}
```

Servez-vous un seul pays ? `operators={MOBILE_MONEY_OPERATORS.filter((o) => o.country === "bj")}`.

Besoin d'une interface sur mesure ? `usePreviewPay(id)` donne `status`,
`preview`, `price`, `downloadUrl`, `pay(phone, operator)`, `reject(reason)`.

## 8. Passer au paiement réel

1. Compte FedaPay, clés **sandbox**, endpoint webhook (secret `wh_sandbox_…`).
2. URL publique HTTPS vers `POST /webhooks/fedapay` (tunnel en développement).
3. `PAYMENT_PROVIDER=fedapay`. Le déblocage reste revérifié par appel API.
4. Live : nouvelles clés et nouveau secret webhook, `environment: "live"`.

## Garanties

- Le contenu complet ne sort du serveur qu'après un paiement **vérifié**.
- Un webhook reçu deux fois ne débloque qu'une fois (idempotence en base).
- Un paiement refusé, annulé ou expiré ramène le livrable à l'aperçu, relançable.
- Un webhook perdu ne bloque pas le client : la lecture du livrable relit le
  statut chez le fournisseur (`reconcile`, activé par défaut).
- Prix figé à la création, journal append-only de chaque transition.

## Écrire votre propre adaptateur

Un autre stockage (MongoDB, DynamoDB…) ou un autre fournisseur (Kkiapay,
CinetPay…) : implémentez `Storage` / `PaymentProvider` du cœur, puis faites
passer les suites de contrat de `@previewpay/testing`.
