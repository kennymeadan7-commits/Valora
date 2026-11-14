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
  Post,
} from "@nestjs/common";
import type { PaymentStatus, PreviewPay, PublicDeliverable } from "@previewpay/core";
import { PREVIEWPAY_ENGINE } from "@previewpay/nestjs";
import { MockPaymentProvider } from "@previewpay/provider-mock";
import { renderCv, type CvInput } from "./cv.js";
import { config } from "./instance.js";

interface CreateCvBody extends Partial<CvInput> {
  fullName?: string;
  headline?: string;
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

  @Post("cv")
  @HttpCode(201)
  async createCv(@Body() body: CreateCvBody): Promise<PublicDeliverable> {
    if (!body?.fullName || !body?.headline) {
      throw new BadRequestException(
        "`fullName` et `headline` sont requis pour générer un CV",
      );
    }

    const content = renderCv({
      fullName: body.fullName,
      headline: body.headline,
      ...(body.email ? { email: body.email } : {}),
      ...(body.phone ? { phone: body.phone } : {}),
      ...(body.city ? { city: body.city } : {}),
      skills: body.skills ?? ["Gestion de projet", "Rédaction", "Communication"],
      experiences: body.experiences ?? [
        {
          role: "Chargé·e de projet",
          company: "Entreprise locale",
          period: "2022 — aujourd'hui",
          highlights: [
            "Pilotage de 4 projets clients en simultané",
            "Réduction de 20 % du délai de livraison",
          ],
        },
      ],
      education: body.education ?? [
        { diploma: "Licence", school: "Université nationale", year: "2021" },
      ],
    });

    return this.previewPay.create({ type: "cv", content });
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
  health(): { status: string; provider: string } {
    return { status: "ok", provider: config.providerName };
  }
}
