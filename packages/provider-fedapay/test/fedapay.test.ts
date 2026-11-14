import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InvalidSignatureError } from "@previewpay/core";
import { DIRECT_MODES, FedaPayProvider } from "@previewpay/provider-fedapay";

const WEBHOOK_SECRET = "wh_sandbox_test_secret";
const NOW = 1_800_000_000;

interface Call {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

function stubFetch(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Call[] = [];
  let i = 0;
  const impl = (async (url: string, init: RequestInit = {}) => {
    calls.push({
      url,
      method: init.method ?? "GET",
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      headers: (init.headers ?? {}) as Record<string, string>,
    });
    const next = responses[i++] ?? { body: {} };
    const status = next.status ?? 200;
    return new Response(JSON.stringify(next.body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

function provider(responses: Array<{ status?: number; body: unknown }>) {
  const { calls, impl } = stubFetch(responses);
  const p = new FedaPayProvider({
    secretKey: "sk_sandbox_test",
    webhookSecret: WEBHOOK_SECRET,
    environment: "sandbox",
    callbackUrl: "https://api.test/callback",
    fetchImpl: impl,
    nowSeconds: () => NOW,
  });
  return { p, calls };
}

function sign(rawBody: string, timestamp = NOW, secret = WEBHOOK_SECRET) {
  const mac = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  return `t=${timestamp},s=${mac}`;
}

const webhookBody = JSON.stringify({
  name: "transaction.approved",
  object: "transaction",
  entity: { klass: "v1/transaction", id: 543440, status: "approved" },
  account: { id: 25615 },
});

describe("createPayment", () => {
  it("crée la transaction puis demande le jeton", async () => {
    const { p, calls } = provider([
      { body: { id: 543440, reference: "trx_x", status: "pending" } },
      { body: { token: "tk", url: "https://sandbox-process.fedapay.com/tk" } },
    ]);

    const out = await p.createPayment({
      amount: 200,
      currency: "XOF",
      phone: "+22990000000",
      operator: "mtn_benin",
      reference: "deliverable-1",
    });

    expect(out.paymentId).toBe("543440");
    expect(out.paymentUrl).toBe("https://sandbox-process.fedapay.com/tk");

    expect(calls[0]?.url).toBe("https://sandbox-api.fedapay.com/v1/transactions");
    expect(calls[0]?.body).toMatchObject({
      amount: 200,
      currency: { iso: "XOF" },
      merchant_reference: "deliverable-1",
      callback_url: "https://api.test/callback",
      customer: { phone_number: { number: "+22990000000", country: "bj" } },
    });
    expect(calls[1]?.url).toContain("/v1/transactions/543440/token");
    expect(calls[0]?.headers.Authorization).toBe("Bearer sk_sandbox_test");
  });

  it("déballe l'enveloppe v1/transaction renvoyée par l'API", async () => {
    const { p } = provider([
      { body: { "v1/transaction": { id: 9001, status: "pending" } } },
      { body: { token: "tk", url: "https://sandbox-process.fedapay.com/tk" } },
    ]);
    const out = await p.createPayment({
      amount: 200,
      currency: "XOF",
      phone: "+22990000000",
      operator: "mtn_benin",
      reference: "d",
    });
    expect(out.paymentId).toBe("9001");
  });

  it("remonte l'erreur HTTP avec le corps de réponse", async () => {    const { p } = provider([{ status: 422, body: { message: "montant invalide" } }]);
    await expect(
      p.createPayment({
        amount: 0,
        currency: "XOF",
        phone: "+22990000000",
        operator: "mtn_benin",
        reference: "d",
      }),
    ).rejects.toThrow(/422.*montant invalide/);
  });
});

describe("getPaymentStatus", () => {
  it.each([
    ["pending", "pending"],
    ["approved", "approved"],
    ["declined", "declined"],
    ["canceled", "canceled"],
    ["expired", "expired"],
    ["transferred", "approved"],
  ])("mappe %s → %s", async (fedapay, expected) => {
    const { p } = provider([{ body: { id: 1, status: fedapay } }]);
    expect(await p.getPaymentStatus("1")).toBe(expected);
  });
});

describe("parseWebhook", () => {
  it("accepte une signature valide et dérive un eventId stable", async () => {
    const { p } = provider([]);
    const headers = { "x-fedapay-signature": sign(webhookBody) };

    const first = await p.parseWebhook(Buffer.from(webhookBody), headers);
    const again = await p.parseWebhook(Buffer.from(webhookBody), headers);

    expect(first).toEqual({
      eventId: "transaction.approved:543440",
      paymentId: "543440",
      type: "transaction.approved",
    });
    expect(again.eventId).toBe(first.eventId);
  });

  it("rejette une signature calculée sur un autre corps", async () => {
    const { p } = provider([]);
    const headers = { "x-fedapay-signature": sign(webhookBody, NOW, "mauvais") };
    await expect(
      p.parseWebhook(Buffer.from(webhookBody), headers),
    ).rejects.toBeInstanceOf(InvalidSignatureError);
  });

  it("rejette un horodatage hors tolérance (rejeu)", async () => {
    const { p } = provider([]);
    const old = NOW - 3600;
    const headers = { "x-fedapay-signature": sign(webhookBody, old) };
    await expect(
      p.parseWebhook(Buffer.from(webhookBody), headers),
    ).rejects.toBeInstanceOf(InvalidSignatureError);
  });

  it("rejette l'absence d'en-tête", async () => {
    const { p } = provider([]);
    await expect(
      p.parseWebhook(Buffer.from(webhookBody), {}),
    ).rejects.toBeInstanceOf(InvalidSignatureError);
  });

  it("accepte les en-têtes en casse mixte", async () => {
    const { p } = provider([]);
    const headers = { "X-FEDAPAY-SIGNATURE": sign(webhookBody) };
    const evt = await p.parseWebhook(Buffer.from(webhookBody), headers);
    expect(evt.paymentId).toBe("543440");
  });
});

describe("modes directs", () => {
  it("liste les modes supportés par le PRD", () => {
    expect(DIRECT_MODES).toContain("mtn_benin");
    expect(DIRECT_MODES).toContain("moov_benin");
  });
});
