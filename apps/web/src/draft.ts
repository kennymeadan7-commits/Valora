import type { CreateCvInput, CvImportResult, CvTheme } from "./api.js";

/**
 * État du formulaire CV côté navigateur. Les listes libres (compétences,
 * langues, réalisations) restent du texte tant qu'on édite ; la conversion en
 * structure se fait au moment d'envoyer (`toPayload`). Le serveur revalide
 * tout (`normalizeCvInput`) : rien ici n'est une règle métier.
 */

export interface ExperienceDraft {
  key: string;
  role: string;
  company: string;
  period: string;
  location: string;
  /** Une réalisation par ligne. */
  highlights: string;
}

export interface EducationDraft {
  key: string;
  diploma: string;
  school: string;
  year: string;
}

export interface CvDraft {
  fullName: string;
  headline: string;
  email: string;
  phone: string;
  city: string;
  website: string;
  summary: string;
  /** « a, b, c ». */
  skills: string;
  /** « Français : courant, Anglais : intermédiaire ». */
  languages: string;
  interests: string;
  experiences: ExperienceDraft[];
  education: EducationDraft[];
  theme: CvTheme;
}

export const THEMES: ReadonlyArray<{ value: CvTheme; label: string; color: string }> = [
  { value: "emeraude", label: "Émeraude", color: "#0f766e" },
  { value: "indigo", label: "Indigo", color: "#4338ca" },
  { value: "ardoise", label: "Ardoise", color: "#334155" },
  { value: "terracotta", label: "Terracotta", color: "#b4440f" },
];

let seq = 0;
export function newKey(): string {
  seq += 1;
  return `k${Date.now().toString(36)}${seq}`;
}

export function emptyExperience(): ExperienceDraft {
  return { key: newKey(), role: "", company: "", period: "", location: "", highlights: "" };
}

export function emptyEducation(): EducationDraft {
  return { key: newKey(), diploma: "", school: "", year: "" };
}

export const EMPTY_DRAFT: CvDraft = {
  fullName: "",
  headline: "",
  email: "",
  phone: "",
  city: "",
  website: "",
  summary: "",
  skills: "",
  languages: "",
  interests: "",
  experiences: [],
  education: [],
  theme: "emeraude",
};

/** Exemple complet pour essayer la démo en un clic. */
export function sampleDraft(): CvDraft {
  return {
    fullName: "Awa Houngbédji",
    headline: "Chargée de communication digitale",
    email: "awa.houngbedji@example.com",
    phone: "+229 97 00 00 01",
    city: "Cotonou, Bénin",
    website: "linkedin.com/in/awa-houngbedji",
    summary: "",
    skills: "Réseaux sociaux, Rédaction web, Canva, Événementiel, Relations presse, Google Analytics",
    languages: "Français : courant, Anglais : professionnel, Fon : langue maternelle",
    interests: "Photographie, Danse, Bénévolat",
    experiences: [
      {
        key: newKey(),
        role: "Chargée de communication",
        company: "ONG Lumière d'Afrique",
        period: "2022 — aujourd'hui",
        location: "Cotonou",
        highlights:
          "Hausse de 40 % de l'audience Facebook en un an\nOrganisation de 6 événements de levée de fonds\nRédaction de la newsletter mensuelle (3 500 abonnés)",
      },
      {
        key: newKey(),
        role: "Assistante marketing",
        company: "Agence Kpayo",
        period: "2020 — 2022",
        location: "Abomey-Calavi",
        highlights: "Gestion des comptes de 8 clients PME\nProduction de visuels et vidéos courtes",
      },
    ],
    education: [
      { key: newKey(), diploma: "Licence en Communication", school: "Université d'Abomey-Calavi", year: "2020" },
    ],
    theme: "emeraude",
  };
}

