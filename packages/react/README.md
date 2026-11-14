# @previewpay/react

Côté navigateur de [PreviewPay](../core) : un hook et un paywall prêt à
l'emploi qui parlent aux endpoints de [`@previewpay/nestjs`](../nestjs) (ou de
toute API compatible). Aucune décision métier ici : état, prix et aperçu
viennent du serveur, et le contenu complet n'est jamais téléchargé avant
déblocage.

```sh
npm install @previewpay/react @previewpay/core react
```

## Composant

```tsx
import { PreviewPaywall } from "@previewpay/react";

<PreviewPaywall
  deliverableId={id}
  className="mon-paywall"                       // styles libres, aucun CSS imposé
  renderPreview={(preview) => <MonApercu data={preview} />}
  onUnlocked={({ downloadUrl }) => console.log(downloadUrl)}
  options={{ baseUrl: "https://api.example.com", pollIntervalMs: 3000 }}
/>
```

Opérateurs : par défaut les quatre modes directs FedaPay (MTN Bénin, Moov
Bénin, Moov Togo, MTN Côte d'Ivoire). Restreignez la liste aux pays que vous
servez :

```tsx
import { MOBILE_MONEY_OPERATORS } from "@previewpay/react";

<PreviewPaywall
  deliverableId={id}
  operators={MOBILE_MONEY_OPERATORS.filter((o) => o.country === "bj")}
  defaultOperator="moov_benin"
/>
```

Il gère : aperçu + prix, saisie du numéro et de l'opérateur, paiement en
attente (scrutation), échec / expiration avec relance, refus de l'aperçu,
déblocage avec lien de téléchargement.

## Hook

```tsx
import { usePreviewPay, formatPrice } from "@previewpay/react";

const { status, preview, price, downloadUrl, error, loading, pay, reject, refresh } =
  usePreviewPay(deliverableId, { baseUrl: "", pollIntervalMs: 3000 });

await pay("+22997000000", "mtn_benin");
await reject("pas convaincu");
formatPrice(price); // « 200 F CFA »
```

`status` suit la machine à états du cœur (`previewed`, `payment_pending`,
`unlocked`, `rejected`). La scrutation ne tourne que pendant `payment_pending`.

| Option | Rôle | Défaut |
| --- | --- | --- |
| `baseUrl` | préfixe de l'API | même origine |
| `pollIntervalMs` | intervalle pendant `payment_pending` (`0` = off) | 3000 |
| `fetchImpl` | `fetch` injecté (tests, SSR) | `globalThis.fetch` |
| `internalKey` | en-tête `x-internal-key` | — |

Exports utiles : `MOBILE_MONEY_OPERATORS` (`value`, `label`, `country`,
`dialCode`), `DEFAULT_OPERATOR`, `previewText`.
