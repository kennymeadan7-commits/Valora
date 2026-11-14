import { Module } from "@nestjs/common";
import { PreviewPayModule } from "@previewpay/nestjs";
import { config } from "./instance.js";
import { DemoController } from "./demo.controller.js";
import { ContentController } from "./content.controller.js";
import { MetricsController } from "./metrics.controller.js";

export { config };

/**
 * App de démo : le module du SDK + trois contrôleurs maison (génération du
 * CV, livraison du fichier final, métriques de validation).
 */
@Module({
  imports: [
    PreviewPayModule.forRoot({
      storage: config.storage,
      provider: config.provider,
      pricing: config.pricing,
      preview: config.preview,
      download: {
        secret: config.downloadSecret,
        baseUrl: config.downloadBaseUrl,
        ttlSeconds: 300,
      },
      maxRegenerations: config.maxRegenerations,
      ...(config.internalApiKey ? { internalApiKey: config.internalApiKey } : {}),
    }),
  ],
  controllers: [DemoController, ContentController, MetricsController],
})
export class AppModule {}
