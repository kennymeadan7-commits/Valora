/**
 * `GET /demo/metrics` — métriques de validation du PRD.
 *
 * Chaque cas démarre sa propre application (mémoire, fournisseur `mock`) :
 * les compteurs repartent de zéro, et `DEMO_AI_COST_PER_DELIVERABLE` peut être
 * fixé **avant** l'import dynamique de l'app (la config est lue à l'import).
 */
import { describe, expect, it, vi } from "vitest";
import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { MockPaymentProvider } from "@previewpay/provider-mock";

interface DemoMetricsView {
  previewed: number;
  paid: number;
  rejected: number;
  conversionRate: number;
  rejectionRate: number;
  paymentAttempts: number;
  paymentFailures: number;
  paymentFailureRate: number;
  averageTimeToPaymentMs: number | null;
  averagePrice: number | null;
  marginPerDeliverable: number | null;
  aiCostPerDeliverable: number | null;
  generatedAt: string;
}

interface DemoApp {
  app: INestApplication;
  server: App;
  provider: MockPaymentProvider;
}

interface BootOptions {
  /** `DEMO_AI_COST_PER_DELIVERABLE` ; absent du processus quand non fourni. */
  aiCost?: string;
  /** `PREVIEWPAY_INTERNAL_KEY` ; la garde est désactivée quand non fourni. */
  internalKey?: string;
}

/** Démarre une app neuve : mémoire, `mock`, aucune clé interne par défaut. */
async function boot(options: BootOptions = {}): Promise<DemoApp> {
  // La config de l'app est lue à l'import : on repart d'un registre vierge.
  vi.resetModules();

  process.env["PAYMENT_PROVIDER"] = "mock";
  process.env["STORAGE"] = "memory";
  process.env["PREVIEWPAY_DOWNLOAD_SECRET"] = "secret_de_test_metriques";
  process.env["PREVIEWPAY_DOWNLOAD_BASE_URL"] = "http://localhost:3000";
  // 0 régénération : un premier refus clôt le livrable en `rejected`.
  process.env["PREVIEWPAY_MAX_REGENERATIONS"] = "0";
  process.env["PORT"] = "3000";

  if (options.aiCost === undefined) {
    delete process.env["DEMO_AI_COST_PER_DELIVERABLE"];
  } else {
    process.env["DEMO_AI_COST_PER_DELIVERABLE"] = options.aiCost;
  }
  if (options.internalKey === undefined) {
    delete process.env["PREVIEWPAY_INTERNAL_KEY"];
  } else {
    process.env["PREVIEWPAY_INTERNAL_KEY"] = options.internalKey;
  }

  const { AppModule, config } = await import("../src/app.module.js");
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication({ rawBody: true });
  await app.init();
  return {
    app,
    server: app.getHttpServer(),
    provider: config.provider as MockPaymentProvider,
  };
}

/** Démarre une app, exécute le cas, puis la referme quoi qu'il arrive. */
async function withApp(
  options: BootOptions,
  run: (ctx: DemoApp) => Promise<void>,
): Promise<void> {
  const ctx = await boot(options);
  try {
    await run(ctx);
  } finally {
    await ctx.app.close();
    // Aucune variable du cas ne doit fuiter vers un autre fichier de test.
    delete process.env["DEMO_AI_COST_PER_DELIVERABLE"];
    delete process.env["PREVIEWPAY_INTERNAL_KEY"];
  }
}

const CV = {
  fullName: "Awa Houngbédji",
  headline: "Chargée de communication",
  email: "awa@example.com",
};

async function createCv(server: App): Promise<string> {
  const created = await request(server).post("/demo/cv").send(CV).expect(201);
  return created.body.id as string;
}

async function pay(server: App, id: string): Promise<void> {
  await request(server)
    .post(`/deliverables/${id}/pay`)
    .send({ phone: "+22990000000", operator: "mtn_benin" })
    .expect(200);
}

/** Le fournisseur `mock` change de statut, puis l'API revérifie par appel. */
async function simulate(
  server: App,
  id: string,
  status: "approved" | "declined" | "expired",
): Promise<void> {
  await request(server).post(`/demo/simulate/${id}/${status}`).expect(200);
}

async function readMetrics(
  server: App,
  internalKey?: string,
): Promise<DemoMetricsView> {
  const call = request(server).get("/demo/metrics");
  const withKey = internalKey === undefined ? call : call.set("x-internal-key", internalKey);
  const res = await withKey.expect(200);

  // Aucune donnée de contenu ne doit fuiter par le tableau de bord.
  expect(JSON.stringify(res.body)).not.toContain(CV.fullName);
  return res.body as DemoMetricsView;
}

