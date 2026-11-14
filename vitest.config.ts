import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@previewpay/core": pkg("core"),
      "@previewpay/storage-memory": pkg("storage-memory"),
      "@previewpay/provider-mock": pkg("provider-mock"),
      "@previewpay/testing": pkg("testing"),
      "@previewpay/provider-fedapay": pkg("provider-fedapay"),
      "@previewpay/nestjs": pkg("nestjs"),
      "@previewpay/react": pkg("react"),
    },
  },
  test: {
    // Les tests PostgreSQL (`storage-prisma`, `apps/api`) partagent la même
    // base et la vident entre deux cas : les exécuter en parallèle les rend
    // instables. Sérialiser les fichiers est le prix de cette garantie.
    fileParallelism: false,
    include: [
      "packages/*/test/**/*.test.{ts,tsx}",
      "apps/api/test/**/*.test.ts",
    ],
    environment: "node",
    globals: false,
  },
});
