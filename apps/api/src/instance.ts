import { loadConfig } from "./config.js";

/**
 * Instance unique de configuration, isolée dans son propre module pour éviter
 * un cycle d'import entre `app.module` et les contrôleurs.
 */
export const config = loadConfig();
