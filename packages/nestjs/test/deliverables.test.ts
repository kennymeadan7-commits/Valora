import { afterEach, describe, expect, it } from "vitest";
import {
  createDeliverable,
  createTestApp,
  DOWNLOAD_SECRET,
  FULL_CV,
  INTERNAL_KEY,
  type TestApp,
} from "./helpers.js";
import { PreviewPay, verifyDownloadToken } from "@previewpay/core";

let current: TestApp | null = null;

async function boot(
  overrides: Parameters<typeof createTestApp>[0] = {},
): Promise<TestApp> {
  current = await createTestApp(overrides);
  return current;
}

afterEach(async () => {
  if (current) await current.close();
  current = null;
});

describe("POST /deliverables", () => {
  it("crée un livrable avec le prix figé du type", async () => {
    const app = await boot();
    const response = await app
      .http()
      .post("/deliverables")
      .set("x-internal-key", INTERNAL_KEY)
      .send({ type: "cv", content: FULL_CV })
      .expect(201);

    expect(response.body).toMatchObject({
      type: "cv",
      state: "previewed",
      price: 200,
      currency: "XOF",
      downloadUrl: null,
    });
    expect(typeof response.body.id).toBe("string");
  });

  it("exige la clé interne quand `internalApiKey` est configurée", async () => {
    const app = await boot();

    const sansCle = await app
      .http()
      .post("/deliverables")
      .send({ type: "cv", content: FULL_CV })
      .expect(401);
    expect(sansCle.body.code).toBe("INVALID_INTERNAL_KEY");

    await app
      .http()
      .post("/deliverables")
      .set("x-internal-key", "mauvaise-cle")
      .send({ type: "cv", content: FULL_CV })
      .expect(401);

    await app
      .http()
      .post("/deliverables")
      .set("x-internal-key", INTERNAL_KEY)
      .send({ type: "cv", content: FULL_CV })
      .expect(201);
  });

  it("désactive la garde quand `internalApiKey` est absente", async () => {
    const app = await boot({ internalApiKey: undefined });
    await app
      .http()
      .post("/deliverables")
      .send({ type: "cv", content: FULL_CV })
      .expect(201);
  });

  it("rejette un corps incomplet en 400", async () => {
    const app = await boot();
    const response = await app
      .http()
      .post("/deliverables")
      .set("x-internal-key", INTERNAL_KEY)
      .send({ content: FULL_CV })
      .expect(400);
    expect(String(response.body.message)).toContain("type");
  });

  it("renvoie 500 quand la grille de prix ne couvre pas le type", async () => {
    const app = await boot();
    const response = await app
      .http()
      .post("/deliverables")
      .set("x-internal-key", INTERNAL_KEY)
      .send({ type: "inconnu", content: FULL_CV })
      .expect(500);
    expect(response.body.code).toBe("MISSING_PRICE");
  });
});

describe("GET /deliverables/:id", () => {
  it("renvoie statut, prix et aperçu — jamais le contenu complet", async () => {
    const app = await boot();
    const created = await createDeliverable(app);

    const response = await app
      .http()
      .get(`/deliverables/${created.id}`)
      .expect(200);

    expect(response.body).toMatchObject({
      id: created.id,
      state: "previewed",
      price: 200,
    });
    expect(response.body).not.toHaveProperty("content");
    expect(JSON.stringify(response.body)).not.toContain("FIN-SECRETE-DU-CV");
    expect(response.body.preview.truncated).toBe(true);
    expect(response.body.preview.watermark).toContain("APERÇU");
  });

  it("ne divulgue pas le contenu après déblocage", async () => {
    const app = await boot();
    const created = await createDeliverable(app);
    await app
      .http()
      .post(`/deliverables/${created.id}/pay`)
      .send({ phone: "+22990000000", operator: "mtn" })
      .expect(200);

    const deliverable = await app.storage.getDeliverable(created.id);
    app.provider.setStatus(deliverable!.paymentId!, "approved");
    const webhook = app.provider.buildWebhook(deliverable!.paymentId!);
    await app
      .http()
      .post("/webhooks/fedapay")
      .set("content-type", "application/json")
      .set(webhook.headers)
      .send(webhook.rawBody.toString("utf8"))
      .expect(200);

    const response = await app
      .http()
      .get(`/deliverables/${created.id}`)
      .expect(200);
    expect(response.body.state).toBe("unlocked");
    expect(response.body).not.toHaveProperty("content");
    expect(JSON.stringify(response.body)).not.toContain("FIN-SECRETE-DU-CV");
  });

  it("renvoie 404 pour un identifiant inconnu", async () => {
    const app = await boot();
    const response = await app
      .http()
      .get("/deliverables/inconnu")
      .expect(404);
    expect(response.body.code).toBe("DELIVERABLE_NOT_FOUND");
  });
});

