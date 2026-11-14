# PRD — PreviewPay SDK (aperçu puis paiement au livrable validé)

Nov 14, 2026 · @Sami

## Contexte et problème

PreviewPay fait payer un livrable généré par une IA (CV, présentation, dossier) seulement après que l'utilisateur l'a vu et validé, en micro-paiement Mobile Money de 100 à 500 F.

Le modèle actuel des outils IA est un abonnement mensuel fixe, souvent en dollars. Il pose trois problèmes sur les marchés à faible pouvoir d'achat :

- **Paiement d'avance :** l'utilisateur paie avant de savoir si l'outil lui sert.
- **Moyen de paiement :** beaucoup d'utilisateurs n'ont pas de carte internationale mais utilisent Mobile Money.
- **Montant :** un forfait mensuel pèse lourd pour un usage occasionnel.

Le projet est un SDK open source (middleware de facturation différée) qu'un développeur branche sur son produit, avec un outil d'agents IA de type « Genspark à l'africaine » comme premier cas d'usage.

## Objectifs, non-objectifs et critères de succès

Le MVP doit prouver, de bout en bout et en sandbox FedaPay, qu'un livrable généré peut être prévisualisé, payé en Mobile Money puis débloqué, sans jamais exposer le contenu complet avant paiement.

**Objectifs du MVP**

- Un cœur TypeScript sans dépendance de framework, avec machine d'états et interfaces `Storage`, `PaymentProvider`, `PreviewStrategy`.
- Deux fournisseurs de paiement : `mock` (tests) et FedaPay sandbox.
- Un module NestJS et un paquet React (hook et composant de paywall).
- Une démo « générer un CV → aperçu → payer → télécharger ».
- Des métriques pour valider l'hypothèse (taux de validation après aperçu, taux de refus, marge par livrable).

**Non-objectifs du MVP**

- Pas de mode live ni d'argent réel.
- Pas de commission sur gain ni de crédit à la consommation (pistes ultérieures).
- Pas d'autre fournisseur que `mock` et FedaPay.
- Pas de tableau de bord d'administration.

**Critères de succès**

- Un paiement sandbox réussi fait passer le livrable à « débloqué » et libère le téléchargement.
- Un webhook reçu deux fois ne débloque le livrable qu'une seule fois.
- Le contenu complet n'apparaît dans aucune réponse de l'API avant paiement confirmé.
- Un paiement échoué, annulé ou expiré laisse le livrable verrouillé et relançable.

## Utilisateurs cibles et cas d'usage

Le SDK sert d'abord les développeurs qui construisent des outils IA pour des utilisateurs qui paient en Mobile Money.

| Profil | Besoin | Ce que le SDK lui apporte |
| --- | --- | --- |
| Développeur intégrateur | Facturer un livrable IA sans abonnement ni carte | Un module à brancher (NestJS ou autre) et un composant React |
| Utilisateur final | Juger le résultat avant de payer, payer en petit montant | Un aperçu, un prix clair, un paiement Mobile Money |
| Contributeur open source | Ajouter un fournisseur de paiement ou un stockage | Des interfaces stables et une suite de tests d'adaptateur |

**Scénario de démo (CV)**

1. L'utilisateur décrit son profil et demande un CV.
2. L'agent génère le CV ; le serveur le garde en entier et renvoie un aperçu filigrané.
3. L'utilisateur voit le prix (par exemple 200 F) et clique sur « Valider et payer ».
4. Le SDK crée la transaction FedaPay sandbox et demande le paiement Mobile Money.
5. Le webhook de confirmation arrive ; le livrable passe à « débloqué ».
6. L'utilisateur télécharge le CV complet par un lien signé à durée courte.
7. S'il refuse l'aperçu à l'étape 3, l'agent régénère (nombre limité) ou l'échange se termine sans frais.

## Architecture et modules

Le monorepo pnpm sépare le cœur des intégrations : chaque brique extérieure se branche sur les interfaces du cœur.

&#91;embedded content: architecture du monorepo · 8 paquets et 2 apps\]

Les flèches vont vers ce dont chaque brique dépend : les adaptateurs et le module NestJS dépendent du cœur, jamais l'inverse.

