/**
 * Chemin de production complet, sans le serveur FedaPay : vrai adaptateur
 * `FedaPayProvider`, vraie vérification de signature `t=…,s=…`, vrai moteur,
 * vraie machine à états. Seul le transport HTTP est bouchonné.
 *
 * C'est la preuve que tout le SDK débloque bien sur un `transaction.approved`
 * authentique ; la seule brique non démontrable ici est l'approbation côté
 * FedaPay (sandbox qui décline, voir docs/fedapay-sandbox.md).
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PreviewPay, type PreviewStrategy, type Storage } from "@previewpay/core";
import { MemoryStorage } from "@previewpay/storage-memory";
import { FedaPayProvider } from "@previewpay/provider-fedapay";

const WEBHOOK_SECRET = "wh_sandbox_preuve_reelle";
const DOWNLOAD_SECRET = "secret_de_test_unlock_flow";
const NOW = 1_800_000_000;

/** Transport bouchonné : FedaPay répond `approved` à la revérification. */
function fedapayStub(statutFinal: string) {
  const appels: string[] = [];
  const impl = (async (url: string, init: RequestInit = {}) => {
    const chemin = decodeURIComponent(new URL(String(url)).pathname);
    appels.push(`${init.method ?? "GET"} ${chemin}`);

    const corps =
      chemin.endsWith("/token")
        ? { token: "tok_1", url: "https://sandbox-process.fedapay.com/tok_1" }
        : chemin === "/v1/transactions"
          ? { "v1/transaction": { id: 9001, status: "pending" } }
          : { "v1/transaction": { id: 9001, status: statutFinal } };

    return new Response(JSON.stringify(corps), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { impl, appels };
}

class ApercuCourte implements PreviewStrategy {
  async makePreview(content: unknown) {
    return { text: String(content).slice(0, 80), watermark: "APERÇU" };
  }
}

function assembler(statutFinal: string) {
  const { impl, appels } = fedapayStub(statutFinal);
  const provider = new FedaPayProvider({
    secretKey: "sk_sandbox_test",
    webhookSecret: WEBHOOK_SECRET,
    environment: "sandbox",
    fetchImpl: impl,
    nowSeconds: () => NOW,
  });
  const storage: Storage = new MemoryStorage();
  const engine = new PreviewPay({
    storage,
    provider,
    preview: new ApercuCourte(),
    pricing: { cv: 200 },
    download: { secret: DOWNLOAD_SECRET, baseUrl: "https://api.test" },
  });
  return { engine, storage, appels };
}

function webhookSigne(nom: string, transactionId: number, t = NOW) {
  const body = Buffer.from(
    JSON.stringify({
      name: nom,
      object: "transaction",
      entity: { klass: "v1/transaction", id: transactionId, status: "approved" },
      account: { id: 25615 },
    }),
  );
  const mac = createHmac("sha256", WEBHOOK_SECRET)
    .update(`${t}.`)
    .update(body)
    .digest("hex");
  return { body, headers: { "x-fedapay-signature": `t=${t},s=${mac}` } };
}

describe("déblocage réel avec l'adaptateur FedaPay", () => {
  it("create → pay → webhook signé → revérification → unlocked → fichier", async () => {
    const { engine, storage, appels } = assembler("approved");

    const livrable = await engine.create({
      type: "cv",
      content: "CV complet de démonstration — " + "x".repeat(500),
    });
    expect(livrable.state).toBe("previewed");
    expect(livrable.price).toBe(200);

    const paye = await engine.pay(livrable.id, {
      phone: "64000001",
      operator: "mtn_benin",
    });
    expect(paye.state).toBe("payment_pending");
    expect(appels).toContain("POST /v1/transactions");
    expect(appels).toContain("POST /v1/transactions/9001/token");

    // Webhook authentique : HMAC-SHA256("<t>.<corps>") avec le secret d'endpoint.
    const { body, headers } = webhookSigne("transaction.approved", 9001);
    const issue = await engine.handleWebhook(body, headers);

    expect(issue).toEqual({
      received: true,
      duplicate: false,
      state: "unlocked",
    });
    expect(appels).toContain("GET /v1/transactions/9001");

    const apres = await engine.get(livrable.id);
    expect(apres.state).toBe("unlocked");
    expect(apres.downloadUrl).toContain("/content?token=");

    const journal = await storage.listJournal(livrable.id);
    expect(journal.map((e) => [e.from, e.to])).toEqual([
      ["draft", "previewed"],
      ["previewed", "payment_pending"],
      ["payment_pending", "unlocked"],
    ]);

    const lien = await engine.download(livrable.id);
    const jeton = new URL(lien.url).searchParams.get("token") ?? "";
    const fichier = await engine.verifyDownloadToken(jeton);
    expect(String(fichier.content)).toContain("CV complet de démonstration");
  });

  it("rejette un webhook dont le corps a été modifié après signature", async () => {
    const { engine } = assembler("approved");
    const livrable = await engine.create({ type: "cv", content: "secret" });
    await engine.pay(livrable.id, { phone: "64000001", operator: "mtn_benin" });

    const { body, headers } = webhookSigne("transaction.approved", 9001);
    const altere = Buffer.from(
      body.toString("utf8").replace('"approved"', '"approved! "'),
    );

    await expect(engine.handleWebhook(altere, headers)).rejects.toThrow(
      /Signature de webhook invalide/,
    );
    expect((await engine.get(livrable.id)).state).toBe("payment_pending");
  });

  it("ne débloque pas si FedaPay dit encore pending malgré le webhook", async () => {
    const { engine } = assembler("pending");
    const livrable = await engine.create({ type: "cv", content: "secret" });
    await engine.pay(livrable.id, { phone: "64000001", operator: "mtn_benin" });

    const { body, headers } = webhookSigne("transaction.approved", 9001);
    await engine.handleWebhook(body, headers);

    expect((await engine.get(livrable.id)).state).toBe("payment_pending");
  });
});
