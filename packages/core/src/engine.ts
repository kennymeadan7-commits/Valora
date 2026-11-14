import { randomUUID } from "node:crypto";
import {
  ConflictError,
  DeliverableNotFoundError,
  InvalidSignatureError,
  InvalidTransitionError,
  MissingPriceError,
  PaymentRequiredError,
} from "./errors.js";
import { canTransition } from "./machine.js";
import {
  signDownloadToken,
  verifyDownloadToken as verifyToken,
} from "./signing.js";
import {
  CURRENCY,
  type CreatePaymentInput,
  type Deliverable,
  type DownloadLink,
  type PaymentProvider,
  type PaymentStatus,
  type PreviewStrategy,
  type Pricing,
  type PublicDeliverable,
  type Storage,
  type TransitionMeta,
} from "./types.js";

export interface PreviewPayOptions {
  storage: Storage;
  provider: PaymentProvider;
  preview: PreviewStrategy;
  pricing: Pricing;
  maxRegenerations?: number;
  download: { secret: string; baseUrl: string; ttlSeconds?: number };
  now?: () => Date;
  generateId?: () => string;
}

export interface CreateDeliverableInput {
  type: string;
  content: unknown;
  maxRegenerations?: number;
}

export interface PayInput {
  phone: string;
  operator: string;
}

export interface WebhookOutcome {
  received: true;
  duplicate: boolean;
  state?: string;
}

const DEFAULT_TTL_SECONDS = 300;
const REMOTE_STATUSES = new Set<PaymentStatus>([
  "declined",
  "canceled",
  "expired",
]);

/**
 * Moteur PreviewPay : seul endroit où la machine à états, le prix et
 * l'idempotence sont décidés. Aucune dépendance de framework.
 */
export class PreviewPay {
  private readonly storage: Storage;
  private readonly provider: PaymentProvider;
  private readonly preview: PreviewStrategy;
  private readonly pricing: Pricing;
  private readonly maxRegenerations: number;
  private readonly secret: string;
  private readonly baseUrl: string;
  private readonly ttlSeconds: number;
  private readonly now: () => Date;
  private readonly generateId: () => string;

  constructor(opts: PreviewPayOptions) {
    this.storage = opts.storage;
    this.provider = opts.provider;
    this.preview = opts.preview;
    this.pricing = opts.pricing;
    this.maxRegenerations = opts.maxRegenerations ?? 2;
    this.secret = opts.download.secret;
    this.baseUrl = opts.download.baseUrl.replace(/\/$/, "");
    this.ttlSeconds = opts.download.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    this.now = opts.now ?? (() => new Date());
    this.generateId = opts.generateId ?? (() => randomUUID());
  }

  // ---------------------------------------------------------------- création

  async create(input: CreateDeliverableInput): Promise<PublicDeliverable> {
    const price = this.pricing[input.type];
    if (price === undefined) throw new MissingPriceError(input.type);
    if (!Number.isInteger(price) || price <= 0) {
      throw new ConflictError(
        `Le prix du type « ${input.type} » doit être un entier positif en XOF`,
      );
    }

    const now = this.now();
    const preview = await this.preview.makePreview(input.content, {
      type: input.type,
    });

    const deliverable: Deliverable = {
      id: this.generateId(),
      type: input.type,
      state: "draft",
      price,
      currency: CURRENCY,
      content: input.content,
      preview,
      paymentId: null,
      paymentUrl: null,
      regenerations: 0,
      maxRegenerations: input.maxRegenerations ?? this.maxRegenerations,
      createdAt: now,
      updatedAt: now,
    };

    await this.storage.saveDeliverable(deliverable);
    const moved = await this.storage.transition(
      deliverable.id,
      "draft",
      "previewed",
      { cause: "preview.created" },
    );
    if (!moved) {
      throw new ConflictError("Le livrable n'a pas pu être prévisualisé");
    }

    return this.toPublic({ ...deliverable, state: "previewed" });
  }

  // ----------------------------------------------------------------- lecture

  async get(id: string): Promise<PublicDeliverable> {
    return this.toPublic(await this.load(id));
  }

  // ------------------------------------------------------------------ refus

  /**
   * Refus de l'aperçu : régénère dans la limite autorisée, sinon clôt le
   * livrable en `rejected` — sans frais.
   */
  async reject(
    id: string,
    reason: string,
  ): Promise<{ regenerated: boolean; deliverable: PublicDeliverable }> {
    const d = await this.load(id);
    if (d.state !== "previewed") {
      throw new InvalidTransitionError(d.state, "rejected");
    }

    const canRegenerate = d.regenerations < d.maxRegenerations;
    if (canRegenerate) {
      const preview = await this.preview.makePreview(d.content, {
        type: d.type,
      });
      const next: Deliverable = {
        ...d,
        preview,
        regenerations: d.regenerations + 1,
        updatedAt: this.now(),
      };
      await this.storage.saveDeliverable(next);
      await this.storage.appendJournal({
        deliverableId: d.id,
        from: "previewed",
        to: "previewed",
        at: this.now(),
        cause: `preview.rejected:${reason}`,
      });
      return { regenerated: true, deliverable: this.toPublic(next) };
    }

    const moved = await this.storage.transition(id, "previewed", "rejected", {
      cause: `preview.rejected:${reason}`,
    });
    if (!moved) throw new ConflictError("Transition refusée par le stockage");
    return { regenerated: false, deliverable: this.toPublic(await this.load(id)) };
  }

  // ---------------------------------------------------------------- paiement