describe("démo API — métriques de validation", () => {
  it("renvoie des métriques vides au démarrage", async () => {
    await withApp({}, async ({ server }) => {
      const metrics = await readMetrics(server);

      expect(metrics.previewed).toBe(0);
      expect(metrics.paid).toBe(0);
      expect(metrics.rejected).toBe(0);
      expect(metrics.conversionRate).toBe(0);
      expect(metrics.rejectionRate).toBe(0);
      expect(metrics.paymentAttempts).toBe(0);
      expect(metrics.paymentFailures).toBe(0);
      expect(metrics.paymentFailureRate).toBe(0);
      expect(metrics.averageTimeToPaymentMs).toBeNull();
      expect(metrics.averagePrice).toBeNull();
      expect(metrics.marginPerDeliverable).toBeNull();
      expect(metrics.aiCostPerDeliverable).toBeNull();
      expect(Number.isNaN(Date.parse(metrics.generatedAt))).toBe(false);
    });
  });

  it("compte 1 CV payé et 1 CV refusé (taux 50 / 50)", async () => {
    await withApp({}, async ({ server }) => {
      const paidId = await createCv(server);
      await pay(server, paidId);
      await simulate(server, paidId, "approved");

      const rejectedId = await createCv(server);
      const rejected = await request(server)
        .post(`/deliverables/${rejectedId}/reject`)
        .send({ reason: "pas le bon profil" })
        .expect(200);
      expect(rejected.body.regenerated).toBe(false);
      expect(rejected.body.deliverable.state).toBe("rejected");

      const metrics = await readMetrics(server);
      expect(metrics.previewed).toBe(2);
      expect(metrics.paid).toBe(1);
      expect(metrics.rejected).toBe(1);
      expect(metrics.conversionRate).toBe(0.5);
      expect(metrics.rejectionRate).toBe(0.5);
      expect(metrics.averagePrice).toBe(200);
      expect(metrics.averageTimeToPaymentMs).not.toBeNull();
      expect(metrics.averageTimeToPaymentMs ?? -1).toBeGreaterThanOrEqual(0);
    });
  });

  it("compte un échec de paiement puis la relance réussie", async () => {
    await withApp({}, async ({ server }) => {
      const id = await createCv(server);
      await pay(server, id);

      // Refus du fournisseur : retour à `previewed`, relançable sans frais.
      await request(server).post(`/demo/simulate/${id}/declined`).expect(200);
      await pay(server, id);
      await request(server).post(`/demo/simulate/${id}/approved`).expect(200);

      const metrics = await readMetrics(server);
      expect(metrics.paymentAttempts).toBeGreaterThanOrEqual(2);
      expect(metrics.paymentFailures).toBeGreaterThanOrEqual(1);
      expect(metrics.paymentFailureRate).toBeGreaterThan(0);
      expect(metrics.paid).toBe(1);
      expect(metrics.conversionRate).toBe(1);
    });
  });

  it("laisse la marge nulle sans DEMO_AI_COST_PER_DELIVERABLE", async () => {
    await withApp({}, async ({ server }) => {
      const id = await createCv(server);
      await pay(server, id);
      await request(server).post(`/demo/simulate/${id}/approved`).expect(200);

      const metrics = await readMetrics(server);
      expect(metrics.aiCostPerDeliverable).toBeNull();
      expect(metrics.averagePrice).toBe(200);
      expect(metrics.marginPerDeliverable).toBeNull();
    });
  });

  it("calcule la marge quand DEMO_AI_COST_PER_DELIVERABLE est fixé", async () => {
    await withApp({ aiCost: "40" }, async ({ server }) => {
      const id = await createCv(server);
      await pay(server, id);
      await request(server).post(`/demo/simulate/${id}/approved`).expect(200);

      const metrics = await readMetrics(server);
      expect(metrics.aiCostPerDeliverable).toBe(40);
      expect(metrics.averagePrice).toBe(200);
      // Prix − coût IA : 200 − 40.
      expect(metrics.marginPerDeliverable).toBe(160);
    });
  });

  it("exige x-internal-key quand PREVIEWPAY_INTERNAL_KEY est définie", async () => {
    await withApp({ internalKey: "cle-de-test" }, async ({ server }) => {
      await request(server).get("/demo/metrics").expect(403);
      await readMetrics(server, "cle-de-test");
    });
  });
});
