# AGENTS.md — Valora / PreviewPay

SDK open source de facturation différée : on **aperçoit** un livrable généré par
une IA, on **paie** en Mobile Money (100–500 F XOF), on **débloque** le contenu.
Sources de vérité : `docs/PRD — PreviewPay SDK …md` puis `docs/DECISIONS.md`.

## État du projet

Jalon 1 en cours : cœur TypeScript testé sans réseau (`@previewpay/core`,
`storage-memory`, `provider-mock`). Les autres paquets sont encore des squelettes.

## Arborescence cible (monorepo pnpm)

```
packages/
  core/              # machine à états, interfaces, moteur — ZÉRO framework
  storage-memory/    # Storage en mémoire (tests, démo)
  storage-prisma/    # Storage PostgreSQL
  provider-mock/     # PaymentProvider simulé
  provider-fedapay/  # PaymentProvider FedaPay sandbox
  testing/           # suite de contrat commune aux adaptateurs
  nestjs/            # PreviewPayModule + 6 endpoints
  react/             # usePreviewPay + <PreviewPaywall />
apps/
  api/               # démo NestJS (rawBody: true)
  web/               # démo React + Vite (CV → aperçu → paiement → download)
```

Les flèches de dépendance vont **vers le cœur**, jamais l'inverse.

## Commandes

```sh
pnpm install
pnpm test           # Vitest, aucun accès réseau
pnpm typecheck      # tsc --noEmit sur tous les paquets
pnpm dev            # apps/api + apps/web (après jalon 2)
```

## Règles invariantes

1. **Le contenu complet ne quitte jamais le serveur** avant `unlocked`. Aucune
   réponse d'API ne contient le contenu ; seulement `preview`.
2. **Transitions atomiques** : `transition(id, from, to)` n'applique que si
   l'état courant vaut `from`, sinon `false`. Chaque transition acceptée écrit
   une entrée de journal append-only (from, to, at, cause, eventId/paymentId).
3. **Idempotence** : `recordEvent` renvoie `false` pour un événement déjà vu ;
   le doublon est acquitté en 200 sans effet de bord.
4. **Déblocage vérifié** : un webhook `approved` ne suffit pas ; on revérifie
   par `getPaymentStatus` avant de passer à `unlocked`.
5. **Prix figé** à la création (entier XOF), stocké sur le livrable.
6. **Aperçu produit côté serveur** par `PreviewStrategy` ; jamais masqué côté
   client.
7. Secrets uniquement en variables d'environnement. `.env` est ignoré par git.

## Machine à états (5 états)

```
draft ──previewed──> previewed ──pay──> payment_pending ──approved──> unlocked
                          │                    │
                       reject              declined / canceled / expired
                          │                    │
                          ▼                    └──> previewed (relançable)
                      rejected  (régénération bornée)
```

`expired` n'est pas un état du livrable : c'est un statut d'essai de paiement,
détecté par appel API, qui ramène le livrable à `previewed` (voir
`docs/DECISIONS.md`).

## Convention de commit

`type(scope): sujet` en français, ex. `feat(core): transition atomique`.
Un commit = un changement cohérent. Ne pousse rien sans validation humaine.

## Agents disponibles

- `core-engineer` — `packages/core|storage-*|provider-*|testing`
- `integration-engineer` — `packages/nestjs|react`, `apps/api|web`

Chaque agent reste dans son périmètre ; les décisions transverses remontent à
l'agent principal.
