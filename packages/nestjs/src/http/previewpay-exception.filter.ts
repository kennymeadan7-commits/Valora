import type { ExceptionFilter, ArgumentsHost } from "@nestjs/common";
import { Catch, HttpException } from "@nestjs/common";
import {
  ConflictError,
  DeliverableNotFoundError,
  InvalidSignatureError,
  InvalidTransitionError,
  PaymentRequiredError,
  PreviewPayError,
} from "@previewpay/core";

/** Réponse HTTP minimale : évite de dépendre des types Express. */
interface HttpResponseLike {
  status(code: number): HttpResponseLike;
  json(body: unknown): unknown;
}

export interface MappedError {
  statusCode: number;
  code: string;
  message: string;
}

/**
 * Correspondance erreurs du cœur → codes HTTP.
 *
 * | Erreur du cœur | HTTP |
 * | --- | --- |
 * | `DeliverableNotFoundError` | 404 |
 * | `InvalidTransitionError`, `ConflictError` | 409 |
 * | `PaymentRequiredError` | 402 |
 * | `InvalidSignatureError` | 400 |
 * | toute autre erreur | 500 |
 *
 * `MissingPriceError` tombe donc dans le 500 : c'est un défaut de
 * configuration du serveur (grille `pricing` incomplète), pas une faute du
 * client.
 */
export function mapPreviewPayError(exception: unknown): MappedError {
  if (exception instanceof DeliverableNotFoundError) {
    return {
      statusCode: 404,
      code: exception.code,
      message: exception.message,
    };
  }
  if (
    exception instanceof InvalidTransitionError ||
    exception instanceof ConflictError
  ) {
    return {
      statusCode: 409,
      code: exception.code,
      message: exception.message,
    };
  }
  if (exception instanceof PaymentRequiredError) {
    return {
      statusCode: 402,
      code: exception.code,
      message: exception.message,
    };
  }
  if (exception instanceof InvalidSignatureError) {
    return {
      statusCode: 400,
      code: exception.code,
      message: exception.message,
    };
  }
  if (exception instanceof PreviewPayError) {
    // Erreur du cœur non listée : défaut serveur, message en français conservé.
    return {
      statusCode: 500,
      code: exception.code,
      message: exception.message,
    };
  }
  return {
    statusCode: 500,
    code: "INTERNAL_ERROR",
    message: "Erreur interne du serveur",
  };
}

/**
 * Filtre global installé par le module : traduit les erreurs du cœur en codes
 * HTTP stables, et laisse passer les `HttpException` de Nest telles quelles.
 */
@Catch()
export class PreviewPayExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<HttpResponseLike>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const body =
        typeof payload === "string"
          ? { statusCode: status, message: payload }
          : (payload as Record<string, unknown>);
      response.status(status).json(body);
      return;
    }

    const mapped = mapPreviewPayError(exception);
    response.status(mapped.statusCode).json({
      statusCode: mapped.statusCode,
      code: mapped.code,
      message: mapped.message,
    });
  }
}
