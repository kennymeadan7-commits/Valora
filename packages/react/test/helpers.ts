/**
 * Fixtures partagées par les tests du paquet React : aucun réseau, tout passe
 * par un `fetch` bouchonné.
 */

export interface LivrableFixture {
  id: string;
  type: string;
  state: "draft" | "previewed" | "payment_pending" | "unlocked" | "rejected";
  price: number;
  currency: "XOF";
  preview: unknown;
  regenerations: number;
  maxRegenerations: number;
  downloadUrl: string | null;
  paymentUrl: string | null;
}

/** Livrable `previewed` à 200 F, surchargeable champ par champ. */
export function livrable(
  surcharge: Partial<LivrableFixture> = {},
): LivrableFixture {
  return {
    id: "dlv_1",
    type: "cv",
    state: "previewed",
    price: 200,
    currency: "XOF",
    preview: { text: "Aperçu filigrané du CV" },
    regenerations: 0,
    maxRegenerations: 2,
    downloadUrl: null,
    paymentUrl: null,
    ...surcharge,
  };
}

/** Réponse HTTP minimale, suffisante pour le hook (`ok`, `status`, `json`). */
export function reponseJson(corps: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => corps,
    text: async () => JSON.stringify(corps),
  } as unknown as Response;
}

export const DOWNLOAD_URL =
  "https://api.previewpay.test/deliverables/dlv_1/download?token=signe";
