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

## Démarrage

```sh
pnpm install
pnpm test        # 147 tests, aucun accès réseau
pnpm typecheck
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

À définir (MIT ou Apache-2.0 — voir questions ouvertes du PRD).
