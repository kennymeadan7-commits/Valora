# Journal de décisions (ADR)

| Date | Décision | Raison |
|------|----------|--------|
| 2026-11-14 | Dépôt initialisé, `main` par défaut, CI pnpm + Vitest | Base minimale vérifiable |
| 2026-11-14 | Le cœur n'importe aucun framework ; les alias `@previewpay/*` sont résolus par `vitest.config.ts` et `tsconfig.json` | Garder `packages/core` testable seul, sans étape de build |
| 2026-11-14 | **`expired` n'est pas un 6ᵉ état du livrable** : c'est un statut d'essai de paiement, détecté par appel API, qui ramène le livrable à `previewed` | Le PRD décrit une machine à *cinq* états mais liste `expired` dans la correspondance des statuts. Conserver 5 états évite un état terminal sans issue ; à confirmer avec Sami |
| 2026-11-14 | Le journal accepte des entrées `previewed → previewed` pour tracer une régénération | Une régénération n'est pas une transition d'état mais doit rester auditable |
| 2026-11-14 | Le prix est validé comme **entier positif** à la création | Évite les montants flottants côté FedaPay (amount entier) |
| 2026-11-14 | Jeton de téléchargement = HMAC-SHA256 `payload.expiresAt` signé, TTL 300 s par défaut | Lien signé court, vérifiable sans base de sessions |

## Points ouverts (repris du PRD)

- [ ] Champs JSON exacts d'un webhook FedaPay → à relever sur un événement sandbox.
- [ ] État PreviewPay pour un paiement `refunded`.
- [ ] Prix par défaut du CV une fois le coût d'IA mesuré.
- [ ] Licence : MIT ou Apache-2.0.
- [ ] Nom définitif : `PreviewPay` est un nom de travail (`Valora` côté dépôt).
- [ ] Confirmer le traitement de `expired` (voir décision ci-dessus).