**Choix techniques**

| Sujet | Choix |
| --- | --- |
| Langage | TypeScript partout |
| Monorepo | pnpm workspaces |
| Démo API | NestJS |
| Démo web | React + Vite |
| Données | Prisma + PostgreSQL (Docker en local, Neon en production) |
| Tests | Vitest |
| Paiement | `mock`, puis FedaPay sandbox |

## Spécification du cœur

Le cœur gère un seul objet, le livrable, qui avance par une machine à cinq états ; chaque transition est écrite dans un journal.

&#91;embedded content: machine d'états du livrable · 5 états\]

Seul un paiement approuvé et vérifié mène à `unlocked`. Un paiement refusé ou annulé ramène à `previewed` pour un nouvel essai ; un refus de l'aperçu mène à `rejected`, d'où l'on régénère dans la limite autorisée.

**Interfaces (esquisse)**

```ts
interface Storage {
  saveDeliverable(d: Deliverable): Promise<void>;
  getDeliverable(id: string): Promise<Deliverable | null>;
  // atomique : n'applique la transition que si l'état courant est `from`
  transition(id: string, from: State, to: State): Promise<boolean>;
  // false si l'événement a déjà été vu
  recordEvent(e: EventRecord): Promise<boolean>;
}

interface PaymentProvider {
  createPayment(i: { amount: number; currency: 'XOF'; phone: string; operator: string; reference: string }): Promise<{ paymentId: string }>;
  getPaymentStatus(paymentId: string): Promise<'pending' | 'approved' | 'declined' | 'canceled' | 'expired'>;
  parseWebhook(rawBody: Buffer, headers: Record<string, string>): Promise<{ eventId: string; paymentId: string; type: string }>;
}

interface PreviewStrategy {
  makePreview(content: unknown, ctx: { type: string }): Promise<unknown>;
}
```

**Règles**

- **Prix figé à la création :** entier en XOF, lu dans la grille `pricing` par type de livrable et stocké avec le livrable ; changer la grille ne touche pas les livrables existants.
- **Transition atomique :** elle n'est appliquée que si l'état courant est celui attendu ; deux webhooks simultanés ne débloquent qu'une fois.
- **Refus :** régénération dans la limite configurée, puis clôture sans frais.
- **Journal :** chaque transition enregistre le livrable, l'état de départ et d'arrivée, l'heure, la cause et l'identifiant de l'événement ou du paiement qui la justifie.

## Intégration FedaPay en sandbox

Le module `provider-fedapay` crée une transaction, déclenche le paiement Mobile Money (MTN ou Moov Bénin) et débloque le livrable à la réception du webhook `transaction.approved`, vérifié par signature.

**Flux de paiement**

