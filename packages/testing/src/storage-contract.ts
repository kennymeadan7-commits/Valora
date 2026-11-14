import { beforeEach, describe, expect, it } from "vitest";
import type {
  Deliverable,
  EventRecord,
  JournalEntry,
  Storage,
  TransitionMeta,
} from "@previewpay/core";

/**
 * Suite de contrat commune à toutes les implémentations de `Storage`.
 *
 * Elle ne teste que les invariants du port : fidélité de lecture, transitions
 * atomiques, journal append-only et idempotence des événements. Les règles
 * métier (machine à états, prix) restent dans le moteur du cœur.
 */
export interface StorageContractOptions {
  /** Fabrique un `Storage` vide. Appelée avant chaque test. */
  create: () => Promise<Storage> | Storage;
}

const AT = new Date("2026-11-14T10:00:00.000Z");

/** Livrable de référence, indépendant de toute implémentation. */
export function makeDeliverable(
  overrides: Partial<Deliverable> = {},
): Deliverable {
  return {
    id: "dlv_contract",
    type: "cv",
    state: "previewed",
    price: 200,
    currency: "XOF",
    content: { full: "contenu complet, jamais exposé" },
    preview: { text: "aperçu" },
    paymentId: "pay_contract",
    paymentUrl: null,
    regenerations: 0,
    maxRegenerations: 1,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

function journalEntry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    deliverableId: "dlv_contract",
    from: "draft",
    to: "previewed",
    at: AT,
    cause: "preview",
    ...overrides,
  };
}

