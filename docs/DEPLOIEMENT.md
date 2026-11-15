# Déployer la démo

Objectif : une URL publique qui montre le parcours complet (import PDF → aperçu
caviardé → paiement Mobile Money simulé → fichier débloqué), sans dépendre de la
sandbox FedaPay.

## 1. Un seul processus

Quand `apps/web/dist` existe, l'API le sert elle-même : une seule URL, aucun
CORS, aucun réglage d'API côté front.

```sh
pnpm build                                   # paquets du SDK
pnpm --filter @previewpay/demo-web build     # front → apps/web/dist
node scripts/build-api.mjs                   # API → apps/api/dist/server.mjs
STORAGE=memory PAYMENT_PROVIDER=mock node apps/api/dist/server.mjs
# → http://localhost:3000 sert l'API et l'interface
```

Variables utiles :

| Variable | Rôle |
| --- | --- |
| `PREVIEWPAY_DOWNLOAD_SECRET` | **obligatoire**, signe les liens de téléchargement |
| `PREVIEWPAY_DOWNLOAD_BASE_URL` | base des liens signés (URL publique) |
| `PREVIEWPAY_INTERNAL_KEY` | clé de `/demo/simulate` et `/demo/metrics` |
| `STORAGE` | `memory` (défaut) ou `prisma` |
| `PAYMENT_PROVIDER` | `mock` (défaut) ou `fedapay` |
| `DEMO_AI_COST_PER_DELIVERABLE` | coût IA en XOF pour la marge |

## 2. Docker

```sh
docker build -t previewpay-demo .
docker run -p 3000:3000 \
  -e PREVIEWPAY_DOWNLOAD_SECRET=$(openssl rand -hex 32) \
  -e PREVIEWPAY_DOWNLOAD_BASE_URL=https://votre-domaine \
  previewpay-demo
```

L'image installe le workspace, construit le SDK, le front et l'API, puis lance
`node apps/api/dist/server.mjs`. `STORAGE=memory` par défaut : aucune base à
provisionner pour une démo.

⚠️ La clé de simulation est compilée dans le front (`VITE_DEMO_INTERNAL_KEY`).
Pour la changer, reconstruis avec `--build-arg VITE_DEMO_INTERNAL_KEY=…` **et**
la même valeur dans `PREVIEWPAY_INTERNAL_KEY` au runtime.

## 3. URL publique immédiate (tunnel)

Pour une démo éphémère (soutenance, candidature, rendez-vous) :

```sh
cloudflared tunnel --url http://localhost:3000 --no-autoupdate
# → https://<mots>.trycloudflare.com
```

L'URL meurt quand le processus s'arrête ; à utiliser pour une session, pas pour
un lien permanent.

## 4. Hébergement durable

N'importe quel hôte qui sait lancer un conteneur :

- **Railway / Render / Fly.io** : déploie l'image, ajoute les variables
  ci-dessus, expose le port 3000.
- **PostgreSQL managé (Neon, Supabase)** si tu veux `STORAGE=prisma` :
  renseigne `DATABASE_URL`, puis
  `pnpm --filter @previewpay/storage-prisma exec prisma migrate deploy`.
- **VM** : `docker compose up -d` avec un reverse proxy TLS devant le port 3000.

Aucun secret ne doit être commité : `.env` est ignoré, `.env.example` documente
les variables.

## 5. Vérification après déploiement

```sh
curl https://<url>/demo/health
# {"status":"ok","provider":"mock","storage":"memory"}
```

Puis dans le navigateur : importer un PDF, générer l'aperçu, payer avec le
simulateur, télécharger. Le tableau de bord intégrateur doit afficher
`100 % de validation` après un paiement confirmé.