1. **Créer la transaction** sur `https://sandbox-api.fedapay.com/v1/transactions` avec `description`, `amount` (entier), `currency` (`XOF`), et si besoin `customer` et `callback_url` ([API de création](https://docs.fedapay.com/integration-api/en/collects-management-en)).
2. **Générer le jeton** via `/transactions/ID/token` ; il donne aussi le lien de la page de paiement sécurisée.
3. **Paiement direct sans redirection** : envoyer le jeton à l'endpoint du mode choisi (`mtn_benin`, `moov_benin`). Le numéro de téléphone est optionnel ; s'il manque, FedaPay utilise celui du client. Tous les opérateurs ne supportent pas ce mode.
4. **Confirmer le statut par un appel API** (`GET /transactions/ID`), sans se fier au seul statut du `callback_url`.

**Correspondance des statuts**

| Statut FedaPay | Événement webhook | État PreviewPay |
| --- | --- | --- |
| `pending` (expire après 24 h) | `transaction.created` | `payment_pending` |
| `approved` | `transaction.approved` | `unlocked` |
| `declined` | `transaction.declined` | `previewed`, relançable |
| `canceled` | `transaction.canceled` | `previewed`, relançable |
| `expired` | aucun événement documenté | `expired`, détecté par appel API |
| `transferred` | `transaction.transferred` | reste `unlocked` |
| `refunded` | non documenté | à définir (question ouverte) |

`declined` et `canceled` ne sont pas définitifs : un nouvel essai de paiement est permis ([statuts](https://docs.fedapay.com/integration-api/en/collects-management-en)).

**Webhook**

- L'endpoint est créé dans la section Webhooks du tableau de bord ; son secret (préfixe `wh_sandbox`) est propre à chaque endpoint et diffère entre test et live.
- La signature arrive dans l'en-tête `X-FEDAPAY-SIGNATURE` ; on la vérifie sur le **corps brut** de la requête, avec `Webhook.constructEvent` de la bibliothèque officielle `fedapay`.
- FedaPay attend une réponse 2xx. Sinon il réessaie jusqu'à 9 fois (attente plafonnée à 2 minutes), puis désactive le webhook après 10 échecs, sauf si l'option est décochée.
- L'URL doit être en HTTPS avec un certificat valide (TLS 1.2 ou 1.3) ; chaque nouvel essai a une nouvelle signature et un nouvel horodatage ([webhooks](https://docs.fedapay.com/integration-api/en/webhooks-en)).
- En développement local, il faut une URL publique HTTPS (un tunnel) pour recevoir les webhooks.

**Idempotence**

Chaque événement est enregistré avec son identifiant avant traitement ; un événement déjà vu est acquitté en 200 sans rien changer. La documentation ne détaille pas les champs JSON exacts : on les relevéra sur un vrai webhook sandbox avant de figer le schéma.

## Module NestJS et paquet React

Le module NestJS expose six endpoints qui enveloppent le cœur ; le paquet React les consomme par un hook et un composant prêt à l'emploi.

**Module NestJS** (`PreviewPayModule.forRoot({ provider, storage, pricing, preview })`)

| Endpoint | Rôle | Règle clé |
| --- | --- | --- |
| `POST /deliverables` | Crée un livrable depuis le serveur de l'agent | Appel interne, jamais depuis le navigateur |
| `GET /deliverables/:id` | Renvoie statut, prix et aperçu | Ne renvoie jamais le contenu complet |
| `POST /deliverables/:id/pay` | Lance le paiement (téléphone, opérateur) | Passe l'état à `payment_pending` |
| `POST /deliverables/:id/reject` | Refuse l'aperçu | Régénère dans la limite autorisée, sinon clôt |
| `GET /deliverables/:id/download` | Donne le lien signé | Refusé (402) tant que l'état n'est pas `unlocked` |
| `POST /webhooks/fedapay` | Reçoit les événements FedaPay | Signature vérifiée sur le corps brut |

Pour vérifier la signature, l'application NestJS active `rawBody` au démarrage (`NestFactory.create(AppModule, { rawBody: true })`).

**Paquet React**

- `usePreviewPay(deliverableId)` renvoie `status`, `preview`, `price`, `downloadUrl`, `error` et les actions `pay(phone)` et `reject(reason)` ; il interroge le statut à intervalle régulier tant que le paiement est en attente.
- `<PreviewPaywall deliverableId />` affiche l'aperçu, le prix et le bouton « Valider et payer », puis gère les états : aperçu, paiement en attente, échec ou expiration (avec relance), débloqué, refusé.
- Le style est personnalisable par l'intégrateur ; le composant n'impose pas le nôtre.

## Sécurité et anti-abus

La règle de base : le contenu complet reste sur le serveur jusqu'à un paiement confirmé par FedaPay.

- **Contenu côté serveur :** l'aperçu est produit sur le serveur ; on n'envoie jamais le contenu complet au navigateur pour le masquer ensuite.
- **Aperçu utile mais inutilisable :** assez pour juger la qualité (premières sections, filigrane, basse résolution), pas assez pour servir tel quel.
- **Webhook :** signature vérifiée sur le corps brut avec le secret propre à l'endpoint, HTTPS obligatoire, horodatage contrôlé contre le rejeu.
- **Déblocage vérifié :** avant de débloquer, le SDK relit la transaction par appel API ; le webhook seul ne suffit pas.
- **Idempotence :** chaque événement est enregistré par identifiant ; un doublon est acquitté sans effet.
- **Téléchargement :** lien signé à durée courte, généré seulement pour un livrable `unlocked`.
- **Limites anti-abus (configurables) :** nombre d'aperçus gratuits par utilisateur et par jour, nombre maximal de régénérations par livrable, limitation de débit sur `/pay`.
- **Journal append-only :** chaque transition d'état est écrite avec sa preuve, pour résoudre les litiges.
- **Secrets :** la clé API FedaPay vit dans des variables d'environnement côté serveur ; les clés sandbox et live sont séparées.

## Plan de tests et métriques

Les tests montent par couches, du plus rapide (sans réseau) au plus réaliste (sandbox FedaPay), et les métriques disent si l'hypothèse tient.

**Tests**

1. **Unitaires du cœur (Vitest)** avec `storage-memory` et `provider-mock` : transitions valides et invalides, webhook reçu deux fois, expiration, plafond de régénérations, calcul du prix.
2. **Contrat d'adaptateur :** une suite partagée que tout `Storage` et tout `PaymentProvider` doit passer.
3. **Intégration :** API NestJS avec PostgreSQL (Docker) et fournisseur `mock` simulant succès, échec, délai dépassé et double clic.
4. **Sandbox FedaPay :** paiement réussi, refusé, annulé, webhook à signature invalide (rejet sans changement d'état), et réémission d'un webhook depuis les journaux du tableau de bord pour tester le doublon.
5. **Bout en bout :** parcours complet de la démo React, de la demande de CV au téléchargement.

**Métriques de validation**

| Métrique | Définition |
| --- | --- |
| Taux de validation | Livrables payés ÷ livrables prévisualisés |
| Taux de refus | Livrables rejetés ÷ livrables prévisualisés |
| Marge par livrable | Prix − coût d'IA (génération et régénérations) |
| Délai aperçu → paiement | Temps entre l'aperçu et le paiement confirmé |
| Taux d'échec de paiement | Paiements `declined`, `canceled` ou `expired` ÷ paiements lancés |

Les seuils à atteindre seront fixés après les premiers tests, quand on connaîtra le coût réel d'un livrable.

## Roadmap par jalons

On commence par le cœur testé sans réseau, puis la base et l'API, puis FedaPay, puis l'interface et la démo ; chaque jalon se ferme sur un critère vérifiable.

&#91;embedded content: roadmap · 4 jalons et leurs critères de sortie\]

Aucune date n'est fixée : les durées seront estimées après le jalon 1.

**Prérequis avant le jalon 3**

- [ ] Un compte FedaPay avec accès au mode sandbox et ses clés de test.
- [ ] Un endpoint webhook créé dans le tableau de bord, avec son secret (préfixe `wh_sandbox`).
- [ ] Un tunnel HTTPS vers la machine de développement, pour recevoir les webhooks en local.

## Risques et questions ouvertes

Le plus gros risque est l'aperçu : trop complet, il se copie ; trop pauvre, il ne convainc pas.

| Risque | Mitigation |
| --- | --- |
| Aperçu copiable (capture, copier-coller) | Aperçu partiel avec filigrane, contenu complet jamais envoyé avant paiement |
| Coût d'IA des aperçus jamais payés | Limites d'aperçus et de régénérations, suivi de la marge par livrable |
| Webhook perdu ou en retard | Réessais FedaPay, plus vérification du statut par appel API pour les paiements en attente |
| Opérateur sans paiement direct | Repli sur la page de paiement FedaPay par lien |
| Webhook désactivé après 10 échecs | Surveiller les journaux FedaPay, garder l'option de désactivation décochée |
| Litige sur un paiement | Journal append-only avec preuve de chaque transition |

**Questions ouvertes**

- [ ] Quels sont les champs JSON exacts d'un webhook FedaPay ? À relever sur un événement sandbox avant de figer le schéma.
- [ ] Quel état PreviewPay pour un paiement `refunded` ?
- [ ] Quel prix par défaut pour le CV, une fois le coût d'IA mesuré ?
- [ ] Quelle licence open source (MIT ou Apache-2.0) ?
- [ ] Nom définitif du projet : PreviewPay est un nom de travail.
- [ ] Le compte FedaPay sandbox et ses clés de test sont-ils prêts ?
