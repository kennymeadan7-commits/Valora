import { useEffect, useState } from "react";
import { formatPrice } from "@previewpay/react";
import type { SimulatedStatus } from "./api.js";

/**
 * Simulateur Mobile Money « maison ».
 *
 * FedaPay sandbox étant indisponible, c'est nous qui jouons le rôle du
 * téléphone du client : la demande de paiement arrive, la personne saisit
 * son code secret, valide ou annule. Le choix est transmis au fournisseur
 * `mock` (`POST /demo/simulate/:id/:statut`), puis **le serveur revérifie le
 * statut par appel API** avant de débloquer — exactement le chemin FedaPay.
 *
 * Aucun code PIN n'est envoyé ni stocké : il ne sert qu'au réalisme.
 */

const OPERATOR_LOOK: Readonly<Record<string, { name: string; app: string; color: string; ink: string }>> = {
  mtn_benin: { name: "MTN", app: "MoMo", color: "#ffcb05", ink: "#1d1d1b" },
  moov_benin: { name: "Moov Africa", app: "Flooz", color: "#0b5fa5", ink: "#ffffff" },
};

interface MomoSimulatorProps {
  operator: string;
  phone: string;
  amount: number;
  reference: string;
  busy: SimulatedStatus | null;
  /** Le serveur a reçu la réponse et revérifie le paiement. */
  verifying: boolean;
  onAnswer: (status: SimulatedStatus) => void;
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"] as const;

export function MomoSimulator(props: MomoSimulatorProps) {
  const { operator, phone, amount, reference, busy, verifying, onAnswer } = props;
  const look = OPERATOR_LOOK[operator] ?? { name: "Mobile Money", app: "Wallet", color: "#111827", ink: "#fff" };
  const [pin, setPin] = useState("");
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const locked = busy !== null || verifying;

  function press(key: (typeof KEYS)[number]): void {
    if (locked || key === "") return;
    if (key === "⌫") setPin((p) => p.slice(0, -1));
    else setPin((p) => (p.length < 4 ? p + key : p));
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (/^\d$/.test(event.key)) press(event.key as (typeof KEYS)[number]);
      else if (event.key === "Backspace") press("⌫");
      else if (event.key === "Enter" && pin.length === 4 && !locked) onAnswer("approved");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="momo" aria-label="Simulateur de téléphone Mobile Money">
      <div className="momo-phone">
        <div className="momo-status">
          <span>{now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
          <span aria-hidden="true">▂▄▆ 4G ▮</span>
        </div>
        <div className="momo-sheet" style={{ ["--op" as string]: look.color, ["--op-ink" as string]: look.ink }}>
          <div className="momo-head">
            <strong>{look.name}</strong> <span>{look.app}</span>
          </div>

          {verifying ? (
            <div className="momo-body momo-center" role="status" aria-live="polite">
              <span className="spinner" aria-hidden="true" />
              <p>Paiement transmis.<br />Vérification par le serveur…</p>
            </div>
          ) : (
            <div className="momo-body">
              <p className="momo-msg">
                <strong>PreviewPay</strong> vous demande <strong>{formatPrice(amount)}</strong>.
                <br />
                Réf. {reference} · {phone}
              </p>
              <p className="momo-ask">Entrez votre code secret pour confirmer</p>
              <div className="momo-pin" aria-label={`${pin.length} chiffres saisis sur 4`}>
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} className={i < pin.length ? "on" : ""} />
                ))}
              </div>
              <div className="momo-keys">
                {KEYS.map((key, i) => (
                  <button
                    key={i}
                    type="button"
                    disabled={key === "" || locked}
                    className={key === "" ? "ghost" : ""}
                    aria-label={key === "⌫" ? "Effacer" : key === "" ? undefined : key}
                    onClick={() => press(key)}
                  >
                    {key}
                  </button>
                ))}
              </div>
              <div className="momo-actions">
                <button type="button" className="momo-cancel" disabled={locked} onClick={() => onAnswer("declined")}>
                  {busy === "declined" ? "…" : "Annuler"}
                </button>
                <button
                  type="button"
                  className="momo-ok"
                  disabled={locked || pin.length < 4}
                  onClick={() => onAnswer("approved")}
                >
                  {busy === "approved" ? "Envoi…" : "Valider"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      <button
        type="button"
        className="link-button small"
        disabled={locked}
        onClick={() => onAnswer("expired")}
      >
        Simuler une demande expirée (pas de réponse)
      </button>
    </div>
  );
}
