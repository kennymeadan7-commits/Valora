export class PreviewPayError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class DeliverableNotFoundError extends PreviewPayError {
  constructor(id: string) {
    super(`Livrable introuvable : ${id}`, "DELIVERABLE_NOT_FOUND");
  }
}

export class InvalidTransitionError extends PreviewPayError {
  constructor(
    readonly from: string,
    readonly to: string,
  ) {
    super(`Transition interdite : ${from} -> ${to}`, "INVALID_TRANSITION");
  }
}

export class ConflictError extends PreviewPayError {
  constructor(message: string) {
    super(message, "CONFLICT");
  }
}

export class PaymentRequiredError extends PreviewPayError {
  constructor() {
    super(
      "Le livrable n'est pas débloqué : paiement confirmé requis",
      "PAYMENT_REQUIRED",
    );
  }
}

export class InvalidSignatureError extends PreviewPayError {
  constructor() {
    super("Signature de webhook invalide", "INVALID_SIGNATURE");
  }
}

export class MissingPriceError extends PreviewPayError {
  constructor(type: string) {
    super(`Aucun prix configuré pour le type « ${type} »`, "MISSING_PRICE");
  }
}

/**
 * Limite d'aperçus gratuits atteinte pour cet utilisateur sur la fenêtre
 * glissante de 24 h. `retryAt` est une borne haute : au plus tard à cette
 * date, un nouvel aperçu redevient possible (souvent plus tôt).
 */
export class PreviewLimitError extends PreviewPayError {
  constructor(
    readonly limit: number,
    readonly retryAt: Date,
  ) {
    super(
      `Limite de ${limit} aperçu${limit > 1 ? "s" : ""} gratuit${limit > 1 ? "s" : ""} par 24 h atteinte`,
      "PREVIEW_LIMIT_REACHED",
    );
  }
}
