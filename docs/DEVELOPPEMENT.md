# Développer PreviewPay

Documentation technique du dépôt : paquets, commandes, structure et état
d'avancement. Pour intégrer le SDK dans une application, voir
[GETTING-STARTED.md](GETTING-STARTED.md).

## État

| Jalon | Contenu | État |
| --- | --- | --- |
| 1 | Cœur TypeScript testé sans réseau | ✅ |
| 2 | Storage PostgreSQL + API NestJS | ✅ Prisma + module NestJS + app de démo (`STORAGE=prisma`) |
| 3 | FedaPay sandbox + webhooks | adaptateur et webhooks réels validés ; déblocage de bout en bout en attente du retour de la sandbox FedaPay |
| 4 | Paywall React + démo CV | ✅ démo « Valora CV » : import PDF, aperçu A4 caviardé, Mobile Money simulé, PDF final |
| — | SDK livrable | ✅ 9 paquets 0.1.0 (ESM, CJS, types), routeur Express, réconciliation, limite d'aperçus ; pas encore publié sur npm |

## Utiliser le SDK

| Paquet | Rôle |
| --- | --- |
| [`@previewpay/core`](../packages/core) | machine à états, moteur, interfaces — zéro framework |
| [`@previewpay/nestjs`](../packages/nestjs) | `PreviewPayModule` + 6 endpoints |
| [`@previewpay/express`](../packages/express) | les mêmes 6 endpoints en routeur Express (4 et 5) |
| [`@previewpay/react`](../packages/react) | `usePreviewPay` + `<PreviewPaywall />` |
| [`@previewpay/storage-prisma`](../packages/storage-prisma) | stockage PostgreSQL |
| [`@previewpay/storage-memory`](../packages/storage-memory) | stockage en mémoire (tests, démo) |
| [`@previewpay/provider-fedapay`](../packages/provider-fedapay) | Mobile Money via FedaPay |
| [`@previewpay/provider-mock`](../packages/provider-mock) | paiement simulé |
| [`@previewpay/testing`](../packages/testing) | suites de contrat pour adaptateurs |

Guide pas à pas : **[GETTING-STARTED.md](GETTING-STARTED.md)**.

Version `0.1.0`, ESM + CommonJS + types, Node ≥ 20, licence MIT. Rien n'est
encore publié sur npm.

## Développer

```sh
pnpm install
pnpm test            # Vitest, aucun accès réseau
pnpm typecheck
pnpm build           # dist/ de chaque paquet (ESM, CJS, .d.ts)
pnpm pack:check      # tarballs + contrôle de ce qui serait publié
pnpm consumer:check  # installe les tarballs dans un projet vierge et les exerce
```

## Structure

```
packages/
  core/              # machine à états, interfaces, moteur — zéro framework
  storage-memory/    # Storage en mémoire
  provider-mock/     # PaymentProvider simulé (webhooks signés)
  storage-prisma/    # Storage PostgreSQL (Prisma)
  provider-fedapay/  # PaymentProvider FedaPay sandbox
  testing/           # suite de contrat d'adaptateur
  nestjs/            # PreviewPayModule + 6 endpoints
  express/           # routeur Express (mêmes endpoints, sans Nest)
  react/             # usePreviewPay + paywall
apps/
  api/               # démo NestJS
  web/               # démo React + Vite
```

## La machine à états

```
draft ──> previewed ──pay──> payment_pending ──approved──> unlocked
              │                     │
           reject          declined / canceled / expired
              │                     │
              v                     └──> previewed (relançable)
          rejected
```

## Documentation

- `docs/PRD — PreviewPay SDK …md` — spécification complète
- `docs/DECISIONS.md` — journal des décisions et points ouverts
- `docs/ROADMAP.md` — jalons et ce qui reste à faire
- `docs/DEMO.md` — lancer la démo API + interface
- `docs/fedapay-sandbox.md` — relevés réels de l'intégration FedaPay
- `AGENTS.md` — conventions de code et répartition entre agents

## Licence

[MIT](../LICENSE). Chaque paquet publié embarque sa copie du fichier `LICENSE`
(`pnpm pack:check --strict` le vérifie).
