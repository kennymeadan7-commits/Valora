/**
 * Routeur Express monté dans une vraie application, sans réseau :
 * MemoryStorage + MockPaymentProvider (webhooks signés en HMAC).
 */
import { describe, expect, it } from "vitest";
import express from "express";
import type { Express } from "express";
import request from "supertest";
import { PreviewPay } from "@previewpay/core";
import { MemoryStorage } from "@previewpay/storage-memory";
import { MockPaymentProvider } from "@previewpay/provider-mock";
import { createPreviewPayRouter, type PreviewPayRouterOptions } from "@previewpay/express";

const KEY = "cle_interne";
const FULL = "CONTENU COMPLET — SECTION SECRÈTE ".repeat(20);

function setup(
  routerOptions: Partial<Omit<PreviewPayRouterOptions, "previewPay">> = {},
  engineOptions: Partial<ConstructorParameters<typeof PreviewPay>[0]> = {},
  mount: (app: Express) => void = () => undefined,
) {
  const storage = new MemoryStorage();
  const provider = new MockPaymentProvider({ secret: "wh" });
  const previewPay = new PreviewPay({
    storage,
    provider,
    pricing: { cv: 200 },
    preview: { makePreview: async (c) => ({ text: String(c).slice(0, 20), watermark: "APERÇU" }) },
    download: { secret: "dl_secret", baseUrl: "http://localhost" },
    ...engineOptions,
  });
  const app = express();
  mount(app);
  app.use(createPreviewPayRouter({ previewPay, internalApiKey: KEY, ...routerOptions }));
  const http = () => request(app);
  const create = async (body: Record<string, unknown> = {}) =>
    (await http().post("/deliverables").set("x-internal-key", KEY).send({ type: "cv", content: FULL, ...body }).expect(201))
      .body as { id: string };
  const paymentIdOf = async (id: string) => (await storage.getDeliverable(id))!.paymentId!;
  return { app, http, create, provider, storage, paymentIdOf };
}

describe("@previewpay/express — parcours complet", () => {
  it("création → aperçu → 402 → paiement → webhook signé → déblocage → lien", async () => {
    const t = setup();
    const { id } = await t.create();

    const read = await t.http().get(`/deliverables/${id}`).expect(200);
    expect(read.headers["cache-control"]).toBe("no-store");
    expect(read.body).toMatchObject({ state: "previewed", price: 200, currency: "XOF", downloadUrl: null });
    expect(JSON.stringify(read.body)).not.toContain("SECTION SECRÈTE");

    await t.http().get(`/deliverables/${id}/download`).expect(402);

    const paid = await t.http().post(`/deliverables/${id}/pay`).send({ phone: "+22990000000", operator: "mtn_benin" }).expect(200);
    expect(paid.body.state).toBe("payment_pending");

    const paymentId = await t.paymentIdOf(id);
    t.provider.setStatus(paymentId, "approved");
    const hook = t.provider.buildWebhook(paymentId);
    const first = await t.http().post("/webhooks/fedapay").set(hook.headers).set("content-type", "application/json").send(hook.rawBody.toString()).expect(200);
    expect(first.body).toMatchObject({ received: true, duplicate: false, state: "unlocked" });
    const again = await t.http().post("/webhooks/fedapay").set(hook.headers).set("content-type", "application/json").send(hook.rawBody.toString()).expect(200);
    expect(again.body.duplicate).toBe(true);

    const link = await t.http().get(`/deliverables/${id}/download`).expect(200);
    expect(link.body.url).toContain(`/deliverables/${id}/content?token=`);
    expect(Date.parse(link.body.expiresAt)).toBeGreaterThan(Date.now());
  });
});

