import "reflect-metadata";

import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import type { PreviewStrategy } from "@previewpay/core";
import { MockPaymentProvider } from "@previewpay/provider-mock";
import { MemoryStorage } from "@previewpay/storage-memory";
import { PreviewPayModule } from "@previewpay/nestjs";
import type { PreviewPayModuleOptions } from "@previewpay/nestjs";
import request from "supertest";

export const WEBHOOK_SECRET = "secret_webhook_test";
export const DOWNLOAD_SECRET = "secret_download_test";
export const INTERNAL_KEY = "cle_interne_test";
export const BASE_URL = "https://api.test";

/** Contenu « complet » qui ne doit jamais sortir du serveur. */
export const FULL_CV =
  "Jean Dupont — Développeur\n".repeat(40) + "FIN-SECRETE-DU-CV";

/** Aperçu borné + filigrane : le serveur ne fabrique jamais le reste. */
export class TruncatePreview implements PreviewStrategy {
  calls = 0;

  async makePreview(content: unknown): Promise<unknown> {
    this.calls += 1;
    const text = String(content);
    return {
      text: text.slice(0, 80),
      watermark: "APERÇU — PreviewPay",
      truncated: text.length > 80,
    };
  }
}

export interface TestApp {
  app: NestExpressApplication;
  storage: MemoryStorage;
  provider: MockPaymentProvider;
  preview: TruncatePreview;
  http: () => ReturnType<typeof request>;
  close: () => Promise<void>;
}

/** Requête supertest prête à être configurée. */
export type SupertestRequest = ReturnType<
  ReturnType<typeof request>["post"]
>;

type Overrides = Partial<
  Omit<PreviewPayModuleOptions, "storage" | "provider">
>;

/**
 * Monte une application Nest réelle (Express) avec `rawBody: true`, le storage
 * en mémoire et le fournisseur mock : aucun accès réseau.
 *
 * `appOptions.rawBody = false` sert à vérifier le diagnostic quand
 * l'intégrateur oublie `rawBody: true` au démarrage.
 */
export async function createTestApp(
  overrides: Overrides = {},
  appOptions: { rawBody?: boolean } = {},
): Promise<TestApp> {
  const storage = new MemoryStorage();
  const provider = new MockPaymentProvider({ secret: WEBHOOK_SECRET });
  const preview = new TruncatePreview();

  const options: PreviewPayModuleOptions = {
    storage,
    provider,
    preview,
    pricing: { cv: 200 },
    download: {
      secret: DOWNLOAD_SECRET,
      baseUrl: BASE_URL,
      ttlSeconds: 60,
    },
    internalApiKey: INTERNAL_KEY,
    ...overrides,
  };

  const moduleRef = await Test.createTestingModule({
    imports: [PreviewPayModule.forRoot(options)],
  }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({
    rawBody: appOptions.rawBody ?? true,
    logger: false,
  });
  await app.init();

  const http = () => request(app.getHttpServer());

  return {
    app,
    storage,
    provider,
    preview,
    http,
    close: async () => {
      await app.close();
    },
  };
}

/** Crée un livrable via l'endpoint interne. */
export async function createDeliverable(
  testApp: TestApp,
  body: Record<string, unknown> = {},
): Promise<{ id: string; state: string; price: number }> {
  const response = await testApp
    .http()
    .post("/deliverables")
    .set("x-internal-key", INTERNAL_KEY)
    .send({ type: "cv", content: FULL_CV, ...body })
    .expect(201);
  return response.body as { id: string; state: string; price: number };
}

/** Récupère l'identifiant de paiement du fournisseur pour un livrable. */
export async function paymentIdOf(
  testApp: TestApp,
  deliverableId: string,
): Promise<string> {
  const deliverable = await testApp.storage.getDeliverable(deliverableId);
  if (!deliverable?.paymentId) {
    throw new Error("Aucun paiement enregistré pour ce livrable");
  }
  return deliverable.paymentId;
}
