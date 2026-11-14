export interface CvInput {
  fullName: string;
  headline: string;
  email?: string;
  phone?: string;
  city?: string;
  skills?: string[];
  experiences?: Array<{ role: string; company: string; period: string; highlights?: string[] }>;
  education?: Array<{ diploma: string; school: string; year: string }>;
}

function bullets(items: string[] | undefined, indent = "- "): string {
  return (items ?? []).map((i) => `${indent}${i}`).join("\n");
}

/**
 * Génère un CV en Markdown. Dans la démo, c'est le « livrable IA » : le texte
 * complet reste côté serveur, seul l'aperçu tronqué part au navigateur.
 */
export function renderCv(input: CvInput): string {
  const experiences = (input.experiences ?? [])
    .map(
      (e) =>
        `### ${e.role} — ${e.company}\n_${e.period}_\n${bullets(e.highlights)}`,
    )
    .join("\n\n");

  const education = (input.education ?? [])
    .map((e) => `- **${e.diploma}**, ${e.school} (${e.year})`)
    .join("\n");

  return `# ${input.fullName}
${input.headline}

${[input.email, input.phone, input.city].filter(Boolean).join(" · ")}

## Profil
Professionnel·le orienté·e résultats, avec une expérience concrète de
${input.headline.toLowerCase()}. Habitué·e à travailler en autonomie sur des
livrables à forte visibilité, du cadrage à la livraison.

## Compétences
${bullets(input.skills)}

## Expérience professionnelle
${experiences || "_À compléter_"}

## Formation
${education || "_À compléter_"}

## Langues
- Français : courant
- Anglais : professionnel

---
_Généré par PreviewPay — contenu complet libéré après paiement._
`;
}