describe("@previewpay/express — sécurité et erreurs", () => {
  it("exige la clé interne pour créer", async () => {
    const t = setup();
    await t.http().post("/deliverables").send({ type: "cv", content: "x" }).expect(401);
    const res = await t.http().post("/deliverables").set("x-internal-key", "mauvaise").send({ type: "cv", content: "x" }).expect(401);
    expect(res.body.code).toBe("INVALID_INTERNAL_KEY");
  });

  it("valide les corps en 400 (champ manquant, JSON invalide)", async () => {
    const t = setup();
    await t.http().post("/deliverables").set("x-internal-key", KEY).send({ type: "cv" }).expect(400);
    const bad = await t.http().post("/deliverables").set("x-internal-key", KEY).set("content-type", "application/json").send("{pas du json").expect(400);
    expect(bad.body.code).toBe("BAD_REQUEST");
    const { id } = await t.create();
    await t.http().post(`/deliverables/${id}/pay`).send({ phone: "+229" }).expect(400);
  });

  it("404 pour un livrable inconnu, 409 pour un double paiement", async () => {
    const t = setup();
    const missing = await t.http().get("/deliverables/inconnu").expect(404);
    expect(missing.body.code).toBe("DELIVERABLE_NOT_FOUND");
    const { id } = await t.create();
    await t.http().post(`/deliverables/${id}/pay`).send({ phone: "+22990000000", operator: "mtn_benin" }).expect(200);
    await t.http().post(`/deliverables/${id}/pay`).send({ phone: "+22990000000", operator: "mtn_benin" }).expect(409);
  });

  it("rejette une signature de webhook invalide sans changer l'état", async () => {
    const t = setup();
    const { id } = await t.create();
    await t.http().post(`/deliverables/${id}/pay`).send({ phone: "+22990000000", operator: "mtn_benin" }).expect(200);
    const paymentId = await t.paymentIdOf(id);
    t.provider.setStatus(paymentId, "approved");
    const hook = t.provider.buildWebhook(paymentId);
    const altered = hook.rawBody.toString().replace("approved", "approvee");
    await t.http().post("/webhooks/fedapay").set(hook.headers).set("content-type", "application/json").send(altered).expect(400);
    expect((await t.storage.getDeliverable(id))?.state).toBe("payment_pending");
  });

  it("explique le problème si express.json() a consommé le corps du webhook", async () => {
    const t = setup({}, {}, (app) => app.use(express.json()));
    const res = await t.http().post("/webhooks/fedapay").send({ id: "evt" }).expect(500);
    expect(res.body.code).toBe("RAW_BODY_UNAVAILABLE");
  });

  it("accepte le corps brut conservé par express.json({ verify })", async () => {
    const t = setup({}, {}, (app) =>
      app.use(
        express.json({
          verify: (req, _res, buf) => {
            (req as unknown as { rawBody: Buffer }).rawBody = buf;
          },
        }),
      ),
    );
    const { id } = await t.create();
    await t.http().post(`/deliverables/${id}/pay`).send({ phone: "+22990000000", operator: "mtn_benin" }).expect(200);
    const paymentId = await t.paymentIdOf(id);
    t.provider.setStatus(paymentId, "approved");
    const hook = t.provider.buildWebhook(paymentId);
    const res = await t.http().post("/webhooks/fedapay").set(hook.headers).set("content-type", "application/json").send(hook.rawBody.toString()).expect(200);
    expect(res.body.state).toBe("unlocked");
  });

  it("limite le débit de /pay (429 + Retry-After)", async () => {
    const t = setup({ rateLimit: { max: 2, windowMs: 60_000 } });
    const { id } = await t.create();
    await t.http().post(`/deliverables/${id}/pay`).send({}).expect(400);
    await t.http().post(`/deliverables/${id}/pay`).send({}).expect(400);
    const limited = await t.http().post(`/deliverables/${id}/pay`).send({}).expect(429);
    expect(limited.body.code).toBe("RATE_LIMITED");
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("applique la limite d'aperçus par utilisateur du cœur (429)", async () => {
    const t = setup({}, { limits: { previewsPerOwnerPerDay: 1 } });
    await t.create({ ownerId: "u1" });
    const res = await t.http().post("/deliverables").set("x-internal-key", KEY).send({ type: "cv", content: FULL, ownerId: "u1" }).expect(429);
    expect(res.body.code).toBe("PREVIEW_LIMIT_REACHED");
    expect(res.headers["retry-after"]).toBeTruthy();
  });

  it("réconcilie à la lecture un paiement dont le webhook n'arrive jamais", async () => {
    const t = setup({}, { reconcile: { afterMs: 0, everyMs: 0 } });
    const { id } = await t.create();
    await t.http().post(`/deliverables/${id}/pay`).send({ phone: "+22990000000", operator: "mtn_benin" }).expect(200);
    t.provider.setStatus(await t.paymentIdOf(id), "approved");
    expect((await t.http().get(`/deliverables/${id}`).expect(200)).body.state).toBe("unlocked");
  });

  it("refus : régénère dans la limite puis clôt", async () => {
    const t = setup({}, { maxRegenerations: 1 });
    const { id } = await t.create();
    await t.http().post(`/deliverables/${id}/reject`).send({}).expect(400);
    const first = await t.http().post(`/deliverables/${id}/reject`).send({ reason: "bof" }).expect(200);
    expect(first.body.regenerated).toBe(true);
    const second = await t.http().post(`/deliverables/${id}/reject`).send({ reason: "non" }).expect(200);
    expect(second.body).toMatchObject({ regenerated: false, deliverable: { state: "rejected" } });
  });
});

describe("@previewpay/express — route de contenu (serveContent)", () => {
  it("n'existe pas sans serveContent", async () => {
    const t = setup();
    await t.http().get("/deliverables/x/content?token=a").expect(404);
  });

  it("vérifie le jeton et l'identifiant avant de servir", async () => {
    const t = setup({
      serveContent: (d, _req, res) => {
        res.type("text/plain").send(String(d.content));
      },
    });
    const { id } = await t.create();
    const other = await t.create();
    await t.http().get(`/deliverables/${id}/content`).expect(403);
    await t.http().get(`/deliverables/${id}/content?token=abc.def`).expect(400);

    await t.http().post(`/deliverables/${id}/pay`).send({ phone: "+22990000000", operator: "mtn_benin" }).expect(200);
    t.provider.setStatus(await t.paymentIdOf(id), "approved");
    const hook = t.provider.buildWebhook(await t.paymentIdOf(id));
    await t.http().post("/webhooks/fedapay").set(hook.headers).set("content-type", "application/json").send(hook.rawBody.toString()).expect(200);

    const link = await t.http().get(`/deliverables/${id}/download`).expect(200);
    const token = new URL(link.body.url).searchParams.get("token") ?? "";
    const file = await t.http().get(`/deliverables/${id}/content`).query({ token }).expect(200);
    expect(file.text).toBe(FULL);
    expect(file.headers["cache-control"]).toBe("no-store");
    await t.http().get(`/deliverables/${other.id}/content`).query({ token }).expect(403);
  });

  it("refuse le contenu d'un livrable non payé même avec un jeton fabriqué ailleurs", async () => {
    const t = setup({ serveContent: (d, _req, res) => res.send(String(d.content)) });
    const { id } = await t.create();
    await t.http().get(`/deliverables/${id}/download`).expect(402);
    await t.http().get(`/deliverables/${id}/content?token=${"x".repeat(40)}.${"y".repeat(10)}`).expect(400);
  });
});
