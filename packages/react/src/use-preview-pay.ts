import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Currency, PublicDeliverable, State } from "@previewpay/core";

/**
 * Hook client du SDK PreviewPay.
 *
 * Il ne prend **aucune** décision métier : il parle aux endpoints du module
 * NestJS (`@previewpay/nestjs`) et se contente de refléter l'état du livrable.
 * Le contenu complet n'est jamais téléchargé ici — l'API n'expose que
 * `preview`, et `downloadUrl` n'apparaît qu'une fois le livrable `unlocked`.
 */

/** Opérateurs Mobile Money supportés par la démo FedaPay. */
export const MOBILE_MONEY_OPERATORS = [
  { value: "mtn_benin", label: "MTN Bénin" },
  { value: "moov_benin", label: "Moov Bénin" },
] as const;

export type MobileMoneyOperator =
  (typeof MOBILE_MONEY_OPERATORS)[number]["value"];

export const DEFAULT_OPERATOR: MobileMoneyOperator = "mtn_benin";

/** Motif envoyé au serveur quand l'intégrateur n'en fournit pas. */
export const DEFAULT_REJECTION_REASON = "aperçu refusé par l'utilisateur";

/** Erreur HTTP normalisée : jamais de `throw` non capturé côté appelant. */
export interface PreviewPayApiError {
  /** Code métier renvoyé par l'API (`DELIVERABLE_NOT_FOUND`, `CONFLICT`, …). */
  code: string;
  /** Message lisible, en français. */
  message: string;
  /** Statut HTTP, `0` pour une panne réseau. */
  status: number;
}

export interface UsePreviewPayOptions {
  /** Préfixe des URLs ; `""` (défaut) = même origine que la page. */
  baseUrl?: string;
  /** Injecte un `fetch` (tests, SSR, transport maison). */
  fetchImpl?: typeof fetch;
  /** Intervalle de scrutation pendant `payment_pending`, en ms. */
  pollIntervalMs?: number;
  /** Clé interne optionnelle, transmise en en-tête `x-internal-key`. */
  internalKey?: string;
}

export interface PreviewPayState {
  /** État du livrable, `null` tant que la première requête n'a pas répondu. */
  status: State | null;
  /** Aperçu produit par le serveur (objet ou texte selon la stratégie). */
  preview: unknown;
  /** Prix figé à la création, entier XOF. */
  price: number;
  currency: Currency;
  /** Lien signé à durée courte, non nul seulement si `unlocked`. */
  downloadUrl: string | null;
  /** Repli si le paiement direct n'est pas disponible. */
  paymentUrl: string | null;
  error: PreviewPayApiError | null;
  /** Vrai pendant une requête déclenchée par l'utilisateur (pas le polling). */
  loading: boolean;
  pay: (phone: string, operator?: string) => Promise<void>;
  reject: (reason?: string) => Promise<void>;
  refresh: () => Promise<void>;
}

/** Champs d'état projetés depuis la vue publique du livrable. */
type DeliverableFields = Pick<
  PreviewPayState,
  "status" | "preview" | "price" | "currency" | "downloadUrl" | "paymentUrl"
>;

type InternalState = Omit<PreviewPayState, "pay" | "reject" | "refresh">;

const INITIAL_STATE: InternalState = {
  status: null,
  preview: null,
  price: 0,
  currency: "XOF",
  downloadUrl: null,
  paymentUrl: null,
  error: null,
  loading: false,
};

/**
 * `fetch` global, appelé comme méthode de `globalThis`. Une référence détachée
 * (`const f = window.fetch; f(...)`) lève `Illegal invocation` dans Chrome.
 */
const defaultFetch: typeof fetch = (input, init) =>
  globalThis.fetch(input, init);

const DEFAULT_POLL_INTERVAL_MS = 3_000;

/** Supprime un éventuel `/` final pour composer des URLs propres. */
function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/** Lit le corps JSON sans échouer sur une réponse vide ou non JSON. */
async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Traduit une réponse HTTP en erreur exploitable par l'UI. */
function toApiError(body: unknown, status: number): PreviewPayApiError {
  const fallback = {
    code: `HTTP_${status}`,
    message: `Erreur HTTP ${status}`,
    status,
  };
  if (typeof body !== "object" || body === null) return fallback;

  const record = body as Record<string, unknown>;
  const code =
    typeof record["code"] === "string" ? record["code"] : fallback.code;
  const raw = record["message"];
  let message = fallback.message;
  if (typeof raw === "string" && raw.trim() !== "") {
    message = raw;
  } else if (Array.isArray(raw)) {
    const parts = raw.filter((item): item is string => typeof item === "string");
    if (parts.length > 0) message = parts.join(", ");
  }
  return { code, message, status };
}

/** Panne réseau / `fetch` indisponible : pas de statut HTTP. */
function toNetworkError(cause: unknown): PreviewPayApiError {
  const message =
    cause instanceof Error && cause.message !== ""
      ? cause.message
      : "Connexion au service PreviewPay impossible";
  return { code: "NETWORK_ERROR", message, status: 0 };
}

