import type { State } from "./machine.js";
import type { Deliverable, JournalEntry } from "./types.js";

/**
 * Métriques de validation du PRD (taux de validation, taux de refus, marge,
 * délai aperçu → paiement, taux d'échec de paiement).
 *
 * Toutes les fonctions de ce module sont pures : aucun accès au stockage, au
 * réseau ou à l'horloge. Le journal et les livrables sont fournis par
 * l'appelant, ce qui rend le calcul testable sans infrastructure.
 */
export interface MetricsInput {
  deliverables: Deliverable[];
  journal: JournalEntry[];
  /** Coût IA moyen par livrable, en XOF entiers. */
  aiCostPerDeliverable?: number;
}

export interface PreviewPayMetrics {
  /** Livrables ayant atteint l'état `previewed` au moins une fois. */
  previewed: number;
  /** Livrables actuellement `unlocked`. */
  paid: number;
  /** Livrables actuellement `rejected`. */
  rejected: number;
  /** `paid / previewed`, dans [0, 1], arrondi à 4 décimales. */
  conversionRate: number;
  /** `rejected / previewed`, dans [0, 1], arrondi à 4 décimales. */
  rejectionRate: number;
  /** Transitions `→ payment_pending` (paiements lancés). */
  paymentAttempts: number;
  /** Retours `payment_pending → previewed` par échec (declined/canceled/expired). */
  paymentFailures: number;
  /** `paymentFailures / paymentAttempts`, dans [0, 1], arrondi à 4 décimales. */
  paymentFailureRate: number;
  /** Aperçu → premier paiement, en millisecondes ; `null` si aucun couple. */
  averageTimeToPaymentMs: number | null;
  /** Prix moyen des livrables payés ; `null` si aucun livrable payé. */
  averagePrice: number | null;
  /** `averagePrice − aiCostPerDeliverable` ; `null` si l'un des deux manque. */
  marginPerDeliverable: number | null;
}

/** Ratio borné à [0, 1], arrondi à 4 décimales ; jamais `NaN`. */
function rate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  const ratio = numerator / denominator;
  const clamped = Math.min(1, Math.max(0, ratio));
  return Math.round(clamped * 10_000) / 10_000;
}

/** Horodatage valide, ou `null` si la date est illisible. */
function timeOf(entry: JournalEntry): number | null {
  const at: unknown = entry.at;
  if (!(at instanceof Date)) return null;
  const time = at.getTime();
  return Number.isFinite(time) ? time : null;
}

/** Première occurrence (chronologique) parmi les entrées retenues. */
function earliestTime(
  entries: readonly JournalEntry[],
  deliverableId: string,
  to: State,
): number | null {
  let earliest: number | null = null;
  for (const entry of entries) {
    if (entry.deliverableId !== deliverableId || entry.to !== to) continue;
    const time = timeOf(entry);
    if (time === null) continue;
    if (earliest === null || time < earliest) earliest = time;
  }
  return earliest;
}

/**
 * Calcule les métriques sans jamais lever : les entrées de journal orphelines
 * (livrable inconnu) ou datées de façon illisible sont ignorées.
 */
export function computeMetrics(input: MetricsInput): PreviewPayMetrics {
  const { deliverables, journal, aiCostPerDeliverable } = input;

  const known = new Set(deliverables.map((d) => d.id));
  const entries = journal.filter((entry) => known.has(entry.deliverableId));

  const previewedIds = new Set<string>();
  for (const entry of entries) {
    if (entry.to === "previewed") previewedIds.add(entry.deliverableId);
  }
  const previewed = previewedIds.size;
  const paidDeliverables = deliverables.filter((d) => d.state === "unlocked");
  const rejected = deliverables.filter((d) => d.state === "rejected").length;
  const paid = paidDeliverables.length;

  const paymentAttempts = entries.filter(
    (entry) => entry.to === "payment_pending",
  ).length;
  const paymentFailures = entries.filter(
    (entry) => entry.from === "payment_pending" && entry.to === "previewed",
  ).length;

  const deltas: number[] = [];
  for (const deliverable of deliverables) {
    const previewedAt = earliestTime(entries, deliverable.id, "previewed");
    const paidAt = earliestTime(entries, deliverable.id, "payment_pending");
    if (previewedAt === null || paidAt === null) continue;
    deltas.push(paidAt - previewedAt);
  }
  const averageTimeToPaymentMs =
    deltas.length === 0
      ? null
      : Math.round(deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length);

  const averagePrice =
    paidDeliverables.length === 0
      ? null
      : paidDeliverables.reduce((sum, d) => sum + d.price, 0) /
        paidDeliverables.length;

  const marginPerDeliverable =
    aiCostPerDeliverable === undefined || averagePrice === null
      ? null
      : averagePrice - aiCostPerDeliverable;

  return {
    previewed,
    paid,
    rejected,
    conversionRate: rate(paid, previewed),
    rejectionRate: rate(rejected, previewed),
    paymentAttempts,
    paymentFailures,
    paymentFailureRate: rate(paymentFailures, paymentAttempts),
    averageTimeToPaymentMs,
    averagePrice,
    marginPerDeliverable,
  };
}
