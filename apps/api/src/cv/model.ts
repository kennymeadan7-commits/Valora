/**
 * Modèle de données du CV de démonstration.
 *
 * C'est la forme unique qui circule entre l'import PDF (`extract.ts`), le
 * formulaire du front, la génération (`render.ts`) et la stratégie d'aperçu
 * (`preview.ts`). Toute entrée HTTP passe par `normalizeCvInput` : longueurs
 * bornées, listes plafonnées, aucune valeur inattendue ne va jusqu'au rendu.
 */

export const CV_THEMES = ["emeraude", "indigo", "ardoise", "terracotta"] as const;
export type CvTheme = (typeof CV_THEMES)[number];
export const DEFAULT_THEME: CvTheme = "emeraude";

export interface CvExperience {
  role: string;
  company: string;
  period: string;
  location?: string;
  highlights: string[];
}

export interface CvEducation {
  diploma: string;
  school: string;
  year: string;
}

export interface CvLanguage {
  name: string;
  level?: string;
}

export interface CvData {
  fullName: string;
  headline: string;
  email?: string;
  phone?: string;
  city?: string;
  website?: string;
  summary?: string;
  skills: string[];
  languages: CvLanguage[];
  experiences: CvExperience[];
  education: CvEducation[];
  interests: string[];
  theme: CvTheme;
}

/**
 * Contenu stocké dans le livrable (`Deliverable.content`, colonne JSON).
 * Le HTML est recalculé à la lecture : une amélioration du gabarit profite
 * aussi aux CV déjà payés.
 */
export interface CvContent {
  format: "cv/v1";
  data: CvData;
}

export function isCvContent(value: unknown): value is CvContent {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { format?: unknown }).format === "cv/v1" &&
    typeof (value as { data?: unknown }).data === "object"
  );
}

/** Erreur de validation lisible, traduite en 400 par le contrôleur. */
export class CvValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CvValidationError";
  }
}

const LIMITS = {
  short: 120,
  long: 1_200,
  highlight: 300,
  skills: 30,
  languages: 10,
  experiences: 10,
  highlights: 8,
  education: 8,
  interests: 12,
} as const;

function str(value: unknown, max: number = LIMITS.short): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).replace(/\s+/g, " ").trim().slice(0, max);
}

/** Texte long : on garde les retours à la ligne simples, on écrase le reste. */
function text(value: unknown, max: number = LIMITS.long): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "")
    .join("\n")
    .slice(0, max);
}

/** `{ key: value }` si la valeur est non vide, `{}` sinon (exactOptionalPropertyTypes). */
function optional<K extends string>(key: K, value: string): Partial<Record<K, string>> {
  return (value === "" ? {} : { [key]: value }) as Partial<Record<K, string>>;
}

/** Accepte un tableau ou une chaîne « a, b ; c » et déduplique sans casse. */
export function toList(value: unknown, max: number, itemMax = 60): string[] {
  const raw: unknown[] = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,;\n]/)
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const clean = str(item, itemMax);
    if (clean === "") continue;
    const key = clean.toLocaleLowerCase("fr");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= max) break;
  }
  return out;
}

function arrayOf(value: unknown, max: number): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .slice(0, max);
}

function languages(value: unknown): CvLanguage[] {
  // Forme libre « Français : courant, Anglais (B2) » acceptée en plus des objets.
  const items: unknown[] = typeof value === "string" ? value.split(/[,;\n]/) : Array.isArray(value) ? value : [];
  const out: CvLanguage[] = [];
  for (const item of items) {
    if (typeof item === "string") {
      const match = /^\s*([^:(\-–]+?)\s*(?:[:\-–]\s*|\(\s*)([^)]*)\)?\s*$/.exec(item);
      const name = str(match ? match[1] : item, 40);
      const level = str(match ? match[2] : "", 40);
      if (name !== "") out.push(level === "" ? { name } : { name, level });
    } else if (typeof item === "object" && item !== null) {
      const record = item as Record<string, unknown>;
      const name = str(record["name"], 40);
      const level = str(record["level"], 40);
      if (name !== "") out.push(level === "" ? { name } : { name, level });
    }
    if (out.length >= LIMITS.languages) break;
  }
  return out;
}

