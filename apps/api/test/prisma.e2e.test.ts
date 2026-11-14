/**
 * Parcours de démo **sur PostgreSQL** : mêmes routes que `demo.e2e.test.ts`,
 * mais le `Storage` est `PrismaStorage`. Vérifie que l'état, le contenu et le
 * journal atterrissent réellement en base, et que l'idempotence des webhooks
 * est garantie par la contrainte primaire de `PaymentEvent`.
 *
 * Le test est ignoré si la base n'est pas joignable (cas de la CI) :
 *   docker compose up -d db
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { PrismaClient } from "@prisma/client";
import type { MockPaymentProvider } from "@previewpay/provider-mock";

/** Lit `DATABASE_URL` depuis l'environnement, sinon depuis le `.env` racine. */
function lireDatabaseUrl(): string | undefined {
  if (process.env["DATABASE_URL"]) return process.env["DATABASE_URL"];
  const ici = dirname(fileURLToPath(import.meta.url));
  const chemin = resolve(ici, "../../../.env");
  if (!existsSync(chemin)) return undefined;
  for (const ligne of readFileSync(chemin, "utf8").split("\n")) {
    const trouve = /^\s*DATABASE_URL\s*=\s*(.+?)\s*$/.exec(ligne);
    const valeur = trouve?.[1]?.replace(/^["']|["']$/g, "");
    if (valeur) return valeur;
  }
  return undefined;
}

const urlBase = lireDatabaseUrl();
if (urlBase) process.env["DATABASE_URL"] = urlBase;

process.env["STORAGE"] = "prisma";
process.env["PAYMENT_PROVIDER"] = "mock";
process.env["PREVIEWPAY_DOWNLOAD_SECRET"] = "secret_de_test_prisma";
process.env["PREVIEWPAY_DOWNLOAD_BASE_URL"] = "http://localhost:3000";
process.env["PAYMENT_PROVIDER"] = "mock";

const db = new PrismaClient();

async function baseDisponible(): Promise<boolean> {
  if (!process.env["DATABASE_URL"]) return false;
  try {
    await db.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

const disponible = await baseDisponible();
if (!disponible) {
  console.warn(
    "[apps/api] PostgreSQL injoignable — parcours Prisma ignoré (docker compose up -d db).",
  );
}

async function vider(): Promise<void> {
  await db.$executeRawUnsafe(
    'TRUNCATE "Deliverable", "JournalEntry", "PaymentEvent" RESTART IDENTITY CASCADE',
  );
}

describe.skipIf(!disponible)("démo API sur PostgreSQL", () => {
  let app: INestApplication;
  let server: App;
  let provider: MockPaymentProvider;

  beforeAll(async () => {
    await vider();
    const { AppModule, config } = await import("../src/app.module.js");
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    server = app.getHttpServer();
    provider = config.provider as MockPaymentProvider;

    expect(config.storageKind).toBe("prisma");
  });

  afterAll(async () => {
    await app?.close();
    await db.$disconnect();
  });

  it("expose le stockage actif dans le healthcheck", async () => {
    const res = await request(server).get("/demo/health").expect(200);
    expect(res.body).toEqual({
      status: "ok",
      provider: "mock",
      storage: "prisma",
    });
  });

  it("persiste le livrable et garde le contenu hors de l'API", async () => {
    const res = await request(server)
      .post("/demo/cv")
      .send({ fullName: "Awa Prisma", headline: "Chargée de communication" })
      .expect(201);

    expect(res.body.content).toBeUndefined();
    expect(res.body.downloadUrl).toBeNull();

    const ligne = await db.deliverable.findUnique({
      where: { id: res.body.id },
    });
    expect(ligne).not.toBeNull();
    expect(ligne?.state).toBe("previewed");
    expect(ligne?.price).toBe(200);
    expect(ligne?.currency).toBe("XOF");
    expect(JSON.stringify(ligne?.content)).toContain("Awa Prisma");
    // `content` en base est bien plus riche que l'aperçu envoyé au client.
    expect(JSON.stringify(ligne?.content).length).toBeGreaterThan(
      String((res.body.preview as { text: string }).text).length,
    );
  });

  it("écrit une entrée de journal par transition, dans l'ordre", async () => {
    const created = await request(server)
      .post("/demo/cv")
      .send({ fullName: "Koffi Journal", headline: "Développeur" })
      .expect(201);

    await request(server)
      .post(`/deliverables/${created.body.id}/pay`)
      .send({ phone: "+22990000000", operator: "mtn_benin" })
      .expect(200);

    // Deuxième paiement sur un livrable déjà `payment_pending` : refusé.
    await request(server)
      .post(`/deliverables/${created.body.id}/pay`)
      .send({ phone: "+22990000000", operator: "mtn_benin" })
      .expect(409);

    const journalApresPaiement = await db.journalEntry.findMany({
      where: { deliverableId: created.body.id },
      orderBy: { id: "asc" },
    });
    expect(journalApresPaiement.map((e) => [e.from, e.to])).toEqual([
      ["draft", "previewed"],
      ["previewed", "payment_pending"],
    ]);

    await request(server)
      .get(`/deliverables/${created.body.id}/download`)
      .expect(402);
  });

  it("débloque après vérification d'API et sert le fichier complet", async () => {
    const created = await request(server)
      .post("/demo/cv")
      .send({ fullName: "Fatou Débloquée", headline: "Assistante" })
      .expect(201);

    await request(server)
      .post(`/deliverables/${created.body.id}/pay`)
      .send({ phone: "+22990000000", operator: "moov_benin" })
      .expect(200);

    const approuve = await request(server)
      .post(`/demo/simulate/${created.body.id}/approved`)
      .set("x-internal-key", process.env["PREVIEWPAY_INTERNAL_KEY"] ?? "dev-internal-key")
      .expect(200);
    expect(approuve.body.state).toBe("unlocked");

    const enBase = await db.deliverable.findUnique({
      where: { id: created.body.id },
    });
    expect(enBase?.state).toBe("unlocked");

    const download = await request(server)
      .get(`/deliverables/${created.body.id}/download`)
      .expect(200);
    expect(download.body.url).toContain("/content?token=");

    const fichier = await request(server)
      .get(new URL(download.body.url).pathname + new URL(download.body.url).search)
      .expect(200);
    expect(fichier.text).toContain("## Langues");
  });

  it("n'enregistre qu'une fois un webhook réémis", async () => {
    const created = await request(server)
      .post("/demo/cv")
      .send({ fullName: "Idem Potent", headline: "Analyste" })
      .expect(201);

    await request(server)
      .post(`/deliverables/${created.body.id}/pay`)
      .send({ phone: "+22990000000", operator: "mtn_benin" })
      .expect(200);

    // Le compteur du fournisseur mock est propre au processus de test.
    const paiement = await db.deliverable.findUnique({
      where: { id: created.body.id },
      select: { paymentId: true },
    });
    const paymentId = paiement?.paymentId ?? "";
    expect(paymentId).toMatch(/^mock_pay_/);

    provider.setStatus(paymentId, "approved");
    const hook = provider.buildWebhook(paymentId);

    for (const _ of [1, 2]) {
      await request(server)
        .post("/webhooks/fedapay")
        .set("content-type", "application/json")
        .set(hook.headers)
        .send(hook.rawBody.toString())
        .expect(200);
    }

    const evenements = await db.paymentEvent.count({ where: { paymentId } });
    expect(evenements).toBe(1);

    const transitions = await db.journalEntry.findMany({
      where: { deliverableId: created.body.id, to: "unlocked" },
    });
    expect(transitions).toHaveLength(1);
  });
});
