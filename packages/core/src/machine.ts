/**
 * Machine à états du livrable : cinq états, transitions explicites.
 *
 *   draft ──> previewed ──pay──> payment_pending ──approved──> unlocked
 *                │                     │
 *             reject          declined / canceled / expired
 *                │                     │
 *                v                     └──> previewed (relançable)
 *            rejected
 *
 * `rejected` et `unlocked` sont terminaux. `expired` n'est pas un état du
 * livrable mais un statut d'essai de paiement (voir docs/DECISIONS.md).
 */

export const STATES = [
  "draft",
  "previewed",
  "payment_pending",
  "unlocked",
  "rejected",
] as const;

export type State = (typeof STATES)[number];

const TRANSITIONS: Readonly<Record<State, readonly State[]>> = {
  draft: ["previewed", "rejected"],
  previewed: ["payment_pending", "rejected"],
  payment_pending: ["unlocked", "previewed"],
  unlocked: [],
  rejected: [],
};

export function canTransition(from: State, to: State): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(state: State): boolean {
  return TRANSITIONS[state].length === 0;
}

export const TERMINAL_STATES: readonly State[] = STATES.filter(isTerminal);
