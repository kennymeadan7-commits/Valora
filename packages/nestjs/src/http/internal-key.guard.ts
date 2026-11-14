import { timingSafeEqual } from "node:crypto";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { PREVIEWPAY_OPTIONS } from "../tokens.js";
import type { ResolvedPreviewPayOptions } from "../options.js";

/** Requête HTTP minimale : évite de dépendre des types Express. */
export interface HttpRequestLike {
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  params?: Record<string, string>;
}

/**
 * Garde de `POST /deliverables` : le livrable est créé par le serveur de
 * l'intégrateur, jamais depuis le navigateur du payeur.
 *
 * Désactivée quand `internalApiKey` n'est pas configurée (développement
 * local uniquement). Comparaison à temps constant.
 */
@Injectable()
export class InternalKeyGuard implements CanActivate {
  constructor(
    @Inject(PREVIEWPAY_OPTIONS)
    private readonly options: ResolvedPreviewPayOptions,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.options.internalApiKey;
    if (!expected) return true;

    const request = context.switchToHttp().getRequest<HttpRequestLike>();
    const header = request.headers?.["x-internal-key"];
    const given = Array.isArray(header) ? header[0] : header;

    if (!given || !safeEqual(given, expected)) {
      throw new HttpException(
        {
          statusCode: HttpStatus.UNAUTHORIZED,
          code: "INVALID_INTERNAL_KEY",
          message:
            "Clé interne absente ou invalide : POST /deliverables est réservé au serveur de l'intégrateur",
        },
        HttpStatus.UNAUTHORIZED,
      );
    }
    return true;
  }
}

/** Comparaison à temps constant, tolérante aux longueurs différentes. */
function safeEqual(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
