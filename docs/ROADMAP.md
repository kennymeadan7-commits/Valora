# Roadmap technique

Coche au fur et à mesure. Chaque jalon se ferme sur un critère vérifiable
(voir le PRD).

## Jalon 1 — cœur testé sans réseau ✅

- [x] `@previewpay/core` : 5 états, transitions atomiques, journal
      append-only, prix figé, idempotence, déblocage vérifié par API
- [x] `storage-memory`, `provider-mock` (webhooks signés)
- [x] Jeton de téléchargement HMAC à durée courte
- [x] 30 tests Vitest, `pnpm typecheck` strict, CI GitHub Actions

**Critère atteint** : un webhook reçu deux fois ne débloque qu'une fois ; le
contenu complet n'apparaît dans aucune réponse avant `unlocked`.

## Jalon 2 — persistance et API

- [x] `@previewpay/storage-prisma` + schéma Prisma (Deliverable, JournalEntry,
      PaymentEvent), migration initiale, contrat Storage sur PostgreSQL réel
- [x] `@previewpay/nestjs` — 6 endpoints, webhook `rawBody`, garde interne, rate limit (25 tests)
- [x] `apps/api` — app de démo NestJS (`rawBody: true`), config par env, bundle esbuild
- [x] Tests d'intégration API (supertest, 7 tests) + contrat PostgreSQL (13 tests)
- [x] Suite de contrat d'adaptateur (`@previewpay/testing`)

## Jalon 3 — FedaPay sandbox

- [x] Clés sandbox générées (scopes Transactions)
- [x] Endpoint webhook créé, secret `wh_sandbox_…` stocké dans `.env`
- [x] `@previewpay/provider-fedapay` : transactions, jeton, direct MTN/Moov,
      vérification de signature sur corps brut, anti-rejeu
- [x] Schéma réel du webhook relevé et documenté
- [x] Rebrancher l'endpoint sur le tunnel HTTPS local — `cloudflared` + endpoint 5218 repointé
- [x] Webhooks réels reçus par le tunnel, signature vérifiée, idempotence en base
- [ ] Déblocage réel FedaPay — **sandbox FedaPay indisponible** (500 sur
      `/v1/mobile_accounts`, `account.null`, tous les `momo_test` déclinés).
      Décision du 14/11 : on continue **sans** la sandbox ; le chemin de
      déblocage est couvert par un test avec l'adaptateur de production
      (`packages/provider-fedapay/test/unlock-flow.test.ts`).

## Jalon 4 — interface et démo

- [x] `@previewpay/react` : `usePreviewPay` (polling borné), `<PreviewPaywall />` (17 tests)
- [x] `apps/web` : parcours CV → aperçu filigrané → 200 F → téléchargement (vérifié dans Chrome)
- [x] Métriques : taux de validation, taux de refus, marge, délai, échecs

## Livraison du SDK (v0.1.0)

- [x] Build par paquet (tsup) : ESM + CommonJS + déclarations, `publishConfig`
      vers `dist/` (le monorepo continue de consommer `src/`)
- [x] Manifestes npm : version, description, `files`, `engines`, peers
      (`@nestjs/*`, `react`, `@prisma/client`, `vitest`), aucun `postinstall` publié
- [x] `pnpm pack:check` : contenu des tarballs et manifestes publiés
- [x] `pnpm consumer:check` : installation dans un projet vierge (ESM, CJS,
      NestJS réel, React SSR, Prisma, types `nodenext`/`bundler`, contrat Vitest)
- [x] Job CI `package`
- [x] README par paquet + `docs/GETTING-STARTED.md`
- [x] Limite d'aperçus gratuits par utilisateur et par 24 h (`ownerId`, 429)
- [x] Licence MIT (décidée le 14/11)
- [ ] Nom définitif, puis `pnpm -r publish` (validation humaine)

## Dette technique connue

- `scripts/build-api.mjs` bundle l'app de démo avec esbuild ; elle consomme
  les sources des paquets, pas leur `dist/`.

## Décisions à prendre avec Sami

- Nom définitif du SDK
- Prix par défaut du CV
- Traitement de `refunded`
