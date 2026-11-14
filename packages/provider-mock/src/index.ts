import { createHmac, timingSafeEqual } from "node:crypto";
import {
  InvalidSignatureError,
  type CreatePaymentInput,
  type ParsedWebhook,
  type PaymentProvider,
  type PaymentStatus,
} from "@previewpay/core";

export interface MockProviderOptions {
  /** Secret partagé pour signer/vérifier les webhooks de test. */
  secret?: string;
}

export interface MockWebhookBody {
  id: string;
  type: string;
  data: { transaction: { id: string } };
}

const EVENT_BY_STATUS: Record<PaymentStatus, string> = {
  pending: "transaction.created",
  approved: "transaction.approved",
  declined: "transaction.declined",
  canceled: "transaction.canceled",
  expired: "transaction.expired",
};

/**
 * Fournisseur de paiement simulé : aucun réseau, statuts pilotables depuis les
 * tests ou la démo. Signe ses webhooks en HMAC-SHA256 comme le fera FedaPay.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock";

  private readonly secret: string;
  private readonly statuses = new Map<string, PaymentStatus>();
  private readonly payments = new Map<string, CreatePaymentInput>();
  private seq = 0;

  constructor(opts: MockProviderOptions = {}) {
    this.secret = opts.secret ?? "mock_webhook_secret";
  }

  async createPayment(
    input: CreatePaymentInput,
  ): Promise<{ paymentId: string }> {
    const paymentId = `mock_pay_${++this.seq}`;
    this.payments.set(paymentId, { ...input });
    this.statuses.set(paymentId, "pending");
    return { paymentId };
  }

  async getPaymentStatus(paymentId: string): Promise<PaymentStatus> {
    return this.statuses.get(paymentId) ?? "pending";
  }

  async parseWebhook(
    rawBody: Buffer,
    headers: Record<string, string>,
  ): Promise<ParsedWebhook> {
    const given = headers["x-mock-signature"] ?? headers["X-Mock-Signature"];
    if (!given) throw new InvalidSignatureError();

    const expected = createHmac("sha256", this.secret)
      .update(rawBody)
      .digest("base64url");
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new InvalidSignatureError();
    }

    const body = JSON.parse(rawBody.toString("utf8")) as MockWebhookBody;
    return {
      eventId: body.id,
      paymentId: body.data.transaction.id,
      type: body.type,
    };
  }

  // -------------------------------------------------- pilotage pour les tests

  setStatus(paymentId: string, status: PaymentStatus): void {
    this.statuses.set(paymentId, status);
  }

  getPaymentInput(paymentId: string): CreatePaymentInput | undefined {
    return this.payments.get(paymentId);
  }

  /** Construit un webhook signé pour `paymentId`, avec un id d'événement. */
  buildWebhook(
    paymentId: string,
    opts: { eventId?: string; status?: PaymentStatus } = {},
  ): { rawBody: Buffer; headers: Record<string, string>; body: MockWebhookBody } {
    const status = opts.status ?? this.statuses.get(paymentId) ?? "pending";
    const body: MockWebhookBody = {
      id: opts.eventId ?? `evt_${paymentId}_${status}`,
      type: EVENT_BY_STATUS[status],
      data: { transaction: { id: paymentId } },
    };
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature = createHmac("sha256", this.secret)
      .update(rawBody)
      .digest("base64url");
    return {
      rawBody,
      headers: { "x-mock-signature": signature },
      body,
    };
  }
}
