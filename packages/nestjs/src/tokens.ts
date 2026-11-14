/**
 * Jetons d'injection Nest.
 *
 * Le module s'appuie volontairement sur des jetons explicites (`@Inject(...)`)
 * plutôt que sur `emitDecoratorMetadata` : esbuild — donc Vitest — n'émet pas
 * cette métadonnée, et un module qui ne fonctionne qu'après compilation `tsc`
 * serait impossible à tester.
 */

/** Options normalisées du module (`ResolvedPreviewPayOptions`). */
export const PREVIEWPAY_OPTIONS = Symbol("PREVIEWPAY_OPTIONS");

/** Instance de `PreviewPay`, le moteur du cœur. */
export const PREVIEWPAY_ENGINE = Symbol("PREVIEWPAY_ENGINE");
