import type { Pricing, PreviewStrategy } from "@previewpay/core";
import { FedaPayProvider } from "@previewpay/provider-fedapay";
import { MockPaymentProvider } from "@previewpay/provider-mock";
import { MemoryStorage } from "@previewpay/storage-memory";
import { createPrismaStorage } from "@previewpay/storage-prisma";
import type { PaymentProvider, Storage } from "@previewpay/core";

/** Grille tarifaire de la démo, en entiers XOF. */
export const DEMO_PRICING: Pricing = { cv: 200, presentation: 500 };

export type StorageKind = "memory" | "prisma";

export interface AppConfig {
  port: number;
  webOrigin: string;
  storage: Storage;
  storageKind: StorageKind;
  provider: PaymentProvider;
  pricing: Pricing;
  preview: PreviewStrategy;
  downloadSecret: string;
  downloadBaseUrl: string;
  internalApiKey: string | undefined;
  maxRegenerations: number;
  providerName: "mock" | "fedapay";
  /**
   * Coût IA moyen par livrable, en XOF, lu dans
   * `DEMO_AI_COST_PER_DELIVERABLE`. `null` quand la variable est absente ou
   * illisible : la marge n'est alors pas calculable (le cœur renvoie `null`).
   */
  aiCostPerDeliverable: number | null;
}

/** Aperçu utile mais inutilisable : début du texte + filigrane explicite. */
export class TextPreviewStrategy implements PreviewStrategy {
  constructor(private readonly maxChars = 420) {}

  async makePreview(
    content: unknown,
    ctx: { type: string },
  ): Promise<unknown> {
    const text = typeof content === "string" ? content : JSON.stringify(content);
    return {
      kind: "text",
      type: ctx.type,
      text: text.slice(0, this.maxChars),
      truncated: text.length > this.maxChars,
      watermark: "APERÇU — PreviewPay",
      totalChars: text.length,
    };
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`);
  return value;
}

function buildProvider(): { provider: PaymentProvider; name: "mock" | "fedapay" } {
  const name = (process.env["PAYMENT_PROVIDER"] ?? "mock").toLowerCase();
  if (name === "fedapay") {
    return {
      name: "fedapay",
      provider: new FedaPayProvider({
        secretKey: requireEnv("FEDAPAY_SECRET_KEY"),
        webhookSecret: requireEnv("FEDAPAY_WEBHOOK_SECRET"),
        environment: process.env["FEDAPAY_ENV"] === "live" ? "live" : "sandbox",
        callbackUrl: process.env["FEDAPAY_CALLBACK_URL"],
        phoneCountry: process.env["FEDAPAY_PHONE_COUNTRY"] ?? "bj",
      }),
    };
  }
  return {
    name: "mock",
    provider: new MockPaymentProvider({
      secret: process.env["MOCK_WEBHOOK_SECRET"] ?? "mock_webhook_secret",
    }),
  };
}

/** `STORAGE=prisma` bascule la démo sur PostgreSQL (docker compose up -d db). */
function buildStorage(): { storage: Storage; kind: StorageKind } {
  const mode = (process.env["STORAGE"] ?? "memory").toLowerCase();
  if (mode === "prisma") {
    return { storage: createPrismaStorage(), kind: "prisma" };
  }
  if (mode !== "memory") {
    throw new Error(`STORAGE inconnu « ${mode} » (memory | prisma)`);
  }
  return { storage: new MemoryStorage(), kind: "memory" };
}

/**
 * Coût IA par livrable pour le calcul de marge. Variable absente, vide ou
 * illisible → `null` : la démo affiche « — » plutôt qu'une marge inventée.
 * Aucune valeur par défaut : le coût réel dépend de l'agent de l'intégrateur.
 */
function parseAiCost(raw: string | undefined): number | null {
  const value = raw?.trim();
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

/**
 * Configuration de l'app de démo. Tout vient de l'environnement : aucun secret
 * en dur, et le mode `mock` est le défaut pour que la démo tourne hors ligne.
 */
export function loadConfig(): AppConfig {
  const { provider, name } = buildProvider();
  const { storage, kind } = buildStorage();
  const port = Number(process.env["PORT"] ?? 3000);

  return {
    port,
    webOrigin: process.env["WEB_ORIGIN"] ?? "http://localhost:5173",
    storage,
    storageKind: kind,
    provider,
    pricing: DEMO_PRICING,
    preview: new TextPreviewStrategy(),
    downloadSecret: requireEnv("PREVIEWPAY_DOWNLOAD_SECRET"),
    downloadBaseUrl:
      process.env["PREVIEWPAY_DOWNLOAD_BASE_URL"] ??
      process.env["PREVIEWPAY_PUBLIC_URL"] ??
      `http://localhost:${port}`,
    internalApiKey: process.env["PREVIEWPAY_INTERNAL_KEY"],
    maxRegenerations: Number(process.env["PREVIEWPAY_MAX_REGENERATIONS"] ?? 2),
    providerName: name,
    aiCostPerDeliverable: parseAiCost(
      process.env["DEMO_AI_COST_PER_DELIVERABLE"],
    ),
  };
}
