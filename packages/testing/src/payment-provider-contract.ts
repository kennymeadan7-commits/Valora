import { beforeEach, describe, expect, it } from "vitest";
import {
  InvalidSignatureError,
  type CreatePaymentInput,
  type PaymentProvider,
  type PaymentStatus,
} from "@previewpay/core";

/**
 * Suite de contrat commune à toutes les implémentations de `PaymentProvider`.
 *
 * `simulate` est la seule partie spécifique à l'adaptateur : elle fabrique un
 * webhook signé et pilote le statut d'un paiement. Pour `provider-fedapay`,
 * elle s'appuie sur un client HTTP bouchonné, jamais sur le réseau.
 */
export interface SimulatedWebhook {
  rawBody: Buffer;
  headers: Record<string, string>;
}

export interface WebhookSimulationOptions {
  status?: PaymentStatus;
  eventId?: string;
}

export interface PaymentProviderSimulator {
  /** Fixe le statut que `getPaymentStatus` renverra ensuite. */
  setStatus(paymentId: string, status: PaymentStatus): Promise<void> | void;
  /** Construit un webhook signé pour le paiement donné. */
  webhook(
    paymentId: string,
    options?: WebhookSimulationOptions,
  ): Promise<SimulatedWebhook> | SimulatedWebhook;
}

export interface PaymentProviderContractOptions {
  /** Fabrique un fournisseur. Appelée avant chaque test. */
  create: () => Promise<PaymentProvider> | PaymentProvider;
  /** Branche les capacités de simulation sur le fournisseur fabriqué. */
  simulate: (provider: PaymentProvider) => PaymentProviderSimulator;
}

const PAYMENT_INPUT: CreatePaymentInput = {
  amount: 200,
  currency: "XOF",
  phone: "+22990000000",
  operator: "mtn_benin",
  reference: "dlv_contract",
};

export function describePaymentProviderContract({
  create,
  simulate,
}: PaymentProviderContractOptions): void {
  describe("contrat PaymentProvider", () => {
    let provider: PaymentProvider;
    let simulator: PaymentProviderSimulator;

    beforeEach(async () => {
      provider = await create();
      simulator = simulate(provider);
    });

    it("createPayment renvoie un identifiant non vide", async () => {
      const payment = await provider.createPayment(PAYMENT_INPUT);

      expect(typeof payment.paymentId).toBe("string");
      expect(payment.paymentId.length).toBeGreaterThan(0);
    });

    it("getPaymentStatus renvoie `pending` juste après la création", async () => {
      const { paymentId } = await provider.createPayment(PAYMENT_INPUT);

      expect(await provider.getPaymentStatus(paymentId)).toBe("pending");
    });

    it("le simulateur pilote le statut relu par getPaymentStatus", async () => {
      const { paymentId } = await provider.createPayment(PAYMENT_INPUT);

      await simulator.setStatus(paymentId, "approved");

      expect(await provider.getPaymentStatus(paymentId)).toBe("approved");
    });

    it("parseWebhook accepte un webhook signé", async () => {
      const { paymentId } = await provider.createPayment(PAYMENT_INPUT);
      const hook = await simulator.webhook(paymentId, {
        status: "approved",
        eventId: "evt_contract",
      });

      const parsed = await provider.parseWebhook(hook.rawBody, hook.headers);

      expect(parsed.paymentId).toBe(paymentId);
      expect(parsed.eventId.length).toBeGreaterThan(0);
      expect(parsed.type.length).toBeGreaterThan(0);
    });

    it("parseWebhook dérive un eventId stable pour le même événement", async () => {
      const { paymentId } = await provider.createPayment(PAYMENT_INPUT);
      const hook = await simulator.webhook(paymentId, { status: "approved" });

      const first = await provider.parseWebhook(hook.rawBody, hook.headers);
      const again = await provider.parseWebhook(hook.rawBody, hook.headers);

      expect(again.eventId).toBe(first.eventId);
    });

    it("parseWebhook rejette une signature invalide", async () => {
      const { paymentId } = await provider.createPayment(PAYMENT_INPUT);
      const hook = await simulator.webhook(paymentId, { status: "approved" });

      // Corps altéré, signature d'origine : le HMAC ne couvre plus le corps.
      const tamperedBody = Buffer.concat([
        hook.rawBody,
        Buffer.from(" "),
      ]);
      await expect(
        provider.parseWebhook(tamperedBody, hook.headers),
      ).rejects.toBeInstanceOf(InvalidSignatureError);

      // Signature absente.
      await expect(
        provider.parseWebhook(hook.rawBody, {}),
      ).rejects.toBeInstanceOf(InvalidSignatureError);
    });
  });
}
