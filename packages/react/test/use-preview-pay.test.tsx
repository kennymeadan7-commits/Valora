// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePreviewPay } from "@previewpay/react";
import { DOWNLOAD_URL, livrable, reponseJson } from "./helpers.js";

type FetchImpl = typeof fetch;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function bouchon(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): FetchImpl {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init),
  ) as unknown as FetchImpl;
}

function appels(fetchImpl: FetchImpl): Array<[RequestInfo | URL, RequestInit?]> {
  return (fetchImpl as unknown as { mock: { calls: Array<[RequestInfo | URL, RequestInit?]> } })
    .mock.calls;
}

describe("usePreviewPay — chargement", () => {
  it("charge l'état, l'aperçu et le prix au montage", async () => {
    const fetchImpl = bouchon(() => reponseJson(livrable()));

    const { result } = renderHook(() =>
      usePreviewPay("dlv_1", { fetchImpl }),
    );

    expect(result.current.status).toBeNull();
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.status).toBe("previewed"));

    expect(result.current.price).toBe(200);
    expect(result.current.currency).toBe("XOF");
    expect(result.current.preview).toEqual({ text: "Aperçu filigrané du CV" });
    expect(result.current.downloadUrl).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);

    const [url, init] = appels(fetchImpl)[0]!;
    expect(String(url)).toBe("/deliverables/dlv_1");
    expect(init?.method ?? "GET").toBe("GET");
  });

  it("préfixe les URLs avec `baseUrl` et ajoute la clé interne", async () => {
    const fetchImpl = bouchon(() => reponseJson(livrable()));

    const { result } = renderHook(() =>
      usePreviewPay("dlv_9", {
        fetchImpl,
        baseUrl: "https://api.previewpay.test/",
        internalKey: "cle-test",
      }),
    );

    await waitFor(() => expect(result.current.status).toBe("previewed"));

    const [url, init] = appels(fetchImpl)[0]!;
    expect(String(url)).toBe("https://api.previewpay.test/deliverables/dlv_9");
    expect(init?.headers).toMatchObject({ "x-internal-key": "cle-test" });
  });

  it("transforme une réponse 404 en `error` sans lever d'exception", async () => {
    const fetchImpl = bouchon(() =>
      reponseJson(
        {
          statusCode: 404,
          code: "DELIVERABLE_NOT_FOUND",
          message: "Livrable introuvable : dlv_1",
        },
        404,
      ),
    );

    const { result } = renderHook(() =>
      usePreviewPay("dlv_1", { fetchImpl }),
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.error).toEqual({
      code: "DELIVERABLE_NOT_FOUND",
      message: "Livrable introuvable : dlv_1",
      status: 404,
    });
    expect(result.current.status).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("capture une panne réseau en `NETWORK_ERROR`", async () => {
    const fetchImpl = bouchon(() => {
      throw new Error("hors ligne");
    });

    const { result } = renderHook(() =>
      usePreviewPay("dlv_1", { fetchImpl }),
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.error?.code).toBe("NETWORK_ERROR");
    expect(result.current.error?.status).toBe(0);
    expect(result.current.error?.message).toContain("hors ligne");
  });
});

describe("usePreviewPay — actions", () => {
  it("`pay` poste téléphone et opérateur puis passe en `payment_pending`", async () => {
    const fetchImpl = bouchon((url) =>
      url.endsWith("/pay")
        ? reponseJson(livrable({ state: "payment_pending" }))
        : reponseJson(livrable()),
    );

    const { result } = renderHook(() =>
      usePreviewPay("dlv_1", { fetchImpl, pollIntervalMs: 60_000 }),
    );

    await waitFor(() => expect(result.current.status).toBe("previewed"));

    await act(async () => {
      await result.current.pay("97000000", "moov_benin");
    });

    expect(result.current.status).toBe("payment_pending");
    expect(result.current.error).toBeNull();

    const appel = appels(fetchImpl).find(([url]) =>
      String(url).endsWith("/pay"),
    );
    expect(appel).toBeDefined();
    expect(String(appel![0])).toBe("/deliverables/dlv_1/pay");
    expect(appel![1]?.method).toBe("POST");
    expect(JSON.parse(String(appel![1]?.body))).toEqual({
      phone: "97000000",
      operator: "moov_benin",
    });
  });

  it("`reject` poste le motif et reflète l'état refusé", async () => {
    const fetchImpl = bouchon((url) =>
      url.endsWith("/reject")
        ? reponseJson({
            regenerated: false,
            deliverable: livrable({ state: "rejected" }),
          })
        : reponseJson(livrable()),
    );

    const { result } = renderHook(() =>
      usePreviewPay("dlv_1", { fetchImpl }),
    );

    await waitFor(() => expect(result.current.status).toBe("previewed"));

    await act(async () => {
      await result.current.reject("trop cher");
    });

    expect(result.current.status).toBe("rejected");

    const appel = appels(fetchImpl).find(([url]) =>
      String(url).endsWith("/reject"),
    );
    expect(JSON.parse(String(appel![1]?.body))).toEqual({ reason: "trop cher" });
  });

  it("affiche l'erreur 409 du paiement dans `error`", async () => {
    const fetchImpl = bouchon((url) =>
      url.endsWith("/pay")
        ? reponseJson(
            {
              statusCode: 409,
              code: "INVALID_TRANSITION",
              message: "Transition interdite : previewed -> payment_pending",
            },
            409,
          )
        : reponseJson(livrable()),
    );

    const { result } = renderHook(() =>
      usePreviewPay("dlv_1", { fetchImpl, pollIntervalMs: 60_000 }),
    );

    await waitFor(() => expect(result.current.status).toBe("previewed"));

    await act(async () => {
      await result.current.pay("97000000");
    });

    expect(result.current.error).toEqual({
      code: "INVALID_TRANSITION",
      message: "Transition interdite : previewed -> payment_pending",
      status: 409,
    });
    expect(result.current.status).toBe("previewed");
    expect(result.current.loading).toBe(false);
  });
});

describe("usePreviewPay — polling", () => {
  it("scrute pendant `payment_pending` et s'arrête au déblocage", async () => {
    vi.useFakeTimers();

    let courant = livrable({ state: "payment_pending" });
    const fetchImpl = bouchon(() => reponseJson(courant));

    const { result } = renderHook(() =>
      usePreviewPay("dlv_1", { fetchImpl, pollIntervalMs: 3_000 }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.status).toBe("payment_pending");
    expect(appels(fetchImpl)).toHaveLength(1);

    // Le webhook a débloqué le livrable entre deux scrutations.
    courant = livrable({ state: "unlocked", downloadUrl: DOWNLOAD_URL });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(result.current.status).toBe("unlocked");
    expect(result.current.downloadUrl).toBe(DOWNLOAD_URL);
    expect(appels(fetchImpl)).toHaveLength(2);

    // Plus aucune requête : l'intervalle a été nettoyé.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(appels(fetchImpl)).toHaveLength(2);
  });

  it("ne scrute pas quand le livrable est déjà `previewed`", async () => {
    vi.useFakeTimers();
    const fetchImpl = bouchon(() => reponseJson(livrable()));

    renderHook(() =>
      usePreviewPay("dlv_1", { fetchImpl, pollIntervalMs: 1_000 }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(appels(fetchImpl)).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(appels(fetchImpl)).toHaveLength(1);
  });
});
