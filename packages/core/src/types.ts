import type { State } from "./machine.js";

export const CURRENCY = "XOF" as const;
export type Currency = typeof CURRENCY;

export type PaymentStatus =
  | "pending"
  | "approved"
  | "declined"
  | "canceled"
  | "expired";

/** Grille tarifaire par type de livrable, en entiers XOF. */
export type Pricing = Readonly<Record<string, number>>;

/**
 * Boîte noire du SDK, côté serveur uniquement.
 * `content` ne doit jamais être sérialisé vers un client.
 */
export interface Deliverable {
  id: string;
  type: string;
  state: State;
  /** Entier XOF, figé à la création. */
  price: number;
  currency: Currency;
  /** Contenu complet — reste sur le serveur jusqu'à `unlocked`. */
  content: unknown;
  /** Aperçu produit par la PreviewStrategy, seul élément exposable. */
  preview: unknown;
  paymentId: string | null;
  /** Page de paiement du fournisseur, si l'opérateur exige une redirection. */
  paymentUrl: string | null;
  regenerations: number;
  maxRegenerations: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Vue client : jamais de `content`, jamais de secret. */
export interface PublicDeliverable {
  id: string;
  type: string;
  state: State;
  price: number;
  currency: Currency;
  preview: unknown;
  regenerations: number;
  maxRegenerations: number;
  downloadUrl: string | null;
  /** À ouvrir si le paiement direct n'est pas disponible (repli). */
  paymentUrl: string | null;
}

export interface EventRecord {
  /** Identifiant fourni par le fournisseur de paiement (idempotence). */
  id: string;
  type: string;
  paymentId: string | null;
  receivedAt: Date;
  payload?: unknown;
}

export interface TransitionMeta {
  cause: string;
  eventId?: string;
  paymentId?: string;
}

export interface JournalEntry extends TransitionMeta {
  deliverableId: string;
  from: State;
  to: State;
  at: Date;
}

export interface Storage {
  saveDeliverable(d: Deliverable): Promise<void>;
  getDeliverable(id: string): Promise<Deliverable | null>;
  /** Retrouve un livrable par l'identifiant de paiement du fournisseur. */
  getDeliverableByPayment(paymentId: string): Promise<Deliverable | null>;
  /**
   * Atomique : n'applique la transition que si l'état courant est `from`.
   * Renvoie `false` si l'état a changé entre-temps (deux webhooks concurrents).
   */
  transition(
    id: string,
    from: State,
    to: State,
    meta: TransitionMeta,
  ): Promise<boolean>;
  /** `false` si l'événement a déjà été traité. */
  recordEvent(e: EventRecord): Promise<boolean>;
  appendJournal(entry: JournalEntry): Promise<void>;
  listJournal(deliverableId: string): Promise<JournalEntry[]>;
}

export interface CreatePaymentInput {
  amount: number;
  currency: Currency;
  phone: string;
  operator: string;
  reference: string;
}

export interface ParsedWebhook {
  eventId: string;
  paymentId: string;
  type: string;
}

export interface PaymentProvider {
  readonly name: string;
  createPayment(
    input: CreatePaymentInput,
  ): Promise<{ paymentId: string; paymentUrl?: string | null }>;
  getPaymentStatus(paymentId: string): Promise<PaymentStatus>;
  /** Doit lever `InvalidSignatureError` si la signature ne couvre pas rawBody. */
  parseWebhook(
    rawBody: Buffer,
    headers: Record<string, string>,
  ): Promise<ParsedWebhook>;
}

export interface PreviewStrategy {
  makePreview(content: unknown, ctx: { type: string }): Promise<unknown>;
}

export interface DownloadLink {
  url: string;
  expiresAt: Date;
}
