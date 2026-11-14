import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { PreviewPaywall, formatPrice } from "@previewpay/react";
import {
  createCv,
  describeError,
  fetchDeliverable,
  fetchDeliverableText,
  fetchHealth,
  fetchMetrics,
  simulatePayment,
  type DeliverableView,
  type DemoHealth,
  type DemoMetrics,
  type SimulatedStatus,
} from "./api.js";

/**
 * Démo PreviewPay : « générer un CV → aperçu filigrané → payer 200 F CFA →
 * télécharger ».
 *
 * Le composant ne prend aucune décision métier : l'aperçu, le prix, les
 * transitions et la validité du lien de téléchargement viennent tous du
 * serveur. Son seul rôle est l'enchaînement d'écran et le pilotage du
 * fournisseur `mock` pour dérouler la démo hors réseau.
 */

interface CvDraft {
  fullName: string;
  headline: string;
  email: string;
  skills: string;
}

const INITIAL_DRAFT: CvDraft = {
  fullName: "",
  headline: "",
  email: "",
  skills: "Gestion de projet, Rédaction, Communication",
};

/** Libellés français des états du livrable (machine à cinq états du cœur). */
const STATE_LABELS: Readonly<Record<string, string>> = {
  draft: "brouillon",
  previewed: "aperçu prêt",
  payment_pending: "paiement en attente",
  unlocked: "débloqué",
  rejected: "refusé",
};

const SIMULATIONS: ReadonlyArray<{
  status: SimulatedStatus;
  label: string;
  hint: string;
}> = [
  {
    status: "approved",
    label: "Approuver",
    hint: "paiement accepté → revérification d'API → débloqué",
  },
  {
    status: "declined",
    label: "Refuser",
    hint: "paiement refusé → retour à l'aperçu, relançable",
  },
  {
    status: "expired",
    label: "Expirer",
    hint: "essai expiré → retour à l'aperçu, relançable",
  },
];

function stateLabel(state: string): string {
  return STATE_LABELS[state] ?? state;
}

/* --- formatage des métriques ---------------------------------------------- */

const PERCENT_FORMAT = new Intl.NumberFormat("fr-FR", {
  style: "percent",
  maximumFractionDigits: 1,
});

const SECONDS_FORMAT = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** `0.5` → « 50 % » ; `null` → « — » (aucune donnée, pas zéro). */
function formatPercent(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return PERCENT_FORMAT.format(value);
}

/** Millisecondes → « 1,4 s » ; `null` → « — ». */
function formatDelay(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
  return `${SECONDS_FORMAT.format(ms / 1000)} s`;
}

/** Entier XOF → « 200 F CFA » ; `null` → « — ». */
function formatAmount(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return formatPrice(value);
}

/**
 * Vrai pour un `POST /pay` ou `POST /reject` émis par le paywall du SDK.
 * L'action de paiement se décide *dans* le composant : l'app n'a pas d'autre
 * signal pour rafraîchir ses métriques sans attendre la scrutation d'état.
 */
function isPaywallAction(
  input: string | URL | Request,
  init: RequestInit | undefined,
): boolean {
  const method = init?.method?.toUpperCase();
  if (method !== "POST") return false;
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  return /\/pay(\?|$)|\/reject(\?|$)/.test(url);
}

/** Découpe la saisie « a, b, c » en compétences propres et dédupliquées. */
function parseSkills(raw: string): string[] {
  const seen = new Set<string>();
  const skills: string[] = [];
  for (const part of raw.split(",")) {
    const value = part.trim();
    if (value === "") continue;
    const key = value.toLocaleLowerCase("fr");
    if (seen.has(key)) continue;
    seen.add(key);
    skills.push(value);
  }
  return skills;
}

interface PreviewSummary {
  text: string;
  watermark: string;
  truncated: boolean;
  totalChars: number | null;
}

