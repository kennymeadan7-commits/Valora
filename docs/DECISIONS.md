# Journal de décisions (ADR)

| Date | Décision | Raison |
|------|----------|--------|
| 2026-11-14 | Dépôt initialisé, `main` par défaut, CI pnpm + Vitest | Base minimale vérifiable |
| 2026-11-14 | Le cœur n'importe aucun framework ; les alias `@previewpay/*` sont résolus par `vitest.config.ts` et `tsconfig.json` | Garder `packages/core` testable seul, sans étape de build |
| 2026-11-14 | **`expired` n'est pas un 6ᵉ état du livrable** : c'est un statut d'essai de paiement, détecté par appel API, qui ramène le livrable à `previewed` | Le PRD décrit une machine à *cinq* états mais liste `expired` dans la correspondance des statuts. Conserver 5 états évite un état terminal sans issue ; à confirmer avec Sami |
| 2026-11-14 | Le journal accepte des entrées `previewed → previewed` pour tracer une régénération | Une régénération n'est pas une transition d'état mais doit rester auditable |
| 2026-11-14 | Le prix est validé comme **entier positif** à la création | Évite les montants flottants côté FedaPay (amount entier) |
| 2026-11-14 | Jeton de téléchargement = HMAC-SHA256 `payload.expiresAt` signé, TTL 300 s par défaut | Lien signé court, vérifiable sans base de sessions |

| 2026-11-14 | Signature webhook FedaPay = `HMAC-SHA256(secret, "<t>.<corps brut>")`, en-tête `t=…,s=…` | Vérifié par calcul sur un événement sandbox réel (`docs/fedapay-sandbox.md`) |
| 2026-11-14 | `eventId = "<name>:<entity.id>"` | FedaPay n'envoie aucun identifiant d'événement ; ce couple est stable entre deux réémissions |
| 2026-11-14 | `merchant_reference` = id du livrable, `custom_metadata` réservé au non-sensible | Permet de recouper côté FedaPay sans table de correspondance |
| 2026-11-14 | `transferred` et `refunded` sont mappés sur `approved` (le livrable reste `unlocked`) | Un `transferred` est un succès déjà acquis ; `refunded` reste à trancher |

| 2026-11-14 | On avance **sans la sandbox FedaPay** (indisponible côté FedaPay) | Le compte sandbox `acc_2990265463` décline tous les `momo_test` et son endpoint `/v1/mobile_accounts` répond 500. Le code reste prêt : le déblocage est prouvé avec l'adaptateur de production et un transport bouchonné. |
| 2026-11-14 | Démo : paiement géré par un **simulateur Mobile Money maison** (fournisseur `mock` + écran téléphone) tant que FedaPay sandbox est indisponible | Démo complète sans opérateur ; le déblocage reste revérifié par `getPaymentStatus`, aucun raccourci côté client |
| 2026-11-14 | Contenu du CV stocké **structuré** (`{ format: "cv/v1", data }`), HTML/Markdown recalculés à la lecture | L'aperçu caviardé et le document final dérivent des mêmes données ; le gabarit peut évoluer sans migrer les livrables |
| 2026-11-14 | Aperçu CV = gabarit HTML réel caviardé **côté serveur** (barres grises à la place du texte payant) | Invariant n° 6 : rien de masqué côté client ; l'aperçu donne envie sans être utilisable |
| 2026-11-14 | PDF final produit par l'impression du navigateur (HTML A4 + `@page`) plutôt qu'un moteur PDF serveur | Zéro dépendance lourde (Chromium) ; rendu fidèle. À revoir si un vrai fichier .pdf serveur devient nécessaire |
| 2026-11-14 | Import de CV PDF : extraction `unpdf` + analyse **heuristique** locale, résultat relu par l'utilisateur | Hors ligne, déterministe, testable ; un LLM pourra améliorer l'extraction plus tard |

## Points ouverts (repris du PRD)

- [x] Champs JSON exacts d'un webhook FedaPay → relevés le 14/11, voir `docs/fedapay-sandbox.md`.
- [ ] État PreviewPay pour un paiement `refunded`.
- [ ] Prix par défaut du CV une fois le coût d'IA mesuré.
- [ ] Licence : MIT ou Apache-2.0.
- [ ] Nom définitif : `PreviewPay` est un nom de travail (`Valora` côté dépôt).
- [ ] Confirmer le traitement de `expired` (voir décision ci-dessus).
- [ ] Extraction PDF : CV scannés (OCR) et mises en page exotiques non couverts.
- [ ] Rouvrir le jalon 3 quand un compte sandbox FedaPay fonctionnel est disponible.
