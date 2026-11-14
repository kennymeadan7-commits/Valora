import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  PayloadTooLargeException,
  Post,
  UnprocessableEntityException,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { PaymentStatus, PreviewPay, PublicDeliverable } from "@previewpay/core";
import { PREVIEWPAY_ENGINE } from "@previewpay/nestjs";
import { MockPaymentProvider } from "@previewpay/provider-mock";
import {
  CvValidationError,
  PdfExtractionError,
  extractCvFromLines,
  extractPdfLines,
  normalizeCvInput,
  type CvContent,
  type ExtractionReport,
} from "./cv/index.js";
import { config } from "./instance.js";

/** Taille maximale d'un CV importé (5 Mo). */
export const MAX_PDF_BYTES = 5 * 1024 * 1024;

interface UploadedPdf {
  buffer: Buffer;
  size: number;
  mimetype: string;
  originalname: string;
}

export interface ImportResponse extends ExtractionReport {
  pages: number;
}

const STATUTS: readonly PaymentStatus[] = [
  "pending",
  "approved",
  "declined",
  "canceled",
  "expired",
];

/**
 * Endpoint de démonstration : c'est le « serveur de l'agent ».
 * Il génère le livrable et le confie au SDK, qui renvoie un aperçu.
 */
@Controller("demo")
export class DemoController {
  constructor(
    @Inject(PREVIEWPAY_ENGINE) private readonly previewPay: PreviewPay,
  ) {}

  /**
   * Génère le CV (le « livrable IA ») et le confie au SDK. Le contenu stocké
   * est structuré (`cv/v1`) : le HTML final et l'aperçu en dérivent, côté
   * serveur uniquement.
   */
  @Post("cv")
  @HttpCode(201)
  async createCv(@Body() body: unknown): Promise<PublicDeliverable> {
    let content: CvContent;
    try {
      content = { format: "cv/v1", data: normalizeCvInput(body) };
    } catch (cause) {
      if (cause instanceof CvValidationError) {
        throw new BadRequestException(cause.message);
      }
      throw cause;
    }
    return this.previewPay.create({ type: "cv", content });
  }

  /**
   * Import d'un CV existant (PDF, champ multipart `file`). Le texte est
   * extrait sur le serveur, sans service tiers, puis analysé pour pré-remplir
   * le formulaire. Rien n'est stocké : ce n'est pas encore un livrable.
   */
  @Post("cv/import")
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: MAX_PDF_BYTES, files: 1 } }),
  )
  async importCv(
    @UploadedFile() file: UploadedPdf | undefined,
  ): Promise<ImportResponse> {
    if (!file) {
      throw new BadRequestException("Aucun fichier reçu (champ « file » attendu)");
    }
    if (file.size > MAX_PDF_BYTES) {
      throw new PayloadTooLargeException("PDF trop volumineux (5 Mo maximum)");
    }

    let extracted: Awaited<ReturnType<typeof extractPdfLines>>;
    try {
      extracted = await extractPdfLines(file.buffer);
    } catch (cause) {
      if (cause instanceof PdfExtractionError) {
        throw new UnprocessableEntityException(cause.message);
      }
      throw cause;
    }
    if (extracted.lines.length === 0) {
      throw new UnprocessableEntityException(
        "Ce PDF ne contient pas de texte (document scanné ?) : remplissez le formulaire à la main.",
      );
    }

    return { ...extractCvFromLines(extracted.lines), pages: extracted.pages };
  }

  /**
   * Pilotage du fournisseur `mock` : indispensable pour dérouler la démo sans
   * opérateur Mobile Money. Le déblocage passe **toujours** par une
   * revérification du statut par appel API (`syncPayment`), comme avec FedaPay.
   */
  @Post("simulate/:id/:status")
  @HttpCode(200)
  async simulate(
    @Param("id") id: string,
    @Param("status") status: string,
    @Headers("x-internal-key") internalKey: string | undefined,
  ): Promise<PublicDeliverable> {
    if (config.internalApiKey && internalKey !== config.internalApiKey) {
      throw new ForbiddenException("x-internal-key invalide");
    }
    if (!STATUTS.includes(status as PaymentStatus)) {
      throw new BadRequestException(
        `Statut inconnu « ${status} » (attendu : ${STATUTS.join(", ")})`,
      );
    }
    if (!(config.provider instanceof MockPaymentProvider)) {
      throw new NotFoundException(
        "Simulation réservée au fournisseur mock (PAYMENT_PROVIDER=mock)",
      );
    }

    const deliverable = await config.storage.getDeliverable(id);
    if (!deliverable) throw new NotFoundException(`Livrable introuvable : ${id}`);
    if (!deliverable.paymentId) {
      throw new BadRequestException(
        "Aucun paiement en cours pour ce livrable : appelez /pay d'abord",
      );
    }

    config.provider.setStatus(deliverable.paymentId, status as PaymentStatus);
    return this.previewPay.syncPayment(id);
  }

  @Get("health")
  health(): { status: string; provider: string; storage: string } {
    return {
      status: "ok",
      provider: config.providerName,
      storage: config.storageKind,
    };
  }
}
