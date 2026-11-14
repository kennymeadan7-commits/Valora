import { useCallback, useEffect, useRef, useState } from "react";
import { formatPrice } from "@previewpay/react";
import {
  createCv,
  describeError,
  fetchHealth,
  fetchMetrics,
  type DemoHealth,
  type DemoMetrics,
} from "./api.js";
import { CvForm } from "./cv-form.js";
import { EMPTY_DRAFT, clearDraft, loadDraft, saveDraft, toPayload, type CvDraft } from "./draft.js";
import { MetricsPanel } from "./metrics.js";
import { Review } from "./review.js";

/**
 * Démo PreviewPay — « Valora CV » : importer ou saisir ses infos → aperçu
 * réel mais caviardé → paiement Mobile Money (simulé) → CV complet en PDF.
 *
 * Aucune décision métier ici : prix, aperçu, transitions et liens signés
 * viennent du serveur (moteur `@previewpay/core` derrière `@previewpay/nestjs`).
 */

/** Prix affiché avant création ; le prix réel est figé par le serveur. */
const CV_PRICE = 200;

const STEPS = ["Vos infos", "Aperçu", "Paiement", "Téléchargement"] as const;

interface Current {
  id: string;
  fullName: string;
  phone: string;
}

export function App() {
  const [draft, setDraft] = useState<CvDraft>(() => loadDraft());
  const [current, setCurrent] = useState<Current | null>(null);
  const [stage, setStage] = useState<0 | 1 | 2 | 3>(0);
  const [generating, setGenerating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [health, setHealth] = useState<DemoHealth | null>(null);

  const [metrics, setMetrics] = useState<DemoMetrics | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [metricsRefreshing, setMetricsRefreshing] = useState(false);
  const metricsTicket = useRef(0);

  useEffect(() => saveDraft(draft), [draft]);

  useEffect(() => {
    fetchHealth()
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  const loadMetrics = useCallback(async (): Promise<void> => {
    const ticket = ++metricsTicket.current;
    setMetricsRefreshing(true);
    try {
      const result = await fetchMetrics();
      if (metricsTicket.current !== ticket) return;
      setMetrics(result);
      setMetricsError(null);
    } catch (cause) {
      if (metricsTicket.current === ticket) setMetricsError(describeError(cause));
    } finally {
      if (metricsTicket.current === ticket) setMetricsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadMetrics();
  }, [loadMetrics]);

  async function generate(): Promise<void> {
    setGenerating(true);
    setFormError(null);
    try {
      const created = await createCv(toPayload(draft));
      setCurrent({ id: created.id, fullName: draft.fullName.trim(), phone: draft.phone.trim() });
      setStage(1);
      window.scrollTo({ top: 0, behavior: "smooth" });
      void loadMetrics();
    } catch (cause) {
      setFormError(describeError(cause));
    } finally {
      setGenerating(false);
    }
  }

  const backToForm = useCallback(() => {
    setCurrent(null);
    setStage(0);
  }, []);

  const restart = useCallback(() => {
    clearDraft();
    setDraft(EMPTY_DRAFT);
    setCurrent(null);
    setStage(0);
  }, []);

  const provider = health?.provider ?? null;
  const simulationAvailable = provider === null || provider === "mock";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">V</div>
          <div>
            <strong>Valora CV</strong>
            <span>propulsé par PreviewPay</span>
          </div>
        </div>
        <div className="topbar-meta">
          <span className={`pill ${provider === "mock" ? "pill-sim" : provider ? "pill-live" : ""}`}>
            {provider === "mock"
              ? "Mobile Money simulé"
              : provider
                ? `Paiement : ${provider}`
                : "API hors ligne ?"}
          </span>
          {health?.storage ? <span className="pill">stockage : {health.storage}</span> : null}
        </div>
      </header>

      {stage === 0 ? (
        <section className="hero">
          <h1>
            Un CV professionnel, <em>vu avant d'être payé.</em>
          </h1>
          <p>
            Importez votre ancien CV ou remplissez vos infos. Vous voyez le résultat mis en page, et vous ne payez{" "}
            <strong>{formatPrice(CV_PRICE)}</strong> en Mobile Money que s'il vous plaît.
          </p>
        </section>
      ) : null}

      <ol className="stepper" aria-label="Étapes">
        {STEPS.map((label, i) => (
          <li key={label} className={i < stage ? "done" : i === stage ? "active" : ""} aria-current={i === stage ? "step" : undefined}>
            <span className="step-dot">{i < stage ? "✓" : i + 1}</span>
            <span className="step-label">{label}</span>
          </li>
        ))}
      </ol>

      <main>
        {current === null ? (
          <CvForm
            draft={draft}
            onChange={setDraft}
            onSubmit={() => void generate()}
            submitting={generating}
            error={formError}
            price={formatPrice(CV_PRICE)}
          />
        ) : (
          <Review
            key={current.id}
            deliverableId={current.id}
            fullName={current.fullName}
            defaultPhone={current.phone}
            simulationAvailable={simulationAvailable}
            onEdit={backToForm}
            onRestart={restart}
            onActivity={() => void loadMetrics()}
            onStage={setStage}
          />
        )}
      </main>

      <MetricsPanel
        metrics={metrics}
        error={metricsError}
        refreshing={metricsRefreshing}
        onRefresh={() => void loadMetrics()}
      />

      <footer className="footer">
        Démonstration PreviewPay — aucun montant réel n'est débité. Le CV complet ne quitte le serveur qu'après
        paiement vérifié, via un lien signé de 5 minutes.
      </footer>
    </div>
  );
}
