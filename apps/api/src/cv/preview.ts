import type { PreviewStrategy } from "@previewpay/core";
import { isCvContent } from "./model.js";
import { maskEmail, maskPhone, renderCvHtml, renderCvMarkdown } from "./render.js";

export const PREVIEW_WATERMARK = "APERÇU — PreviewPay";

/**
 * Aperçu utile mais inutilisable : début du texte + filigrane explicite.
 * Stratégie générique, utilisée pour tout contenu qui n'est pas un CV.
 */
export class TextPreviewStrategy implements PreviewStrategy {
  constructor(private readonly maxChars = 420) {}

  async makePreview(content: unknown, ctx: { type: string }): Promise<unknown> {
    const text = typeof content === "string" ? content : JSON.stringify(content);
    return {
      kind: "text",
      type: ctx.type,
      text: text.slice(0, this.maxChars),
      truncated: text.length > this.maxChars,
      watermark: PREVIEW_WATERMARK,
      totalChars: text.length,
    };
  }
}

/**
 * Aperçu d'un CV : le **vrai gabarit**, rendu côté serveur, dont les parties
 * payantes (réalisations, formation, coordonnées complètes…) sont remplacées
 * par des barres grises avant de quitter le serveur. Le champ `text` reste
 * fourni pour les clients qui n'affichent que du texte (paywall générique).
 */
export class CvPreviewStrategy implements PreviewStrategy {
  private readonly fallback: TextPreviewStrategy;

  constructor(private readonly maxChars = 420) {
    this.fallback = new TextPreviewStrategy(maxChars);
  }

  async makePreview(content: unknown, ctx: { type: string }): Promise<unknown> {
    if (!isCvContent(content)) return this.fallback.makePreview(content, ctx);

    const { data } = content;
    const markdown = renderCvMarkdown(data);
    // Le texte d'aperçu masque les coordonnées, comme le HTML d'aperçu.
    const safe = renderCvMarkdown({
      ...data,
      ...(data.email ? { email: maskEmail(data.email) } : {}),
      ...(data.phone ? { phone: maskPhone(data.phone) } : {}),
      website: undefined,
    });
    return {
      kind: "cv",
      type: ctx.type,
      theme: data.theme,
      html: renderCvHtml(data, { mode: "preview" }),
      text: safe.slice(0, this.maxChars),
      truncated: markdown.length > this.maxChars,
      watermark: PREVIEW_WATERMARK,
      totalChars: markdown.length,
      sections: {
        experiences: data.experiences.length,
        education: data.education.length,
        skills: data.skills.length,
        languages: data.languages.length,
      },
    };
  }
}
