import type { CvEducation, CvExperience, CvLanguage } from "./model.js";

/**
 * Analyse heuristique d'un CV déjà converti en lignes de texte.
 *
 * Volontairement déterministe et hors ligne (aucun appel à un LLM) : la
 * personne relit et corrige le formulaire pré-rempli avant de générer. Le but
 * est de lui éviter la saisie, pas de deviner parfaitement.
 */

export interface ExtractedCv {
  fullName: string;
  headline: string;
  email: string;
  phone: string;
  city: string;
  website: string;
  summary: string;
  skills: string[];
  languages: CvLanguage[];
  experiences: CvExperience[];
  education: CvEducation[];
  interests: string[];
}

export interface ExtractionReport {
  fields: ExtractedCv;
  /** Champs effectivement trouvés, pour le bandeau « 9 champs détectés ». */
  found: string[];
  lines: number;
}

type Section =
  | "header"
  | "summary"
  | "experience"
  | "education"
  | "skills"
  | "languages"
  | "interests"
  | "other";

const HEADINGS: Array<[Section, RegExp]> = [
  ["summary", /^(profil(\s+professionnel)?|r[ée]sum[ée]|[àa] propos(\s+de\s+moi)?|about(\s+me)?|summary|profile|objectif(\s+professionnel)?|pr[ée]sentation)$/i],
  ["experience", /^(exp[ée]riences?(\s+professionnelles?)?|parcours(\s+professionnel)?|emplois?|work\s+(experience|history)|experience|professional\s+experience|employment)$/i],
  ["education", /^(formations?(\s+acad[ée]miques?)?|[ée]ducation|[ée]tudes|dipl[ôo]mes?(\s+et\s+formations?)?|cursus|education|academic\s+background|parcours\s+acad[ée]mique)$/i],
  ["skills", /^(comp[ée]tences?(\s+(cl[ée]s|techniques|professionnelles))?|skills|technical\s+skills|savoir[- ]faire|outils|technologies|aptitudes|expertises?|informatique|logiciels)$/i],
  ["languages", /^(langues?(\s+parl[ée]es)?|languages?)$/i],
  ["interests", /^(centres?\s+d'?int[ée]r[êe]ts?|int[ée]r[êe]ts|loisirs|hobbies|interests|activit[ée]s\s+extra[- ]?professionnelles)$/i],
  ["other", /^(certifications?|projets?|projects|r[ée]f[ée]rences?|publications?|b[ée]n[ée]volat|volunteering|associatif|distinctions?|prix|awards|informations?\s+compl[ée]mentaires|divers)$/i],
];

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;
const PHONE = /(\+\d{1,3}[\s.-]?)?(\(?\d{1,3}\)?[\s.-]?)?\d{2}([\s.-]?\d{2}){3,4}/;
const URL_RE = /\b((https?:\/\/)?(www\.)?(linkedin\.com|github\.com|[\w-]+\.(com|dev|io|me|net|org|bj|tg|sn|ci|fr))(\/[^\s]*)?)/i;
const BULLET = /^[•\-–—▪*●◦►✓➢❖·]\s*/;

const MONTHS = "janv(?:ier)?|f[ée]vr?(?:ier)?|mars|avr(?:il)?|mai|juin|juil(?:let)?|ao[uû]t|sept?(?:embre)?|oct(?:obre)?|nov(?:embre)?|d[ée]c(?:embre)?|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:tember)?|october|november|dec(?:ember)?";
const DATE = `(?:(?:${MONTHS})\\.?\\s+|\\d{1,2}[/.-])?(?:19|20)\\d{2}`;
const NOW = "aujourd'?hui|aujourd’hui|pr[ée]sent|present|actuel(?:lement)?|en cours|now|ce jour|current";
const PERIOD = new RegExp(
  `(?:depuis\\s+)?${DATE}(?:\\s*(?:[-–—]|à|a|au|to|>)\\s*(?:${DATE}|${NOW}))?`,
  "i",
);

const CITIES = /\b(cotonou|porto[- ]novo|parakou|abomey[- ]calavi|calavi|bohicon|natitingou|ouidah|lokossa|djougou|lom[ée]|kara|dakar|thi[èe]s|abidjan|bouak[ée]|yamoussoukro|ouagadougou|bobo[- ]dioulasso|bamako|niamey|conakry|douala|yaound[ée]|libreville|kinshasa|brazzaville|paris|lyon|marseille|bruxelles|montr[ée]al|accra|lagos|n'?djamena|nouakchott)\b/i;
const COUNTRIES = /\b(b[ée]nin|togo|s[ée]n[ée]gal|c[ôo]te d'ivoire|burkina faso|mali|niger|guin[ée]e|cameroun|gabon|congo|france|belgique|canada|ghana|nigeria|tchad|mauritanie)\b/i;

const LEVEL_WORDS = /\b(maternelle|natif|native|courant|bilingue|fluent|interm[ée]diaire|d[ée]butant|notions?|scolaire|professionnel|avanc[ée]|lu,? [ée]crit,? parl[ée]|bon niveau|[abc][12])\b/i;
const DIPLOMA_WORDS = /\b(licence|master|bac(calaur[ée]at)?|bts|dut|but|doctorat|phd|dipl[ôo]me|certificat|ing[ée]nieur|bachelor|mba|cap|bep|dts|cep|bepc|maîtrise|maitrise|deug|dea|dess|attestation|mast[eè]re)\b/i;
const SCHOOL_WORDS = /\b(universit[ée]|[ée]cole|institut|lyc[ée]e|coll[èe]ge|facult[ée]|campus|academy|acad[ée]mie|school|university|ensea|esgis|hecm|uac|ifri|epac|iut|cnam)\b/i;

function headingOf(line: string): Section | null {
  const clean = line
    .replace(BULLET, "")
    .replace(/[:：|•]+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length < 3 || clean.length > 45) return null;
  for (const [section, re] of HEADINGS) {
    if (re.test(clean)) return section;
  }
  return null;
}

function isContactish(line: string): boolean {
  return EMAIL.test(line) || PHONE.test(line) || URL_RE.test(line);
}

/** Une ligne qui ressemble à un nom : 2 à 5 mots, lettres seulement. */
function looksLikeName(line: string): boolean {
  if (line.length < 4 || line.length > 48) return false;
  if (/\d|@|:|\//.test(line)) return false;
  const words = line.split(/\s+/);
  if (words.length < 2 || words.length > 5) return false;
  if (headingOf(line)) return false;
  return words.every((w) => /^[\p{L}][\p{L}'’.-]*$/u.test(w));
}

function titleCaseIfShouting(value: string): string {
  if (value !== value.toLocaleUpperCase("fr") || !/\p{L}{2}/u.test(value)) return value;
  return value
    .toLocaleLowerCase("fr")
    .replace(/(^|[\s'’-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toLocaleUpperCase("fr"));
}

function splitList(lines: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    for (const raw of line.split(/\s*[,;•|·▪●]\s*|\s{2,}|\s[-–]\s/)) {
      const item = raw.replace(BULLET, "").replace(/[.:]$/, "").trim();
      if (item.length < 2 || item.length > 45) continue;
      const key = item.toLocaleLowerCase("fr");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

function parseLanguages(lines: string[]): CvLanguage[] {
  const out: CvLanguage[] = [];
  for (const line of lines) {
    for (const chunk of line.split(/\s*[,;•|·]\s*/)) {
      const clean = chunk.replace(BULLET, "").trim();
      if (clean === "") continue;
      const m = /^([\p{L}'’ -]+?)\s*(?:[:\-–(]\s*(.+?)\)?)?$/u.exec(clean);
      if (!m) continue;
      let name = (m[1] ?? "").trim();
      let level = (m[2] ?? "").trim();
      // « Français courant » : le niveau collé au nom.
      if (level === "") {
        const lm = LEVEL_WORDS.exec(name);
        if (lm && lm.index > 0) {
          level = name.slice(lm.index).trim();
          name = name.slice(0, lm.index).trim();
        }
      }
      if (name.length < 2 || name.length > 25 || name.split(" ").length > 3) continue;
      out.push(level ? { name: titleCaseIfShouting(name), level } : { name: titleCaseIfShouting(name) });
      if (out.length >= 8) return out;
    }
  }
  return out;
}

interface RawEntry {
  period: string;
  titles: string[];
  bullets: string[];
}

/** Découpe une section (expérience ou formation) en entrées. */
function segmentEntries(lines: string[]): RawEntry[] {
  const entries: RawEntry[] = [];
  let cur: RawEntry | null = null;
  const flush = () => {
    if (cur && (cur.period || cur.titles.length > 0)) entries.push(cur);
    cur = null;
  };

  /** Ligne réduite à une période (« 2019 », « Janv. 2022 – Aujourd'hui »). */
  const periodOnly = (line: string | undefined): boolean => {
    if (!line || BULLET.test(line)) return false;
    const m = PERIOD.exec(line);
    return m !== null && line.replace(m[0], "").replace(/[\s,|·:–—()-]/g, "") === "";
  };

  for (const [index, line] of lines.entries()) {
    const bullet = BULLET.test(line);
    const periodMatch = bullet ? null : PERIOD.exec(line);
    const rest = periodMatch
      ? (line.slice(0, periodMatch.index) + line.slice(periodMatch.index + periodMatch[0].length))
          .replace(/^[\s,|·:–—-]+|[\s,|·:–—-]+$/g, "")
          .replace(/\(\s*\)/g, "")
          .trim()
      : line;

    if (bullet) {
      cur ??= { period: "", titles: [], bullets: [] };
      cur.bullets.push(line.replace(BULLET, "").trim());
      continue;
    }

    if (periodMatch) {
      const c = cur as RawEntry | null;
      if (c && c.period === "" && c.bullets.length === 0) {
        c.period = periodMatch[0].trim();
        if (rest) c.titles.push(rest);
      } else {
        flush();
        cur = { period: periodMatch[0].trim(), titles: rest ? [rest] : [], bullets: [] };
      }
      continue;
    }

    const c = cur as RawEntry | null;
    if (c && c.period !== "" && c.titles.length > 0 && periodOnly(lines[index + 1])) {
      // « Titre / date » répété : la ligne ouvre l'entrée suivante.
      flush();
      cur = { period: "", titles: [line], bullets: [] };
    } else if (c && c.bullets.length === 0 && c.titles.length < 2 && line.length <= 80) {
      c.titles.push(line);
    } else if (c && (line.length > 80 || /^[\p{Ll}]/u.test(line))) {
      // Phrase longue ou suite de ligne : réalisation / description.
      const last = c.bullets.length - 1;
      if (last >= 0 && /^[\p{Ll}]/u.test(line)) c.bullets[last] += ` ${line}`;
      else c.bullets.push(line);
    } else if (c && c.titles.length >= 2 && c.bullets.length === 0) {
      c.bullets.push(line);
    } else {
      flush();
      cur = { period: "", titles: [line], bullets: [] };
    }
  }
  flush();
  return entries;
}

function splitRoleCompany(titles: string[]): { role: string; company: string; location: string } {
  let role = titles[0] ?? "";
  let company = titles[1] ?? "";
  let location = "";
  const sep = /\s+(?:[—–|@]|-|chez|at)\s+|\s*,\s+/i;
  if (company === "" && sep.test(role)) {
    const [a = "", b = "", c = ""] = role.split(sep);
    role = a;
    company = b;
    location = c;
  } else if (sep.test(company)) {
    const [a = "", b = ""] = company.split(sep);
    if (CITIES.test(b) || COUNTRIES.test(b)) {
      company = a;
      location = b;
    }
  }
  return { role: role.trim(), company: company.trim(), location: location.trim() };
}

function toExperiences(lines: string[]): CvExperience[] {
  return segmentEntries(lines)
    .map((e) => {
      const { role, company, location } = splitRoleCompany(e.titles);
      return {
        role: titleCaseIfShouting(role),
        company,
        period: e.period,
        ...(location ? { location } : {}),
        highlights: e.bullets.slice(0, 8),
      };
    })
    .filter((e) => e.role !== "" && (e.period !== "" || e.company !== "" || e.highlights.length > 0))
    .slice(0, 10);
}

function toEducation(lines: string[]): CvEducation[] {
  return segmentEntries(lines)
    .map((e) => {
      const parts = [...e.titles, ...e.bullets].flatMap((t) =>
        t.split(/\s+[—–|]\s+|\s+-\s+|\s*,\s+/),
      );
      const diploma =
        parts.find((p) => DIPLOMA_WORDS.test(p)) ?? parts.find((p) => !SCHOOL_WORDS.test(p)) ?? "";
      const school =
        parts.find((p) => p !== diploma && SCHOOL_WORDS.test(p)) ??
        parts.find((p) => p !== diploma) ??
        "";
      return { diploma: diploma.trim(), school: school.trim(), year: e.period };
    })
    .filter((e) => e.diploma !== "")
    .slice(0, 8);
}

export function extractCvFromLines(input: string[]): ExtractionReport {
  const lines = input.map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l !== "");

  const sections: Record<Section, string[]> = {
    header: [],
    summary: [],
    experience: [],
    education: [],
    skills: [],
    languages: [],
    interests: [],
    other: [],
  };
  let current: Section = "header";
  for (const line of lines) {
    const heading = headingOf(line);
    if (heading) {
      current = heading;
      continue;
    }
    sections[current].push(line);
  }

  const all = lines.join("\n");
  const email = EMAIL.exec(all)?.[0] ?? "";
  const phoneLine = lines.find((l) => PHONE.test(l.replace(EMAIL, "")) && !PERIOD.test(l.replace(EMAIL, "").replace(PHONE, "")));
  const phone = phoneLine ? (PHONE.exec(phoneLine.replace(EMAIL, ""))?.[0] ?? "").trim() : "";
  const website = (URL_RE.exec(all.replace(EMAIL, ""))?.[0] ?? "").replace(/[),.;]+$/, "");

  // En-tête : nom, titre, ville. On regarde aussi les premières lignes de
  // tout le document (CV en deux colonnes : l'en-tête peut être « avalé »).
  const head = sections.header.length > 0 ? sections.header : lines.slice(0, 8);
  const nameLine = head.find(looksLikeName) ?? lines.slice(0, 6).find(looksLikeName) ?? "";
  const fullName = titleCaseIfShouting(nameLine);

  const headline =
    head.find(
      (l) =>
        l !== nameLine &&
        !isContactish(l) &&
        !CITIES.test(l) &&
        l.length >= 4 &&
        l.length <= 70 &&
        !/^\d/.test(l) &&
        !headingOf(l),
    ) ?? "";

  let city = "";
  const cityLine = lines.slice(0, 25).find((l) => CITIES.test(l) || /^(adresse|address|ville)\s*:/i.test(l));
  if (cityLine) {
    const m = CITIES.exec(cityLine);
    const country = COUNTRIES.exec(cityLine);
    city = m ? titleCaseIfShouting(m[0]).replace(/^\p{Ll}/u, (c) => c.toLocaleUpperCase("fr")) : cityLine.replace(/^(adresse|address|ville)\s*:\s*/i, "");
    if (m && country) city += `, ${country[0].replace(/^\p{Ll}/u, (c) => c.toLocaleUpperCase("fr"))}`;
  }

  let summary = sections.summary.join(" ").replace(/\s+/g, " ").trim();
  if (summary === "") {
    // Pas de rubrique « Profil » : une longue phrase dans l'en-tête en tient lieu.
    summary = head.filter((l) => l.length > 80 && !isContactish(l)).join(" ");
  }

  const fields: ExtractedCv = {
    fullName,
    headline: headline === fullName ? "" : titleCaseIfShouting(headline),
    email,
    phone,
    city: city.trim(),
    website,
    summary: summary.slice(0, 1_200),
    skills: splitList(sections.skills).slice(0, 30),
    languages: parseLanguages(sections.languages),
    experiences: toExperiences(sections.experience),
    education: toEducation(sections.education),
    interests: splitList(sections.interests).slice(0, 12),
  };

  const found = (Object.keys(fields) as Array<keyof ExtractedCv>).filter((key) => {
    const value = fields[key];
    return Array.isArray(value) ? value.length > 0 : value !== "";
  });

  return { fields, found, lines: lines.length };
}
