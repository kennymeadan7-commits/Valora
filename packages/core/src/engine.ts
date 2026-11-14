import { randomUUID } from "node:crypto";
import {
  ConflictError,
  DeliverableNotFoundError,
  InvalidSignatureError,
  InvalidTransitionError,
  MissingPriceError,
  PaymentRequiredError,
  PreviewLimitError,
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
  /** Limites anti-abus (désactivées par défaut). */
  limits?: PreviewPayLimits;
  /**
   * Réconciliation automatique des paiements en attente (activée par défaut).
   * `false` la désactive : il faut alors appeler `syncPayment` soi-même.
   */
  reconcile?: false | Partial<ReconcileOptions>;
  now?: () => Date;
  generateId?: () => string;
}

export interface PreviewPayLimits {
  /**
   * Nombre maximal de livrables (donc d'aperçus gratuits) par `ownerId` sur
   * une fenêtre glissante de 24 h. Ne s'applique qu'aux créations qui
   * fournissent un `ownerId`.
   */
  previewsPerOwnerPerDay?: number;
}

/**
 * Filet de sécurité quand le webhook n'arrive pas (perdu, retardé, ou statut
 * `expired` qui n'a pas de webhook) : lire un livrable `payment_pending`
 * déclenche une relecture du statut chez le fournisseur.
 */
export interface ReconcileOptions {
  /** Ancienneté minimale du paiement avant la première relecture (laisse sa chance au webhook). */
  afterMs: number;
  /** Intervalle minimal entre deux relectures d'un même livrable. */
  everyMs: number;
}

export const DEFAULT_RECONCILE: ReconcileOptions = { afterMs: 10_000, everyMs: 10_000 };

export interface CreateDeliverableInput {
  type: string;
  content: unknown;
  maxRegenerations?: number;
  /** Utilisateur final (identifiant opaque) — active la limite d'aperçus. */
  ownerId?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

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
  private readonly previewsPerOwnerPerDay: number | null;
  private readonly reconcile: ReconcileOptions | null;
  /** Dernière relecture par livrable (mémoire du processus, purgée hors attente). */
  private readonly lastReconcile = new Map<string, number>();

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

    const perDay = opts.limits?.previewsPerOwnerPerDay;
    if (perDay !== undefined && (!Number.isInteger(perDay) || perDay < 1)) {
      throw new TypeError("limits.previewsPerOwnerPerDay doit être un entier ≥ 1");
    }
    this.previewsPerOwnerPerDay = perDay ?? null;

    this.reconcile =
      opts.reconcile === false ? null : { ...DEFAULT_RECONCILE, ...(opts.reconcile ?? {}) };
    if (
      this.reconcile &&
      (!(this.reconcile.afterMs >= 0) || !(this.reconcile.everyMs >= 0))
    ) {
      throw new TypeError("reconcile.afterMs et reconcile.everyMs doivent être ≥ 0");
    }
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
    const ownerId = input.ownerId?.trim() || null;

    // Contrôlé *avant* la génération de l'aperçu : un aperçu refusé ne coûte
    // rien. Compter puis créer n'est pas atomique ; deux requêtes simultanées
    // peuvent dépasser la limite d'une unité, ce qui reste acceptable ici.
    if (ownerId !== null && this.previewsPerOwnerPerDay !== null) {
      const since = new Date(now.getTime() - DAY_MS);
      const used = await this.storage.countDeliverablesByOwner(ownerId, since);
      if (used >= this.previewsPerOwnerPerDay) {
        throw new PreviewLimitError(
          this.previewsPerOwnerPerDay,
          new Date(now.getTime() + DAY_MS),
        );
      }
    }

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
      ownerId,
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

  /**
   * Vue publique. Si le livrable attend un paiement depuis au moins
   * `reconcile.afterMs`, le statut est relu chez le fournisseur (au plus une
   * fois par `reconcile.everyMs`) : un webhook perdu ou une expiration ne
   * laissent plus le livrable bloqué. Une panne du fournisseur ne fait jamais
   * échouer la lecture.
   */
  async get(id: string): Promise<PublicDeliverable> {
    const d = await this.load(id);
    return this.toPublic(await this.reconcileIfDue(d));
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
      url: `${this.baseUrl}/deliverables/${d.id}/content?token=${encodeURIComponent(token)}`,
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

  private async reconcileIfDue(d: Deliverable): Promise<Deliverable> {
    if (d.state !== "payment_pending" || !d.paymentId || !this.reconcile) {
      this.lastReconcile.delete(d.id);
      return d;
    }
    const now = this.now().getTime();
    if (now - d.updatedAt.getTime() < this.reconcile.afterMs) return d;
    const last = this.lastReconcile.get(d.id);
    if (last !== undefined && now - last < this.reconcile.everyMs) return d;

    this.lastReconcile.set(d.id, now);
    try {
      const status = await this.provider.getPaymentStatus(d.paymentId);
      await this.applyPaymentStatus(d, status, {
        cause: `payment.reconciled:${status}`,
        paymentId: d.paymentId,
      });
      return await this.load(d.id);
    } catch {
      // Fournisseur injoignable : on renvoie l'état connu, on retentera.
      return d;
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
        ? `${this.baseUrl}/deliverables/${d.id}/content?token=${encodeURIComponent(token)}`
        : null,
      paymentUrl: d.paymentUrl ?? null,
    };
  }
}
