import type { DynamicModule } from "@nestjs/common";
import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { PreviewPay } from "@previewpay/core";
import type { PreviewPayModuleOptions, ResolvedPreviewPayOptions } from "./options.js";
import { resolveOptions } from "./options.js";
import { PREVIEWPAY_ENGINE, PREVIEWPAY_OPTIONS } from "./tokens.js";
import { DeliverablesController } from "./deliverables.controller.js";
import { WebhooksController } from "./webhooks.controller.js";
import { PreviewPayExceptionFilter } from "./http/previewpay-exception.filter.js";

/**
 * Module NestJS de PreviewPay : six endpoints qui enveloppent le cœur.
 *
 * ```ts
 * import { PreviewPayModule } from "@previewpay/nestjs";
 *
 * @Module({
 *   imports: [
 *     PreviewPayModule.forRoot({
 *       provider: fedapay,           // ou provider-mock en local
 *       storage: new MemoryStorage(), // ou storage-prisma
 *       pricing: { cv: 200 },
 *       preview: myPreviewStrategy,
 *       download: { secret: process.env.PREVIEWPAY_DOWNLOAD_SECRET! },
 *       internalApiKey: process.env.PREVIEWPAY_INTERNAL_KEY,
 *     }),
 *   ],
 * })
 * export class AppModule {}
 *
 * // ⚠️ Indispensable pour la signature des webhooks (corps brut) :
 * NestFactory.create(AppModule, { rawBody: true });
 * ```
 *
 * Routes exposées :
 * - `POST   /deliverables`                (garde `x-internal-key` optionnelle)
 * - `GET    /deliverables/:id`
 * - `POST   /deliverables/:id/pay`        (limitation de débit)
 * - `POST   /deliverables/:id/reject`
 * - `GET    /deliverables/:id/download`   (402 tant que non `unlocked`)
 * - `POST   /webhooks/fedapay`            (signature vérifiée sur le corps brut)
 *
 * Le module n'ajoute **aucune** règle métier : transitions, prix, idempotence
 * et signature vivent dans `@previewpay/core`.
 */
@Module({})
export class PreviewPayModule {
  static forRoot(options: PreviewPayModuleOptions): DynamicModule {
    const resolved = resolveOptions(options);

    return {
      module: PreviewPayModule,
      controllers: [DeliverablesController, WebhooksController],
      providers: [
        { provide: PREVIEWPAY_OPTIONS, useValue: resolved },
        {
          provide: PREVIEWPAY_ENGINE,
          useFactory: (opts: ResolvedPreviewPayOptions) =>
            new PreviewPay(opts.core),
          inject: [PREVIEWPAY_OPTIONS],
        },
        // Alias pratique : `constructor(private pay: PreviewPay) {}` côté hôte.
        { provide: PreviewPay, useExisting: PREVIEWPAY_ENGINE },
        { provide: APP_FILTER, useClass: PreviewPayExceptionFilter },
      ],
      exports: [PREVIEWPAY_ENGINE, PreviewPay, PREVIEWPAY_OPTIONS],
    };
  }
}
