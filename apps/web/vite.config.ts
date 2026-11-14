import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Configuration Vite de la démo PreviewPay.
 *
 * L'application parle à `apps/api` (NestJS, port 3000) en **même origine** :
 * les préfixes `/deliverables`, `/demo` et `/webhooks` sont proxifiés, donc
 * `src/api.ts` n'utilise que des URLs relatives et il n'y a aucun CORS à
 * configurer côté navigateur.
 */
const apiOrigin = process.env["PREVIEWPAY_API_ORIGIN"] ?? "http://localhost:3000";

/** Préfixes servis par l'API de démo (voir `apps/api/src/*.controller.ts`). */
const proxy: Record<string, string> = {
  "/deliverables": apiOrigin,
  "/demo": apiOrigin,
  "/webhooks": apiOrigin,
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { ...proxy },
  },
  // `vite preview` sert le build : même proxys, pour tester la démo compilée.
  preview: {
    port: 4173,
    proxy: { ...proxy },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
