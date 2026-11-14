import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import type {
  DownloadLink,
  PreviewPay,
  PublicDeliverable,
} from "@previewpay/core";
import { PREVIEWPAY_ENGINE } from "./tokens.js";
import { parseCreateInput, parsePayInput, parseRejectInput } from "./http/parse.js";
import { InternalKeyGuard } from "./http/internal-key.guard.js";
import { RateLimitGuard } from "./http/rate-limit.guard.js";

/**
 * Les cinq endpoints HTTP du livrable. Chaque méthode délègue au cœur : aucune
 * règle de transition, de prix ou d'idempotence n'est écrite ici.
 */
@Controller()
export class DeliverablesController {
  constructor(
    @Inject(PREVIEWPAY_ENGINE) private readonly previewPay: PreviewPay,
  ) {}

  /**
   * Création côté serveur uniquement : la garde `x-internal-key` s'active dès
   * que `internalApiKey` est configurée dans `forRoot`.
   */
  @Post("deliverables")
  @UseGuards(InternalKeyGuard)
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: unknown): Promise<PublicDeliverable> {
    return this.previewPay.create(parseCreateInput(body));
  }

  /**
   * Vue client : statut, prix, aperçu. Le champ `content` n'existe pas dans
   * `PublicDeliverable` — le contenu complet ne sort jamais d'ici.
   */
  @Get("deliverables/:id")
  @Header("cache-control", "no-store")
  async findOne(@Param("id") id: string): Promise<PublicDeliverable> {
    return this.previewPay.get(id);
  }

  /** Passe le livrable à `payment_pending` et crée la demande de paiement. */
  @Post("deliverables/:id/pay")
  @UseGuards(RateLimitGuard)
  @HttpCode(HttpStatus.OK)
  async pay(
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<PublicDeliverable> {
    return this.previewPay.pay(id, parsePayInput(body));
  }

  /**
   * Refus de l'aperçu : régénération dans la limite autorisée, puis clôture
   * en `rejected` sans frais.
   */
  @Post("deliverables/:id/reject")
  @HttpCode(HttpStatus.OK)
  async reject(
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<{ regenerated: boolean; deliverable: PublicDeliverable }> {
    const { reason } = parseRejectInput(body);
    return this.previewPay.reject(id, reason);
  }

  /**
   * Lien signé à durée courte, produit par le cœur et **seulement** pour un
   * livrable `unlocked` (sinon 402 via `PaymentRequiredError`).
   */
  @Get("deliverables/:id/download")
  @Header("cache-control", "no-store")
  async download(
    @Param("id") id: string,
  ): Promise<{ url: string; expiresAt: string }> {
    const link: DownloadLink = await this.previewPay.download(id);
    return { url: link.url, expiresAt: link.expiresAt.toISOString() };
  }
}
