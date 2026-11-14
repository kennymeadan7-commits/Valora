import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { State } from "@previewpay/core";
import {
  DEFAULT_OPERATOR,
  MOBILE_MONEY_OPERATORS,
  usePreviewPay,
  type UsePreviewPayOptions,
} from "./use-preview-pay.js";

/**
 * Paywall prêt à l'emploi : aperçu, prix, paiement Mobile Money, états
 * d'attente / d'échec / de refus / de déblocage.
 *
 * Aucune dépendance UI : styles inline minimaux, `className` et `style`
 * laissés à l'intégrateur, aperçu personnalisable par `renderPreview`.
 */

export interface PreviewPaywallProps {
  deliverableId: string;
  /** Classe appliquée à la racine, pour surcharger les styles par CSS. */
  className?: string;
  /** Styles additionnels fusionnés avec les styles inline par défaut. */
  style?: CSSProperties;
  /** Rendu personnalisé de l'aperçu (reçoit l'objet `preview` brut). */
  renderPreview?: (preview: unknown) => ReactNode;
  /** Appelé une fois, au passage à `unlocked`. */
  onUnlocked?: (info: { downloadUrl: string | null }) => void;
  /** Options du hook (`baseUrl`, `fetchImpl`, `pollIntervalMs`, …). */
  options?: UsePreviewPayOptions;
}

const styles: Record<string, CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
    fontFamily:
      'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
    color: "#111827",
    maxWidth: "32rem",
  },
  title: {
    margin: 0,
    fontSize: "1rem",
    fontWeight: 600,
  },
  subtitle: {
    margin: 0,
    fontSize: "0.8125rem",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "#6b7280",
  },
  preview: {
    margin: 0,
    padding: "0.75rem",
    border: "1px dashed #d1d5db",
    borderRadius: "0.5rem",
    background: "#f9fafb",
    fontSize: "0.875rem",
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
    maxHeight: "18rem",
    overflow: "auto",
  },
  price: {
    margin: 0,
    fontSize: "1.5rem",
    fontWeight: 700,
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
    fontSize: "0.8125rem",
    fontWeight: 500,
  },
  input: {
    padding: "0.5rem 0.625rem",
    fontSize: "0.9375rem",
    fontFamily: "inherit",
    border: "1px solid #d1d5db",
    borderRadius: "0.5rem",
    background: "#fff",
    color: "inherit",
  },
  primary: {
    padding: "0.625rem 1rem",
    fontSize: "0.9375rem",
    fontWeight: 600,
    fontFamily: "inherit",
    border: "none",
    borderRadius: "0.5rem",
    background: "#111827",
    color: "#fff",
    cursor: "pointer",
  },
  secondary: {
    padding: "0.5rem 1rem",
    fontSize: "0.875rem",
    fontFamily: "inherit",
    border: "1px solid #d1d5db",
    borderRadius: "0.5rem",
    background: "transparent",
    color: "#374151",
    cursor: "pointer",
  },
  muted: {
    margin: 0,
    fontSize: "0.875rem",
    color: "#6b7280",
  },
  error: {
    margin: 0,
    padding: "0.5rem 0.75rem",
    fontSize: "0.875rem",
    border: "1px solid #fecaca",
    borderRadius: "0.5rem",
    background: "#fef2f2",
    color: "#991b1b",
  },
  success: {
    margin: 0,
    padding: "0.5rem 0.75rem",
    fontSize: "0.875rem",
    border: "1px solid #bbf7d0",
    borderRadius: "0.5rem",
    background: "#f0fdf4",
    color: "#166534",
  },
  pending: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    margin: 0,
    padding: "0.75rem",
    border: "1px solid #e5e7eb",
    borderRadius: "0.5rem",
    background: "#f9fafb",
    fontSize: "0.875rem",
  },
  spinner: {
    display: "inline-block",
    width: "0.875rem",
    height: "0.875rem",
    border: "2px solid #9ca3af",
    borderTopColor: "transparent",
    borderRadius: "50%",
    animation: "previewpay-spin 0.8s linear infinite",
  },
  link: {
    display: "inline-block",
    padding: "0.625rem 1rem",
    fontSize: "0.9375rem",
    fontWeight: 600,
    borderRadius: "0.5rem",
    background: "#111827",
    color: "#fff",
    textDecoration: "none",
    textAlign: "center",
  },
  inlineLink: {
    color: "#1d4ed8",
    fontSize: "0.875rem",
  },
};

