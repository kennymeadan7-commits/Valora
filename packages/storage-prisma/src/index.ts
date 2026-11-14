import type {
  Currency,
  Deliverable,
  EventRecord,
  JournalEntry,
  State,
  Storage,
  TransitionMeta,
} from "@previewpay/core";
import { Prisma, PrismaClient } from "@prisma/client";
import type {
  Deliverable as DeliverableRow,
  JournalEntry as JournalEntryRow,
} from "@prisma/client";

/**
 * `Storage` PostgreSQL — adaptateur du port du cœur.
 *
 * Les conversions entre le cœur et la base sont regroupées ci-dessus : dates
 * `TIMESTAMPTZ` normalisées en `Date` UTC, valeurs `unknown` sérialisées en
 * `JSONB`, lignes Prisma mappées vers les objets du cœur.
 *
 * Aucune valeur de retour autre qu'un `Deliverable` ne contient `content`.
 */

/** `at`/`createdAt` sont des `TIMESTAMPTZ` : on normalise en `Date` UTC. */
function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Normalise une valeur `unknown` en entrée JSON Prisma.
 *
 * Le passage par `JSON.stringify` applique exactement la sémantique de la
 * colonne `JSONB` : les `Date` deviennent des chaînes ISO-8601, `undefined`
 * en sommet devient `null`, et une valeur non sérialisable (BigInt, cycle)
 * lève immédiatement plutôt que d'être stockée de travers.
 */
function toJsonInput(value: unknown): Prisma.InputJsonValue {
  const serialized = JSON.stringify(value === undefined ? null : value);
  if (serialized === undefined) {
    throw new TypeError(
      "Valeur non sérialisable en JSON : refus d'écrire un contenu altéré.",
    );
  }
  return JSON.parse(serialized) as Prisma.InputJsonValue;
}

/** Ligne `Deliverable` → objet du cœur. Seul point qui lit `content`. */
function toDeliverable(row: DeliverableRow): Deliverable {
  return {
    id: row.id,
    type: row.type,
    state: row.state as State,
    price: row.price,
    currency: row.currency as Currency,
    content: row.content as unknown,
    preview: row.preview as unknown,
    paymentId: row.paymentId,
    paymentUrl: row.paymentUrl,
    regenerations: row.regenerations,
    maxRegenerations: row.maxRegenerations,
    createdAt: asDate(row.createdAt),
    updatedAt: asDate(row.updatedAt),
  };
}

/** Ligne `JournalEntry` → entrée du cœur (aucun contenu de livrable). */
function toJournalEntry(row: JournalEntryRow): JournalEntry {
  return {
    deliverableId: row.deliverableId,
    from: row.from as State,
    to: row.to as State,
    at: asDate(row.at),
    cause: row.cause,
    ...(row.eventId === null ? {} : { eventId: row.eventId }),
    ...(row.paymentId === null ? {} : { paymentId: row.paymentId }),
  };
}

/** Colonnes d'un livrable, hors clé primaire (utilisées par `update`). */
function deliverableData(
  d: Deliverable,
): Omit<Prisma.DeliverableUncheckedCreateInput, "id"> {
  return {
    type: d.type,
    state: d.state,
    price: d.price,
    currency: d.currency,
    content: toJsonInput(d.content),
    preview: toJsonInput(d.preview),
    paymentId: d.paymentId,
    paymentUrl: d.paymentUrl,
    regenerations: d.regenerations,
    maxRegenerations: d.maxRegenerations,
    createdAt: asDate(d.createdAt),
    updatedAt: asDate(d.updatedAt),
  };
}

/** Violation de contrainte unique côté PostgreSQL. */
function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

/**
 * `Storage` PostgreSQL.
 *
 * Deux garanties portées par la base elle-même :
 * - la transition conditionnelle (`UPDATE … WHERE state = from`) est atomique :
 *   deux webhooks concurrents ne peuvent pas dépasser l'un l'autre ;
 * - la clé primaire de `PaymentEvent` porte l'`eventId`, donc un doublon est
 *   rejeté par PostgreSQL (P2002) sans verrou applicatif.
 */
export class PrismaStorage implements Storage {
  constructor(private readonly prisma: PrismaClient) {}

  async saveDeliverable(d: Deliverable): Promise<void> {
    const data = deliverableData(d);
    await this.prisma.deliverable.upsert({
      where: { id: d.id },
      create: { id: d.id, ...data },
      update: data,
    });
  }

  async getDeliverable(id: string): Promise<Deliverable | null> {
    const row = await this.prisma.deliverable.findUnique({ where: { id } });
    return row ? toDeliverable(row) : null;
  }

  async getDeliverableByPayment(paymentId: string): Promise<Deliverable | null> {
    const row = await this.prisma.deliverable.findUnique({
      where: { paymentId },
    });
    return row ? toDeliverable(row) : null;
  }

  /**
   * Transition atomique : l'`UPDATE` conditionnel et l'écriture du journal
   * forment une seule transaction. Le perdant d'une course (`count === 0`)
   * ne laisse aucune trace.
   */
  async transition(
    id: string,
    from: State,
    to: State,
    meta: TransitionMeta,
  ): Promise<boolean> {
    const at = new Date();

    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.deliverable.updateMany({
        where: { id, state: from },
        data: { state: to, updatedAt: at },
      });

      if (count !== 1) return false;

      await tx.journalEntry.create({
        data: {
          deliverableId: id,
          from,
          to,
          at,
          cause: meta.cause,
          eventId: meta.eventId ?? null,
          paymentId: meta.paymentId ?? null,
        },
      });

      return true;
    });
  }

  async recordEvent(e: EventRecord): Promise<boolean> {
    try {
      await this.prisma.paymentEvent.create({
        data: {
          id: e.id,
          type: e.type,
          paymentId: e.paymentId,
          receivedAt: asDate(e.receivedAt),
          ...(e.payload === undefined
            ? {}
            : { payload: toJsonInput(e.payload) }),
        },
      });
      return true;
    } catch (error) {
      // Doublon : la contrainte unique a fait son travail.
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  async appendJournal(entry: JournalEntry): Promise<void> {
    await this.prisma.journalEntry.create({
      data: {
        deliverableId: entry.deliverableId,
        from: entry.from,
        to: entry.to,
        at: asDate(entry.at),
        cause: entry.cause,
        eventId: entry.eventId ?? null,
        paymentId: entry.paymentId ?? null,
      },
    });
  }

  async listJournal(deliverableId: string): Promise<JournalEntry[]> {
    const rows = await this.prisma.journalEntry.findMany({
      where: { deliverableId },
      orderBy: [{ at: "asc" }, { id: "asc" }],
    });
    return rows.map(toJournalEntry);
  }
}

/**
 * Fabrique l'adaptateur. Sans argument, un `PrismaClient` est créé à partir de
 * `DATABASE_URL` ; passer un client existant permet de partager la connexion
 * (et de la fermer) avec l'application hôte.
 */
export function createPrismaStorage(
  prisma: PrismaClient = new PrismaClient(),
): PrismaStorage {
  return new PrismaStorage(prisma);
}
