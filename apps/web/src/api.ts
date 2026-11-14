/**
 * Accès HTTP à l'API de démo (`apps/api`) pour la démonstration.
 *
 * Toutes les URLs sont **relatives** : Vite proxifie `/deliverables`, `/demo`
 * et `/webhooks` vers `http://localhost:3000` (voir `vite.config.ts`). Aucun
 * secret de paiement ne transite ici ; la seule clé manipulée est celle du
 * pilotage de démonstration (`/demo/simulate`), lue dans l'environnement.
 */

/**
 * Vue publique d'un livrable — sous-ensemble de `PublicDeliverable`
 * (`@previewpay/core`). Elle ne contient **jamais** `content` : le texte
 * complet ne sort du serveur qu'après `unlocked`, via un jeton signé.
 */
export interface DeliverableView {
  id: string;
  type: string;
  state: DeliverableState;
  /** Prix figé à la création, entier XOF. */
  price: number;
  currency: string;
  /** Aperçu produit côté serveur (objet `{ text, watermark, … }`). */
  preview: unknown;
  regenerations: number;
  maxRegenerations: number;
  /** Lien signé, non nul seulement si `unlocked`. */
  downloadUrl: string | null;
  /** Repli si le paiement direct n'est pas disponible. */
  paymentUrl: string | null;
}

export type DeliverableState =
  | "draft"
  | "previewed"
  | "payment_pending"
  | "unlocked"
  | "rejected";

export type CvTheme = "emeraude" | "indigo" | "ardoise" | "terracotta";

export interface CvExperienceInput {
  role: string;
  company: string;
  period: string;
  location?: string;
  highlights: string[];
}

export interface CvEducationInput {
  diploma: string;
  school: string;
  year: string;
}

export interface CvLanguageInput {
  name: string;
  level?: string;
}

/** Corps de `POST /demo/cv` (voir `apps/api/src/cv/model.ts`). */
export interface CreateCvInput {
  fullName: string;
  headline: string;
  email?: string;
  phone?: string;
  city?: string;
  website?: string;
  summary?: string;
  skills?: string[];
  languages?: CvLanguageInput[];
  experiences?: CvExperienceInput[];
  education?: CvEducationInput[];
  interests?: string[];
  theme?: CvTheme;
}

/** Réponse de `POST /demo/cv/import` : champs pré-remplis à relire. */
export interface CvImportResult {
  fields: {
    fullName: string;
    headline: string;
    email: string;
    phone: string;
    city: string;
    website: string;
    summary: string;
    skills: string[];
    languages: CvLanguageInput[];
    experiences: CvExperienceInput[];
    education: CvEducationInput[];
    interests: string[];
  };
  found: string[];
  lines: number;
  pages: number;
}

/** Format du fichier final servi par `/deliverables/:id/content`. */
export type ContentFormat = "html" | "md";

/** Statuts d'essai de paiement simulables avec `provider-mock`. */
export type SimulatedStatus = "approved" | "declined" | "expired";

/** Réponse de `GET /deliverables/:id/download`. */
export interface DownloadLinkView {
  url: string;
  expiresAt: string;
}

/** Réponse de `GET /demo/health`. */
export interface DemoHealth {
  status: string;
  provider: string;
  /** `memory` ou `prisma`. */
  storage?: string;
}

/**
 * Réponse de `GET /demo/metrics` — métriques de validation du PRD.
 *
 * Elles sont calculées par le cœur (`computeMetrics`) côté serveur : le
 * navigateur ne fait que les afficher. Aucune donnée de contenu n'y figure.
 */
export interface DemoMetrics {
  /** Livrables prévisualisés au moins une fois. */
  previewed: number;
  /** Livrables débloqués (payés). */
  paid: number;
  /** Livrables refusés (clos sans frais). */
  rejected: number;
  /** `paid / previewed`. */
  conversionRate: number;
  /** `rejected / previewed`. */
  rejectionRate: number;
  /** Paiements lancés. */
  paymentAttempts: number;
  /** Paiements revenus en arrière (declined / canceled / expired). */
  paymentFailures: number;
  /** `paymentFailures / paymentAttempts`. */
  paymentFailureRate: number;
  /** Aperçu → premier paiement, en millisecondes. */
  averageTimeToPaymentMs: number | null;
  /** Prix moyen des livrables payés, en XOF. */
  averagePrice: number | null;
  /** `averagePrice − aiCostPerDeliverable`, en XOF. */
  marginPerDeliverable: number | null;
  /** Coût IA retenu par le serveur ; `null` s'il n'est pas configuré. */
  aiCostPerDeliverable: number | null;
  /** Horodatage ISO du calcul. */
  generatedAt: string;
}

