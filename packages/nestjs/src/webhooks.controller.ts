import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  InternalServerErrorException,
  Post,
  Req,
} from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import type { PreviewPay, WebhookOutcome } from "@previewpay/core";
import { PREVIEWPAY_ENGINE } from "./tokens.js";
import { normalizeHeaders } from "./http/headers.js";

/** Corps brut attaché à la requête par Nest quand `rawBody: true`. */
type WebhookRequest = RawBodyRequest<Record<string, unknown>>;

/**
 * Réception des notifications de paiement.
 *
 * La signature est vérifiée par le `PaymentProvider` du cœur **sur le corps
 * brut** : l'application hôte doit donc démarrer avec
 * `NestFactory.create(AppModule, { rawBody: true })`. Un corps re-sérialisé
 * (JSON re-stringifié) invaliderait la signature.
 *
 * Réponse 200 même pour un doublon : FedaPay réessaie tant qu'il n'a pas de
 * 2xx.
 */
@Controller("webhooks")
export class WebhooksController {
  constructor(
    @Inject(PREVIEWPAY_ENGINE) private readonly previewPay: PreviewPay,
  ) {}

  @Post("fedapay")
  @HttpCode(HttpStatus.OK)
  async fedapay(
    @Req() request: WebhookRequest,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ): Promise<WebhookOutcome> {
    const rawBody = request.rawBody;
    if (!rawBody) {
      throw new InternalServerErrorException(
        "Corps brut indisponible : créez l'application avec NestFactory.create(AppModule, { rawBody: true }) pour vérifier la signature du webhook",
      );
    }
    return this.previewPay.handleWebhook(rawBody, normalizeHeaders(headers));
  }
}
