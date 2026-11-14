import {
  ConflictError,
  DeliverableNotFoundError,
  InvalidSignatureError,
  InvalidTransitionError,
  PaymentRequiredError,
  PreviewLimitError,
  PreviewPayError,
} from "@previewpay/core";

/** Erreur HTTP déjà formée par le routeur (validation, clé, débit). */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface HttpErrorBody {
  statusCode: number;
  code: string;
  message: string;
}

/**
 * Erreurs du cœur → HTTP. Même table que `@previewpay/nestjs`, pour qu'un
 * client (dont `@previewpay/react`) se comporte à l'identique quel que soit
 * le serveur.
 *
 * | Erreur | HTTP |
 * | --- | --- |
 * | `DeliverableNotFoundError` | 404 |
 * | `InvalidTransitionError`, `ConflictError` | 409 |
 * | `PaymentRequiredError` | 402 |
 * | `InvalidSignatureError` | 400 |
 * | `PreviewLimitError` | 429 (+ `Retry-After`) |
 * | autre erreur du cœur | 500 (code conservé) |
 * | erreur inattendue | 500 `INTERNAL_ERROR` |
 */
export function toHttpError(error: unknown): HttpErrorBody & { retryAfterSeconds?: number } {
  const body = (statusCode: number, e: PreviewPayError | HttpError) => ({
    statusCode,
    code: e.code,
    message: e.message,
  });

  if (error instanceof HttpError) {
    return {
      ...body(error.statusCode, error),
      ...(error.retryAfterSeconds !== undefined ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
    };
  }
  if (error instanceof DeliverableNotFoundError) return body(404, error);
  if (error instanceof InvalidTransitionError || error instanceof ConflictError) {
    return body(409, error);
  }
  if (error instanceof PaymentRequiredError) return body(402, error);
  if (error instanceof InvalidSignatureError) return body(400, error);
  if (error instanceof PreviewLimitError) {
    return {
      ...body(429, error),
      retryAfterSeconds: Math.max(1, Math.ceil((error.retryAt.getTime() - Date.now()) / 1000)),
    };
  }
  if (error instanceof PreviewPayError) return body(500, error);
  return { statusCode: 500, code: "INTERNAL_ERROR", message: "Erreur interne du serveur" };
}
