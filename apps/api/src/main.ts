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

  // Déploiement « un seul processus » :
  //   /        → page produit (apps/landing)
  //   /app/    → démonstration React (apps/web/dist)
  // En développement, Vite sert le front et ces branches sont inactives.
  const landingDir = fileURLToPath(new URL("../../landing/", import.meta.url));
  const webDist = fileURLToPath(new URL("../../web/dist/", import.meta.url));
  const server = app.getHttpAdapter().getInstance();

  if (existsSync(webDist)) {
    app.useStaticAssets(webDist, { prefix: "/app/", index: false });
    const appIndex = fileURLToPath(new URL("../../web/dist/index.html", import.meta.url));
    // Repli SPA de la démo : /app/... renvoie son index.
    server.get(/^\/app(\/.*)?$/, (_req: unknown, res: { sendFile: (p: string) => unknown }) =>
      res.sendFile(appIndex),
    );
    console.log(`Démo servie depuis ${webDist} (montée sur /app/)`);
  }

  if (existsSync(landingDir)) {
    app.useStaticAssets(landingDir, { index: "index.html" });
    console.log(`Page produit servie depuis ${landingDir}`);
  }

  const port = Number(process.env["PORT"] ?? 3000);
  await app.listen(port, "0.0.0.0");
  console.log(`PreviewPay demo API → http://localhost:${port}`);
  console.log(`Paiement : ${process.env["PAYMENT_PROVIDER"] ?? "mock"}`);
}

await bootstrap();
