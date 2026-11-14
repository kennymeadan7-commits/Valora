/**
 * Parcours complet de la démo, sans réseau : génération du CV → aperçu →
 * paiement mobile → webhook signé → téléchargement du contenu complet.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { MockPaymentProvider } from "@previewpay/provider-mock";

process.env["PAYMENT_PROVIDER"] = "mock";
process.env["PREVIEWPAY_DOWNLOAD_SECRET"] = "secret_de_test_demo_api";
process.env["PREVIEWPAY_DOWNLOAD_BASE_URL"] = "http://localhost:3000";
process.env["PREVIEWPAY_MAX_REGENERATIONS"] = "1";
process.env["PORT"] = "3000";

let app: INestApplication;
let provider: MockPaymentProvider;
let server: App;

beforeAll(async () => {
  const { AppModule, config } = await import("../src/app.module.js");
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleRef.createNestApplication({ rawBody: true });
  await app.init();
  server = app.getHttpServer();
  provider = config.provider as MockPaymentProvider;
});

afterAll(async () => {
  await app?.close();
});

const CV = {
  fullName: "Awa Houngbédji",
  headline: "Chargée de communication",
  email: "awa@example.com",
  phone: "+229 97 00 00 01",
  city: "Cotonou",
  skills: ["Réseaux sociaux", "Rédaction", "Événementiel", "Photographie"],
  languages: "Français : courant, Anglais : intermédiaire",
  experiences: [
    {
      role: "Chargée de communication",
      company: "ONG Lumière",
      period: "2021 — aujourd'hui",
      highlights: ["Hausse de 40 % de l'audience Facebook en un an"],
    },
  ],
  education: [{ diploma: "Licence en communication", school: "UAC", year: "2020" }],
};

async function creerEtPayer() {
  const created = await request(server)
    .post("/demo/cv")
    .send(CV)
    .expect(201);

  const paid = await request(server)
    .post(`/deliverables/${created.body.id}/pay`)
    .send({ phone: "+22990000000", operator: "mtn_benin" })
    .expect(200);

  return { created: created.body, paid: paid.body };
}

describe("démo API — parcours CV", () => {
  it("génère un CV et n'expose que l'aperçu", async () => {
    const res = await request(server).post("/demo/cv").send(CV).expect(201);

    expect(res.body.state).toBe("previewed");
    expect(res.body.price).toBe(200);
    expect(res.body.currency).toBe("XOF");
    expect(res.body.content).toBeUndefined();
    expect(res.body.preview.text).toContain("Awa Houngbédji");
    expect(res.body.preview.truncated).toBe(true);
    expect(res.body.preview.watermark).toContain("APERÇU");
    expect(res.body.downloadUrl).toBeNull();

    // Aperçu HTML produit côté serveur : le gabarit réel, mais les parties
    // payantes ne sont pas dans le document envoyé au navigateur.
    expect(res.body.preview.kind).toBe("cv");
    expect(res.body.preview.html).toContain("Awa Houngbédji");
    expect(res.body.preview.html).toContain("APERÇU · PREVIEWPAY");
    expect(res.body.preview.html).not.toContain("audience Facebook");
    expect(res.body.preview.html).not.toContain("awa@example.com");
    expect(res.body.preview.html).not.toContain("Licence en communication");
    expect(res.body.preview.text).not.toContain("awa@example.com");
  });

  it("refuse un CV sans nom ni poste", async () => {
    await request(server).post("/demo/cv").send({}).expect(400);
  });

  it("enchaîne paiement → webhook signé → téléchargement", async () => {
    const { created, paid } = await creerEtPayer();

    expect(paid.state).toBe("payment_pending");
    expect(paid.paymentUrl).toBeNull();

    // Avant le webhook : toujours verrouillé.
    await request(server).get(`/deliverables/${created.id}/download`).expect(402);

    provider.setStatus("mock_pay_1", "approved");
    const hook = provider.buildWebhook("mock_pay_1");
    await request(server)
      .post("/webhooks/fedapay")
      .set("content-type", "application/json")
      .set(hook.headers)
      .send(hook.rawBody.toString())
      .expect(200);

    const download = await request(server)
      .get(`/deliverables/${created.id}/download`)
      .expect(200);

    expect(download.body.url).toContain("/deliverables/");
    expect(download.body.expiresAt).toBeTruthy();

    const token = new URL(download.body.url).searchParams.get("token") ?? "";
    const file = await request(server)
      .get(`/deliverables/${created.id}/content`)
      .query({ token })
      .expect(200);

    // Par défaut : le CV final en HTML A4, complet et sans filigrane.
    expect(file.headers["content-type"]).toContain("text/html");
    expect(file.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(file.text).toContain("<!doctype html>");
    expect(file.text).toContain("Hausse de 40 % de l&#39;audience Facebook");
    expect(file.text).toContain("awa@example.com");
    expect(file.text).not.toContain("APERÇU · PREVIEWPAY");

    const markdown = await request(server)
      .get(`/deliverables/${created.id}/content`)
      .query({ token, format: "md" })
      .expect(200);
    expect(markdown.headers["content-type"]).toContain("text/markdown");
    expect(markdown.text).toContain("## Compétences");
    expect(markdown.text).toContain("## Langues");
    expect(markdown.text).toContain("libéré après paiement");
    expect(markdown.text.length).toBeGreaterThan(created.preview.text.length);

    await request(server)
      .get(`/deliverables/${created.id}/content`)
      .query({ token, format: "exe" })
      .expect(400);
  });

  it("rejette un webhook dupliqué sans double déblocage", async () => {
    const { created } = await creerEtPayer();
    provider.setStatus("mock_pay_2", "approved");
    const hook = provider.buildWebhook("mock_pay_2");

    const post = () =>
      request(server)
        .post("/webhooks/fedapay")
        .set("content-type", "application/json")
        .set(hook.headers)
        .send(hook.rawBody.toString());

    await post().expect(200);
    await post().expect(200);

    const vue = await request(server).get(`/deliverables/${created.id}`).expect(200);
    expect(vue.body.state).toBe("unlocked");
  });

  it("rejette un webhook à signature invalide", async () => {
    const { created } = await creerEtPayer();
    await request(server)
      .post("/webhooks/fedapay")
      .set("content-type", "application/json")
      .set("x-mock-signature", "faux")
      .send(JSON.stringify({ id: "evt", data: { transaction: { id: "mock_pay_1" } } }))
      .expect(400);

    const vue = await request(server).get(`/deliverables/${created.id}`).expect(200);
    expect(vue.body.state).toBe("payment_pending");
  });

  it("refuse un jeton de téléchargement absent ou falsifié", async () => {
    const { created } = await creerEtPayer();
    await request(server).get(`/deliverables/${created.id}/content`).expect(403);

    provider.setStatus(`mock_pay_1`, "approved");
    const hook = provider.buildWebhook("mock_pay_1");
    await request(server)
      .post("/webhooks/fedapay")
      .set("content-type", "application/json")
      .set(hook.headers)
      .send(hook.rawBody.toString())
      .expect(200);

    await request(server)
      .get(`/deliverables/${created.id}/content`)
      .query({ token: "abc.def" })
      .expect(400);
  });

  it("expose un healthcheck avec le fournisseur actif", async () => {
    const res = await request(server).get("/demo/health").expect(200);
    expect(res.body).toEqual({ status: "ok", provider: "mock", storage: "memory" });
  });
});