/** Lit l'aperçu renvoyé par la `PreviewStrategy` du serveur (jamais le contenu). */
function summarizePreview(preview: unknown): PreviewSummary {
  const record =
    typeof preview === "object" && preview !== null
      ? (preview as Record<string, unknown>)
      : {};

  const rawText =
    typeof preview === "string"
      ? preview
      : typeof record["text"] === "string"
        ? record["text"]
        : "";

  return {
    text: rawText,
    watermark:
      typeof record["watermark"] === "string"
        ? record["watermark"]
        : "APERÇU — PreviewPay",
    truncated: record["truncated"] === true,
    totalChars:
      typeof record["totalChars"] === "number" ? record["totalChars"] : null,
  };
}

/**
 * Rendu de l'aperçu serveur : texte tronqué + filigrane visuel.
 * Le contenu complet n'existe pas dans cet objet.
 */
function PreviewView({ preview }: { preview: unknown }) {
  const summary = summarizePreview(preview);

  return (
    <figure className="preview">
      <div className="preview-frame">
        <pre className="preview-text">
          {summary.text === "" ? "Aperçu indisponible." : summary.text}
        </pre>
        <span className="preview-watermark" aria-hidden="true">
          {summary.watermark}
        </span>
      </div>
      <figcaption className="preview-caption">
        {summary.watermark}
        {summary.truncated && summary.totalChars !== null
          ? ` · aperçu tronqué, ${summary.totalChars} caractères au total (le reste reste sur le serveur)`
          : " · aperçu produit côté serveur"}
      </figcaption>
    </figure>
  );
}

/**
 * Tableau des cinq métriques de validation du PRD.
 *
 * Ce composant ne calcule rien : les taux et les moyennes arrivent déjà
 * calculés par `computeMetrics` (côté serveur). Il se contente de formater,
 * et affiche « — » quand une valeur n'existe pas encore (marge sans coût IA).
 */
