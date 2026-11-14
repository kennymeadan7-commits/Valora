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
    include: [
      "packages/*/test/**/*.test.{ts,tsx}",
      "apps/api/test/**/*.test.ts",
    ],
    environment: "node",
    globals: false,
  },
});
