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
- [ ] Rebrancher l'endpoint sur le tunnel HTTPS local (le code est prêt)
- [ ] Rejouer un webhook depuis le tableau de bord (test du doublon)
- [ ] Paiement direct `mtn_benin` / `moov_benin` de bout en bout

## Jalon 4 — interface et démo

- [x] `@previewpay/react` : `usePreviewPay` (polling borné), `<PreviewPaywall />` (17 tests)
- [x] `apps/web` : parcours CV → aperçu filigrané → 200 F → téléchargement (vérifié dans Chrome)
- [ ] Métriques : taux de validation, taux de refus, marge, délai, échecs

## Dette technique connue

- `apps/api` tourne sur `storage-memory`. Pour basculer sur Prisma, il faut un
  client Prisma généré accessible à l'app (sortie de `generator` partagée entre
  `packages/storage-prisma` et `apps/api`) — sinon les deux copies pnpm du client
  divergent. Le contrat PostgreSQL, lui, est déjà validé (13 tests sur base réelle).
- Les paquets exposent leur source TypeScript ; `scripts/build-api.mjs` bundle
  l'API avec esbuild. Une publication npm demandera une compilation `tsc` par paquet.

## Décisions à prendre avec Sami

- Licence (MIT / Apache-2.0)
- Nom définitif du SDK
- Prix par défaut du CV
- Traitement de `refunded`
