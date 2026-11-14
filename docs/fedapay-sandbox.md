# FedaPay — intégration sandbox (relevés réels)

Date du relevé : **14 nov. 2026**, compte sandbox `acc_2990265463`.
Tout ce qui suit a été observé, pas déduit de la documentation.

## Ce qui est en place

| Élément | Valeur |
| --- | --- |
| Compte sandbox | `acc_2990265463` |
| Clés API | générées le 14/11 12:10 — scopes **Transactions** uniquement |
| Endpoint webhook | id `5218`, **tous** les événements, `disable_on_error` **décoché** |
| URL de l'endpoint | `https://webhook.site/99b7cc13-…` (temporaire, voir plus bas) |
| Secret webhook | `wh_sandbox_…` → `FEDAPAY_WEBHOOK_SECRET` dans `.env` (hors git) |

Les clés et le secret vivent uniquement dans `.env` (ignoré par git) ; ils ne
sont pas dans ce document. Les clés API se régénèrent depuis
**Api → Regénérer les clés API** ; le secret du webhook depuis
**Webhooks → \<endpoint\> → Regénérer la clé secrète**.

> ⚠️ Le secret d'endpoint est propre à cet endpoint. Recréer l'endpoint (par
> exemple pour pointer vers le tunnel local) invalide le secret actuel.

## API — formes de réponse

1. `POST /v1/transactions` renvoie **une enveloppe** :

   ```json
   { "v1/transaction": { "id": 543440, "reference": "trx_…", "status": "pending" } }
   ```

   `@previewpay/provider-fedapay` déballe automatiquement cette enveloppe.

2. `POST /v1/transactions/{id}/token` renvoie `{ "token": "...", "url": "https://sandbox-process.fedapay.com/..." }`.
3. `GET /v1/transactions/{id}` renvoie `{ "v1/transaction": { … } }`.
4. `GET /v1/transactions` est **obsolète** : utiliser `/v1/transactions/search`.

## Webhook — schéma exact

En-tête :

```
x-fedapay-signature: t=1794654714,s=dd86f2e9…
```

Corps (extrait, schéma complet dans
`docs/samples/fedapay-transaction.created.json`) :

```json
{
  "name": "transaction.created",
  "object": "transaction",
  "entity": { "klass": "v1/transaction", "id": 543440, "status": "pending", … },
  "account": { … }
}
```

**Vérification de signature** (confirmée par calcul sur un événement réel) :

```
HMAC-SHA256(clé = secret de l'endpoint, message = "<t>.<corps brut>")  ==  s
```

Les variantes `HMAC(corps)` et `HMAC(<t> + <corps>)` sont **fausses** — le
point séparateur est obligatoire.

**Pas d'identifiant d'événement.** Le seul couple stable entre deux réémissions
est `(name, entity.id)` : `eventId = "${name}:${entity.id}"`. C'est la clé
d'idempotence utilisée par le SDK.

## Champs utiles pour PreviewPay

| Champ webhook | Usage |
| --- | --- |
| `entity.id` | identifiant de transaction = `paymentId` |
| `entity.status` | source de vérité à recouper par `GET /v1/transactions/{id}` |
| `entity.merchant_reference` | référence libre : on y met **l'id du livrable** |
| `entity.custom_metadata` | données non sensibles (ex. `deliverable_type`) |
| `entity.receipt_url` | reçu client, disponible après approbation |

## Événements observés / attendus

`transaction.created`, `.approved`, `.declined`, `.canceled`, `.transferred`.
Aucun événement documenté pour `expired` : la détection passe par
`getPaymentStatus`, ce que fait déjà `PreviewPay.syncPayment`.

## À faire pour recevoir les webhooks en local

L'URL de l'endpoint pointe aujourd'hui vers **webhook.site**, ce qui a permis de
relever le schéma sans serveur public. Pour brancher le SDK :

1. démarrer un tunnel HTTPS (`cloudflared tunnel --url http://localhost:3000` ou
   `ngrok http 3000`) ;
2. dans **Webhooks → endpoint 5218 → Modifier les détails**, remplacer l'URL par
   `https://<tunnel>/webhooks/fedapay` ;
3. garder `Désactiver la vérification SSL` **décoché** (TLS vérifié) et
   `Désactiver le webhook lorsque l'application génère des erreurs` **décoché**
   (sinon FedaPay coupe l'endpoint après 10 erreurs) ;
4. récupérer le nouveau secret si l'endpoint est recréé, et mettre à jour
   `FEDAPAY_WEBHOOK_SECRET`.

## Vérification exécutée

```sh
pnpm exec tsx --env-file=.env scripts/smoke-fedapay.ts
```

```
1. transaction créée : 543444
2. statut API        : pending
3. signature vérifiée : transaction.created → transaction 543444
4. corps altéré       : rejeté (attendu)
```

La transaction sandbox `543444` reste `pending` et expirera d'elle-même en 24 h.