function list(raw: string): string[] {
  return raw
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

function opt<K extends string>(key: K, value: string): Partial<Record<K, string>> {
  const v = value.trim();
  return (v === "" ? {} : { [key]: v }) as Partial<Record<K, string>>;
}

export function toPayload(draft: CvDraft): CreateCvInput {
  return {
    fullName: draft.fullName.trim(),
    headline: draft.headline.trim(),
    ...opt("email", draft.email),
    ...opt("phone", draft.phone),
    ...opt("city", draft.city),
    ...opt("website", draft.website),
    ...opt("summary", draft.summary),
    skills: list(draft.skills),
    languages: list(draft.languages).map((item) => {
      const [name = "", ...rest] = item.split(/\s*[:(]\s*/);
      const level = rest.join(" ").replace(/\)$/, "").trim();
      return level ? { name: name.trim(), level } : { name: name.trim() };
    }),
    interests: list(draft.interests),
    experiences: draft.experiences
      .filter((e) => e.role.trim() !== "" || e.company.trim() !== "")
      .map((e) => ({
        role: e.role.trim(),
        company: e.company.trim(),
        period: e.period.trim(),
        ...opt("location", e.location),
        highlights: e.highlights
          .split("\n")
          .map((h) => h.trim())
          .filter((h) => h !== ""),
      })),
    education: draft.education
      .filter((e) => e.diploma.trim() !== "" || e.school.trim() !== "")
      .map((e) => ({ diploma: e.diploma.trim(), school: e.school.trim(), year: e.year.trim() })),
    theme: draft.theme,
  };
}

/**
 * Fusionne les champs extraits d'un PDF dans le brouillon : une valeur trouvée
 * remplace la saisie, un champ non trouvé laisse la saisie en place.
 */
export function mergeImport(draft: CvDraft, result: CvImportResult): CvDraft {
  const f = result.fields;
  const pick = (found: string, current: string) => (found.trim() !== "" ? found : current);
  return {
    ...draft,
    fullName: pick(f.fullName, draft.fullName),
    headline: pick(f.headline, draft.headline),
    email: pick(f.email, draft.email),
    phone: pick(f.phone, draft.phone),
    city: pick(f.city, draft.city),
    website: pick(f.website, draft.website),
    summary: pick(f.summary, draft.summary),
    skills: f.skills.length > 0 ? f.skills.join(", ") : draft.skills,
    languages:
      f.languages.length > 0
        ? f.languages.map((l) => (l.level ? `${l.name} : ${l.level}` : l.name)).join(", ")
        : draft.languages,
    interests: f.interests.length > 0 ? f.interests.join(", ") : draft.interests,
    experiences:
      f.experiences.length > 0
        ? f.experiences.map((e) => ({
            key: newKey(),
            role: e.role,
            company: e.company,
            period: e.period,
            location: e.location ?? "",
            highlights: e.highlights.join("\n"),
          }))
        : draft.experiences,
    education:
      f.education.length > 0
        ? f.education.map((e) => ({ key: newKey(), ...e }))
        : draft.education,
  };
}

const STORAGE_KEY = "previewpay-demo:cv-draft";

/** Brouillon mémorisé dans ce navigateur (confort uniquement). */
export function loadDraft(): CvDraft {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_DRAFT;
    const parsed = JSON.parse(raw) as Partial<CvDraft>;
    return {
      ...EMPTY_DRAFT,
      ...parsed,
      experiences: Array.isArray(parsed.experiences) ? parsed.experiences : [],
      education: Array.isArray(parsed.education) ? parsed.education : [],
    };
  } catch {
    return EMPTY_DRAFT;
  }
}

export function saveDraft(draft: CvDraft): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Stockage indisponible (navigation privée) : sans conséquence.
  }
}

export function clearDraft(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // idem
  }
}

/** Libellés des champs détectés à l'import. */
export const FIELD_LABELS: Readonly<Record<string, string>> = {
  fullName: "nom",
  headline: "titre",
  email: "email",
  phone: "téléphone",
  city: "ville",
  website: "site / LinkedIn",
  summary: "profil",
  skills: "compétences",
  languages: "langues",
  experiences: "expériences",
  education: "formation",
  interests: "centres d'intérêt",
};
