import { timingSafeEqual } from "node:crypto";
import { Router, json, raw } from "express";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type {
  CreateDeliverableInput,
  Deliverable,
  PayInput,
  PreviewPay,
} from "@previewpay/core";
import { HttpError, toHttpError } from "./errors.js";

/**
 * Routeur Express de PreviewPay : les mêmes six endpoints que
 * `@previewpay/nestjs`, avec les mêmes garanties.
 *
 * ```
 * POST   /deliverables                création côté serveur (x-internal-key)
 * GET    /deliverables/:id            statut, prix, aperçu — jamais le contenu
 * POST   /deliverables/:id/pay        { phone, operator } → payment_pending
 * POST   /deliverables/:id/reject     { reason } → régénère, sinon rejette
 * GET    /deliverables/:id/download   lien signé, 402 avant paiement
 * POST   /webhooks/fedapay            signature vérifiée sur le corps brut
 * GET    /deliverables/:id/content    (optionnel, `serveContent`) jeton vérifié
 * ```
 *
 * Toute règle métier reste dans le cœur : ce fichier ne fait que valider les
 * entrées, appeler `PreviewPay` et traduire ses erreurs.
 */

export interface RateLimitOptions {
  /** Tentatives autorisées par fenêtre, par couple (IP, livrable). */
  max: number;
  /** Durée de la fenêtre glissante, en millisecondes. */
  windowMs: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitOptions = { max: 5, windowMs: 60_000 };

export interface PreviewPayRouterOptions {
  /** Moteur du cœur, construit par l'hôte (`new PreviewPay({ … })`). */
  previewPay: PreviewPay;
  /**
   * Si fournie, `POST /deliverables` exige `x-internal-key` égal à cette
   * valeur. Absente : la garde est désactivée (développement local).
   */
  internalApiKey?: string;
  /** Limitation de débit de `/pay` ; `false` la désactive. */
  rateLimit?: false | Partial<RateLimitOptions>;
  /** Chemin du webhook (défaut `/webhooks/fedapay`). */
  webhookPath?: string;
  /**
   * Sert le contenu débloqué sur `GET /deliverables/:id/content?token=…`.
   * Le routeur vérifie le jeton signé et l'identifiant **avant** d'appeler
   * ce gestionnaire ; sans lui, la route n'existe pas et reste à l'hôte.
   */
  serveContent?: (deliverable: Deliverable, req: Request, res: Response) => unknown;
  /** Taille max des corps JSON (défaut `1mb`). */
  jsonLimit?: string;
}

/* -------------------------------------------------------------- validation */

function asObject(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body) || Buffer.isBuffer(body)) {
    throw new HttpError(400, "BAD_REQUEST", "Le corps de la requête doit être un objet JSON");
  }
  return body as Record<string, unknown>;
}

function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(
      400,
      "BAD_REQUEST",
      `Le champ « ${field} » est requis et doit être une chaîne non vide`,
    );
  }
  return value.trim();
}

export function parseCreateInput(body: unknown): CreateDeliverableInput {
  const obj = asObject(body);
  const type = requireString(obj, "type");
  if (obj["content"] === undefined || obj["content"] === null) {
    throw new HttpError(400, "BAD_REQUEST", "Le champ « content » est requis");
  }
  const maxRegenerations = obj["maxRegenerations"];
  if (
    maxRegenerations !== undefined &&
    (typeof maxRegenerations !== "number" || !Number.isInteger(maxRegenerations) || maxRegenerations < 0)
  ) {
    throw new HttpError(
      400,
      "BAD_REQUEST",
      "Le champ « maxRegenerations » doit être un entier positif ou nul",
    );
  }
  const ownerId = obj["ownerId"];
  if (
    ownerId !== undefined &&
    (typeof ownerId !== "string" || ownerId.trim() === "" || ownerId.length > 200)
  ) {
    throw new HttpError(
      400,
      "BAD_REQUEST",
      "Le champ « ownerId » doit être une chaîne non vide (200 caractères max)",
    );
  }
  return {
    type,
    content: obj["content"],
    ...(typeof maxRegenerations === "number" ? { maxRegenerations } : {}),
    ...(typeof ownerId === "string" ? { ownerId: ownerId.trim() } : {}),
  };
}

