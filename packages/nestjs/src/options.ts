import type {
  PaymentProvider,
  PreviewPayLimits,
  PreviewPayOptions,
  Pricing,
  PreviewStrategy,
  Storage,
} from "@previewpay/core";

/** Limitation de débit appliquée à `POST /deliverables/:id/pay`. */
export interface RateLimitOptions {
  /** Nombre de tentatives autorisées par clé (IP + livrable) et par fenêtre. */
  max: number;
  /** Durée de la fenêtre glissante, en millisecondes. */
  windowMs: number;
}

/**
 * Options du module NestJS. Elles ne contiennent aucune règle métier : le
 * module se contente de transmettre les dépendances au cœur.
 *
 * Aucun secret ne doit être écrit en dur : `download.secret` est la seule
 * valeur sensible attendue ici, et elle peut venir de
 * `PREVIEWPAY_DOWNLOAD_SECRET`.
 */
export interface PreviewPayModuleOptions {
  storage: Storage;
  provider: PaymentProvider;
  pricing: Pricing;
  preview: PreviewStrategy;
  /**
   * Signature et base des liens de téléchargement.
   * `secret` : obligatoire (ou `PREVIEWPAY_DOWNLOAD_SECRET`).
   * `baseUrl` : préfixe d'URL, `PREVIEWPAY_DOWNLOAD_BASE_URL` sinon.
   */
  download?: {
    secret?: string;
    baseUrl?: string;
    ttlSeconds?: number;
  };
  /** Régénérations autorisées après un refus (2 par défaut, côté cœur). */
  maxRegenerations?: number;
  /**
   * Limites anti-abus du cœur, ex. `{ previewsPerOwnerPerDay: 5 }`. La limite
   * s'applique aux créations qui portent un `ownerId` (429 au-delà).
   */
  limits?: PreviewPayLimits;
  /**
   * Si fourni, `POST /deliverables` exige l'en-tête `x-internal-key` égal à
   * cette valeur. Absent : la garde est désactivée (à réserver au
   * développement local).
   */
  internalApiKey?: string;
  /** `false` désactive la limitation ; absent : 5 tentatives / minute. */
  rateLimit?: false | Partial<RateLimitOptions>;
  now?: () => Date;
  generateId?: () => string;
}

/** Options normalisées, telles que consommées par le module et ses gardes. */
export interface ResolvedPreviewPayOptions {
  /** Options transmises telles quelles au moteur du cœur. */
  core: PreviewPayOptions;
  /** `null` quand la garde `x-internal-key` est désactivée. */
  internalApiKey: string | null;
  /** `null` quand la limitation de débit est désactivée. */
  rateLimit: RateLimitOptions | null;
}

export const DEFAULT_RATE_LIMIT: RateLimitOptions = {
  max: 5,
  windowMs: 60_000,
};

/**
 * Valide et normalise les options du module. Les erreurs de configuration sont
 * levées au démarrage, pas à la première requête.
 */
export function resolveOptions(
  options: PreviewPayModuleOptions,
): ResolvedPreviewPayOptions {
  if (
    !options ||
    !options.storage ||
    !options.provider ||
    !options.pricing ||
    !options.preview
  ) {
    throw new Error(
      "PreviewPayModule.forRoot : `storage`, `provider`, `pricing` et `preview` sont requis",
    );
  }

  const secret =
    options.download?.secret ?? process.env["PREVIEWPAY_DOWNLOAD_SECRET"];
  if (!secret) {
    throw new Error(
      "PreviewPayModule.forRoot : `download.secret` est requis (ou la variable d'environnement PREVIEWPAY_DOWNLOAD_SECRET) — aucun secret en dur",
    );
  }

  const baseUrl =
    options.download?.baseUrl ??
    process.env["PREVIEWPAY_DOWNLOAD_BASE_URL"] ??
    "";

  const core: PreviewPayOptions = {
    storage: options.storage,
    provider: options.provider,
    pricing: options.pricing,
    preview: options.preview,
    download: {
      secret,
      baseUrl,
      ...(options.download?.ttlSeconds !== undefined
        ? { ttlSeconds: options.download.ttlSeconds }
        : {}),
    },
    ...(options.maxRegenerations !== undefined
      ? { maxRegenerations: options.maxRegenerations }
      : {}),
    ...(options.limits ? { limits: options.limits } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.generateId ? { generateId: options.generateId } : {}),
  };

  const rateLimit: RateLimitOptions | null =
    options.rateLimit === false
      ? null
      : { ...DEFAULT_RATE_LIMIT, ...(options.rateLimit ?? {}) };

  if (rateLimit && (!Number.isInteger(rateLimit.max) || rateLimit.max <= 0)) {
    throw new Error(
      "PreviewPayModule.forRoot : `rateLimit.max` doit être un entier positif",
    );
  }

  const internalApiKey =
    typeof options.internalApiKey === "string" && options.internalApiKey !== ""
      ? options.internalApiKey
      : null;

  return { core, internalApiKey, rateLimit };
}
