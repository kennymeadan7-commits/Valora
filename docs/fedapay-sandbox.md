# FedaPay — intégration sandbox (relevés réels)

Date du relevé : **14 nov. 2026**, compte sandbox `acc_2990265463`.
Tout ce qui suit a été observé, pas déduit de la documentation.

## Ce qui est en place

| Élément | Valeur |
| --- | --- |
| Compte sandbox | `acc_2990265463` |
| Clés API | générées le 14/11 12:10 — scopes **Transactions** uniquement |
| Endpoint webhook | id `5218`, **tous** les événements, `disable_on_error` **décoché** |
| URL de l'endpoint | `https://<tunnel>/webhooks/fedapay` (tunnel cloudflared, voir plus bas) |
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

## Tunnel HTTPS et endpoint réellement branché

```sh
cloudflared tunnel --url http://localhost:3000 --no-autoupdate
# → https://<adjectif>-<mot>-<mot>.trycloudflare.com
```

L'endpoint **5218** a été repointé vers
`https://label-none-elect-dis.trycloudflare.com/webhooks/fedapay`
(Webhooks → 5218 → Modifier les détails). Le secret `wh_sandbox_…` n'a **pas**
changé : les événements réels suivants ont été acceptés par la vérification de
signature, ce qui le prouve.

⚠️ Un quick tunnel cloudflared est éphémère : l'URL change à chaque
redémarrage. Il faut alors re-pointer l'endpoint et redémarrer l'API.

Réglages de l'endpoint : `Désactiver la vérification SSL` **décoché** (TLS
vérifié), `Désactiver le webhook lorsque l'application génère des erreurs`
**décoché** (sinon FedaPay coupe l'endpoint après 10 erreurs).

### Chaîne réelle vérifiée

Événements livrés par FedaPay par le tunnel, horodatés en base :

```
             id              |         receivedAt
 transaction.created:543515  | 2026-11-14 11:57:12.829+00
 transaction.declined:543515 | 2026-11-14 11:57:14.705+00
 transaction.created:543513  | 2026-11-14 11:57:10.047+00
 transaction.declined:543513 | 2026-11-14 11:57:11.957+00
 transaction.created:543511  | 2026-11-14 11:56:08.188+00
 transaction.declined:543511  | 2026-11-14 11:56:10.908+00
```

Transition appliquée par le SDK (`storage-prisma`) :

```
        from        |        to
--------------------+------------------
 draft              | previewed
 previewed          | payment_pending
 payment_pending    | previewed      ← webhook:transaction.declined
```

**Anti-falsification** : un webhook `transaction.approved` signé avec le vrai
secret de l'endpoint est accepté (HTTP 200) mais **ne débloque pas** le
livrable, parce que le SDK revérifie le statut par appel API et obtient
`declined`. C'est exactement la règle « le webhook seul ne suffit pas ».

## Bloquant actuel : la sandbox refuse tous les paiements

Le compte sandbox `acc_2990265463` décline **tous** les paiements `momo_test`,
même les numéros documentés comme réussis :

| Tentative | Montant | Numéro | Résultat |
| --- | --- | --- | --- |
| page de paiement | 200 | +22990000000 | `declined` |
| page de paiement | 200 | 64000001 | `declined` |
| API directe `/v1/momo_test` | 208 | 64000001 | `declined` |
| API directe | 208 | 66000001 | `declined` |
| API directe | 208 | +22964000001 | `declined` |
| API directe | 1008 | 64000001 | `declined` |
| API directe | 5008 | 64000001 | `declined` |

### Ce qui a été vérifié dans le tableau de bord (et qui n'est PAS le problème)

| Vérification | Résultat |
| --- | --- |
| Statut du compte (`/get-started`) | « Votre compte est déjà activé » |
| Canaux de paiement (`/settings/preferences?tab=payment_channels`) | `Momo Test`, Moov CI, Wave CI, Orange CI : **tous cochés** |
| Type de compte actif (`/settings/account`) | `account.null` — champ en lecture seule, non modifiable |
| Comptes Mobiles (`/settings/mobile-accounts`) | **aucun compte** enregistré (« Ajouter un compte mobile ») |
| Ouverture du formulaire « Ajouter un compte mobile » | **HTTP 500** sur `GET https://sandbox-api.fedapay.com/v1/mobile_accounts?locale=fr` |

Le 500 tombe sur la simple **lecture** de la liste des comptes mobiles, pas sur
l'enregistrement : l'endpoint est cassé pour ce compte, aucune action dans
l'interface ne peut le réparer.

Il n'y a donc **aucun interrupteur d'activation** à basculer : la sandbox est
bien active, c'est le simulateur `momo_test` qui refuse les paiements.

Deux hypothèses restantes, toutes deux hors de portée du code :

1. **Compte mobile de règlement manquant** — impossible à enregistrer sans
   recevoir un SMS sur un vrai numéro (action utilisateur).
2. **Provisionnement du compte** (`account.null` en lecture seule, 404 sur
   `/v1/whitelisted_ips`) — relève du support FedaPay.

**Action requise (utilisateur)** : enregistrer un compte mobile avec son propre
numéro (réception du SMS), ou demander au support FedaPay pourquoi
`account.null` et pourquoi `momo_test` décline les numéros de test documentés.
Dès que c'est le cas, la preuve est immédiate :

```sh
curl -s -X POST http://localhost:3000/demo/cv   -H 'content-type: application/json'   -d '{"fullName":"Preuve","headline":"Approbation sandbox"}'
# puis /pay avec le numéro 64000001, puis payer sur la page FedaPay
```

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