/** Erreur HTTP normalisée : `message` est toujours affichable tel quel. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Clé interne du pilotage de démonstration.
 *
 * Elle ne protège que `/demo/simulate` (fournisseur `mock`) et n'est jamais
 * utilisée pour un paiement. On la lit dans `VITE_DEMO_INTERNAL_KEY` ; la
 * valeur par défaut est celle du `.env` de démo, pour que le parcours
 * fonctionne sans configuration supplémentaire.
 */
const DEMO_INTERNAL_KEY: string =
  import.meta.env.VITE_DEMO_INTERNAL_KEY ?? "dev-internal-key";

/** Message lisible pour n'importe quelle erreur (réseau incluse). */
export function describeError(cause: unknown): string {
  if (cause instanceof ApiError) return cause.message;
  if (cause instanceof Error && cause.message !== "") return cause.message;
  return "Erreur inattendue";
}

/** Lit un corps JSON sans échouer sur une réponse vide ou non JSON. */
async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

/** Extrait `message` (chaîne ou tableau de validation Nest) d'un corps d'erreur. */
function messageOf(body: unknown, fallback: string): string {
  if (typeof body !== "object" || body === null) return fallback;
  const raw = (body as Record<string, unknown>)["message"];
  if (typeof raw === "string" && raw.trim() !== "") return raw;
  if (Array.isArray(raw)) {
    const parts = raw.filter((item): item is string => typeof item === "string");
    if (parts.length > 0) return parts.join(", ");
  }
  return fallback;
}

/** Extrait le code métier renvoyé par le filtre d'exceptions du SDK. */
function codeOf(body: unknown, status: number): string {
  if (typeof body === "object" && body !== null) {
    const code = (body as Record<string, unknown>)["code"];
    if (typeof code === "string" && code !== "") return code;
  }
  return `HTTP_${status}`;
}

/** Requête JSON générique : erreurs réseau et HTTP remontent en `ApiError`. */
async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      "API de démo injoignable — lancez `pnpm dev` (ou `pnpm --filter @previewpay/demo-api dev`).",
    );
  }

  const body = await readJson(response);
  if (!response.ok) {
    throw new ApiError(
      response.status,
      codeOf(body, response.status),
      messageOf(body, `Erreur HTTP ${response.status}`),
    );
  }
  return body as T;
}

/** `POST /demo/cv` — le « serveur de l'agent » génère le livrable et son aperçu. */
export function createCv(input: CreateCvInput): Promise<DeliverableView> {
  return requestJson<DeliverableView>("/demo/cv", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(input),
  });
}

/**
 * `POST /demo/cv/import` — envoie un PDF ; le serveur en extrait le texte et
 * renvoie les champs détectés. Rien n'est stocké.
 */
export async function importCvPdf(file: File): Promise<CvImportResult> {
  const form = new FormData();
  form.append("file", file, file.name);
  return requestJson<CvImportResult>("/demo/cv/import", {
    method: "POST",
    headers: { accept: "application/json" },
    body: form,
  });
}

/**
 * `GET /deliverables/:id` — vue publique rafraîchie : statut, prix, aperçu.
 * Utilisée par la démo pour garder sa synthèse alignée sur le serveur
 * (paiement en attente, régénération, déblocage par webhook).
 */
export function fetchDeliverable(id: string): Promise<DeliverableView> {
  return requestJson<DeliverableView>(`/deliverables/${encodeURIComponent(id)}`, {
    headers: { accept: "application/json" },
  });
}

/**
 * `POST /demo/simulate/:id/:status` — règle le statut de l'essai de paiement
 * dans le fournisseur `mock`. La réponse est le livrable **après**
 * revérification d'API (`syncPayment`), jamais un simple écho du webhook.
 */
