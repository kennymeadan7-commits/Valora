import { beforeEach, describe, expect, it } from "vitest";
import {
  InvalidSignatureError,
  InvalidTransitionError,
  PaymentRequiredError,
  PreviewPay,
  verifyDownloadToken,
  type PaymentProvider,
  type PreviewStrategy,
} from "@previewpay/core";
import { MemoryStorage } from "@previewpay/storage-memory";
import { MockPaymentProvider } from "@previewpay/provider-mock";

const SECRET = "test_download_secret";
const PRICING = { cv: 200, presentation: 500 };

/** Aperçu : 120 premiers caractères + filigrane. Le reste ne sort jamais. */
class TruncatePreview implements PreviewStrategy {
  calls = 0;
  async makePreview(content: unknown): Promise<unknown> {
    this.calls += 1;
    const text = String(content);
    return { text: text.slice(0, 120), watermark: "APERÇU", truncated: text.length > 120 };
  }
}

function setup() {
  const storage = new MemoryStorage();
  const provider = new MockPaymentProvider({ secret: "mock_secret" });
  const preview = new TruncatePreview();
  const engine = new PreviewPay({
    storage,
    provider,
    preview,
    pricing: PRICING,
    maxRegenerations: 1,
    download: { secret: SECRET, baseUrl: "https://api.test", ttlSeconds: 60 },
  });
  return { storage, provider, preview, engine };
}

const FULL_CV = "Jean Dupont — Développeur\n".repeat(40) + "SECTION-FINALE-SECRETE";

describe("création et prix", () => {
  it("fige le prix à la création même si la grille change", async () => {
    const { engine, storage } = setup();
    const created = await engine.create({ type: "cv", content: FULL_CV });
    expect(created.price).toBe(200);
    expect(created.state).toBe("previewed");
    expect(created.currency).toBe("XOF");

    const pricing = { cv: 900 };
    expect(pricing.cv).toBe(900);
    expect((await storage.getDeliverable(created.id))?.price).toBe(200);
  });

  it("refuse un type sans prix", async () => {
    const { engine } = setup();
    await expect(engine.create({ type: "inconnu", content: "x" })).rejects.toThrow(
      /Aucun prix configuré/,
    );
  });

  it("n'expose jamais le contenu complet dans la vue publique", async () => {
    const { engine } = setup();
    const created = await engine.create({ type: "cv", content: FULL_CV });
    const serialized = JSON.stringify(created);
    expect(serialized).not.toContain("SECTION-FINALE-SECRETE");
    expect((created.preview as { text: string }).text.length).toBeLessThan(
      FULL_CV.length,
    );
    expect((created.preview as { truncated: boolean }).truncated).toBe(true);
    expect(created.downloadUrl).toBeNull();
  });
});

describe("refus d'aperçu", () => {
  it("régénère dans la limite puis clôt sans frais", async () => {
    const { engine } = setup();
    const created = await engine.create({ type: "cv", content: FULL_CV });

    const first = await engine.reject(created.id, "trop générique");
    expect(first.regenerated).toBe(true);
    expect(first.deliverable.state).toBe("previewed");
    expect(first.deliverable.regenerations).toBe(1);

    const second = await engine.reject(created.id, "toujours pas");
    expect(second.regenerated).toBe(false);
    expect(second.deliverable.state).toBe("rejected");

    await expect(engine.pay(created.id, { phone: "+22990000000", operator: "mtn_benin" }))
      .rejects.toBeInstanceOf(InvalidTransitionError);
  });
});

describe("paiement", () => {
  it("réserve le livrable et transmet le montant figé", async () => {
    const { engine, provider } = setup();
    const created = await engine.create({ type: "cv", content: FULL_CV });

    const paid = await engine.pay(created.id, {
      phone: "+22990000000",
      operator: "mtn_benin",
    });
    expect(paid.state).toBe("payment_pending");
    expect(paid.downloadUrl).toBeNull();

    const input = provider.getPaymentInput("mock_pay_1");
    expect(input?.amount).toBe(200);
    expect(input?.currency).toBe("XOF");
    expect(input?.reference).toBe(created.id);
  });

  it("libère la réservation si la création du paiement échoue", async () => {
    const { engine, storage } = setup();
    const broken: PaymentProvider = {
      name: "broken",
      async createPayment() {
        throw new Error("opérateur indisponible");
      },
      async getPaymentStatus() {
        return "pending";
      },
      async parseWebhook() {
        throw new Error("n/a");
      },
    };
    const engineWithBroken = new PreviewPay({
      storage,
      provider: broken,
      preview: new TruncatePreview(),
      pricing: PRICING,
      download: { secret: SECRET, baseUrl: "https://api.test" },
    });

    const created = await engine.create({ type: "cv", content: FULL_CV });
    await expect(
      engineWithBroken.pay(created.id, { phone: "+22990000000", operator: "mtn_benin" }),
    ).rejects.toThrow(/opérateur/);

    expect((await storage.getDeliverable(created.id))?.state).toBe("previewed");
  });
});

