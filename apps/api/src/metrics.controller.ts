import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
} from "@nestjs/common";
import { computeMetrics } from "@previewpay/core";
import type {
  JournalEntry,
  PreviewPayMetrics,
  Storage,
} from "@previewpay/core";
import { config } from "./instance.js";

/**
 * Métriques de validation du PRD, telles que lues par le panneau « Métriques »
 * de la démo web.
 *
 * Le calcul lui-même vit dans le cœur (`computeMetrics`) : ce contrôleur ne
 * fait que rassembler les données (livrables + journal) et exposer le résultat.
 */
export interface DemoMetrics extends PreviewPayMetrics {
  /** Coût IA retenu pour la marge ; `null` si `DEMO_AI_COST_PER_DELIVERABLE` est absent. */
  aiCostPerDeliverable: number | null;
  /** Horodatage ISO du calcul. */
  generatedAt: string;
}

/**
 * Agrège les livrables et leur journal, puis délègue le calcul au cœur.
 *
 * Exporté pour être appelé hors HTTP (tests, scripts) sans dupliquer la règle :
 * la seule logique ici est la collecte, jamais le calcul d'un taux.
 */
export async function collectMetrics(
  storage: Storage,
  aiCostPerDeliverable: number | null,
  now: () => Date = () => new Date(),
): Promise<DemoMetrics> {
  const deliverables = await storage.listDeliverables();

  const journal: JournalEntry[] = [];
  for (const deliverable of deliverables) {
    journal.push(...(await storage.listJournal(deliverable.id)));
  }

  const metrics: PreviewPayMetrics = computeMetrics({
    deliverables,
    journal,
    // `undefined` (et non `0`) : sans coût connu, la marge doit rester `null`.
    ...(aiCostPerDeliverable === null ? {} : { aiCostPerDeliverable }),
  });

  return {
    ...metrics,
    aiCostPerDeliverable,
    generatedAt: now().toISOString(),
  };
}

/**
 * `GET /demo/metrics` — tableau de bord de la démonstration.
 *
 * Même règle d'accès que `POST /demo/simulate` : dès que
 * `PREVIEWPAY_INTERNAL_KEY` est définie, l'en-tête `x-internal-key` est exigé.
 * Aucune donnée de contenu n'est exposée, seulement des agrégats.
 */
@Controller("demo")
export class MetricsController {
  @Get("metrics")
  @Header("cache-control", "no-store")
  async metrics(
    @Headers("x-internal-key") internalKey: string | undefined,
  ): Promise<DemoMetrics> {
    if (config.internalApiKey && internalKey !== config.internalApiKey) {
      throw new ForbiddenException("x-internal-key invalide");
    }
    return collectMetrics(config.storage, config.aiCostPerDeliverable);
  }
}
