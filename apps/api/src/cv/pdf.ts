import { getDocumentProxy } from "unpdf";

/**
 * Extraction du texte d'un PDF, ligne par ligne, **sans réseau** et sans
 * service tiers : le CV importé ne quitte pas le serveur de démo.
 *
 * pdf.js renvoie des fragments positionnés ; on reconstruit des lignes en
 * regroupant les fragments de même ordonnée, et on coupe une ligne en deux
 * quand un grand blanc horizontal sépare deux colonnes (CV en deux colonnes).
 */

export interface PdfText {
  pages: number;
  lines: string[];
}

export class PdfExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfExtractionError";
  }
}

interface Fragment {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const MAX_PAGES = 6;

export function looksLikePdf(buffer: Uint8Array): boolean {
  return (
    buffer.length > 4 &&
    buffer[0] === 0x25 && // %
    buffer[1] === 0x50 && // P
    buffer[2] === 0x44 && // D
    buffer[3] === 0x46 // F
  );
}

export async function extractPdfLines(buffer: Uint8Array): Promise<PdfText> {
  if (!looksLikePdf(buffer)) {
    throw new PdfExtractionError("Le fichier envoyé n'est pas un PDF.");
  }

  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // Copie : pdf.js détache le tampon qu'on lui confie.
    pdf = await getDocumentProxy(new Uint8Array(buffer));
  } catch {
    throw new PdfExtractionError("PDF illisible ou protégé par mot de passe.");
  }

  const lines: string[] = [];
  const pages = Math.min(pdf.numPages, MAX_PAGES);
  for (let p = 1; p <= pages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const fragments: Fragment[] = [];
    for (const item of content.items) {
      if (!("str" in item) || item.str.trim() === "") continue;
      const [, , , d = 0, e = 0, f = 0] = item.transform as number[];
      fragments.push({
        str: item.str,
        x: e,
        y: f,
        width: item.width,
        height: Math.abs(d) || item.height || 10,
      });
    }
    lines.push(...toLines(fragments));
  }
  await pdf.destroy();

  return { pages: pdf.numPages, lines };
}

/** Regroupe les fragments par ligne (ordonnée proche), de haut en bas. */
function toLines(fragments: Fragment[]): string[] {
  const rows: Fragment[][] = [];
  const sorted = [...fragments].sort((a, b) => b.y - a.y || a.x - b.x);
  for (const fragment of sorted) {
    const row = rows[rows.length - 1];
    const ref = row?.[0];
    if (row && ref && Math.abs(ref.y - fragment.y) <= Math.max(2, ref.height * 0.35)) {
      row.push(fragment);
    } else {
      rows.push([fragment]);
    }
  }

  const out: string[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    let current = "";
    let end = -Infinity;
    for (const f of row) {
      const gap = f.x - end;
      if (current !== "" && gap > Math.max(28, f.height * 3)) {
        // Grand blanc : deux colonnes côte à côte, on sépare.
        out.push(current.trim());
        current = "";
      } else if (current !== "" && gap > f.height * 0.15 && !current.endsWith(" ") && !f.str.startsWith(" ")) {
        current += " ";
      }
      current += f.str;
      end = f.x + f.width;
    }
    if (current.trim() !== "") out.push(current.replace(/\s+/g, " ").trim());
  }
  return out;
}
