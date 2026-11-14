# Valora / PreviewPay

> **Aperçu puis paiement.** Un livrable généré par une IA se prévisualise, se
> paie en Mobile Money (100–500 F XOF), puis se débloque. SDK open source pour
> les développeurs qui construisent des outils IA sur les marchés à faible
> pouvoir d'achat.

## Le problème

Les outils IA facturent un abonnement mensuel fixe, souvent en dollars : on paie
avant de savoir si l'outil sert, sans carte internationale, et le forfait pèse
lourd pour un usage occasionnel. PreviewPay inverse la logique : **on voit
d'abord, on paie le livrable, pas le mois**.

## État

| Jalon | Contenu | État |
| --- | --- | --- |
| 1 | Cœur TypeScript testé sans réseau | ✅ |
| 2 | Storage PostgreSQL + API NestJS | ✅ Prisma + module NestJS + app de démo (`STORAGE=prisma`) |
| 3 | FedaPay sandbox + webhooks | provider + sandbox validés, endpoint à rebrancher sur un tunnel |
| 4 | Paywall React + démo CV | ✅ démo « Valora CV » : import PDF, aperçu A4 caviardé, Mobile Money simulé, PDF final |

## Utiliser le SDK

| Paquet | Rôle |
| --- | --- |
| [`@previewpay/core`](packages/core) | machine à états, moteur, interfaces — zéro framework |
| [`@previewpay/nestjs`](packages/nestjs) | `PreviewPayModule` + 6 endpoints |
| [`@previewpay/react`](packages/react) | `usePreviewPay` + `<PreviewPaywall />` |
| [`@previewpay/storage-prisma`](packages/storage-prisma) | stockage PostgreSQL |
| [`@previewpay/storage-memory`](packages/storage-memory) | stockage en mémoire (tests, démo) |
| [`@previewpay/provider-fedapay`](packages/provider-fedapay) | Mobile Money via FedaPay |
| [`@previewpay/provider-mock`](packages/provider-mock) | paiement simulé |
| [`@previewpay/testing`](packages/testing) | suites de contrat pour adaptateurs |

Guide pas à pas : **[docs/GETTING-STARTED.md](docs/GETTING-STARTED.md)**.

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

[MIT](LICENSE). Chaque paquet publié embarque sa copie du fichier `LICENSE`
(`pnpm pack:check --strict` le vérifie).