export function parsePayInput(body: unknown): PayInput {
  const obj = asObject(body);
  return { phone: requireString(obj, "phone"), operator: requireString(obj, "operator") };
}

export function parseRejectInput(body: unknown): { reason: string } {
  return { reason: requireString(asObject(body), "reason") };
}

/* ----------------------------------------------------------------- gardes */

function safeEqual(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function internalKeyGuard(expected: string | undefined): RequestHandler {
  return (req, _res, next) => {
    if (!expected) return next();
    const header = req.headers["x-internal-key"];
    const given = Array.isArray(header) ? header[0] : header;
    if (!given || !safeEqual(given, expected)) {
      return next(
        new HttpError(
          401,
          "INVALID_INTERNAL_KEY",
          "Clé interne absente ou invalide : POST /deliverables est réservé au serveur de l'intégrateur",
        ),
      );
    }
    next();
  };
}

const MAX_TRACKED_KEYS = 1_000;

/**
 * Fenêtre glissante en mémoire, par (IP, livrable). Sur plusieurs instances,
 * placez un limiteur partagé (Redis…) devant le routeur.
 */
function rateLimitGuard(limit: RateLimitOptions | null): RequestHandler {
  const hits = new Map<string, number[]>();
  return (req, _res, next) => {
    if (!limit) return next();
    const key = `${req.ip ?? "inconnu"}|${String(req.params["id"] ?? "")}`;
    const now = Date.now();
    const windowStart = now - limit.windowMs;
    const recent = (hits.get(key) ?? []).filter((at) => at > windowStart);
    if (recent.length >= limit.max) {
      hits.set(key, recent);
      const retryAfter = Math.max(1, Math.ceil(((recent[0] ?? now) + limit.windowMs - now) / 1000));
      return next(
        new HttpError(
          429,
          "RATE_LIMITED",
          "Trop de tentatives de paiement : réessayez dans quelques instants",
          retryAfter,
        ),
      );
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > MAX_TRACKED_KEYS) {
      for (const [k, at] of hits) if (at.every((t) => t <= windowStart)) hits.delete(k);
    }
    next();
  };
}

/* ------------------------------------------------------------------ outils */

type AsyncHandler = (req: Request, res: Response) => Promise<unknown>;

/** Express 4 ne capture pas les rejets de promesse : on les relaie à `next`. */
function handle(fn: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

function normalizeHeaders(headers: Request["headers"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") out[key.toLowerCase()] = value;
    else if (Array.isArray(value) && value.length > 0) out[key.toLowerCase()] = value.join(", ");
  }
  return out;
}

/**
 * Corps brut du webhook. Le routeur installe `express.raw()` sur cette route,
 * mais si l'application a déjà analysé le corps (`express.json()` monté
 * avant), il ne reste que `req.rawBody` si l'hôte l'a conservé via `verify`.
 */
function rawBodyOf(req: Request): Buffer {
  if (Buffer.isBuffer(req.body)) return req.body;
  const kept = (req as Request & { rawBody?: unknown }).rawBody;
  if (Buffer.isBuffer(kept)) return kept;
  throw new HttpError(
    500,
    "RAW_BODY_UNAVAILABLE",
    "Corps brut indisponible pour vérifier la signature du webhook : montez le routeur PreviewPay avant express.json(), ou conservez le corps via express.json({ verify: (req, _res, buf) => { req.rawBody = buf } })",
  );
}

function param(req: Request, name: string): string {
  return String(req.params[name] ?? "");
}

/* ----------------------------------------------------------------- routeur */

export function createPreviewPayRouter(options: PreviewPayRouterOptions): Router {
  const { previewPay } = options;
  if (!previewPay) {
    throw new Error("createPreviewPayRouter : l'option `previewPay` (moteur du cœur) est requise");
  }

  const rateLimit =
    options.rateLimit === false ? null : { ...DEFAULT_RATE_LIMIT, ...(options.rateLimit ?? {}) };
  if (rateLimit && (!Number.isInteger(rateLimit.max) || rateLimit.max <= 0)) {
    throw new Error("createPreviewPayRouter : `rateLimit.max` doit être un entier positif");
  }

  const router = Router();
  const body = json({ limit: options.jsonLimit ?? "1mb" });
  const noStore: RequestHandler = (_req, res, next) => {
    res.setHeader("cache-control", "no-store");
    next();
  };

  // Le webhook d'abord, avec le corps brut : la signature porte dessus.
  router.post(
    options.webhookPath ?? "/webhooks/fedapay",
    raw({ type: () => true, limit: options.jsonLimit ?? "1mb" }),
    handle(async (req, res) => {
      const outcome = await previewPay.handleWebhook(rawBodyOf(req), normalizeHeaders(req.headers));
      res.status(200).json(outcome);
    }),
  );

  router.post(
    "/deliverables",
    internalKeyGuard(options.internalApiKey),
    body,
    handle(async (req, res) => {
      res.status(201).json(await previewPay.create(parseCreateInput(req.body)));
    }),
  );

  router.get(
    "/deliverables/:id",
    noStore,
    handle(async (req, res) => {
      res.json(await previewPay.get(param(req, "id")));
    }),
  );

  router.post(
    "/deliverables/:id/pay",
    rateLimitGuard(rateLimit),
    body,
    handle(async (req, res) => {
      res.json(await previewPay.pay(param(req, "id"), parsePayInput(req.body)));
    }),
  );

  router.post(
    "/deliverables/:id/reject",
    body,
    handle(async (req, res) => {
      const { reason } = parseRejectInput(req.body);
      res.json(await previewPay.reject(param(req, "id"), reason));
    }),
  );

  router.get(
    "/deliverables/:id/download",
    noStore,
    handle(async (req, res) => {
      const link = await previewPay.download(param(req, "id"));
      res.json({ url: link.url, expiresAt: link.expiresAt.toISOString() });
    }),
  );

  const serveContent = options.serveContent;
  if (serveContent) {
    router.get(
      "/deliverables/:id/content",
      noStore,
      handle(async (req, res) => {
        const token = typeof req.query["token"] === "string" ? req.query["token"] : "";
        if (token === "") throw new HttpError(403, "FORBIDDEN", "Jeton de téléchargement requis");
        const deliverable = await previewPay.verifyDownloadToken(token);
        if (deliverable.id !== param(req, "id")) {
          throw new HttpError(403, "FORBIDDEN", "Jeton valable pour un autre livrable");
        }
        await serveContent(deliverable, req, res);
      }),
    );
  }

  // Erreurs du cœur et du routeur → JSON { statusCode, code, message }.
  router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(error);
    const mapped = toHttpError(error);
    if (mapped.retryAfterSeconds !== undefined) {
      res.setHeader("retry-after", String(mapped.retryAfterSeconds));
    }
    // Erreur d'analyse JSON d'express (body-parser) : 400, pas 500.
    const parse = error as { type?: string; status?: number };
    if (mapped.code === "INTERNAL_ERROR" && parse?.type === "entity.parse.failed") {
      return res.status(400).json({ statusCode: 400, code: "BAD_REQUEST", message: "Corps JSON invalide" });
    }
    if (mapped.code === "INTERNAL_ERROR" && parse?.status === 413) {
      return res.status(413).json({ statusCode: 413, code: "PAYLOAD_TOO_LARGE", message: "Corps de requête trop volumineux" });
    }
    res.status(mapped.statusCode).json({
      statusCode: mapped.statusCode,
      code: mapped.code,
      message: mapped.message,
    });
  });

  return router;
}
