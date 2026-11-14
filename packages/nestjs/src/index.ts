// Nest lit ses métadonnées de décorateurs via `Reflect` : le polyfill doit être
// chargé avant tout décorateur du paquet.
import "reflect-metadata";

export { PreviewPayModule } from "./previewpay.module.js";
export { DeliverablesController } from "./deliverables.controller.js";
export { WebhooksController } from "./webhooks.controller.js";
export { InternalKeyGuard } from "./http/internal-key.guard.js";
export type { HttpRequestLike } from "./http/internal-key.guard.js";
export { RateLimitGuard } from "./http/rate-limit.guard.js";
export {
  PreviewPayExceptionFilter,
  mapPreviewPayError,
} from "./http/previewpay-exception.filter.js";
export type { MappedError } from "./http/previewpay-exception.filter.js";
export { normalizeHeaders } from "./http/headers.js";
export {
  parseCreateInput,
  parsePayInput,
  parseRejectInput,
} from "./http/parse.js";
export { DEFAULT_RATE_LIMIT, resolveOptions } from "./options.js";
export type {
  PreviewPayModuleOptions,
  RateLimitOptions,
  ResolvedPreviewPayOptions,
} from "./options.js";
export { PREVIEWPAY_ENGINE, PREVIEWPAY_OPTIONS } from "./tokens.js";

// Ré-exports des erreurs du cœur : l'hôte n'a pas à dépendre de deux paquets
// pour attraper ce que l'API renvoie.
export {
  ConflictError,
  DeliverableNotFoundError,
  InvalidSignatureError,
  InvalidTransitionError,
  PaymentRequiredError,
  PreviewLimitError,
  PreviewPayError,
} from "@previewpay/core";
export type {
  PreviewPay,
  PreviewPayLimits,
  PublicDeliverable,
  WebhookOutcome,
} from "@previewpay/core";
