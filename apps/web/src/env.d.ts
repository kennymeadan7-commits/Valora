/**
 * Déclarations minimales des variables d'environnement Vite.
 * Aucun secret de paiement ne doit jamais y figurer : tout ce préfixé
 * `VITE_` est embarqué dans le bundle client.
 */
interface ImportMetaEnv {
  /** Clé interne du pilotage `/demo/simulate` (fournisseur `mock`). */
  readonly VITE_DEMO_INTERNAL_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
