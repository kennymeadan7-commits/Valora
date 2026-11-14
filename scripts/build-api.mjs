/**
 * Build de l'API de démo avec esbuild : un seul fichier ESM exécutable par
 * Node. Nécessaire parce que les paquets du monorepo exposent leur source
 * TypeScript (`main: ./src/index.ts`), que Node ne sait pas exécuter tel quel.
 *
 *   pnpm --filter @previewpay/demo-api build
 *   node apps/api/dist/server.mjs
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

await build({
  entryPoints: [`${root}apps/api/src/main.ts`],
  outfile: `${root}apps/api/dist/server.mjs`,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  // Les décorateurs Nest ont besoin du mode legacy ; sans métadonnées émises,
  // le module utilise des @Inject(...) explicites.
  tsconfigRaw: JSON.stringify({
    compilerOptions: {
      experimentalDecorators: true,
      useDefineForClassFields: false,
    },
  }),
  // Paquets natifs / optionnels laissés à Node (chargés dynamiquement par Nest).
  external: [
    "@prisma/client",
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