function MetricsTable({ metrics }: { metrics: DemoMetrics | null }) {
  const paid = metrics?.paid ?? 0;
  const previewed = metrics?.previewed ?? 0;
  const rejected = metrics?.rejected ?? 0;
  const attempts = metrics?.paymentAttempts ?? 0;
  const failures = metrics?.paymentFailures ?? 0;
  const aiCost = metrics?.aiCostPerDeliverable ?? null;

  return (
    <table className="metrics-table" data-testid="metrics">
      <thead>
        <tr>
          <th scope="col">Métrique</th>
          <th scope="col">Valeur</th>
          <th scope="col">Détail</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row">Taux de validation</th>
          <td className="metric-value" data-testid="metric-conversion">
            {formatPercent(metrics?.conversionRate)}
          </td>
          <td className="metric-hint">
            {paid} payé{paid > 1 ? "s" : ""} ÷ {previewed} prévisualisé
            {previewed > 1 ? "s" : ""}
          </td>
        </tr>
        <tr>
          <th scope="row">Taux de refus</th>
          <td className="metric-value" data-testid="metric-rejection">
            {formatPercent(metrics?.rejectionRate)}
          </td>
          <td className="metric-hint">
            {rejected} refusé{rejected > 1 ? "s" : ""} ÷ {previewed}{" "}
            prévisualisé{previewed > 1 ? "s" : ""}
          </td>
        </tr>
        <tr>
          <th scope="row">Marge par livrable</th>
          <td className="metric-value" data-testid="metric-margin">
            {formatAmount(metrics?.marginPerDeliverable)}
          </td>
          <td className="metric-hint">
            {aiCost === null
              ? "coût IA inconnu (DEMO_AI_COST_PER_DELIVERABLE absent)"
              : metrics === null || metrics.averagePrice === null
                ? `en attente d'un livrable payé (coût IA ${formatAmount(aiCost)})`
                : `prix moyen ${formatAmount(metrics.averagePrice)} − coût IA ${formatAmount(aiCost)}`}
          </td>
        </tr>
        <tr>
          <th scope="row">Délai aperçu → paiement</th>
          <td className="metric-value" data-testid="metric-delay">
            {formatDelay(metrics?.averageTimeToPaymentMs)}
          </td>
          <td className="metric-hint">
            temps moyen entre l'aperçu et le lancement du paiement
          </td>
        </tr>
        <tr>
          <th scope="row">Taux d'échec de paiement</th>
          <td className="metric-value" data-testid="metric-failure">
            {formatPercent(metrics?.paymentFailureRate)}
          </td>
          <td className="metric-hint">
            {failures} échec{failures > 1 ? "s" : ""} ÷ {attempts} paiement
            {attempts > 1 ? "s" : ""} lancé{attempts > 1 ? "s" : ""}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

export function App() {
  const [draft, setDraft] = useState<CvDraft>(INITIAL_DRAFT);
  const [deliverable, setDeliverable] = useState<DeliverableView | null>(null);
  const [generating, setGenerating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  /** Incrémenté pour remonter le paywall et lui faire relire l'état serveur. */
  const [revision, setRevision] = useState(0);
  const [unlocked, setUnlocked] = useState(false);

  const [file, setFile] = useState<{ href: string; name: string } | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const [simulating, setSimulating] = useState<SimulatedStatus | null>(null);
  const [demoError, setDemoError] = useState<string | null>(null);
  const [demoNotice, setDemoNotice] = useState<string | null>(null);

  const [health, setHealth] = useState<DemoHealth | null>(null);

  const [metrics, setMetrics] = useState<DemoMetrics | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [metricsRefreshing, setMetricsRefreshing] = useState(false);
  /** Jeton de requête : une réponse ancienne ne doit pas écraser la récente. */
  const metricsTicket = useRef(0);

  const deliverableId = deliverable?.id ?? null;
  const deliverableState = deliverable?.state ?? null;

  // Fournisseur actif : la simulation n'a de sens qu'avec `provider-mock`.
  useEffect(() => {
    let alive = true;
    fetchHealth()
      .then((result) => {
        if (alive) setHealth(result);
      })
      .catch(() => {
        if (alive) setHealth(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * Relit `GET /demo/metrics`. Aucun compteur n'est tenu dans le navigateur :
   * le cœur recalcule tout à partir des livrables et de leur journal.
   */
  const loadMetrics = useCallback(async (): Promise<void> => {
    const ticket = ++metricsTicket.current;
    setMetricsRefreshing(true);
    try {
      const result = await fetchMetrics();
      if (metricsTicket.current !== ticket) return;
      setMetrics(result);
      setMetricsError(null);
    } catch (cause) {
      if (metricsTicket.current !== ticket) return;
      setMetricsError(describeError(cause));
    } finally {
      if (metricsTicket.current === ticket) setMetricsRefreshing(false);
    }
  }, []);

  // Rafraîchissement au montage, puis après chaque action : génération ou
  // simulation (`revision`), et tout changement d'état observé côté serveur
  // (paiement lancé, refus, déblocage par webhook).
  useEffect(() => {
    void loadMetrics();
  }, [loadMetrics, revision, deliverable]);

  /**
   * `fetch` instrumenté du paywall : dès qu'un `POST /pay` ou `/reject` est
   * revenu, le panneau relit les métriques. Sans cela, il attendrait le
   * prochain rafraîchissement d'état (3 s) pour voir le paiement.
   */
  const paywallFetch = useCallback<typeof fetch>(
    (input, init) => {
      const pending = globalThis.fetch(input, init);
      if (isPaywallAction(input, init)) {
        void pending.then(
          () => loadMetrics(),
          () => undefined,
        );
      }
      return pending;
    },
    [loadMetrics],
  );

  // Libère l'URL Blob du fichier précédent (ou au démontage).
  useEffect(() => {
    if (!file) return undefined;
    const href = file.href;
    return () => {
      URL.revokeObjectURL(href);
    };
  }, [file]);

  const downloadTicket = useRef(0);

  /** Récupère le .txt via le lien signé court, puis le rend téléchargeable. */
  const loadFile = useCallback(async (id: string): Promise<void> => {
    const ticket = ++downloadTicket.current;
    setFileLoading(true);
    setFileError(null);
    try {
      const text = await fetchDeliverableText(id);
      if (downloadTicket.current !== ticket) return;
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      setFile({
        href: URL.createObjectURL(blob),
        name: `cv-${id.slice(0, 8)}.txt`,
      });
    } catch (cause) {
      if (downloadTicket.current !== ticket) return;
      setFileError(describeError(cause));
    } finally {
      if (downloadTicket.current === ticket) setFileLoading(false);
    }
  }, []);

  // Dès que le livrable est débloqué, le fichier final devient récupérable.
  useEffect(() => {
    if (deliverableId === null || !unlocked) return;
    if (file !== null || fileLoading) return;
    void loadFile(deliverableId);
  }, [deliverableId, unlocked, file, fileLoading, loadFile]);

  /**
   * Garde la synthèse (état, régénérations) alignée sur le serveur : le
   * paywall scrute de son côté, et un déblocage peut aussi venir d'un webhook
   * ou d'un refus suivi d'une régénération.
   */
  useEffect(() => {
    if (deliverableId === null) return undefined;
    if (deliverableState === null) return undefined;
    if (deliverableState === "unlocked" || deliverableState === "rejected") {
      return undefined;
    }

    let alive = true;
    const timer = setInterval(() => {
      fetchDeliverable(deliverableId)
        .then((updated) => {
          if (!alive) return;
          setDeliverable(updated);
          if (updated.state === "unlocked") setUnlocked(true);
        })
        .catch(() => {
          // Silencieux : on retentera au prochain intervalle.
        });
    }, 3_000);

    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [deliverableId, deliverableState]);

  const resetOutput = useCallback((): void => {
    downloadTicket.current += 1;
    setUnlocked(false);
    setFile(null);
    setFileLoading(false);
    setFileError(null);
    setDemoError(null);
    setDemoNotice(null);
  }, []);

  async function handleGenerate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const fullName = draft.fullName.trim();
    const headline = draft.headline.trim();
    const email = draft.email.trim();
    if (fullName === "" || headline === "") {
      setFormError("Le nom complet et le poste visé sont obligatoires.");
      return;
    }

    setGenerating(true);
    setFormError(null);
    resetOutput();

    try {
      const created = await createCv({
        fullName,
        headline,
        ...(email === "" ? {} : { email }),
        skills: parseSkills(draft.skills),
      });
      setDeliverable(created);
      setRevision((value) => value + 1);
    } catch (cause) {
      setFormError(describeError(cause));
    } finally {
      setGenerating(false);
    }
  }

  async function handleSimulate(status: SimulatedStatus): Promise<void> {
    if (!deliverable) return;

    setSimulating(status);
    setDemoError(null);
    setDemoNotice(null);

    try {
      // L'API revérifie le statut auprès du fournisseur : elle ne se contente
      // pas d'enregistrer un webhook.
      const updated = await simulatePayment(deliverable.id, status);
      setDeliverable(updated);
      setRevision((value) => value + 1);
      setUnlocked(updated.state === "unlocked");
      setDemoNotice(
        `Statut « ${status} » appliqué au fournisseur mock · état du livrable : ${stateLabel(updated.state)}.`,
      );
    } catch (cause) {
      setDemoError(describeError(cause));
    } finally {
      setSimulating(null);
    }
  }

  const provider = health?.provider ?? null;
  const simulationAvailable = provider === null || provider === "mock";
  const simulationClosed =
    deliverable === null ||
    deliverable.state === "unlocked" ||
    deliverable.state === "rejected";
  const simulateDisabled = simulating !== null || simulationClosed || !simulationAvailable;

  return (
    <div className="app">
      <header className="hero">
        <p className="eyebrow">PreviewPay · démonstration locale</p>
        <h1>Un CV généré, aperçu filigrané, payé 200 F CFA, débloqué.</h1>
        <p className="lede">
          Le contenu complet ne quitte jamais le serveur avant le paiement. Seul
          l'aperçu produit par la stratégie du serveur est envoyé au navigateur,
          puis un lien signé à durée courte débloque le fichier.
        </p>
        <p className="badges">
          <span
            className={
              provider === null
                ? "badge"
                : provider === "mock"
                  ? "badge badge-ok"
                  : "badge badge-warn"
            }
          >
            Fournisseur : {provider ?? "inconnu"}
          </span>
          <span className="badge">Paiement Mobile Money simulé</span>
          <span className="badge">Aucun secret côté client</span>
        </p>
      </header>

      <main className="layout">
        <section className="card" aria-labelledby="form-title">
          <h2 id="form-title">1. Générer le CV</h2>
          <p className="muted">
            Côté serveur, l'agent produit le texte puis confie le livrable au
            SDK : prix figé, aperçu calculé, état <code>previewed</code>.
          </p>

          <form className="form" onSubmit={(event) => void handleGenerate(event)}>
            <label className="field">
              Nom complet
              <input
                type="text"
                name="fullName"
                autoComplete="name"
                required
                placeholder="Awa Dossou"
                value={draft.fullName}
                disabled={generating}
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    fullName: event.target.value,
                  }))
                }
              />
            </label>

            <label className="field">
              Poste visé
              <input
                type="text"
                name="headline"
                autoComplete="organization-title"
                required
                placeholder="Chargée de projet"
                value={draft.headline}
                disabled={generating}
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    headline: event.target.value,
                  }))
                }
              />
            </label>

            <label className="field">
              Email <span className="optional">(facultatif)</span>
              <input
                type="email"
                name="email"
                autoComplete="email"
                placeholder="awa@example.com"
                value={draft.email}
                disabled={generating}
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    email: event.target.value,
                  }))
                }
              />
            </label>

            <label className="field">
              Compétences <span className="optional">(séparées par des virgules)</span>
              <input
                type="text"
                name="skills"
                placeholder="Gestion de projet, Rédaction, Communication"
                value={draft.skills}
                disabled={generating}
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    skills: event.target.value,
                  }))
                }
              />
            </label>

            {formError ? (
              <p className="alert" role="alert">
                {formError}
              </p>
            ) : null}

            <button className="button" type="submit" disabled={generating}>
              {generating ? "Génération en cours…" : "Générer mon CV"}
            </button>
          </form>
        </section>

        <section className="card" aria-labelledby="paywall-title">
          <h2 id="paywall-title">2. Aperçu et paiement</h2>

          {deliverable === null ? (
            <p className="muted">
              Aucun livrable pour l'instant : générez un CV pour voir l'aperçu
              filigrané et le prix.
            </p>
          ) : (
            <>
              <dl className="summary">
                <div>
                  <dt>Prix figé</dt>
                  <dd className="price">{formatPrice(deliverable.price)}</dd>
                </div>
                <div>
                  <dt>État</dt>
                  <dd>
                    <span className={`state state-${deliverable.state}`}>
                      {stateLabel(deliverable.state)}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Régénérations</dt>
                  <dd>
                    {deliverable.regenerations} / {deliverable.maxRegenerations}
                  </dd>
                </div>
              </dl>

              <PreviewPaywall
                key={`${deliverable.id}:${revision}`}
                deliverableId={deliverable.id}
                className="paywall"
                style={{ maxWidth: "100%" }}
                renderPreview={(preview) => <PreviewView preview={preview} />}
                onUnlocked={() => setUnlocked(true)}
                options={{ fetchImpl: paywallFetch }}
              />

              <div className="download">
                <h3>Fichier final</h3>
                {!unlocked ? (
                  <p className="muted">
                    Le <code>.txt</code> apparaît ici une fois le livrable
                    débloqué. Avant cela, l'API répond <code>402</code> et le
                    texte reste sur le serveur.
                  </p>
                ) : fileLoading ? (
                  <p className="muted" role="status" aria-live="polite">
                    Préparation du fichier à partir du lien signé…
                  </p>
                ) : file ? (
                  <>
                    <a
                      className="button button-link"
                      href={file.href}
                      download={file.name}
                    >
                      Télécharger {file.name}
                    </a>
                    <p className="muted small">
                      Lien signé, valable 5 minutes ; le jeton est vérifié à
                      chaque lecture. Le bouton du paywall pointe sur le même
                      endpoint signé, ce lien-ci produit le fichier{" "}
                      <code>.txt</code>.
                    </p>
                  </>
                ) : (
                  <p className="muted">Fichier indisponible pour le moment.</p>
                )}

                {unlocked ? (
                  <button
                    className="button button-ghost"
                    type="button"
                    disabled={fileLoading}
                    onClick={() => {
                      if (deliverableId !== null) void loadFile(deliverableId);
                    }}
                  >
                    Régénérer le lien
                  </button>
                ) : null}

                {fileError ? (
                  <p className="alert" role="alert">
                    {fileError}
                  </p>
                ) : null}
              </div>
            </>
          )}
        </section>
      </main>

      <section className="card demo" aria-labelledby="demo-title">
        <h2 id="demo-title">
          3. Mode démo — fournisseur <code>mock</code>
        </h2>
        <p className="muted">
          Aucun opérateur Mobile Money n'est contacté. Ces boutons règlent le
          statut de l'essai de paiement directement dans le fournisseur simulé.
          Le déblocage ne vient jamais du statut écrit : l'API revérifie le
          paiement par appel (<code>getPaymentStatus</code>) avant de passer à{" "}
          <code>unlocked</code>.
        </p>

        <ol className="steps">
          <li>
            <code>POST /deliverables/:id/pay</code> →{" "}
            <code>payment_pending</code>
          </li>
          <li>
            <code>POST /demo/simulate/:id/&#123;statut&#125;</code> → statut du
            fournisseur mock
          </li>
          <li>
            revérification d'API → <code>unlocked</code> ou retour à{" "}
            <code>previewed</code>
          </li>
        </ol>

        <div className="actions">
          {SIMULATIONS.map((simulation) => (
            <button
              key={simulation.status}
              className="button button-ghost"
              type="button"
              disabled={simulateDisabled}
              title={simulation.hint}
              onClick={() => void handleSimulate(simulation.status)}
            >
              {simulating === simulation.status
                ? "Application…"
                : simulation.label}
            </button>
          ))}
        </div>

        {deliverable === null ? (
          <p className="muted small">
            Générez d'abord un CV, puis lancez le paiement dans le paywall.
          </p>
        ) : simulationClosed ? (
          <p className="muted small">
            Livrable {stateLabel(deliverable.state)} : plus rien à simuler.
            Générez un nouveau CV pour rejouer le parcours.
          </p>
        ) : !simulationAvailable ? (
          <p className="alert" role="alert">
            Le fournisseur actif est « {provider} » : la simulation est réservée
            à <code>PAYMENT_PROVIDER=mock</code>.
          </p>
        ) : (
          <p className="muted small">
            Un <code>/pay</code> doit avoir été lancé dans le paywall avant de
            simuler.
          </p>
        )}

        {demoNotice ? (
          <p className="notice" role="status" aria-live="polite">
            {demoNotice}
          </p>
        ) : null}
        {demoError ? (
          <p className="alert" role="alert">
            {demoError}
          </p>
        ) : null}
      </section>

      <section className="card metrics" aria-labelledby="metrics-title">
        <div className="metrics-head">
          <h2 id="metrics-title">4. Métriques de validation</h2>
          <button
            className="button button-ghost"
            type="button"
            disabled={metricsRefreshing}
            onClick={() => void loadMetrics()}
          >
            {metricsRefreshing ? "Actualisation…" : "Rafraîchir"}
          </button>
        </div>
        <p className="muted">
          Calculées côté serveur par <code>computeMetrics</code> à partir des
          livrables et de leur journal, puis exposées par{" "}
          <code>GET /demo/metrics</code>. Le navigateur ne fait aucun calcul :
          il affiche des agrégats, jamais un contenu.
        </p>

        <MetricsTable metrics={metrics} />

        <p className="muted small">
          {metrics === null
            ? "Aucune donnée pour l'instant."
            : `${metrics.previewed} livrable${metrics.previewed > 1 ? "s" : ""} prévisualisé${metrics.previewed > 1 ? "s" : ""} · ${metrics.paymentAttempts} paiement${metrics.paymentAttempts > 1 ? "s" : ""} lancé${metrics.paymentAttempts > 1 ? "s" : ""} · calculé à ${new Date(metrics.generatedAt).toLocaleTimeString("fr-FR")}`}
        </p>

        {metricsError ? (
          <p className="alert" role="alert">
            {metricsError}
          </p>
        ) : null}
      </section>

      <footer className="footer">
        <p>
          Démonstration locale — aucun montant réel n'est débité. Le contenu
          complet n'apparaît jamais dans une réponse d'API publique.
        </p>
      </footer>
    </div>
  );
}
