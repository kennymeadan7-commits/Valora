/**
 * Installe les tarballs produits par `pack-check.mjs` dans un projet vierge,
 * hors du monorepo, puis vérifie qu'un intégrateur peut réellement s'en servir :
 *
 * - ESM : parcours complet create → pay → webhook signé → download → jeton ;
 * - CommonJS : `require()` de chaque paquet ;
 * - NestJS : application réelle avec `PreviewPayModule`, appels HTTP ;
 * - Express : routeur réel, jusqu'au contenu servi par jeton signé ;
 * - React : rendu serveur du paywall ;
 * - Prisma : génération du client à partir du schéma publié ;
 * - TypeScript : types résolus en `nodenext` et en `bundler` ;
 * - Vitest : la suite de contrat de `@previewpay/testing` sur `MemoryStorage`.
 *
 *   node scripts/pack-check.mjs --out /tmp/packs
 *   node scripts/consumer-check.mjs --packs /tmp/packs [--dir /tmp/consumer]
 *
 * Nécessite le registre npm pour les dépendances tierces (Nest, React, Prisma…).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const packs = arg("--packs");
if (!packs) {
  console.error("Usage : node scripts/consumer-check.mjs --packs <dossier des .tgz> [--dir <dossier>]");
  process.exit(2);
}
const dir = resolve(arg("--dir") ?? mkdtempSync(join(tmpdir(), "previewpay-consumer-")));
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const tarballs = readdirSync(packs)
  .filter((f) => f.endsWith(".tgz"))
  .map((f) => resolve(packs, f));
if (tarballs.length === 0) throw new Error(`Aucun tarball dans ${packs}`);

const run = (cmd, cmdArgs, opts = {}) =>
  execFileSync(cmd, cmdArgs, { cwd: dir, stdio: "inherit", env: { ...process.env, CI: "1" }, ...opts });
const write = (file, content) => writeFileSync(join(dir, file), content);

write("package.json", JSON.stringify({ name: "previewpay-consumer", private: true, type: "module" }, null, 2));

console.log(`→ installation de ${tarballs.length} tarballs dans ${dir}`);
run("npm", [
  "install",
  "--no-audit",
  "--no-fund",
  "--loglevel=error",
  ...tarballs,
  "@nestjs/common@^12.5.0",
  "@nestjs/core@^12.5.0",
  "@nestjs/platform-express@^12.5.0",
  "express@^5.1.0",
  "@types/express@^5",
  "reflect-metadata@^0.2.2",
  "rxjs@^7.8.2",
  "react@^19.0.0",
  "react-dom@^19.0.0",
  "@prisma/client@6.19.3",
  "prisma@6.19.3",
  "vitest@^3.2.4",
  "typescript@5.9.3",
  "@types/node@^22",
  "@types/react@^19",
]);

/* ---------------------------------------------------------------- ESM */
write(
  "esm-flow.mjs",
  `
import assert from "node:assert/strict";
import { PreviewPay, PaymentRequiredError, PreviewLimitError } from "@previewpay/core";
import { MemoryStorage } from "@previewpay/storage-memory";
import { MockPaymentProvider } from "@previewpay/provider-mock";

const provider = new MockPaymentProvider({ secret: "s" });
const pp = new PreviewPay({
  storage: new MemoryStorage(),
  provider,
  pricing: { cv: 200 },
  preview: { makePreview: async (c) => ({ text: String(c).slice(0, 10) }) },
  download: { secret: "dl", baseUrl: "https://api.test" },
  limits: { previewsPerOwnerPerDay: 1 },
});

const d = await pp.create({ type: "cv", content: "CONTENU COMPLET SECRET", ownerId: "u1" });
assert.equal(d.state, "previewed");
assert.equal(d.price, 200);
assert.equal("content" in d, false);
await assert.rejects(pp.create({ type: "cv", content: "x", ownerId: "u1" }), PreviewLimitError);
await assert.rejects(pp.download(d.id), PaymentRequiredError);

const paying = await pp.pay(d.id, { phone: "+22990000000", operator: "mtn_benin" });
assert.equal(paying.state, "payment_pending");
const paymentId = "mock_pay_1"; // premier paiement du fournisseur mock
provider.setStatus(paymentId, "approved");
const hook = provider.buildWebhook(paymentId);
assert.equal((await pp.handleWebhook(hook.rawBody, hook.headers)).state, "unlocked");
assert.equal((await pp.handleWebhook(hook.rawBody, hook.headers)).duplicate, true);

const link = await pp.download(d.id);
const token = new URL(link.url).searchParams.get("token");
assert.equal((await pp.verifyDownloadToken(token)).content, "CONTENU COMPLET SECRET");
console.log("✓ ESM : parcours complet");
`,
);
run("node", ["esm-flow.mjs"]);

