// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreviewPaywall } from "@previewpay/react";
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
  return (
    fetchImpl as unknown as {
      mock: { calls: Array<[RequestInfo | URL, RequestInit?]> };
    }
  ).mock.calls;
}

describe("<PreviewPaywall /> — aperçu et prix", () => {
  it("rend l'aperçu, le prix en F CFA et le formulaire de paiement", async () => {
    const fetchImpl = bouchon(() => reponseJson(livrable()));

    render(<PreviewPaywall deliverableId="dlv_1" options={{ fetchImpl }} />);

    const apercu = await screen.findByTestId("preview");
    expect(apercu.textContent).toContain("Aperçu filigrané du CV");

    expect(screen.getByTestId("price").textContent).toBe("200 F CFA");
    expect(screen.getByTestId("paywall")).toBeTruthy();
    expect(screen.getByTestId("phone")).toBeTruthy();
    expect(screen.getByTestId("operator")).toBeTruthy();
    expect(screen.getByTestId("pay-button").textContent).toBe("Valider et payer");
    expect(screen.getByTestId("reject-button").textContent).toBe(
      "Ce n'est pas ce que je voulais",
    );
    expect(screen.queryByTestId("error")).toBeNull();
  });

  it("accepte `className`, `style` et un rendu d'aperçu personnalisé", async () => {
    const fetchImpl = bouchon(() => reponseJson(livrable()));

    render(
      <PreviewPaywall
        deliverableId="dlv_1"
        className="ma-classe"
        style={{ maxWidth: 480 }}
        options={{ fetchImpl }}
        renderPreview={(preview) => (
          <strong>CV de {(preview as { text: string }).text}</strong>
        )}
      />,
    );

    const racine = await screen.findByTestId("paywall");
    expect(racine.className).toBe("ma-classe");
    expect(racine.style.maxWidth).toBe("480px");
    expect(screen.getByTestId("preview").textContent).toContain(
      "CV de Aperçu filigrané du CV",
    );
  });
});

describe("<PreviewPaywall /> — parcours de paiement", () => {
  it("envoie le numéro et l'opérateur puis affiche l'attente", async () => {
    const fetchImpl = bouchon((url) =>
      url.endsWith("/pay")
        ? reponseJson(livrable({ state: "payment_pending" }))
        : reponseJson(livrable()),
    );

    render(
      <PreviewPaywall
        deliverableId="dlv_1"
        options={{ fetchImpl, pollIntervalMs: 60_000 }}
      />,
    );

    const telephone = await screen.findByTestId("phone");
    fireEvent.change(telephone, { target: { value: "97000000" } });
    fireEvent.change(screen.getByTestId("operator"), {
      target: { value: "moov_benin" },
    });
    fireEvent.click(screen.getByTestId("pay-button"));

    const attente = await screen.findByText(/Paiement en attente de confirmation/);
    expect(attente.textContent).toContain("97000000");
    expect(screen.queryByTestId("pay-button")).toBeNull();
    expect(screen.queryByTestId("download-link")).toBeNull();

    const appel = appels(fetchImpl).find(([url]) => String(url).endsWith("/pay"));
    expect(String(appel![0])).toBe("/deliverables/dlv_1/pay");
    expect(appel![1]?.method).toBe("POST");
    expect(JSON.parse(String(appel![1]?.body))).toEqual({
      phone: "97000000",
      operator: "moov_benin",
    });
  });

  it("refuse l'aperçu et affiche l'état refusé", async () => {
    const fetchImpl = bouchon((url) =>
      url.endsWith("/reject")
        ? reponseJson({
            regenerated: false,
            deliverable: livrable({ state: "rejected" }),
          })
        : reponseJson(livrable()),
    );

    render(<PreviewPaywall deliverableId="dlv_1" options={{ fetchImpl }} />);

    fireEvent.click(await screen.findByTestId("reject-button"));

    await waitFor(() => expect(screen.queryByTestId("pay-button")).toBeNull());
    expect(screen.queryByTestId("download-link")).toBeNull();
    expect(screen.queryByTestId("error")).toBeNull();
    expect(screen.getByTestId("paywall").textContent).toContain(
      "Ce livrable a été refusé",
    );

    const appel = appels(fetchImpl).find(([url]) =>
      String(url).endsWith("/reject"),
    );
    expect(JSON.parse(String(appel![1]?.body))).toEqual({
      reason: "aperçu refusé par l'utilisateur",
    });
  });
});

