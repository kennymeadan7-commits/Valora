import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Query,
  Res,
} from "@nestjs/common";
import type { PreviewPay } from "@previewpay/core";
import { PREVIEWPAY_ENGINE } from "@previewpay/nestjs";
import { isCvContent, renderCvHtml, renderCvMarkdown } from "./cv/index.js";

type Format = "html" | "md";

/** Sous-ensemble de la réponse Express utilisé ici (évite une dépendance de types). */
interface HeaderSink {
  setHeader(name: string, value: string): unknown;
}

/**
 * CSP du CV servi en HTML : aucune ressource externe, aucun script hormis le
 * bouton « Imprimer » de la barre d'outils. Toutes les données sont échappées
 * au rendu ; la CSP est une seconde ceinture.
 */
const HTML_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self' http://localhost:5173 http://127.0.0.1:5173";

/**
 * Livraison du fichier final. C'est le seul endroit qui lit `content`, et
 * uniquement contre un jeton signé valide émis par `GET /deliverables/:id/download`.
 *
 * - `format=html` (défaut pour un CV) : document A4 prêt à imprimer en PDF ;
 * - `format=md` : version texte (Markdown) ;
 * - `toolbar=1` : ajoute la barre « Imprimer / PDF » (ouverture en onglet).
 */
@Controller("deliverables")
export class ContentController {
  constructor(
    @Inject(PREVIEWPAY_ENGINE) private readonly previewPay: PreviewPay,
  ) {}

  @Get(":id/content")
  async content(
    @Param("id") id: string,
    @Query("token") token: string | undefined,
    @Query("format") rawFormat: string | undefined,
    @Query("toolbar") toolbar: string | undefined,
    @Res({ passthrough: true }) res: HeaderSink,
  ): Promise<string> {
    if (!token) throw new ForbiddenException("Jeton de téléchargement requis");
    const format: Format | undefined =
      rawFormat === undefined || rawFormat === "" ? undefined : (rawFormat as Format);
    if (format !== undefined && format !== "html" && format !== "md") {
      throw new BadRequestException("format attendu : html | md");
    }

    const deliverable = await this.previewPay.verifyDownloadToken(token);
    if (deliverable.id !== id) {
      throw new ForbiddenException("Jeton valable pour un autre livrable");
    }

    res.setHeader("cache-control", "no-store");
    res.setHeader("x-content-type-options", "nosniff");

    const { content } = deliverable;
    if (isCvContent(content)) {
      const slug = content.data.fullName
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase();
      if (format === "md") {
        res.setHeader("content-type", "text/markdown; charset=utf-8");
        res.setHeader("content-disposition", `inline; filename="cv-${slug || "previewpay"}.md"`);
        return renderCvMarkdown(content.data);
      }
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.setHeader("content-security-policy", HTML_CSP);
      res.setHeader("content-disposition", `inline; filename="cv-${slug || "previewpay"}.html"`);
      return renderCvHtml(content.data, { mode: "full", toolbar: toolbar === "1" });
    }

    res.setHeader("content-type", "text/plain; charset=utf-8");
    return typeof content === "string" ? content : JSON.stringify(content, null, 2);
  }
}