export function describeStorageContract({
  create,
}: StorageContractOptions): void {
  describe("contrat Storage", () => {
    let storage: Storage;

    beforeEach(async () => {
      storage = await create();
    });

    it("enregistre puis relit un livrable à l'identique", async () => {
      const deliverable = makeDeliverable();

      await storage.saveDeliverable(deliverable);

      expect(await storage.getDeliverable(deliverable.id)).toEqual(deliverable);
    });

    it("renvoie null pour un livrable inconnu", async () => {
      expect(await storage.getDeliverable("dlv_absent")).toBeNull();
    });

    it("renvoie une liste vide quand aucun livrable n'existe", async () => {
      expect(await storage.listDeliverables()).toEqual([]);
    });

    it("renvoie tous les livrables enregistrés", async () => {
      const first = makeDeliverable({
        id: "dlv_un",
        paymentId: null,
        content: { full: "contenu un" },
      });
      const second = makeDeliverable({
        id: "dlv_deux",
        paymentId: null,
        state: "rejected",
        createdAt: new Date(AT.getTime() + 1_000),
        updatedAt: new Date(AT.getTime() + 1_000),
        content: { full: "contenu deux" },
      });

      await storage.saveDeliverable(first);
      await storage.saveDeliverable(second);

      expect(await storage.listDeliverables()).toEqual([first, second]);
    });

    it("trie la liste par createdAt puis id", async () => {
      const later = makeDeliverable({
        id: "dlv_c",
        paymentId: null,
        createdAt: new Date(AT.getTime() + 2_000),
        updatedAt: new Date(AT.getTime() + 2_000),
      });
      const tieB = makeDeliverable({ id: "dlv_b", paymentId: null });
      const tieA = makeDeliverable({ id: "dlv_a", paymentId: null });
      const earlier = makeDeliverable({
        id: "dlv_0",
        paymentId: null,
        createdAt: new Date(AT.getTime() - 1_000),
        updatedAt: new Date(AT.getTime() - 1_000),
      });

      // Insertion volontairement dans le désordre.
      await storage.saveDeliverable(later);
      await storage.saveDeliverable(tieB);
      await storage.saveDeliverable(earlier);
      await storage.saveDeliverable(tieA);

      const ids = (await storage.listDeliverables()).map((d) => d.id);
      expect(ids).toEqual(["dlv_0", "dlv_a", "dlv_b", "dlv_c"]);
    });

    it("retrouve un livrable par son paiement, null sinon", async () => {
      const deliverable = makeDeliverable();
      await storage.saveDeliverable(deliverable);

      expect(
        (await storage.getDeliverableByPayment("pay_contract"))?.id,
      ).toBe(deliverable.id);
      expect(await storage.getDeliverableByPayment("pay_absent")).toBeNull();
    });

    it("applique une transition dont l'état courant correspond à `from`", async () => {
      await storage.saveDeliverable(makeDeliverable());

      const applied = await storage.transition(
        "dlv_contract",
        "previewed",
        "payment_pending",
        { cause: "pay", paymentId: "pay_contract" },
      );

      expect(applied).toBe(true);
      expect((await storage.getDeliverable("dlv_contract"))?.state).toBe(
        "payment_pending",
      );
    });

    it("refuse une transition si l'état courant diffère de `from`", async () => {
      await storage.saveDeliverable(makeDeliverable({ state: "previewed" }));

      const applied = await storage.transition(
        "dlv_contract",
        "payment_pending",
        "unlocked",
        { cause: "webhook" },
      );

      expect(applied).toBe(false);
      expect((await storage.getDeliverable("dlv_contract"))?.state).toBe(
        "previewed",
      );
      expect(await storage.listJournal("dlv_contract")).toHaveLength(0);
    });

    it("n'applique une transition qu'une seule fois (garde atomique)", async () => {
      await storage.saveDeliverable(makeDeliverable());

      const first = await storage.transition(
        "dlv_contract",
        "previewed",
        "payment_pending",
        { cause: "pay" },
      );
      const second = await storage.transition(
        "dlv_contract",
        "previewed",
        "payment_pending",
        { cause: "pay" },
      );

      expect(first).toBe(true);
      expect(second).toBe(false);
      expect((await storage.getDeliverable("dlv_contract"))?.state).toBe(
        "payment_pending",
      );
    });

    it("renvoie false pour un livrable inconnu", async () => {
      const applied = await storage.transition(
        "dlv_absent",
        "draft",
        "previewed",
        { cause: "preview" },
      );

      expect(applied).toBe(false);
    });

    it("journalise chaque transition acceptée avec from, to, at et cause", async () => {
      await storage.saveDeliverable(makeDeliverable());
      const meta: TransitionMeta = {
        cause: "pay",
        eventId: "evt_1",
        paymentId: "pay_contract",
      };

      await storage.transition(
        "dlv_contract",
        "previewed",
        "payment_pending",
        meta,
      );

      const journal = await storage.listJournal("dlv_contract");
      expect(journal).toHaveLength(1);
      const first = journal[0];
      if (!first) throw new Error("journal vide après une transition acceptée");
      expect(first).toMatchObject({
        deliverableId: "dlv_contract",
        from: "previewed",
        to: "payment_pending",
        cause: "pay",
        eventId: "evt_1",
        paymentId: "pay_contract",
      });
      expect(first.at).toBeInstanceOf(Date);

      await storage.transition(
        "dlv_contract",
        "payment_pending",
        "unlocked",
        { cause: "webhook", eventId: "evt_2" },
      );

      const afterSecond = await storage.listJournal("dlv_contract");
      expect(afterSecond.map((entry) => [entry.from, entry.to])).toEqual([
        ["previewed", "payment_pending"],
        ["payment_pending", "unlocked"],
      ]);
    });

    it("conserve l'ordre d'insertion du journal (append-only)", async () => {
      const first = journalEntry({ cause: "preview" });
      const second = journalEntry({
        from: "previewed",
        to: "payment_pending",
        cause: "pay",
        at: new Date(AT.getTime() + 1_000),
      });

      await storage.appendJournal(first);
      await storage.appendJournal(second);

      const entries = await storage.listJournal("dlv_contract");
      expect(entries.map((entry) => entry.cause)).toEqual(["preview", "pay"]);
      expect(entries[0]).toMatchObject({ from: "draft", to: "previewed" });
      expect(entries[1]).toMatchObject({
        from: "previewed",
        to: "payment_pending",
      });
      expect(entries[1]?.at).toBeInstanceOf(Date);
      expect(await storage.listJournal("dlv_autre")).toEqual([]);
    });

    it("est idempotent : un événement déjà vu renvoie false", async () => {
      const event: EventRecord = {
        id: "evt_contract",
        type: "transaction.approved",
        paymentId: "pay_contract",
        receivedAt: AT,
        payload: { ok: true },
      };

      expect(await storage.recordEvent(event)).toBe(true);
      expect(await storage.recordEvent(event)).toBe(false);
      // Même identifiant, charge utile différente : toujours un doublon.
      expect(
        await storage.recordEvent({ ...event, payload: { ok: false } }),
      ).toBe(false);
    });
  });
}
