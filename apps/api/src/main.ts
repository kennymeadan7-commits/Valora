import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module.js";

/**
 * `rawBody: true` est indispensable : la signature FedaPay se vérifie sur le
 * corps brut, pas sur le JSON re-sérialisé.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  app.enableCors({
    origin: (process.env["WEB_ORIGIN"] ?? "http://localhost:5173").split(","),
  });

  // Déploiement « un seul processus » : si le build du front est présent à côté
  // de l'API, il est servi en même origine (aucun CORS, aucune URL d'API à
  // configurer). En développement, Vite sert le front et cette branche est
  // inactive.
  const webDist = fileURLToPath(new URL("../../web/dist/", import.meta.url));
  if (existsSync(webDist)) {
    const index = fileURLToPath(new URL("../../web/dist/index.html", import.meta.url));
    // Assets statiques servis par Nest ; l'index est servi par le repli SPA.
    app.useStaticAssets(webDist, { index: false });

    const server = app.getHttpAdapter().getInstance();
    server.get(
      /^\/(?!deliverables|demo|webhooks|api\/).*/,
      (_req: unknown, res: { sendFile: (path: string) => unknown }) => res.sendFile(index),
    );
    console.log(`Front servi depuis ${webDist}`);
  }

  const port = Number(process.env["PORT"] ?? 3000);
  await app.listen(port, "0.0.0.0");
  console.log(`PreviewPay demo API → http://localhost:${port}`);
  console.log(`Paiement : ${process.env["PAYMENT_PROVIDER"] ?? "mock"}`);
}

await bootstrap();
