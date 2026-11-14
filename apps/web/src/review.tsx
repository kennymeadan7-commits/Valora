import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  DEFAULT_OPERATOR,
  MOBILE_MONEY_OPERATORS,
  formatPrice,
  previewText,
  usePreviewPay,
} from "@previewpay/react";
import {
  describeError,
  fetchDeliverableText,
  signedViewerUrl,
  simulatePayment,
  type SimulatedStatus,
} from "./api.js";
import { CvFrame, type CvFrameHandle } from "./cv-frame.js";
import { MomoSimulator } from "./momo-simulator.js";

/**
 * Écran « aperçu → paiement → téléchargement » d'un livrable.
 *
 * Toute la vérité vient du SDK : `usePreviewPay` lit l'état, l'aperçu et le
 * prix sur l'API (`@previewpay/nestjs`), lance `/pay` et `/reject`, et scrute
 * l'état pendant `payment_pending`. Ce composant n'ajoute que la mise en
 * scène et le simulateur Mobile Money.
 */

interface ReviewProps {
  deliverableId: string;
  fullName: string;
  defaultPhone: string;
  simulationAvailable: boolean;
  onEdit: () => void;
  onRestart: () => void;
  /** Un événement a pu changer les métriques (paiement, refus, déblocage). */
  onActivity: () => void;
  /** Étape du parcours à afficher dans le fil d'Ariane (1 aperçu → 3 téléchargement). */
  onStage: (stage: 1 | 2 | 3) => void;
}

const FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  declined: "Paiement annulé sur le téléphone. Rien n'a été débité : vous pouvez réessayer.",
  expired: "La demande de paiement a expiré sans réponse. Vous pouvez relancer le paiement.",
};

function previewHtml(preview: unknown): string | null {
  if (typeof preview === "object" && preview !== null) {
    const html = (preview as { html?: unknown }).html;
    if (typeof html === "string") return html;
  }
  return null;
}

function slug(value: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "cv"
  );
}