/**
 * Valide et nettoie le corps de `POST /demo/cv`. Seuls `fullName` et
 * `headline` sont obligatoires ; les sections vides disparaissent du rendu
 * au lieu d'être comblées par du contenu inventé.
 */
export function normalizeCvInput(body: unknown): CvData {
  const input = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;

  const fullName = str(input["fullName"], 80);
  const headline = str(input["headline"], 120);
  if (fullName === "" || headline === "") {
    throw new CvValidationError("`fullName` et `headline` sont requis pour générer un CV");
  }

  const theme = CV_THEMES.includes(input["theme"] as CvTheme)
    ? (input["theme"] as CvTheme)
    : DEFAULT_THEME;

  const experiences: CvExperience[] = arrayOf(input["experiences"], LIMITS.experiences)
    .map((e) => ({
      role: str(e["role"]),
      company: str(e["company"]),
      period: str(e["period"], 60),
      ...optional("location", str(e["location"], 60)),
      highlights: (Array.isArray(e["highlights"])
        ? e["highlights"]
        : typeof e["highlights"] === "string"
          ? (e["highlights"] as string).split("\n")
          : []
      )
        .map((h) => str(h, LIMITS.highlight).replace(/^[•\-–▪*●◦►✓]\s*/, ""))
        .filter((h) => h !== "")
        .slice(0, LIMITS.highlights),
    }))
    .filter((e) => e.role !== "" || e.company !== "");

  const education: CvEducation[] = arrayOf(input["education"], LIMITS.education)
    .map((e) => ({
      diploma: str(e["diploma"]),
      school: str(e["school"]),
      year: str(e["year"], 40),
    }))
    .filter((e) => e.diploma !== "" || e.school !== "");

  return {
    fullName,
    headline,
    ...optional("email", str(input["email"], 120)),
    ...optional("phone", str(input["phone"], 40)),
    ...optional("city", str(input["city"], 80)),
    ...optional("website", str(input["website"], 120)),
    ...optional("summary", text(input["summary"])),
    skills: toList(input["skills"], LIMITS.skills),
    languages: languages(input["languages"]),
    experiences,
    education,
    interests: toList(input["interests"], LIMITS.interests),
    theme,
  };
}

/**
 * Accroche « IA » quand la personne n'a pas rédigé de profil : construite
 * uniquement à partir de ses propres données, jamais d'invention de chiffres.
 */
export function composeSummary(data: CvData): string {
  if (data.summary) return data.summary;
  const parts: string[] = [`${data.headline}`];
  const years = estimateYears(data.experiences);
  if (years !== null && years > 0) {
    parts[0] += ` avec ${years} an${years > 1 ? "s" : ""} d'expérience`;
  }
  const top = data.skills.slice(0, 3);
  let sentence = `${parts[0]}.`;
  if (top.length > 0) {
    sentence += ` Points forts : ${top.join(", ").toLocaleLowerCase("fr")}.`;
  }
  const last = data.experiences[0];
  if (last?.company) {
    sentence += ` Dernière expérience chez ${last.company}${last.role ? ` en tant que ${last.role.toLocaleLowerCase("fr")}` : ""}.`;
  }
  sentence += " Rigueur, sens du résultat et goût du travail bien livré.";
  return sentence;
}

/** Années couvertes par les périodes « 2019 — 2023 », « 2021 – aujourd'hui »… */
export function estimateYears(experiences: CvExperience[], now = new Date()): number | null {
  let min = Infinity;
  let max = -Infinity;
  for (const e of experiences) {
    const years = (e.period.match(/\b(19|20)\d{2}\b/g) ?? []).map(Number);
    if (/aujourd|présent|present|actuel|en cours|now/i.test(e.period)) {
      years.push(now.getFullYear());
    }
    for (const y of years) {
      min = Math.min(min, y);
      max = Math.max(max, y);
    }
  }
  if (!Number.isFinite(min)) return null;
  return Math.max(0, max - min);
}
