import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Inject,
  Param,
  Query,
} from "@nestjs/common";
import type { PreviewPay } from "@previewpay/core";
import { PREVIEWPAY_ENGINE } from "@previewpay/nestjs";

/**
 * Livraison du fichier final. C'est le seul endroit qui lit `content`, et
 * uniquement contre un jeton signé valide émis par `GET /deliverables/:id/download`.
 */
@Controller("deliverables")
export class ContentController {
  constructor(
    @Inject(PREVIEWPAY_ENGINE) private readonly previewPay: PreviewPay,
  ) {}

  @Get(":id/content")
  @Header("content-type", "text/plain; charset=utf-8")
  @Header("cache-control", "no-store")
  async content(
    @Param("id") id: string,
    @Query("token") token: string | undefined,
  ): Promise<string> {
    if (!token) throw new ForbiddenException("Jeton de téléchargement requis");

    const deliverable = await this.previewPay.verifyDownloadToken(token);
    if (deliverable.id !== id) {
      throw new ForbiddenException("Jeton valable pour un autre livrable");
    }
    return typeof deliverable.content === "string"
      ? deliverable.content
      : JSON.stringify(deliverable.content, null, 2);
  }
}