describe("POST /deliverables/:id/pay", () => {
  it("passe le livrable à payment_pending", async () => {
    const app = await boot();
    const created = await createDeliverable(app);

    const response = await app
      .http()
      .post(`/deliverables/${created.id}/pay`)
      .send({ phone: "+22990000000", operator: "mtn" })
      .expect(200);

    expect(response.body.state).toBe("payment_pending");
    expect(response.body.downloadUrl).toBeNull();
  });

  it("rejette un paiement sans numéro en 400", async () => {
    const app = await boot();
    const created = await createDeliverable(app);

    const response = await app
      .http()
      .post(`/deliverables/${created.id}/pay`)
      .send({ operator: "mtn" })
      .expect(400);
    expect(String(response.body.message)).toContain("phone");
  });

  it("renvoie 409 quand un paiement est déjà en cours", async () => {
    const app = await boot();
    const created = await createDeliverable(app);
    const body = { phone: "+22990000000", operator: "mtn" };

    await app.http().post(`/deliverables/${created.id}/pay`).send(body).expect(200);
    const response = await app
      .http()
      .post(`/deliverables/${created.id}/pay`)
      .send(body)
      .expect(409);
    expect(response.body.code).toBe("INVALID_TRANSITION");
  });

  it("limite le débit des tentatives de paiement", async () => {
    const app = await boot({ rateLimit: { max: 2, windowMs: 60_000 } });
    const created = await createDeliverable(app);
    const body = { phone: "+22990000000", operator: "mtn" };

    await app.http().post(`/deliverables/${created.id}/pay`).send(body).expect(200);
    // Deuxième appel : autorisé par le limiteur, refusé par le cœur.
    await app.http().post(`/deliverables/${created.id}/pay`).send(body).expect(409);
    // Troisième : le limiteur coupe avant le cœur.
    const response = await app
      .http()
      .post(`/deliverables/${created.id}/pay`)
      .send(body)
      .expect(429);
    expect(response.body.code).toBe("RATE_LIMITED");
  });
});

describe("POST /deliverables/:id/reject", () => {
  it("régénère dans la limite puis clôt sans frais", async () => {
    const app = await boot();
    const created = await createDeliverable(app, { maxRegenerations: 1 });

    const first = await app
      .http()
      .post(`/deliverables/${created.id}/reject`)
      .send({ reason: "trop générique" })
      .expect(200);
    expect(first.body.regenerated).toBe(true);
    expect(first.body.deliverable.state).toBe("previewed");
    expect(first.body.deliverable.regenerations).toBe(1);

    const second = await app
      .http()
      .post(`/deliverables/${created.id}/reject`)
      .send({ reason: "toujours trop générique" })
      .expect(200);
    expect(second.body.regenerated).toBe(false);
    expect(second.body.deliverable.state).toBe("rejected");

    // Un livrable clos ne peut plus être payé.
    await app
      .http()
      .post(`/deliverables/${created.id}/pay`)
      .send({ phone: "+22990000000", operator: "mtn" })
      .expect(409);
  });
});

describe("GET /deliverables/:id/download", () => {
  it("renvoie 402 tant que le livrable n'est pas débloqué", async () => {
    const app = await boot();
    const created = await createDeliverable(app);

    const avant = await app
      .http()
      .get(`/deliverables/${created.id}/download`)
      .expect(402);
    expect(avant.body.code).toBe("PAYMENT_REQUIRED");

    await app
      .http()
      .post(`/deliverables/${created.id}/pay`)
      .send({ phone: "+22990000000", operator: "mtn" })
      .expect(200);

    await app
      .http()
      .get(`/deliverables/${created.id}/download`)
      .expect(402);
  });

  it("cycle complet : création → paiement → webhook approuvé → téléchargement", async () => {
    const app = await boot();
    const created = await createDeliverable(app);

    const paid = await app
      .http()
      .post(`/deliverables/${created.id}/pay`)
      .send({ phone: "+22990000000", operator: "mtn" })
      .expect(200);
    expect(paid.body.state).toBe("payment_pending");

    const deliverable = await app.storage.getDeliverable(created.id);
    const paymentId = deliverable?.paymentId;
    expect(paymentId).toBeTruthy();
    expect(app.provider.getPaymentInput(paymentId!)).toMatchObject({
      amount: 200,
      currency: "XOF",
      phone: "+22990000000",
      operator: "mtn",
      reference: created.id,
    });

    // Le webhook seul ne suffit pas : le cœur revérifie le statut.
    app.provider.setStatus(paymentId!, "approved");
    const webhook = app.provider.buildWebhook(paymentId!);
    const hook = await app
      .http()
      .post("/webhooks/fedapay")
      .set("content-type", "application/json")
      .set(webhook.headers)
      .send(webhook.rawBody.toString("utf8"))
      .expect(200);
    expect(hook.body).toEqual({
      received: true,
      duplicate: false,
      state: "unlocked",
    });

    const vue = await app
      .http()
      .get(`/deliverables/${created.id}`)
      .expect(200);
    expect(vue.body.state).toBe("unlocked");
    expect(vue.body.downloadUrl).toContain("/deliverables/");

    const download = await app
      .http()
      .get(`/deliverables/${created.id}/download`)
      .expect(200);
    expect(download.body.url).toContain(
      `https://api.test/deliverables/${created.id}/download?token=`,
    );
    expect(new Date(download.body.expiresAt).getTime()).toBeGreaterThan(
      Date.now(),
    );

    // Le jeton est bien celui du cœur, signé avec le secret de `download`.
    const token = String(download.body.url).split("token=")[1] ?? "";
    const payload = verifyDownloadToken(
      decodeURIComponent(token),
      DOWNLOAD_SECRET,
    );
    expect(payload?.deliverableId).toBe(created.id);
  });
});

describe("PreviewPayModule", () => {
  it("expose le moteur du cœur et ses options à l'hôte", async () => {
    const app = await boot();
    const engine = app.app.get(PreviewPay);
    expect(engine).toBeInstanceOf(PreviewPay);
  });

  it("refuse de démarrer sans secret de téléchargement", async () => {
    const previous = process.env["PREVIEWPAY_DOWNLOAD_SECRET"];
    delete process.env["PREVIEWPAY_DOWNLOAD_SECRET"];
    try {
      await expect(
        createTestApp({ download: { baseUrl: "https://api.test" } }),
      ).rejects.toThrow(/download\.secret/);
    } finally {
      if (previous !== undefined) {
        process.env["PREVIEWPAY_DOWNLOAD_SECRET"] = previous;
      }
    }
  });
});