/** Formate un entier XOF : `200` → `200 F CFA`, `1200` → `1 200 F CFA`. */
export function formatPrice(amount: number): string {
  const integer = Number.isFinite(amount) ? Math.round(amount) : 0;
  const grouped = String(integer).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${grouped} F CFA`;
}

/** Extrait le texte d'un aperçu, quel que soit le format de la stratégie. */
export function previewText(preview: unknown): string {
  if (typeof preview === "string") return preview;
  if (typeof preview === "object" && preview !== null) {
    const text = (preview as { text?: unknown }).text;
    if (typeof text === "string") return text;
  }
  return "";
}

const KEYFRAMES = "@keyframes previewpay-spin{to{transform:rotate(360deg)}}";

export function PreviewPaywall(props: PreviewPaywallProps) {
  const {
    deliverableId,
    className,
    style,
    renderPreview,
    onUnlocked,
    options,
  } = props;

  const {
    status,
    preview,
    price,
    downloadUrl,
    paymentUrl,
    error,
    loading,
    pay,
    reject,
    refresh,
  } = usePreviewPay(deliverableId, options);

  const [phone, setPhone] = useState("");
  const [operator, setOperator] = useState<string>(DEFAULT_OPERATOR);
  /** Vrai quand un paiement en attente est revenu à `previewed` (échec/expiration). */
  const [paymentFailed, setPaymentFailed] = useState(false);

  const previousStatus = useRef<State | null>(null);
  const notified = useRef(false);
  const onUnlockedRef = useRef(onUnlocked);
  onUnlockedRef.current = onUnlocked;

  useEffect(() => {
    const previous = previousStatus.current;
    previousStatus.current = status;

    if (status === "payment_pending") setPaymentFailed(false);
    if (previous === "payment_pending" && status === "previewed") {
      setPaymentFailed(true);
    }
    if (status === "unlocked" && !notified.current) {
      notified.current = true;
      onUnlockedRef.current?.({ downloadUrl });
    }
  }, [status, downloadUrl]);

  const handlePay = useCallback(async (): Promise<void> => {
    setPaymentFailed(false);
    await pay(phone, operator);
  }, [pay, phone, operator]);

  const handleReject = useCallback(async (): Promise<void> => {
    await reject();
  }, [reject]);

  const handleRetry = useCallback(async (): Promise<void> => {
    setPaymentFailed(false);
    await refresh();
  }, [refresh]);

  const showRetry = (paymentFailed || error !== null) && status !== "unlocked";

  function renderPreviewBlock(): ReactNode {
    if (renderPreview) {
      return (
        <div data-testid="preview" style={styles.preview}>
          {renderPreview(preview)}
        </div>
      );
    }
    return (
      <p data-testid="preview" style={styles.preview}>
        {previewText(preview) || "Aperçu indisponible."}
      </p>
    );
  }

  function renderPayForm(): ReactNode {
    return (
      <>
        {renderPreviewBlock()}
        <p data-testid="price" style={styles.price}>
          {formatPrice(price)}
        </p>
        <label style={styles.field}>
          Numéro Mobile Money
          <input
            data-testid="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="97 00 00 00"
            value={phone}
            disabled={loading}
            onChange={(event) => setPhone(event.target.value)}
            style={styles.input}
          />
        </label>
        <label style={styles.field}>
          Opérateur
          <select
            data-testid="operator"
            value={operator}
            disabled={loading}
            onChange={(event) => setOperator(event.target.value)}
            style={styles.input}
          >
            {MOBILE_MONEY_OPERATORS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <button
          data-testid="pay-button"
          type="button"
          onClick={() => void handlePay()}
          disabled={loading || phone.trim() === ""}
          style={styles.primary}
        >
          {loading ? "Envoi du paiement…" : "Valider et payer"}
        </button>
        <button
          data-testid="reject-button"
          type="button"
          onClick={() => void handleReject()}
          disabled={loading}
          style={styles.secondary}
        >
          Ce n'est pas ce que je voulais
        </button>
      </>
    );
  }

  function renderBody(): ReactNode {
    if (status === null) {
      if (error) {
        return <p style={styles.muted}>Impossible de charger l'aperçu.</p>;
      }
      return <p style={styles.muted}>Chargement de l'aperçu…</p>;
    }

    switch (status) {
      case "unlocked":
        return (
          <>
            <p style={styles.success}>
              Paiement confirmé — votre livrable est débloqué.
            </p>
            {downloadUrl ? (
              <a
                data-testid="download-link"
                href={downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={styles.link}
              >
                Télécharger
              </a>
            ) : (
              <p style={styles.muted}>
                Le lien de téléchargement arrive dans un instant…
              </p>
            )}
          </>
        );

      case "payment_pending":
        return (
          <>
            <style>{KEYFRAMES}</style>
            <p style={styles.pending} role="status" aria-live="polite">
              <span style={styles.spinner} aria-hidden="true" />
              Paiement en attente de confirmation
              {phone.trim() !== ""
                ? ` — confirmez la demande sur le ${phone.trim()}.`
                : "."}
            </p>
            {paymentUrl ? (
              <a
                href={paymentUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={styles.inlineLink}
              >
                Ouvrir la page de paiement
              </a>
            ) : null}
          </>
        );

      case "rejected":
        return (
          <p style={styles.muted}>
            Ce livrable a été refusé. Aucun montant n'a été débité.
          </p>
        );

      case "previewed":
      case "draft":
        return renderPayForm();

      default:
        return null;
    }
  }

  return (
    <div
      data-testid="paywall"
      className={className}
      style={{ ...styles.root, ...style }}
    >
      {error ? (
        <p data-testid="error" role="alert" style={styles.error}>
          {error.message}
        </p>
      ) : null}

      {paymentFailed ? (
        <p style={styles.error}>
          Le paiement n'a pas abouti (refusé, annulé ou expiré). Vous pouvez
          réessayer sans frais.
        </p>
      ) : null}

      {renderBody()}

      {showRetry ? (
        <button
          data-testid="retry-button"
          type="button"
          onClick={() => void handleRetry()}
          disabled={loading}
          style={styles.secondary}
        >
          Réessayer
        </button>
      ) : null}
    </div>
  );
}