/* ---------------------------------------------------------------- CJS */
write(
  "cjs.cjs",
  `
const assert = require("node:assert/strict");
assert.equal(typeof require("@previewpay/core").PreviewPay, "function");
assert.equal(typeof require("@previewpay/storage-memory").MemoryStorage, "function");
assert.equal(typeof require("@previewpay/provider-mock").MockPaymentProvider, "function");
assert.equal(typeof require("@previewpay/provider-fedapay").FedaPayProvider, "function");
assert.equal(typeof require("@previewpay/nestjs").PreviewPayModule, "function");
assert.equal(typeof require("@previewpay/express").createPreviewPayRouter, "function");
assert.equal(typeof require("@previewpay/react").usePreviewPay, "function");
console.log("✓ CommonJS : require() de chaque paquet");
`,
);
run("node", ["cjs.cjs"]);

/* ------------------------------------------------------------- NestJS */
write(
  "nest.mjs",
  `
import "reflect-metadata";
import assert from "node:assert/strict";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { PreviewPayModule } from "@previewpay/nestjs";
import { MemoryStorage } from "@previewpay/storage-memory";
import { MockPaymentProvider } from "@previewpay/provider-mock";

const provider = new MockPaymentProvider({ secret: "s" });
class AppModule {}
Module({
  imports: [
    PreviewPayModule.forRoot({
      storage: new MemoryStorage(),
      provider,
      pricing: { cv: 200 },
      preview: { makePreview: async (c) => ({ text: String(c).slice(0, 5) }) },
      download: { secret: "dl", baseUrl: "http://localhost" },
      internalApiKey: "k",
      limits: { previewsPerOwnerPerDay: 1 },
    }),
  ],
})(AppModule);

const app = await NestFactory.create(AppModule, { rawBody: true, logger: false });
await app.listen(0);
const base = await app.getUrl();
const json = (r) => r.json();
const post = (path, body, headers = {}) =>
  fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

const created = await post("/deliverables", { type: "cv", content: "SECRET COMPLET", ownerId: "u1" }, { "x-internal-key": "k" }).then(json);
assert.equal(created.state, "previewed");
assert.equal((await post("/deliverables", { type: "cv", content: "x", ownerId: "u1" }, { "x-internal-key": "k" })).status, 429);
assert.equal((await fetch(base + "/deliverables/" + created.id + "/download")).status, 402);
assert.equal((await post("/deliverables/" + created.id + "/pay", { phone: "+22990000000", operator: "mtn_benin" })).status, 200);
provider.setStatus("mock_pay_1", "approved");
const hook = provider.buildWebhook("mock_pay_1");
assert.equal((await post("/webhooks/fedapay", hook.rawBody.toString(), hook.headers)).status, 200);
const got = await fetch(base + "/deliverables/" + created.id).then(json);
assert.equal(got.state, "unlocked");
assert.equal(JSON.stringify(got).includes("SECRET COMPLET"), false);
assert.equal((await fetch(base + "/deliverables/" + created.id + "/download")).status, 200);
await app.close();
console.log("✓ NestJS : module réel, création → 429 → 402 → paiement → webhook → déblocage");
`,
);
run("node", ["nest.mjs"]);

/* ------------------------------------------------------------ Express */
write(
  "express.mjs",
  `
import assert from "node:assert/strict";
import express from "express";
import { PreviewPay } from "@previewpay/core";
import { MemoryStorage } from "@previewpay/storage-memory";
import { MockPaymentProvider } from "@previewpay/provider-mock";
import { createPreviewPayRouter } from "@previewpay/express";

const provider = new MockPaymentProvider({ secret: "s" });
const previewPay = new PreviewPay({
  storage: new MemoryStorage(),
  provider,
  pricing: { cv: 200 },
  preview: { makePreview: async (c) => ({ text: String(c).slice(0, 5) }) },
  download: { secret: "dl", baseUrl: "http://localhost" },
});
const app = express();
app.use(createPreviewPayRouter({ previewPay, internalApiKey: "k", serveContent: (d, _q, res) => res.send(d.content) }));
app.use(express.json());
const server = app.listen(0);
await new Promise((r) => server.once("listening", r));
const base = "http://127.0.0.1:" + server.address().port;
const post = (path, body, headers = {}) =>
  fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

const created = await post("/deliverables", { type: "cv", content: "SECRET COMPLET" }, { "x-internal-key": "k" }).then((r) => r.json());
assert.equal(created.state, "previewed");
assert.equal((await fetch(base + "/deliverables/" + created.id + "/download")).status, 402);
await post("/deliverables/" + created.id + "/pay", { phone: "+22990000000", operator: "mtn_benin" });
provider.setStatus("mock_pay_1", "approved");
const hook = provider.buildWebhook("mock_pay_1");
assert.equal((await post("/webhooks/fedapay", hook.rawBody.toString(), hook.headers)).status, 200);
const link = await fetch(base + "/deliverables/" + created.id + "/download").then((r) => r.json());
const content = await fetch(base + new URL(link.url).pathname + new URL(link.url).search).then((r) => r.text());
assert.equal(content, "SECRET COMPLET");
server.close();
console.log("✓ Express : routeur réel, 402 → paiement → webhook → contenu servi par jeton");
`,
);
run("node", ["express.mjs"]);

