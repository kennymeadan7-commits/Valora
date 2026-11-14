import { Module } from "@nestjs/common";
import { PreviewPayModule } from "@previewpay/nestjs";
import { config } from "./instance.js";
import { DemoController } from "./demo.controller.js";
import { ContentController } from "./content.controller.js";

export { config };

/**
 * App de démo : le module du SDK + deux contrôleurs maison (génération du CV,
 * livraison du fichier final).
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
  controllers: [DemoController, ContentController],
})
export class AppModule {}
