import { existsSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import type { Storage } from "@previewpay/core";
import { describeStorageContract, makeDeliverable } from "@previewpay/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaStorage } from "../src/index.js";

/**
 * Contrat `Storage` exécuté contre une vraie base PostgreSQL.
 *
 * Le fichier se saute proprement quand `DATABASE_URL` est absent ou que le
 * serveur est injoignable : la CI GitHub reste verte sans service Postgres.
 */

/** Lit `DATABASE_URL` depuis l'environnement, sinon depuis le `.env` racine. */
function readDatabaseUrl(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const here = dirname(fileURLToPath(import.meta.url));
  const envPath = resolve(here, "../../../.env");
  if (!existsSync(envPath)) return undefined;

  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const match = /^\s*DATABASE_URL\s*=\s*(.+?)\s*$/.exec(line);
    const value = match?.[1]?.replace(/^["']|["']$/g, "");
    if (value) return value;
  }
  return undefined;
}

/** Teste l'ouverture TCP vers l'hôte de la base, sans dépendre de Prisma. */
function canReach(url: string, timeoutMs = 1_000): Promise<boolean> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return Promise.resolve(false);
  }

  const port = Number(target.port === "" ? 5432 : target.port);

  return new Promise<boolean>((settle) => {
    const socket = connect({ host: target.hostname, port });
    const finish = (reachable: boolean) => {
      socket.destroy();
      settle(reachable);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

const databaseUrl = readDatabaseUrl();
const reachable = databaseUrl !== undefined && (await canReach(databaseUrl));

if (!reachable) {
  console.warn(
    databaseUrl
      ? "[storage-prisma] PostgreSQL injoignable — contrat ignoré (docker compose up -d db)."
      : "[storage-prisma] DATABASE_URL absent — contrat ignoré.",
  );
}

describe.skipIf(!reachable)("PrismaStorage sur PostgreSQL", () => {
  let prisma: PrismaClient;
  let storage: Storage;

  beforeAll(async () => {
    if (databaseUrl === undefined) {
      throw new Error("DATABASE_URL requis pour le contrat PostgreSQL");
    }
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await prisma.$connect();
    storage = createPrismaStorage(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Remet la base à zéro entre deux tests (identifiants autoincrement inclus). */
  async function resetDatabase(): Promise<void> {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Deliverable", "JournalEntry", "PaymentEvent" RESTART IDENTITY CASCADE',
    );
  }

  describeStorageContract({
    create: async () => {
      await resetDatabase();
      return storage;
    },
  });

  describe("garanties propres à PostgreSQL", () => {
    beforeEach(async () => {
      await resetDatabase();
    });

    it("n'accorde qu'une transition sur deux tentatives simultanées", async () => {
      await storage.saveDeliverable(makeDeliverable());

      const results = await Promise.all([
        storage.transition("dlv_contract", "previewed", "payment_pending", {
          cause: "pay",
          paymentId: "pay_contract",
        }),
        storage.transition("dlv_contract", "previewed", "payment_pending", {
          cause: "pay",
          paymentId: "pay_contract",
        }),
      ]);

      expect(results.filter((applied) => applied)).toHaveLength(1);
      expect((await storage.getDeliverable("dlv_contract"))?.state).toBe(
        "payment_pending",
      );
      // Le perdant ne laisse aucune entrée de journal.
      expect(await storage.listJournal("dlv_contract")).toHaveLength(1);
    });

    it("ne renvoie que des métadonnées dans le journal", async () => {
      await storage.saveDeliverable(makeDeliverable());
      await storage.transition("dlv_contract", "previewed", "payment_pending", {
        cause: "pay",
        paymentId: "pay_contract",
      });

      const [entry] = await storage.listJournal("dlv_contract");
      expect(entry).toBeDefined();
      expect(Object.keys(entry ?? {}).sort()).toEqual([
        "at",
        "cause",
        "deliverableId",
        "from",
        "paymentId",
        "to",
      ]);
      // Aucun fragment du contenu complet ne fuit par le journal.
      expect(JSON.stringify(entry)).not.toContain("contenu complet");
    });

    it("conserve la date de création à la milliseconde près", async () => {
      const createdAt = new Date("2026-11-14T10:00:00.123Z");
      await storage.saveDeliverable(makeDeliverable({ createdAt }));

      const stored = await storage.getDeliverable("dlv_contract");
      expect(stored?.createdAt.toISOString()).toBe("2026-11-14T10:00:00.123Z");
    });
  });
});