describe("webhook", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  async function paidDeliverable() {
    const created = await ctx.engine.create({ type: "cv", content: FULL_CV });
    await ctx.engine.pay(created.id, { phone: "+22990000000", operator: "moov_benin" });
    return created.id;
  }

  it("débloque après approbation vérifiée par appel API", async () => {
    const id = await paidDeliverable();
    ctx.provider.setStatus("mock_pay_1", "approved");

    const hook = ctx.provider.buildWebhook("mock_pay_1");
    const out = await ctx.engine.handleWebhook(hook.rawBody, hook.headers);

    expect(out.duplicate).toBe(false);
    const d = await ctx.engine.get(id);
    expect(d.state).toBe("unlocked");
    expect(d.downloadUrl).toContain("https://api.test/deliverables/");
    // Le lien doit viser l'endpoint qui sert réellement le fichier.
    expect(d.downloadUrl).toContain("/content?token=");
  });

  it("un webhook reçu deux fois ne débloque qu'une fois", async () => {
    const id = await paidDeliverable();
    ctx.provider.setStatus("mock_pay_1", "approved");
    const hook = ctx.provider.buildWebhook("mock_pay_1");

    await ctx.engine.handleWebhook(hook.rawBody, hook.headers);
    const second = await ctx.engine.handleWebhook(hook.rawBody, hook.headers);

    expect(second.duplicate).toBe(true);
    const journal = await ctx.storage.listJournal(id);
    expect(journal.filter((e) => e.to === "unlocked")).toHaveLength(1);
  });

  it("ne se fie pas au webhook : si l'API dit declined, pas de déblocage", async () => {
    const id = await paidDeliverable();
    ctx.provider.setStatus("mock_pay_1", "declined");
    const hook = ctx.provider.buildWebhook("mock_pay_1", { status: "approved" });

    await ctx.engine.handleWebhook(hook.rawBody, hook.headers);
    expect((await ctx.engine.get(id)).state).toBe("previewed");
  });

  it("declined rend le livrable relançable", async () => {
    const id = await paidDeliverable();
    ctx.provider.setStatus("mock_pay_1", "declined");
    const hook = ctx.provider.buildWebhook("mock_pay_1");
    await ctx.engine.handleWebhook(hook.rawBody, hook.headers);

    expect((await ctx.engine.get(id)).state).toBe("previewed");
    const retry = await ctx.engine.pay(id, {
      phone: "+22990000000",
      operator: "moov_benin",
    });
    expect(retry.state).toBe("payment_pending");
  });

  it("rejette une signature invalide sans changer d'état", async () => {
    const id = await paidDeliverable();
    const hook = ctx.provider.buildWebhook("mock_pay_1");

    await expect(
      ctx.engine.handleWebhook(hook.rawBody, { "x-mock-signature": "faux" }),
    ).rejects.toBeInstanceOf(InvalidSignatureError);
    expect((await ctx.engine.get(id)).state).toBe("payment_pending");
  });

  it("détecte l'expiration par appel API (aucun webhook)", async () => {
    const id = await paidDeliverable();
    ctx.provider.setStatus("mock_pay_1", "expired");

    const d = await ctx.engine.syncPayment(id);
    expect(d.state).toBe("previewed");
  });
});

describe("téléchargement", () => {
  it("refuse le lien tant que le livrable est verrouillé", async () => {
    const { engine } = setup();
    const created = await engine.create({ type: "cv", content: FULL_CV });
    await expect(engine.download(created.id)).rejects.toBeInstanceOf(
      PaymentRequiredError,
    );
  });

  it("délivre le contenu complet une fois débloqué", async () => {
    const { engine, provider } = setup();
    const created = await engine.create({ type: "cv", content: FULL_CV });
    await engine.pay(created.id, { phone: "+22990000000", operator: "mtn_benin" });
    provider.setStatus("mock_pay_1", "approved");
    const hook = provider.buildWebhook("mock_pay_1");
    await engine.handleWebhook(hook.rawBody, hook.headers);

    const link = await engine.download(created.id);
    const token = new URL(link.url).searchParams.get("token") ?? "";
    const deliverable = await engine.verifyDownloadToken(token);
    expect(deliverable.content).toBe(FULL_CV);
  });

  it("rejette un jeton falsifié ou expiré", async () => {
    const token = "abc.def";
    expect(verifyDownloadToken(token, SECRET)).toBeNull();

    const { engine, provider } = setup();
    const created = await engine.create({ type: "cv", content: FULL_CV });
    await engine.pay(created.id, { phone: "+22990000000", operator: "mtn_benin" });
    provider.setStatus("mock_pay_1", "approved");
    const hook = provider.buildWebhook("mock_pay_1");
    await engine.handleWebhook(hook.rawBody, hook.headers);

    const link = await engine.download(created.id);
    const token2 = new URL(link.url).searchParams.get("token") ?? "";
    const parts = token2.split(".");
    const forged = `${parts[0]}.${"A".repeat(43)}`;
    expect(verifyDownloadToken(forged, SECRET)).toBeNull();
    expect(
      verifyDownloadToken(token2, SECRET, new Date(Date.now() + 120_000)),
    ).toBeNull();
  });
});
