import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

/**
 * `rawBody: true` est indispensable : la signature FedaPay se vérifie sur le
 * corps brut, pas sur le JSON re-sérialisé.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableCors({
    origin: (process.env["WEB_ORIGIN"] ?? "http://localhost:5173").split(","),
  });

  const port = Number(process.env["PORT"] ?? 3000);
  await app.listen(port);
  console.log(`PreviewPay demo API → http://localhost:${port}`);
  console.log(`Paiement : ${process.env["PAYMENT_PROVIDER"] ?? "mock"}`);
}

await bootstrap();