  async pay(id: string, input: PayInput): Promise<PublicDeliverable> {
    const d = await this.load(id);
    if (!canTransition(d.state, "payment_pending")) {
      throw new InvalidTransitionError(d.state, "payment_pending");
    }
    if (!Number.isInteger(d.price) || d.price <= 0) {
      throw new ConflictError("Prix du livrable invalide");
    }

    const reserved = await this.storage.transition(
      id,
      "previewed",
      "payment_pending",
      { cause: "payment.requested" },
    );
    if (!reserved) {
      throw new ConflictError("Paiement déjà en cours pour ce livrable");
    }

    const paymentInput: CreatePaymentInput = {
      amount: d.price,
      currency: d.currency,
      phone: input.phone,
      operator: input.operator,
      reference: d.id,
    };

    let paymentId: string;
    let paymentUrl: string | null = null;
    try {
      const created = await this.provider.createPayment(paymentInput);
      paymentId = created.paymentId;
      paymentUrl = created.paymentUrl ?? null;
    } catch (err) {
      // On relâche la réservation : le livrable redevient relançable.
      await this.storage.transition(id, "payment_pending", "previewed", {
        cause: "payment.create_failed",
      });
      throw err;
    }

    const current = await this.load(id);
    await this.storage.saveDeliverable({
      ...current,
      paymentId,
      paymentUrl,
      updatedAt: this.now(),
    });

    return this.toPublic({ ...current, paymentId, paymentUrl });
  }

  /**
   * Réconciliation : interroge le fournisseur et applique le statut.
   * Utilisé pour `expired` (aucun webhook documenté) et comme filet de
   * sécurité quand un webhook est perdu.
   */
  async syncPayment(id: string): Promise<PublicDeliverable> {
    const d = await this.load(id);
    if (!d.paymentId) return this.toPublic(d);

    const status = await this.provider.getPaymentStatus(d.paymentId);
    await this.applyPaymentStatus(d, status, {
      cause: `payment.synced:${status}`,
      paymentId: d.paymentId,
    });
    return this.toPublic(await this.load(id));
  }

  // ---------------------------------------------------------------- webhook

  async handleWebhook(
    rawBody: Buffer,
    headers: Record<string, string>,
  ): Promise<WebhookOutcome> {
    const event = await this.provider.parseWebhook(rawBody, headers);

    // Idempotence : l'événement est enregistré avant tout effet de bord.
    const fresh = await this.storage.recordEvent({
      id: event.eventId,
      type: event.type,
      paymentId: event.paymentId,
      receivedAt: this.now(),
      payload: undefined,
    });
    if (!fresh) return { received: true, duplicate: true };

    const d = await this.storage.getDeliverableByPayment(event.paymentId);
    if (!d) return { received: true, duplicate: false };

    // Un webhook ne suffit jamais : on revérifie auprès du fournisseur.
    const status = await this.provider.getPaymentStatus(event.paymentId);
    await this.applyPaymentStatus(d, status, {
      cause: `webhook:${event.type}`,
      eventId: event.eventId,
      paymentId: event.paymentId,
    });

    const updated = await this.load(d.id);
    return { received: true, duplicate: false, state: updated.state };
  }

  // ----------------------------------------------------------- téléchargement

  async download(id: string): Promise<DownloadLink> {
    const d = await this.load(id);
    if (d.state !== "unlocked") throw new PaymentRequiredError();

    const expiresAt = new Date(this.now().getTime() + this.ttlSeconds * 1000);
    const token = signDownloadToken(
      { deliverableId: d.id, expiresAt: expiresAt.getTime() },
      this.secret,
    );
    return {
      url: `${this.baseUrl}/deliverables/${d.id}/download?token=${encodeURIComponent(token)}`,
      expiresAt,
    };
  }

  async verifyDownloadToken(token: string): Promise<Deliverable> {
    const payload = verifyToken(token, this.secret, this.now());
    if (!payload) throw new InvalidSignatureError();
    const d = await this.load(payload.deliverableId);
    if (d.state !== "unlocked") throw new PaymentRequiredError();
    return d;
  }

  // ----------------------------------------------------------------- interne

  private async applyPaymentStatus(
    d: Deliverable,
    status: PaymentStatus,
    meta: TransitionMeta,
  ): Promise<void> {
    if (status === "approved") {
      if (d.state === "unlocked") return;
      await this.storage.transition(d.id, "payment_pending", "unlocked", meta);
      return;
    }
    if (REMOTE_STATUSES.has(status)) {
      if (d.state !== "payment_pending") return;
      await this.storage.transition(d.id, "payment_pending", "previewed", {
        ...meta,
        cause: `${meta.cause}:relaunchable`,
      });
    }
  }

  private async load(id: string): Promise<Deliverable> {
    const d = await this.storage.getDeliverable(id);
    if (!d) throw new DeliverableNotFoundError(id);
    return d;
  }

  private toPublic(d: Deliverable): PublicDeliverable {
    const unlocked = d.state === "unlocked";
    const expiresAt = new Date(this.now().getTime() + this.ttlSeconds * 1000);
    const token = signDownloadToken(
      { deliverableId: d.id, expiresAt: expiresAt.getTime() },
      this.secret,
    );
    return {
      id: d.id,
      type: d.type,
      state: d.state,
      price: d.price,
      currency: d.currency,
      preview: d.preview,
      regenerations: d.regenerations,
      maxRegenerations: d.maxRegenerations,
      downloadUrl: unlocked
        ? `${this.baseUrl}/deliverables/${d.id}/download?token=${encodeURIComponent(token)}`
        : null,
      paymentUrl: d.paymentUrl ?? null,
    };
  }
}
