/**
 * Build Vercel (Build Output API) : produit `.vercel/output/` que Vercel
 * déploie tel quel.
 *
 *   /            → page produit (apps/landing)
 *   /app/        → démo React (apps/web/dist)
 *   /deliverables, /demo, /webhooks → fonction Node qui embarque l'API Nest
 *
 *   node scripts/build-vercel.mjs        (lancé par `vercel.json`)
 */
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = `${root}.vercel/output`;
const run = (cmd) => execSync(cmd, { cwd: root, stdio: "inherit" });

rmSync(out, { recursive: true, force: true });

// 1. SDK puis front (la démo est montée sous /app/, voir vite.config.ts).
run("pnpm build");
run("pnpm --filter @previewpay/demo-web build");

// 2. Fichiers statiques.
mkdirSync(`${out}/static`, { recursive: true });
cpSync(`${root}apps/landing`, `${out}/static`, { recursive: true });
cpSync(`${root}apps/web/dist`, `${out}/static/app`, { recursive: true });

// 3. Fonction : un seul fichier ESM autonome, sans node_modules.
const fn = `${out}/functions/api.func`;
await build({
  entryPoints: [`${root}apps/api/src/vercel.ts`],
  outfile: `${fn}/index.mjs`,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  tsconfigRaw: JSON.stringify({
    compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false },
  }),
  alias: { "@prisma/client": `${root}scripts/vercel/prisma-stub.mjs` },
  // Paquets optionnels que Nest charge seulement s'ils sont présents.
  external: [
    "@nestjs/microservices",
    "@nestjs/websockets",
    "@nestjs/platform-socket.io",
    "class-validator",
    "class-transformer",
    "cache-manager",
  ],
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      "const require = __createRequire(import.meta.url);",
    ].join("\n"),
  },
  logLevel: "info",
});
writeFileSync(
  `${fn}/.vc-config.json`,
  JSON.stringify(
    {
      runtime: "nodejs22.x",
      handler: "index.mjs",
      launcherType: "Nodejs",
      shouldAddHelpers: false,
      supportsResponseStreaming: true,
      maxDuration: 30,
    },
    null,
    2,
  ),
);
writeFileSync(`${fn}/package.json`, JSON.stringify({ type: "module" }));

// 4. Routage.
writeFileSync(
  `${out}/config.json`,
  JSON.stringify(
    {
      version: 3,
      routes: [
        { handle: "filesystem" },
        { src: "^/(deliverables|demo|webhooks)(/.*)?$", dest: "/api" },
        { src: "^/app(/.*)?$", dest: "/app/index.html" },
      ],
    },
    null,
    2,
  ),
);

console.log(`Build Vercel prêt → ${out}`);
