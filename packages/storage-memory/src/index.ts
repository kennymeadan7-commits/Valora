import type {
  Deliverable,
  EventRecord,
  JournalEntry,
  State,
  Storage,
  TransitionMeta,
} from "@previewpay/core";

/**
 * `Storage` en mémoire — tests, démo, et référence de comportement pour les
 * implémentations persistantes. Les transitions sont atomiques vis-à-vis de
 * l'ordonnanceur JS : la vérification et l'écriture se font dans le même tick.
 */
export class MemoryStorage implements Storage {
  private readonly deliverables = new Map<string, Deliverable>();
  private readonly payments = new Map<string, string>();
  private readonly events = new Set<string>();
  private readonly journal: JournalEntry[] = [];

  async saveDeliverable(d: Deliverable): Promise<void> {
    this.deliverables.set(d.id, structuredClone(d));
    if (d.paymentId) this.payments.set(d.paymentId, d.id);
  }

  async getDeliverable(id: string): Promise<Deliverable | null> {
    const d = this.deliverables.get(id);
    return d ? structuredClone(d) : null;
  }

  async getDeliverableByPayment(paymentId: string): Promise<Deliverable | null> {
    const id = this.payments.get(paymentId);
    return id ? this.getDeliverable(id) : null;
  }

  async transition(
    id: string,
    from: State,
    to: State,
    meta: TransitionMeta,
  ): Promise<boolean> {
    const current = this.deliverables.get(id);
    if (!current || current.state !== from) return false;

    const next: Deliverable = { ...current, state: to, updatedAt: new Date() };
    this.deliverables.set(id, next);
    this.journal.push({
      deliverableId: id,
      from,
      to,
      at: next.updatedAt,
      cause: meta.cause,
      ...(meta.eventId ? { eventId: meta.eventId } : {}),
      ...(meta.paymentId ? { paymentId: meta.paymentId } : {}),
    });
    return true;
  }

  async recordEvent(e: EventRecord): Promise<boolean> {
    if (this.events.has(e.id)) return false;
    this.events.add(e.id);
    return true;
  }

  async appendJournal(entry: JournalEntry): Promise<void> {
    this.journal.push(structuredClone(entry));
  }

  async listJournal(deliverableId: string): Promise<JournalEntry[]> {
    return this.journal
      .filter((e) => e.deliverableId === deliverableId)
      .map((e) => structuredClone(e));
  }

  /** Vide le store (utile entre deux tests). */
  reset(): void {
    this.deliverables.clear();
    this.payments.clear();
    this.events.clear();
    this.journal.length = 0;
  }
}
