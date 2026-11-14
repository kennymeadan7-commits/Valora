import { formatPrice } from "@previewpay/react";
import type { DemoMetrics } from "./api.js";

/**
 * Les cinq métriques de validation du PRD, calculées côté serveur par
 * `computeMetrics` (`GET /demo/metrics`). Ce composant ne calcule rien : il
 * formate et affiche « — » quand une valeur n'existe pas encore.
 */

const PERCENT = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 1 });
const SECONDS = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function percent(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? PERCENT.format(value) : "—";
}

function delay(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
  return ms >= 60_000 ? `${SECONDS.format(ms / 60_000)} min` : `${SECONDS.format(ms / 1000)} s`;
}

function amount(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? formatPrice(value) : "—";
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n > 1 ? "s" : ""}`;
}

interface MetricsPanelProps {
  metrics: DemoMetrics | null;
  error: string | null;
  refreshing: boolean;
  onRefresh: () => void;
}

export function MetricsPanel({ metrics, error, refreshing, onRefresh }: MetricsPanelProps) {
  const previewed = metrics?.previewed ?? 0;
  const aiCost = metrics?.aiCostPerDeliverable ?? null;

  const tiles = [
    {
      id: "metric-conversion",
      label: "Taux de validation",
      value: percent(metrics?.conversionRate),
      hint: `${plural(metrics?.paid ?? 0, "payé")} sur ${plural(previewed, "aperçu")}`,
    },
    {
      id: "metric-rejection",
      label: "Taux de refus",
      value: percent(metrics?.rejectionRate),
      hint: `${plural(metrics?.rejected ?? 0, "refusé")} sur ${plural(previewed, "aperçu")}`,
    },
    {
      id: "metric-margin",
      label: "Marge par livrable",
      value: amount(metrics?.marginPerDeliverable),
      hint:
        aiCost === null
          ? "coût IA non configuré"
          : metrics?.averagePrice == null
            ? `coût IA ${amount(aiCost)}, aucun paiement`
            : `prix moyen ${amount(metrics.averagePrice)} − IA ${amount(aiCost)}`,
    },
    {
      id: "metric-delay",
      label: "Délai aperçu → paiement",
      value: delay(metrics?.averageTimeToPaymentMs),
      hint: "temps moyen avant de lancer le paiement",
    },
    {
      id: "metric-failure",
      label: "Échecs de paiement",
      value: percent(metrics?.paymentFailureRate),
      hint: `${plural(metrics?.paymentFailures ?? 0, "échec")} sur ${plural(metrics?.paymentAttempts ?? 0, "essai")}`,
    },
  ];

  return (
    <details className="metrics">
      <summary>
        <span>Tableau de bord intégrateur</span>
        <span className="metrics-teaser">
          {metrics ? `${percent(metrics.conversionRate)} de validation · ${plural(previewed, "aperçu")}` : "métriques du PRD"}
        </span>
      </summary>
      <div className="metrics-body">
        <div className="metrics-grid" data-testid="metrics">
          {tiles.map((t) => (
            <div className="tile" key={t.id}>
              <span className="tile-label">{t.label}</span>
              <strong className="tile-value" data-testid={t.id}>
                {t.value}
              </strong>
              <span className="tile-hint">{t.hint}</span>
            </div>
          ))}
        </div>
        <div className="row row-between">
          <p className="muted small">
            Calculées côté serveur par <code>computeMetrics</code> (journal des transitions), exposées par{" "}
            <code>GET /demo/metrics</code>.
            {metrics ? ` Mis à jour à ${new Date(metrics.generatedAt).toLocaleTimeString("fr-FR")}.` : ""}
          </p>
          <button type="button" className="button button-ghost button-sm" disabled={refreshing} onClick={onRefresh}>
            {refreshing ? "…" : "Rafraîchir"}
          </button>
        </div>
        {error ? (
          <p className="alert" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </details>
  );
}