export function simulatePayment(
  id: string,
  status: SimulatedStatus,
): Promise<DeliverableView> {
  return requestJson<DeliverableView>(
    `/demo/simulate/${encodeURIComponent(id)}/${status}`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "x-internal-key": DEMO_INTERNAL_KEY,
      },
    },
  );
}

/** `GET /demo/metrics` — nom du fournisseur actif (`mock` ou `fedapay`). */
export function fetchHealth(): Promise<DemoHealth> {
  return requestJson<DemoHealth>("/demo/health", {
    headers: { accept: "application/json" },
  });
}

/**
 * `GET /demo/metrics` — tableau de bord de la démo.
 *
 * La route est protégée comme `/demo/simulate` : on envoie la même clé
 * interne, lue dans `VITE_DEMO_INTERNAL_KEY`.
 */
export function fetchMetrics(): Promise<DemoMetrics> {
  return requestJson<DemoMetrics>("/demo/metrics", {
    headers: {
      accept: "application/json",
      "x-internal-key": DEMO_INTERNAL_KEY,
    },
  });
}

/** `GET /deliverables/:id/download` — 402 tant que le livrable n'est pas débloqué. */
export function fetchDownloadLink(id: string): Promise<DownloadLinkView> {
  return requestJson<DownloadLinkView>(
    `/deliverables/${encodeURIComponent(id)}/download`,
    { headers: { accept: "application/json" } },
  );
}

/**
 * Réécrit le lien signé vers l'endpoint qui sert réellement le texte.
 *
 * Le cœur signe une URL `/deliverables/:id/download?token=…`, alors que le
 * contenu est lu par `/deliverables/:id/content?token=…`. On conserve donc le
 * jeton et on ne remplace que le dernier segment ; si le cœur finit par signer
 * `/content`, l'URL est utilisée telle quelle.
 */
function contentPathFor(
  id: string,
  signedUrl: string,
  extra: Record<string, string> = {},
): string {
  const parsed = new URL(signedUrl, window.location.origin);
  const token = parsed.searchParams.get("token");
  if (!token) {
    throw new ApiError(
      0,
      "INVALID_DOWNLOAD_LINK",
      "Lien de téléchargement sans jeton signé.",
    );
  }
  const params = new URLSearchParams({ token, ...extra });
  const suffix = `?${params.toString()}`;
  if (parsed.pathname.endsWith("/content")) {
    return `${parsed.pathname}${suffix}`;
  }
  return `/deliverables/${encodeURIComponent(id)}/content${suffix}`;
}

/**
 * Récupère le texte complet du livrable via un lien signé à durée courte.
 * Ne fonctionne que pour un livrable `unlocked` (sinon 402 / 403).
 */
export async function fetchDeliverableText(
  id: string,
  format: ContentFormat = "html",
): Promise<string> {
  const link = await fetchDownloadLink(id);
  const path = contentPathFor(id, link.url, { format });

  let response: Response;
  try {
    response = await fetch(path, {
      headers: { accept: format === "html" ? "text/html" : "text/markdown" },
    });
  } catch {
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      "Impossible de récupérer le fichier : API de démo injoignable.",
    );
  }

  if (!response.ok) {
    if (response.status === 402) {
      throw new ApiError(
        402,
        "PAYMENT_REQUIRED",
        "Le livrable n'est pas encore débloqué : le fichier reste côté serveur.",
      );
    }
    if (response.status === 403) {
      throw new ApiError(
        403,
        "INVALID_DOWNLOAD_LINK",
        "Lien de téléchargement expiré ou invalide — relancez le téléchargement.",
      );
    }
    throw new ApiError(
      response.status,
      `HTTP_${response.status}`,
      `Téléchargement impossible (HTTP ${response.status}).`,
    );
  }

  return response.text();
}

/**
 * URL signée (même origine, via le proxy Vite) du CV autonome avec sa barre
 * « Imprimer / PDF ». Le jeton expire après quelques minutes.
 */
export async function signedViewerUrl(id: string): Promise<string> {
  const link = await fetchDownloadLink(id);
  return contentPathFor(id, link.url, { format: "html", toolbar: "1" });
}
