import { describe, expect, it } from "vitest";
import type { Deliverable, JournalEntry, State } from "@previewpay/core";
import { computeMetrics } from "@previewpay/core";

const T0 = new Date("2026-11-14T10:00:00.000Z");

/** Livrable de référence pour les métriques (prix en XOF entiers). */
function deliverable(overrides: Partial<Deliverable> = {}): Deliverable {
  return {
    id: "dlv_1",
    type: "cv",
    state: "previewed",
    price: 200,
    currency: "XOF",
    content: { full: "contenu complet" },
    preview: { text: "aperçu" },
    paymentId: null,
    paymentUrl: null,
    regenerations: 0,
    maxRegenerations: 1,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

/** Entrée de journal, horodatée relativement à T0 (millisecondes). */
function entry(
  from: State,
  to: State,
  offsetMs: number,
  deliverableId = "dlv_1",
  cause = "test",
): JournalEntry {
  return {
    deliverableId,
    from,
    to,
    at: new Date(T0.getTime() + offsetMs),
    cause,
  };
}

describe("computeMetrics", () => {
  it("renvoie des zéros et des `null` sans aucun livrable", () => {
    expect(computeMetrics({ deliverables: [], journal: [] })).toEqual({
      previewed: 0,
      paid: 0,
      rejected: 0,
      conversionRate: 0,
      rejectionRate: 0,
      paymentAttempts: 0,
      paymentFailures: 0,
      paymentFailureRate: 0,
      averageTimeToPaymentMs: null,
      averagePrice: null,
      marginPerDeliverable: null,
    });
  });

  it("compte un livrable payé comme prévisualisé, avec son délai et son prix", () => {
    const metrics = computeMetrics({
      deliverables: [deliverable({ state: "unlocked", price: 500 })],
      journal: [
        entry("draft", "previewed", 0),
        entry("previewed", "payment_pending", 60_000),
        entry("payment_pending", "unlocked", 75_000),
      ],
    });

    expect(metrics).toMatchObject({
      previewed: 1,
      paid: 1,
      rejected: 0,
      conversionRate: 1,
      rejectionRate: 0,
      paymentAttempts: 1,
      paymentFailures: 0,
      paymentFailureRate: 0,
      averageTimeToPaymentMs: 60_000,
      averagePrice: 500,
      marginPerDeliverable: null,
    });
  });

  it("compte un livrable refusé et son taux de refus", () => {
    const metrics = computeMetrics({
      deliverables: [deliverable({ state: "rejected", price: 200 })],
      journal: [entry("draft", "previewed", 0)],
    });

    expect(metrics).toMatchObject({
      previewed: 1,
      paid: 0,
      rejected: 1,
      conversionRate: 0,
      rejectionRate: 1,
      paymentAttempts: 0,
      paymentFailures: 0,
      paymentFailureRate: 0,
      averageTimeToPaymentMs: null,
      averagePrice: null,
      marginPerDeliverable: null,
    });
  });

  it("compte plusieurs tentatives et un échec de paiement", () => {
    const metrics = computeMetrics({
      deliverables: [deliverable({ state: "unlocked", price: 300 })],
      journal: [
        entry("draft", "previewed", 0),
        entry("previewed", "payment_pending", 10_000, "dlv_1", "pay"),
        entry("payment_pending", "previewed", 20_000, "dlv_1", "declined"),
        entry("previewed", "payment_pending", 40_000, "dlv_1", "pay"),
        entry("payment_pending", "unlocked", 50_000, "dlv_1", "approved"),
      ],
    });

    expect(metrics.paymentAttempts).toBe(2);
    expect(metrics.paymentFailures).toBe(1);
    expect(metrics.paymentFailureRate).toBe(0.5);
    // Le délai se mesure sur le premier paiement, pas sur la relance.
    expect(metrics.averageTimeToPaymentMs).toBe(10_000);
    expect(metrics.conversionRate).toBe(1);
  });

  it("moyenne le délai aperçu → premier paiement sur les livrables concernés", () => {
    const metrics = computeMetrics({
      deliverables: [
        deliverable({ id: "dlv_1", state: "unlocked" }),
        deliverable({ id: "dlv_2", state: "unlocked" }),
        deliverable({ id: "dlv_3", state: "previewed" }),
      ],
      journal: [
        // Volontairement dans le désordre : on retient la première date.
        entry("previewed", "payment_pending", 90_000, "dlv_2"),
        entry("previewed", "payment_pending", 30_000, "dlv_2"),
        entry("draft", "previewed", 0, "dlv_2"),
        entry("draft", "previewed", 0, "dlv_1"),
        entry("previewed", "payment_pending", 60_000, "dlv_1"),
        // `dlv_3` n'a jamais payé : ignoré dans la moyenne.
        entry("draft", "previewed", 0, "dlv_3"),
      ],
    });

    expect(metrics.averageTimeToPaymentMs).toBe(45_000);
  });

  it("calcule la marge avec un coût IA, et renvoie null sans coût", () => {
    const input = {
      deliverables: [
        deliverable({ id: "dlv_1", state: "unlocked", price: 200 }),
        deliverable({ id: "dlv_2", state: "unlocked", price: 500 }),
        deliverable({ id: "dlv_3", state: "rejected", price: 900 }),
      ],
      journal: [entry("draft", "previewed", 0)],
    };

    const avecCout = computeMetrics({ ...input, aiCostPerDeliverable: 100 });
    expect(avecCout.averagePrice).toBe(350);
    expect(avecCout.marginPerDeliverable).toBe(250);

    const sansCout = computeMetrics(input);
    expect(sansCout.averagePrice).toBe(350);
    expect(sansCout.marginPerDeliverable).toBeNull();
  });

  it("ignore les entrées de journal orphelines", () => {
    const metrics = computeMetrics({
      deliverables: [deliverable({ id: "dlv_1", state: "previewed" })],
      journal: [
        entry("draft", "previewed", 0, "dlv_1"),
        entry("draft", "previewed", 0, "dlv_fantome"),
        entry("previewed", "payment_pending", 1_000, "dlv_fantome"),
        entry("payment_pending", "previewed", 2_000, "dlv_fantome"),
      ],
    });

    expect(metrics.previewed).toBe(1);
    expect(metrics.paymentAttempts).toBe(0);
    expect(metrics.paymentFailures).toBe(0);
    expect(metrics.paymentFailureRate).toBe(0);
    expect(metrics.averageTimeToPaymentMs).toBeNull();
  });

  it("borne tous les taux dans [0, 1] même sur un journal incohérent", () => {
    const metrics = computeMetrics({
      // Payé sans trace de prévisualisation : le ratio dépasserait 1.
      deliverables: [deliverable({ state: "unlocked", price: 200 })],
      journal: [entry("payment_pending", "previewed", 0)],
    });

    for (const value of [
      metrics.conversionRate,
      metrics.rejectionRate,
      metrics.paymentFailureRate,
    ]) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(metrics.paymentAttempts).toBe(0);
    expect(metrics.paymentFailures).toBe(1);
    expect(metrics.paymentFailureRate).toBe(0);
  });
});