function saveBlob(content: string, type: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function Review(props: ReviewProps) {
  const { deliverableId, fullName, defaultPhone, simulationAvailable, onEdit, onRestart, onActivity, onStage } = props;
  const { status, preview, price, error, loading, pay, reject, refresh } = usePreviewPay(deliverableId, {
    pollIntervalMs: 1_500,
  });

  const [phone, setPhone] = useState(defaultPhone);
  const [operator, setOperator] = useState<string>(DEFAULT_OPERATOR);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "info" | "warn"; text: string } | null>(null);
  const [answering, setAnswering] = useState<SimulatedStatus | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  const lastAnswer = useRef<SimulatedStatus | null>(null);

  const [finalHtml, setFinalHtml] = useState<string | null>(null);
  const [finalError, setFinalError] = useState<string | null>(null);
  const [busyExport, setBusyExport] = useState<string | null>(null);
  const frameRef = useRef<CvFrameHandle | null>(null);

  // Toute transition observée peut changer les métriques.
  const previousStatus = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousStatus.current;
    previousStatus.current = status;
    if (status === null || previous === status) return;
    onActivity();
    if (previous === "payment_pending" && status === "previewed") {
      const answer = lastAnswer.current ?? "declined";
      setNotice({ kind: "warn", text: FAILURE_MESSAGES[answer] ?? FAILURE_MESSAGES["declined"]! });
    }
    if (status !== "payment_pending") setVerifying(false);
    onStage(status === "unlocked" ? 3 : status === "payment_pending" ? 2 : 1);
  }, [status, onActivity, onStage]);

  const loadFinal = useCallback(async () => {
    setFinalError(null);
    try {
      setFinalHtml(await fetchDeliverableText(deliverableId, "html"));
    } catch (cause) {
      setFinalError(describeError(cause));
    }
  }, [deliverableId]);

  useEffect(() => {
    if (status === "unlocked" && finalHtml === null) void loadFinal();
  }, [status, finalHtml, loadFinal]);

  async function handlePay(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 8) {
      setPhoneError("Numéro Mobile Money invalide (8 chiffres au moins).");
      return;
    }
    setPhoneError(null);
    setNotice(null);
    setSimError(null);
    lastAnswer.current = null;
    await pay(phone.trim(), operator);
  }

  async function handleAnswer(answer: SimulatedStatus): Promise<void> {
    setAnswering(answer);
    setSimError(null);
    lastAnswer.current = answer;
    try {
      if (answer === "approved") setVerifying(true);
      await simulatePayment(deliverableId, answer);
      await refresh();
    } catch (cause) {
      setVerifying(false);
      setSimError(describeError(cause));
    } finally {
      setAnswering(null);
    }
  }

  async function handleReject(): Promise<void> {
    setNotice(null);
    await reject("aperçu jugé insatisfaisant");
    onActivity();
    setNotice({
      kind: "info",
      text: "Avis enregistré, sans frais. Modifiez vos informations ou changez de modèle pour obtenir une nouvelle version.",
    });
  }

  async function exportAs(kind: "html" | "md" | "tab"): Promise<void> {
    setBusyExport(kind);
    setFinalError(null);
    try {
      if (kind === "tab") {
        // Fenêtre ouverte tout de suite (bloqueur de pop-up), URL signée ensuite.
        const win = window.open("about:blank", "_blank");
        const url = await signedViewerUrl(deliverableId);
        if (win) win.location.href = url;
        else window.location.assign(url);
      } else if (kind === "html") {
        const html = finalHtml ?? (await fetchDeliverableText(deliverableId, "html"));
        saveBlob(html, "text/html;charset=utf-8", `cv-${slug(fullName)}.html`);
      } else {
        const md = await fetchDeliverableText(deliverableId, "md");
        saveBlob(md, "text/markdown;charset=utf-8", `cv-${slug(fullName)}.md`);
      }
    } catch (cause) {
      setFinalError(describeError(cause));
    } finally {
      setBusyExport(null);
    }
  }

  const reference = `CV-${deliverableId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase()}`;
  const html = previewHtml(preview);

  /* ---------------------------------------------------------------- débloqué */
  if (status === "unlocked") {
    return (
      <div className="review">
        <div className="review-doc">
          {finalHtml ? (
            <CvFrame ref={frameRef} html={finalHtml} title={`CV de ${fullName}`} />
          ) : (
            <div className="doc-placeholder">
              <span className="spinner" aria-hidden="true" /> Récupération du CV complet via le lien signé…
            </div>
          )}
        </div>
        <aside className="panel panel-success">
          <p className="panel-kicker">Paiement confirmé</p>
          <h2>Votre CV est débloqué 🎉</h2>
          <p className="muted">
            Paiement de <strong>{formatPrice(price)}</strong> vérifié par le serveur. Le document complet,
            sans filigrane, est à vous.
          </p>
          <div className="stack">
            <button
              type="button"
              className="button"
              disabled={!finalHtml}
              onClick={() => {
                if (!frameRef.current?.print()) void exportAs("tab");
              }}
            >
              Télécharger en PDF
            </button>
            <p className="hint">Dans la fenêtre d'impression, choisissez « Enregistrer au format PDF ».</p>
            <button type="button" className="button button-ghost" disabled={busyExport !== null} onClick={() => void exportAs("tab")}>
              {busyExport === "tab" ? "Ouverture…" : "Ouvrir dans un nouvel onglet"}
            </button>
            <div className="row">
              <button type="button" className="button button-ghost button-sm" disabled={busyExport !== null} onClick={() => void exportAs("html")}>
                {busyExport === "html" ? "…" : "Fichier .html"}
              </button>
              <button type="button" className="button button-ghost button-sm" disabled={busyExport !== null} onClick={() => void exportAs("md")}>
                {busyExport === "md" ? "…" : "Texte .md"}
              </button>
            </div>
          </div>
          {finalError ? (
            <p className="alert" role="alert">
              {finalError}{" "}
              <button type="button" className="link-button" onClick={() => void loadFinal()}>
                Réessayer
              </button>
            </p>
          ) : null}
          <p className="hint">Chaque téléchargement utilise un lien signé valable 5 minutes.</p>
          <hr />
          <button type="button" className="link-button" onClick={onRestart}>
            Créer un autre CV
          </button>
        </aside>
      </div>
    );
  }

  /* ------------------------------------------------- aperçu / paiement / clos */
  return (
    <div className="review">
      <div className="review-doc">
        {html ? (
          <CvFrame html={html} title={`Aperçu du CV de ${fullName}`} />
        ) : status === null ? (
          <div className="doc-placeholder">
            <span className="spinner" aria-hidden="true" /> Chargement de l'aperçu…
          </div>
        ) : (
          <pre className="doc-text">{previewText(preview) || "Aperçu indisponible."}</pre>
        )}
        <p className="doc-caption">
          🔒 Aperçu produit par le serveur : les détails sont masqués <em>avant</em> d'arriver dans votre
          navigateur. Le CV complet est livré après paiement.
        </p>
      </div>

      <aside className="panel">
        {status === "rejected" ? (
          <>
            <p className="panel-kicker">Aperçu refusé</p>
            <h2>Aucun frais</h2>
            <p className="muted">Ce CV est clos. Vous pouvez repartir de vos informations pour une nouvelle version.</p>
            <button type="button" className="button" onClick={onEdit}>
              Modifier mes informations
            </button>
          </>
        ) : status === "payment_pending" ? (
          <>
            <p className="panel-kicker">Étape 3 · Paiement</p>
            <h2>Confirmez sur votre téléphone</h2>
            {simulationAvailable ? (
              <>
                <MomoSimulator
                  operator={operator}
                  phone={phone}
                  amount={price}
                  reference={reference}
                  busy={answering}
                  verifying={verifying}
                  onAnswer={(answer) => void handleAnswer(answer)}
                />
                <p className="hint">
                  FedaPay sandbox étant indisponible, ce téléphone simule l'opérateur. Le déblocage reste
                  revérifié côté serveur (<code>getPaymentStatus</code>).
                </p>
              </>
            ) : (
              <p className="muted">
                <span className="spinner" aria-hidden="true" /> En attente de la confirmation de l'opérateur…
              </p>
            )}
            {simError ? <p className="alert" role="alert">{simError}</p> : null}
          </>
        ) : (
          <>
            <p className="panel-kicker">Étape 2 · Aperçu</p>
            <h2>Il vous plaît ?</h2>
            <p className="price-line">
              <span className="price">{status === null ? "…" : formatPrice(price)}</span>
              <span className="muted">paiement unique, pas d'abonnement</span>
            </p>
            <ul className="perks">
              <li>CV complet, sans filigrane</li>
              <li>PDF prêt à imprimer + versions .html et .md</li>
              <li>Vous ne payez que si l'aperçu vous convient</li>
            </ul>

            <form className="pay-form" onSubmit={(event) => void handlePay(event)}>
              <fieldset className="operators" disabled={loading}>
                <legend>Opérateur</legend>
                {MOBILE_MONEY_OPERATORS.map((op) => (
                  <label key={op.value} className={`operator ${operator === op.value ? "selected" : ""}`}>
                    <input
                      type="radio"
                      name="operator"
                      value={op.value}
                      checked={operator === op.value}
                      onChange={() => setOperator(op.value)}
                    />
                    <span className={`op-dot op-${op.value}`} aria-hidden="true" />
                    {op.label}
                  </label>
                ))}
              </fieldset>
              <label className="field">
                Numéro Mobile Money
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+229 97 00 00 00"
                  value={phone}
                  disabled={loading}
                  onChange={(event) => setPhone(event.target.value)}
                />
              </label>
              {phoneError ? <p className="alert" role="alert">{phoneError}</p> : null}
              <button className="button button-pay" type="submit" disabled={loading || status === null}>
                {loading ? "Envoi de la demande…" : `Payer ${status === null ? "" : formatPrice(price)}`}
              </button>
            </form>

            {notice ? (
              <p className={notice.kind === "warn" ? "alert" : "notice"} role="status">
                {notice.text}
              </p>
            ) : null}
            {error ? <p className="alert" role="alert">{error.message}</p> : null}

            <hr />
            <div className="row row-between">
              <button type="button" className="link-button" onClick={onEdit}>
                ← Modifier mes infos
              </button>
              <button type="button" className="link-button muted-link" disabled={loading} onClick={() => void handleReject()}>
                Ce CV ne me convient pas
              </button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
