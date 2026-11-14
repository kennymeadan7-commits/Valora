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