/* -------------------------------------------------------------- React */
write(
  "react.mjs",
  `
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { PreviewPaywall, formatPrice } from "@previewpay/react";
const html = renderToString(createElement(PreviewPaywall, { deliverableId: "d1", options: { fetchImpl: async () => new Response("{}") } }));
assert.ok(html.length > 0);
assert.equal(formatPrice(1200), "1 200 F CFA");
console.log("✓ React : rendu serveur du paywall");
`,
);
run("node", ["react.mjs"]);

/* ------------------------------------------------------------- Prisma */
run("npx", ["prisma", "generate", "--schema", "node_modules/@previewpay/storage-prisma/prisma/schema.prisma"], {
  stdio: "pipe",
});
write(
  "prisma.mjs",
  `
import assert from "node:assert/strict";
import { createPrismaStorage, PrismaStorage } from "@previewpay/storage-prisma";
const storage = createPrismaStorage();
assert.ok(storage instanceof PrismaStorage);
assert.equal(typeof storage.countDeliverablesByOwner, "function");
console.log("✓ Prisma : client généré depuis le schéma publié, adaptateur instancié");
`,
);
run("node", ["prisma.mjs"]);

/* --------------------------------------------------------- TypeScript */
write(
  "types.ts",
  `
import { PreviewPay, type Storage, type PublicDeliverable, PreviewLimitError } from "@previewpay/core";
import { MemoryStorage } from "@previewpay/storage-memory";
import { MockPaymentProvider } from "@previewpay/provider-mock";
import { FedaPayProvider, type FedaPayOptions } from "@previewpay/provider-fedapay";
import { createPrismaStorage } from "@previewpay/storage-prisma";
import { PreviewPayModule, type PreviewPayModuleOptions } from "@previewpay/nestjs";
import { createPreviewPayRouter, type PreviewPayRouterOptions } from "@previewpay/express";
import type { Router } from "express";
import { usePreviewPay, PreviewPaywall, type PreviewPaywallProps } from "@previewpay/react";
import { describeStorageContract } from "@previewpay/testing";

const storage: Storage = new MemoryStorage();
const prismaStorage: Storage = createPrismaStorage();
const opts: FedaPayOptions = { secretKey: "sk", webhookSecret: "wh" };
const fedapay = new FedaPayProvider(opts);
const pp = new PreviewPay({
  storage,
  provider: new MockPaymentProvider(),
  pricing: { cv: 200 },
  preview: { makePreview: async () => ({}) },
  download: { secret: "s", baseUrl: "http://x" },
  limits: { previewsPerOwnerPerDay: 3 },
});
const p: Promise<PublicDeliverable> = pp.create({ type: "cv", content: "x", ownerId: "u" });
const moduleOptions: PreviewPayModuleOptions = { storage, provider: fedapay, pricing: { cv: 1 }, preview: { makePreview: async () => ({}) } };
const props: PreviewPaywallProps = { deliverableId: "d" };
const routerOptions: PreviewPayRouterOptions = { previewPay: pp, rateLimit: false };
const router: Router = createPreviewPayRouter(routerOptions);
void [p, prismaStorage, moduleOptions, props, router, PreviewPayModule, usePreviewPay, PreviewPaywall, describeStorageContract, PreviewLimitError];
`,
);
for (const resolution of ["nodenext", "bundler"]) {
  write(
    `tsconfig.${resolution}.json`,
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: "ES2022",
        module: resolution === "nodenext" ? "NodeNext" : "ESNext",
        moduleResolution: resolution,
        jsx: "react-jsx",
        skipLibCheck: false,
        types: ["node"],
        lib: ["ES2022", "DOM"],
      },
      files: ["types.ts"],
    }),
  );
  run("npx", ["tsc", "-p", `tsconfig.${resolution}.json`]);
  console.log(`✓ TypeScript : types résolus (moduleResolution ${resolution})`);
}

/* ------------------------------------------------------------- Vitest */
write(
  "contract.test.mjs",
  `
import { describeStorageContract } from "@previewpay/testing";
import { MemoryStorage } from "@previewpay/storage-memory";
describeStorageContract({ create: () => new MemoryStorage() });
`,
);
run("npx", ["vitest", "run", "--reporter=dot", "contract.test.mjs"]);
console.log("✓ Vitest : suite de contrat Storage exécutée depuis le paquet publié");

console.log(`\n✓ Installation vierge validée (${dir})`);