describe("<PreviewPaywall /> — erreurs", () => {
  it("affiche l'erreur 409 du paiement et propose « Réessayer »", async () => {
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

    render(
      <PreviewPaywall
        deliverableId="dlv_1"
        options={{ fetchImpl, pollIntervalMs: 60_000 }}
      />,
    );

    fireEvent.change(await screen.findByTestId("phone"), {
      target: { value: "97000000" },
    });
    fireEvent.click(screen.getByTestId("pay-button"));

    const erreur = await screen.findByTestId("error");
    expect(erreur.textContent).toContain(
      "Transition interdite : previewed -> payment_pending",
    );
    expect(erreur.getAttribute("role")).toBe("alert");
    expect(screen.getByTestId("retry-button")).toBeTruthy();
    // L'erreur ne casse pas le formulaire : l'utilisateur peut réessayer.
    expect(screen.getByTestId("pay-button")).toBeTruthy();
  });

  it("affiche l'erreur 402 renvoyée au chargement", async () => {
    const fetchImpl = bouchon(() =>
      reponseJson(
        {
          statusCode: 402,
          code: "PAYMENT_REQUIRED",
          message: "Le livrable n'est pas débloqué : paiement confirmé requis",
        },
        402,
      ),
    );

    render(<PreviewPaywall deliverableId="dlv_1" options={{ fetchImpl }} />);

    const erreur = await screen.findByTestId("error");
    expect(erreur.textContent).toContain("paiement confirmé requis");
    expect(screen.queryByTestId("pay-button")).toBeNull();
    expect(screen.queryByTestId("preview")).toBeNull();
  });
});

describe("<PreviewPaywall /> — déblocage", () => {
  it("n'affiche le lien de téléchargement qu'une fois débloqué", async () => {
    const verrouille = render(
      <PreviewPaywall
        deliverableId="dlv_1"
        options={{ fetchImpl: bouchon(() => reponseJson(livrable())) }}
      />,
    );

    await screen.findByTestId("pay-button");
    expect(screen.queryByTestId("download-link")).toBeNull();
    verrouille.unmount();

    const fetchImpl = bouchon(() =>
      reponseJson(livrable({ state: "unlocked", downloadUrl: DOWNLOAD_URL })),
    );
    render(
      <PreviewPaywall
        deliverableId="dlv_1"
        options={{ fetchImpl }}
        onUnlocked={() => undefined}
      />,
    );

    const lien = await screen.findByTestId("download-link");
    expect(lien.getAttribute("href")).toBe(DOWNLOAD_URL);
    expect(lien.textContent).toBe("Télécharger");
    expect(screen.queryByTestId("pay-button")).toBeNull();
    expect(screen.queryByTestId("price")).toBeNull();
    expect(screen.getByTestId("paywall").textContent).toContain(
      "Paiement confirmé",
    );
  });

  it("détecte l'échec du paiement et propose une relance", async () => {
    vi.useFakeTimers();

    let courant = livrable({ state: "payment_pending" });
    const fetchImpl = bouchon(() => reponseJson(courant));

    render(
      <PreviewPaywall
        deliverableId="dlv_1"
        options={{ fetchImpl, pollIntervalMs: 1_000 }}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.queryByTestId("retry-button")).toBeNull();
    expect(screen.getByTestId("paywall").textContent).toContain(
      "Paiement en attente",
    );

    // Paiement refusé : le serveur ramène le livrable à `previewed`.
    courant = livrable({ state: "previewed" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(screen.getByTestId("retry-button")).toBeTruthy();
    expect(screen.getByTestId("paywall").textContent).toContain(
      "Le paiement n'a pas abouti",
    );
    // Le formulaire revient : nouvel essai possible.
    expect(screen.getByTestId("pay-button")).toBeTruthy();
  });
});

describe("<PreviewPaywall /> — opérateurs", () => {
  it("propose par défaut les quatre modes directs FedaPay", async () => {
    const fetchImpl = bouchon(() => reponseJson(livrable()));
    render(<PreviewPaywall deliverableId="dlv_1" options={{ fetchImpl }} />);
    const select = (await screen.findByTestId("operator")) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual([
      "mtn_benin",
      "moov_benin",
      "moov_togo",
      "mtn_ci",
    ]);
    expect(select.value).toBe("mtn_benin");
  });

  it("accepte une liste restreinte et envoie l'opérateur choisi à /pay", async () => {
    const fetchImpl = bouchon((url, init) =>
      reponseJson(livrable(init?.method === "POST" ? { state: "payment_pending" } : {})),
    );
    render(
      <PreviewPaywall
        deliverableId="dlv_1"
        options={{ fetchImpl, pollIntervalMs: 0 }}
        operators={[{ value: "mtn_ci", label: "MTN CI", country: "ci", dialCode: "+225" }]}
      />,
    );
    const select = (await screen.findByTestId("operator")) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["mtn_ci"]);
    expect((screen.getByTestId("phone") as HTMLInputElement).placeholder).toContain("+225");

    fireEvent.change(screen.getByTestId("phone"), { target: { value: "+2250700000000" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("pay-button"));
    });
    await waitFor(() => {
      const pay = appels(fetchImpl).find(([, init]) => init?.method === "POST");
      expect(JSON.parse(String(pay?.[1]?.body))).toMatchObject({ operator: "mtn_ci" });
    });
  });
});
