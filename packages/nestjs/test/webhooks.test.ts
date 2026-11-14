import { afterEach, describe, expect, it } from "vitest";
import {
  createDeliverable,
  createTestApp,
  type SupertestRequest,
  type TestApp,
} from "./helpers.js";

let current: TestApp | null = null;

async function boot(): Promise<TestApp> {
  current = await createTestApp();
  return current;
}

afterEach(async () => {
  if (current) await current.close();
  current = null;
});

/** Crée un livrable déjà en `payment_pending` et renvoie son paymentId. */
async function pendingPayment(app: TestApp): Promise<{
  id: string;
  paymentId: string;
}> {
  const created = await createDeliverable(app);
  await app
    .http()
    .post(`/deliverables/${created.id}/pay`)
    .send({ phone: "+22990000000", operator: "mtn" })
    .expect(200);
  const deliverable = await app.storage.getDeliverable(created.id);
  return { id: created.id, paymentId: deliverable!.paymentId! };
}

function sendWebhook(
  app: TestApp,
  rawBody: Buffer,
  headers: Record<string, string>,
): SupertestRequest {
  return app
    .http()
    .post("/webhooks/fedapay")
    .set("content-type", "application/json")
    .set(headers)
    .send(rawBody.toString("utf8"));
}

describe("POST /webhooks/fedapay", () => {
  it("débloque le livrable sur un événement approuvé", async () => {
    const app = await boot();
    const { id, paymentId } = await pendingPayment(app);

    app.provider.setStatus(paymentId, "approved");
    const webhook = app.provider.buildWebhook(paymentId);

    const response = await sendWebhook(app, webhook.rawBody, webhook.headers);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      received: true,
      duplicate: false,
      state: "unlocked",
    });

    const journal = await app.storage.listJournal(id);
    expect(journal.filter((entry) => entry.to === "unlocked")).toHaveLength(1);
    expect(journal.at(-1)?.cause).toBe("webhook:transaction.approved");
  });

  it("acquitte un doublon en 200 sans second déblocage", async () => {
    const app = await boot();
    const { id, paymentId } = await pendingPayment(app);

    app.provider.setStatus(paymentId, "approved");
    const webhook = app.provider.buildWebhook(paymentId);

    await sendWebhook(app, webhook.rawBody, webhook.headers).expect(200);
    const journalApresPremier = await app.storage.listJournal(id);

    // Réémission stricte du même événement : même signature, même corps.
    const second = await sendWebhook(
      app,
      webhook.rawBody,
      webhook.headers,
    ).expect(200);
    expect(second.body).toEqual({ received: true, duplicate: true });

    const journal = await app.storage.listJournal(id);
    expect(journal.length).toBe(journalApresPremier.length);
    expect(journal.filter((entry) => entry.to === "unlocked")).toHaveLength(1);

    const deliverable = await app.storage.getDeliverable(id);
    expect(deliverable?.state).toBe("unlocked");
  });

  it("rejette une signature invalide en 400 sans changer l'état", async () => {
    const app = await boot();
    const { id, paymentId } = await pendingPayment(app);

    app.provider.setStatus(paymentId, "approved");
    const webhook = app.provider.buildWebhook(paymentId);
    const journalAvant = await app.storage.listJournal(id);

    const response = await sendWebhook(app, webhook.rawBody, {
      "x-mock-signature": "c2lnbmF0dXJlLWZhbHNpZmllZQ",
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("INVALID_SIGNATURE");

    const deliverable = await app.storage.getDeliverable(id);
    expect(deliverable?.state).toBe("payment_pending");
    expect(await app.storage.listJournal(id)).toHaveLength(journalAvant.length);
  });

  it("rejette un corps altéré après signature en 400", async () => {
    const app = await boot();
    const { paymentId } = await pendingPayment(app);

    app.provider.setStatus(paymentId, "approved");
    const webhook = app.provider.buildWebhook(paymentId);

    // Même signature, corps modifié : le HMAC porte sur le corps brut.
    const altere = Buffer.from(
      webhook.rawBody.toString("utf8").replace("transaction.approved", "transaction.approved "),
    );
    await sendWebhook(app, altere, webhook.headers).expect(400);
  });

  it("exige l'en-tête de signature", async () => {
    const app = await boot();
    const { paymentId } = await pendingPayment(app);
    const webhook = app.provider.buildWebhook(paymentId);

    await sendWebhook(app, webhook.rawBody, {}).expect(400);
  });

  it("ramène un paiement refusé à `previewed`, relançable", async () => {
    const app = await boot();
    const { id, paymentId } = await pendingPayment(app);

    app.provider.setStatus(paymentId, "declined");
    const webhook = app.provider.buildWebhook(paymentId);
    const response = await sendWebhook(app, webhook.rawBody, webhook.headers);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ received: true, duplicate: false });

    const deliverable = await app.storage.getDeliverable(id);
    expect(deliverable?.state).toBe("previewed");

    // Nouvel essai autorisé, avec un nouveau paiement.
    const relance = await app
      .http()
      .post(`/deliverables/${id}/pay`)
      .send({ phone: "+22990000000", operator: "moov" })
      .expect(200);
    expect(relance.body.state).toBe("payment_pending");
  });

  it("acquitte un événement dont le paiement est inconnu", async () => {
    const app = await boot();
    const webhook = app.provider.buildWebhook("mock_pay_inconnu", {
      status: "approved",
    });
    const response = await sendWebhook(app, webhook.rawBody, webhook.headers);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ received: true, duplicate: false });
  });

  it("explique le 500 quand l'hôte oublie `rawBody: true`", async () => {
    current = await createTestApp({}, { rawBody: false });
    const app = current;
    const { paymentId } = await pendingPayment(app);
    const webhook = app.provider.buildWebhook(paymentId);

    const response = await sendWebhook(app, webhook.rawBody, webhook.headers);
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).toContain("rawBody: true");
  });
});
