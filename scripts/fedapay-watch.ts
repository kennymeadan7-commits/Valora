/**
 * Preuve de bout en bout contre la sandbox FedaPay.
 *
 *   pnpm --filter @previewpay/demo-api build
 *   STORAGE=prisma PAYMENT_PROVIDER=fedapay node --env-file=.env apps/api/dist/server.mjs
 *   pnpm tsx --env-file=.env scripts/fedapay-watch.ts [--montant 200] [--tel 64000001]
 *
 * Crée un livrable, lance le paiement, affiche la page FedaPay à ouvrir, puis
 * suit l'état jusqu'à `unlocked` (ou jusqu'au délai maximal). Chaque
 * changement d'état est horodaté pour la démonstration.
 */
const BASE = process.env["PREVIEWPAY_PUBLIC_URL"] ?? "http://localhost:3000";
const MONTANT = Number(process.env["PREVIEWPAY_PRIX_DEMO"] ?? 200);
const TELEPHONE = process.env["PREVIEWPAY_TEL_TEST"] ?? "64000001";
const DELAI_MS = Number(process.env["PREVIEWPAY_WATCH_MS"] ?? 300_000);

interface Etat {
  id: string;
  state: string;
  price: number;
  currency: string;
  paymentUrl: string | null;
  downloadUrl: string | null;
  preview: { text?: string };
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return (text ? JSON.parse(text) : {}) as T;
}

function horodatage(): string {
  return new Date().toISOString().slice(11, 19);
}

const livrable = await api<Etat>("POST", "/demo/cv", {
  fullName: "Preuve Sandbox",
  headline: "Déblocage de bout en bout",
});
console.log(`${horodatage()} livrable   ${livrable.id}`);
console.log(`${horodatage()} état       ${livrable.state} (${livrable.price} ${livrable.currency})`);
console.log(`${horodatage()} aperçu     ${JSON.stringify(livrable.preview.text?.slice(0, 60))}…`);

const paye = await api<Etat>("POST", `/deliverables/${livrable.id}/pay`, {
  phone: TELEPHONE,
  operator: "mtn_benin",
});
console.log(`${horodatage()} paiement   ${paye.state}`);
if (paye.paymentUrl) {
  console.log(`${horodatage()} à ouvrir   ${paye.paymentUrl}`);
  console.log("            → payez sur cette page avec le numéro", TELEPHONE);
}

const debut = Date.now();
let etatCourant = paye.state;

while (Date.now() - debut < DELAI_MS) {
  await new Promise((r) => setTimeout(r, 3000));
  const courant = await api<Etat>("GET", `/deliverables/${livrable.id}`);
  if (courant.state !== etatCourant) {
    console.log(`${horodatage()} transition ${etatCourant} → ${courant.state}`);
    etatCourant = courant.state;
  }
  if (courant.state === "unlocked") {
    console.log(`${horodatage()} SUCCÈS     débloqué après ${Math.round((Date.now() - debut) / 1000)} s`);
    console.log(`${horodatage()} lien       ${courant.downloadUrl}`);
    const fichier = await fetch(String(courant.downloadUrl));
    const texte = await fichier.text();
    console.log(`${horodatage()} fichier    ${fichier.status} | ${texte.length} caractères`);
    console.log(texte.split("\n").slice(0, 4).join("\n"));
    process.exit(0);
  }
}

console.error(
  `${horodatage()} ÉCHEC      toujours « ${etatCourant} » après ${Math.round(DELAI_MS / 1000)} s — voir docs/fedapay-sandbox.md (bloquant sandbox)`,
);
process.exit(1);