/** Projette une `PublicDeliverable` sur les champs d'état du hook. */
function fieldsFromDeliverable(
  deliverable: PublicDeliverable | null | undefined,
): Partial<DeliverableFields> {
  if (typeof deliverable !== "object" || deliverable === null) return {};
  return {
    status: deliverable.state,
    preview: deliverable.preview ?? null,
    price: typeof deliverable.price === "number" ? deliverable.price : 0,
    currency: deliverable.currency ?? "XOF",
    downloadUrl: deliverable.downloadUrl ?? null,
    paymentUrl: deliverable.paymentUrl ?? null,
  };
}

type SendResult =
  | { ok: true; data: unknown }
  | { ok: false; error: PreviewPayApiError };

export function usePreviewPay(
  deliverableId: string,
  options: UsePreviewPayOptions = {},
): PreviewPayState {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? "");
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const internalKey = options.internalKey;

  const [state, setState] = useState<InternalState>(INITIAL_STATE);

  // `fetch` est lu via une ref : une fonction recréée à chaque rendu par
  // l'intégrateur ne doit pas relancer les effets. Le wrapper par défaut
  // conserve `this = globalThis` : sans lui, appeler `window.fetch` détaché
  // lève « Illegal invocation » dans le navigateur.
  const fetchRef = useRef<typeof fetch>(options.fetchImpl ?? defaultFetch);
  fetchRef.current = options.fetchImpl ?? defaultFetch;

  const aliveRef = useRef(true);

  const headers = useCallback((): Record<string, string> => {
    const headers: Record<string, string> = { accept: "application/json" };
    if (internalKey) headers["x-internal-key"] = internalKey;
    return headers;
  }, [internalKey]);

  const deliverablePath = `/deliverables/${encodeURIComponent(deliverableId)}`;

  /** GET du statut ; `silent` évite d'allumer `loading` pendant le polling. */
  const load = useCallback(
    async (silent = false): Promise<void> => {
      if (!silent) setState((previous) => ({ ...previous, loading: true }));
      try {
        const response = await fetchRef.current(
          `${baseUrl}${deliverablePath}`,
          { headers: headers() },
        );
        const body = await readBody(response);
        if (!aliveRef.current) return;
        if (!response.ok) {
          setState((previous) => ({
            ...previous,
            loading: false,
            error: toApiError(body, response.status),
          }));
          return;
        }
        setState((previous) => ({
          ...previous,
          ...fieldsFromDeliverable(body as PublicDeliverable),
          loading: false,
          error: null,
        }));
      } catch (cause) {
        if (!aliveRef.current) return;
        setState((previous) => ({
          ...previous,
          loading: false,
          error: toNetworkError(cause),
        }));
      }
    },
    [baseUrl, deliverablePath, headers],
  );

  /** POST JSON générique : le corps d'erreur est toujours absorbé. */
  const send = useCallback(
    async (path: string, payload: unknown): Promise<SendResult> => {
      try {
        const response = await fetchRef.current(`${baseUrl}${path}`, {
          method: "POST",
          headers: { ...headers(), "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await readBody(response);
        if (!response.ok) {
          return { ok: false, error: toApiError(data, response.status) };
        }
        return { ok: true, data };
      } catch (cause) {
        return { ok: false, error: toNetworkError(cause) };
      }
    },
    [baseUrl, headers],
  );

  const pay = useCallback(
    async (phone: string, operator?: string): Promise<void> => {
      setState((previous) => ({ ...previous, loading: true, error: null }));
      const result = await send(`${deliverablePath}/pay`, {
        phone,
        operator: operator ?? DEFAULT_OPERATOR,
      });
      if (!aliveRef.current) return;
      if (!result.ok) {
        setState((previous) => ({
          ...previous,
          loading: false,
          error: result.error,
        }));
        return;
      }
      setState((previous) => ({
        ...previous,
        ...fieldsFromDeliverable(result.data as PublicDeliverable),
        loading: false,
        error: null,
      }));
    },
    [deliverablePath, send],
  );

  const reject = useCallback(
    async (reason?: string): Promise<void> => {
      setState((previous) => ({ ...previous, loading: true, error: null }));
      const result = await send(`${deliverablePath}/reject`, {
        reason: reason ?? DEFAULT_REJECTION_REASON,
      });
      if (!aliveRef.current) return;
      if (!result.ok) {
        setState((previous) => ({
          ...previous,
          loading: false,
          error: result.error,
        }));
        return;
      }
      const payload = result.data as
        | { deliverable?: PublicDeliverable }
        | null;
      setState((previous) => ({
        ...previous,
        ...fieldsFromDeliverable(payload?.deliverable),
        loading: false,
        error: null,
      }));
    },
    [deliverablePath, send],
  );

  const refresh = useCallback((): Promise<void> => load(), [load]);

  // Chargement initial (et rechargement si l'id ou le serveur change).
  useEffect(() => {
    aliveRef.current = true;
    void load();
    return () => {
      aliveRef.current = false;
    };
  }, [load]);

  // Scrutation tant que le paiement est en attente ; l'intervalle est nettoyé
  // dès que l'état change (débloqué, revenu à `previewed`) ou au démontage.
  useEffect(() => {
    if (state.status !== "payment_pending") return undefined;
    if (pollIntervalMs <= 0) return undefined;
    const timer = setInterval(() => {
      void load(true);
    }, pollIntervalMs);
    return () => clearInterval(timer);
  }, [state.status, pollIntervalMs, load]);

  return useMemo(
    () => ({ ...state, pay, reject, refresh }),
    [state, pay, reject, refresh],
  );
}
