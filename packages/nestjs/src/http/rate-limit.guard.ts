import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { PREVIEWPAY_OPTIONS } from "../tokens.js";
import type { ResolvedPreviewPayOptions } from "../options.js";
import type { HttpRequestLike } from "./internal-key.guard.js";

const MAX_TRACKED_KEYS = 1_000;

/**
 * Limitation de débit sur `POST /deliverables/:id/pay` : fenêtre glissante en
 * mémoire, par couple (IP, livrable). Volontairement simple — un déploiement
 * multi-instances doit la remplacer par un limiteur partagé (Redis) ; les
 * tests et la démo locale n'ont pas besoin de plus.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, number[]>();

  constructor(
    @Inject(PREVIEWPAY_OPTIONS)
    private readonly options: ResolvedPreviewPayOptions,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const limit = this.options.rateLimit;
    if (!limit) return true;

    const request = context.switchToHttp().getRequest<HttpRequestLike>();
    const key = `${request.ip ?? "inconnu"}|${request.params?.["id"] ?? ""}`;
    const now = Date.now();
    const windowStart = now - limit.windowMs;

    const recent = (this.hits.get(key) ?? []).filter((at) => at > windowStart);
    if (recent.length >= limit.max) {
      this.hits.set(key, recent);
      const oldest = recent[0] ?? now;
      const retryAfter = Math.max(
        1,
        Math.ceil((oldest + limit.windowMs - now) / 1000),
      );
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          code: "RATE_LIMITED",
          message:
            "Trop de tentatives de paiement : réessayez dans quelques instants",
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > MAX_TRACKED_KEYS) this.prune(windowStart);
    return true;
  }

  private prune(windowStart: number): void {
    for (const [key, at] of this.hits) {
      if (at.every((t) => t <= windowStart)) this.hits.delete(key);
    }
  }
}
