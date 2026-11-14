import { createHmac, timingSafeEqual } from "node:crypto";
import {
  InvalidSignatureError,
  type CreatePaymentInput,
  type ParsedWebhook,
  type PaymentProvider,
  type PaymentStatus,
} from "@previewpay/core";

/** Modes FedaPay qui acceptent un paiement direct, sans redirection. */
export const DIRECT_MODES = [
  "mtn_benin",
  "moov_benin",
  "moov_togo",
  "mtn_ci",
] as const;
export type DirectMode = (typeof DIRECT_MODES)[number];

export interface FedaPayOptions {
  secretKey: string;
  /** Secret de l'endpoint webhook (`wh_sandbox_…` / `wh_live_…`). */
  webhookSecret: string;
  environment?: "sandbox" | "live";
  callbackUrl?: string;
  /** Pays du numéro Mobile Money, format ISO 3166-1 alpha-2 minuscule (bj). */
  phoneCountry?: string;
  description?: (input: CreatePaymentInput) => string;
  /** Tolérance du rejeu sur l'horodatage du webhook, en secondes (défaut 300). */
  toleranceSeconds?: number;
  /** Injectable pour les tests ; `globalThis.fetch` par défaut. */
  fetchImpl?: typeof fetch;
  nowSeconds?: () => number;
}

export interface FedaPayPayment {
  paymentId: string;
  /** Page de paiement FedaPay — repli quand l'opérateur ne fait pas de direct. */
  paymentUrl: string | null;
}

interface TransactionPayload {
  id: number;
  reference?: string;
  status?: string;
  merchant_reference?: string | null;
}

interface WebhookBody {
  name: string;
  object: string;
  entity: TransactionPayload & { updated_at?: string };
}

const STATUS_MAP: Record<string, PaymentStatus> = {
  pending: "pending",
  approved: "approved",
  declined: "declined",
  canceled: "canceled",
  cancelled: "canceled",
  expired: "expired",
  // `transferred` et `refunded` maintiennent le déblocage : on les traite
  // comme un succès déjà acquis (voir docs/DECISIONS.md).
  transferred: "approved",
  refunded: "approved",
};

/**
 * `PaymentProvider` FedaPay.
 *
 * Le schéma des webhooks (en-tête `x-fedapay-signature: t=…,s=…`, corps
 * `{ name, object, entity }`) a été relevé sur un vrai événement sandbox :
 * docs/samples/fedapay-transaction.created.json.
 */
export class FedaPayProvider implements PaymentProvider {
  readonly name = "fedapay";

  private readonly baseUrl: string;
  private readonly secretKey: string;
  private readonly webhookSecret: string;
  private readonly callbackUrl?: string;
  private readonly phoneCountry: string;
  private readonly description: (input: CreatePaymentInput) => string;
  private readonly tolerance: number;
  private readonly doFetch: typeof fetch;
  private readonly nowSeconds: () => number;

  constructor(opts: FedaPayOptions) {
    this.baseUrl =
      (opts.environment ?? "sandbox") === "live"
        ? "https://api.fedapay.com"
        : "https://sandbox-api.fedapay.com";
    this.secretKey = opts.secretKey;
    this.webhookSecret = opts.webhookSecret;
    this.callbackUrl = opts.callbackUrl;
    this.phoneCountry = opts.phoneCountry ?? "bj";
    this.description =
      opts.description ?? ((i) => `PreviewPay ${i.reference}`);
    this.tolerance = opts.toleranceSeconds ?? 300;
    this.doFetch = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.nowSeconds = opts.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  }

  async createPayment(input: CreatePaymentInput): Promise<FedaPayPayment> {
    const transaction = await this.request<TransactionPayload>(
      "POST",
      "/v1/transactions",
      {
        description: this.description(input),
        amount: input.amount,
        currency: { iso: input.currency },
        ...(this.callbackUrl ? { callback_url: this.callbackUrl } : {}),
        // Notre identifiant de livrable, retrouvable côté FedaPay.
        merchant_reference: input.reference,
        customer: {
          phone_number: {
            number: input.phone,
            country: this.phoneCountry,
          },
        },
      },
    );

    const token = await this.request<{ token: string; url: string }>(
      "POST",
      `/v1/transactions/${transaction.id}/token`,
      {},
    );

    return {
      paymentId: String(transaction.id),
      paymentUrl: token.url ?? null,
    };
  }

  /**
   * Paiement direct sans redirection (MTN/Moov). Le jeton est envoyé à
   * l'endpoint du mode choisi ; le numéro est optionnel côté FedaPay mais on
   * l'envoie toujours pour éviter d'utiliser celui du client enregistré.
   */
  async payDirect(
    transactionId: string,
    mode: DirectMode,
    phone: string,
  ): Promise<void> {
    const { token } = await this.request<{ token: string }>(
      "POST",
      `/v1/transactions/${transactionId}/token`,
      {},
    );
    await this.request("POST", `/v1/${mode}`, {
      token,
      phone_number: { number: phone, country: this.phoneCountry },
    });
  }

  async getPaymentStatus(paymentId: string): Promise<PaymentStatus> {
    const tx = await this.request<TransactionPayload>(
      "GET",
      `/v1/transactions/${paymentId}`,
    );
    return STATUS_MAP[tx.status ?? "pending"] ?? "pending";
  }

  async parseWebhook(
    rawBody: Buffer,
    headers: Record<string, string>,
  ): Promise<ParsedWebhook> {
    const signature = this.readSignatureHeader(headers);
    const { timestamp, signature: given } = this.splitSignature(signature);

    if (Math.abs(this.nowSeconds() - timestamp) > this.tolerance) {
      throw new InvalidSignatureError();
    }

    const expected = createHmac("sha256", this.webhookSecret)
      .update(`${timestamp}.`)
      .update(rawBody)
      .digest();
    const provided = Buffer.from(given, "hex");

    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw new InvalidSignatureError();
    }

    const body = JSON.parse(rawBody.toString("utf8")) as WebhookBody;
    if (!body?.entity?.id) throw new InvalidSignatureError();

    return {
      // FedaPay n'envoie pas d'identifiant d'événement : le couple
      // (nom, transaction) est stable entre deux réémissions.
      eventId: `${body.name}:${body.entity.id}`,
      paymentId: String(body.entity.id),
      type: body.name,
    };
  }

  // ----------------------------------------------------------------- interne

  private readSignatureHeader(headers: Record<string, string>): string {
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === "x-fedapay-signature") return value;
    }
    throw new InvalidSignatureError();
  }

  private splitSignature(header: string): { timestamp: number; signature: string } {
    const parts = new Map(
      header
        .split(",")
        .map((p) => p.trim().split("=") as [string, string]),
    );
    const t = Number(parts.get("t"));
    const s = parts.get("s");
    if (!Number.isFinite(t) || !s) throw new InvalidSignatureError();
    return { timestamp: t, signature: s };
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await this.doFetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`FedaPay ${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
    }
    const parsed = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
    // FedaPay enveloppe les entités : { "v1/transaction": { … } }.
    const wrapped = Object.keys(parsed).find((k) => k.startsWith("v1/"));
    return (wrapped ? parsed[wrapped] : parsed) as T;
  }
}
