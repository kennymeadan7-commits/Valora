import {
  composeSummary,
  type CvData,
  type CvExperience,
  type CvTheme,
} from "./model.js";

/**
 * Rendu du CV : un document HTML A4 autonome (aucune ressource externe, styles
 * inline), imprimable en PDF par le navigateur, et une version Markdown.
 *
 * Deux modes :
 * - `full`    : le livrable payé, servi uniquement contre un jeton signé ;
 * - `preview` : l'aperçu, construit **côté serveur** à partir des données mais
 *   dont les parties payantes sont remplacées par des barres grises. Le texte
 *   masqué n'est jamais présent dans le HTML d'aperçu (invariant n° 6).
 *
 * Toute donnée utilisateur passe par `esc()` : le HTML est servi sur l'origine
 * de l'API, une injection y serait exploitable.
 */

export type RenderMode = "full" | "preview";

export interface RenderOptions {
  mode: RenderMode;
  /** Barre « Imprimer / PDF » en haut de page (onglet autonome uniquement). */
  toolbar?: boolean;
}

const THEMES: Record<CvTheme, { accent: string; soft: string; side: string; sideText: string }> = {
  emeraude: { accent: "#0f766e", soft: "#e6f4f1", side: "#0b3b36", sideText: "#d5ece7" },
  indigo: { accent: "#4338ca", soft: "#eceefe", side: "#1e1b4b", sideText: "#dcdcf7" },
  ardoise: { accent: "#334155", soft: "#eef1f5", side: "#111827", sideText: "#d9dee6" },
  terracotta: { accent: "#b4440f", soft: "#fbefe6", side: "#3b1407", sideText: "#f3dccd" },
};

export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Initiales pour le monogramme : « Awa Dossou » → « AD ». */
function initials(fullName: string): string {
  const parts = fullName.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toLocaleUpperCase("fr");
}

/** Largeurs pseudo-aléatoires mais stables pour les barres d'aperçu. */
function barWidth(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return 55 + Math.floor((x - Math.floor(x)) * 40);
}

function bars(count: number, seed: number, cls = "ph"): string {
  return Array.from(
    { length: count },
    (_, i) => `<span class="${cls}" style="width:${barWidth(seed + i)}%"></span>`,
  ).join("");
}

export function maskEmail(email: string): string {
  const [user = "", domain = ""] = email.split("@");
  return `${user.slice(0, 1)}•••@${domain || "•••"}`;
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `${phone.trim().startsWith("+") ? "+" : ""}${digits.slice(0, 3)} •• •• ${digits.slice(-2)}`;
}

/** Coupe au dernier mot entier avant `max` caractères. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const space = slice.lastIndexOf(" ");
  return `${slice.slice(0, space > max * 0.6 ? space : max)}…`;
}

const ICONS = {
  mail: '<svg viewBox="0 0 24 24"><path d="M4 6h16v12H4z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m4 7 8 6 8-6" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  phone:
    '<svg viewBox="0 0 24 24"><path d="M6.6 3.5 9.4 4l1.1 3.6-1.9 1.5a12 12 0 0 0 6.3 6.3l1.5-1.9 3.6 1.1.5 2.8c-.1 1-1 1.6-2 1.6A15.6 15.6 0 0 1 3.9 5.5c0-1 .7-1.9 1.7-2Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="10" r="2.3" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
};

function contactLine(icon: keyof typeof ICONS, value: string): string {
  return `<li><span class="ico">${ICONS[icon]}</span><span>${esc(value)}</span></li>`;
}

function sidebar(data: CvData, preview: boolean): string {
  const contact: string[] = [];
  if (data.email) contact.push(contactLine("mail", preview ? maskEmail(data.email) : data.email));
  if (data.phone) contact.push(contactLine("phone", preview ? maskPhone(data.phone) : data.phone));
  if (data.city) contact.push(contactLine("pin", data.city));
  if (data.website) contact.push(contactLine("link", preview ? "•••••••" : data.website));

  const visibleSkills = preview ? data.skills.slice(0, 3) : data.skills;
  const hiddenSkills = preview ? Math.max(0, data.skills.length - visibleSkills.length) : 0;

  const blocks: string[] = [
    `<div class="monogram">${esc(initials(data.fullName))}</div>`,
  ];
  if (contact.length > 0) {
    blocks.push(`<section><h3>Contact</h3><ul class="contact">${contact.join("")}</ul></section>`);
  }
  if (data.skills.length > 0) {
    blocks.push(
      `<section><h3>Compétences</h3><ul class="chips">${visibleSkills
        .map((s) => `<li>${esc(s)}</li>`)
        .join("")}${Array.from({ length: Math.min(hiddenSkills, 6) }, (_, i) => `<li class="chip-ph" style="width:${40 + barWidth(i) / 2}px"></li>`).join("")}</ul></section>`,
    );
  }
  if (data.languages.length > 0) {
    blocks.push(
      `<section><h3>Langues</h3><ul class="langs">${data.languages
        .map(
          (l) =>
            `<li><strong>${esc(l.name)}</strong>${
              l.level ? (preview ? `<span class="ph ph-light" style="width:45%"></span>` : `<span>${esc(l.level)}</span>`) : ""
            }</li>`,
        )
        .join("")}</ul></section>`,
    );
  }
  if (data.interests.length > 0) {
    blocks.push(
      `<section><h3>Centres d'intérêt</h3>${
        preview
          ? bars(Math.min(2, data.interests.length), 31, "ph ph-light")
          : `<p class="interests">${data.interests.map(esc).join(" · ")}</p>`
      }</section>`,
    );
  }
  return `<aside class="side">${blocks.join("")}</aside>`;
}

function experienceItem(e: CvExperience, index: number, preview: boolean): string {
  const showTitle = !preview || index === 0;
  const title = showTitle
    ? `<h4>${esc(e.role || e.company)}</h4>${
        e.company && e.role
          ? `<p class="org">${esc(e.company)}${e.location ? ` · ${esc(e.location)}` : ""}</p>`
          : ""
      }`
    : `<span class="ph ph-strong" style="width:${barWidth(index + 7)}%"></span>${bars(1, index + 40)}`;
  const body = preview
    ? `<div class="ph-group">${bars(Math.max(2, Math.min(3, e.highlights.length)), index * 5 + 3)}</div>`
    : e.highlights.length > 0
      ? `<ul class="bullets">${e.highlights.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>`
      : "";
  return `<article class="item"><div class="when">${esc(e.period)}</div><div class="what">${title}${body}</div></article>`;
}

function main(data: CvData, preview: boolean): string {
  const summary = composeSummary(data);
  const blocks: string[] = [
    `<header class="head"><h1>${esc(data.fullName)}</h1><p class="headline">${esc(data.headline)}</p></header>`,
  ];

  blocks.push(
    `<section><h2>Profil</h2>${
      preview
        ? `<p class="summary">${esc(cut(summary, 110))}</p><div class="ph-group">${bars(2, 90)}</div>`
        : summary
            .split("\n")
            .map((p) => `<p class="summary">${esc(p)}</p>`)
            .join("")
    }</section>`,
  );

  if (data.experiences.length > 0) {
    blocks.push(
      `<section><h2>Expérience professionnelle</h2>${data.experiences
        .map((e, i) => experienceItem(e, i, preview))
        .join("")}</section>`,
    );
  }

  if (data.education.length > 0) {
    blocks.push(
      `<section><h2>Formation</h2>${data.education
        .map((e, i) =>
          preview
            ? `<article class="item"><div class="when">${esc(e.year)}</div><div class="what"><span class="ph ph-strong" style="width:${barWidth(i + 60)}%"></span>${bars(1, i + 70)}</div></article>`
            : `<article class="item"><div class="when">${esc(e.year)}</div><div class="what"><h4>${esc(e.diploma)}</h4>${
                e.school ? `<p class="org">${esc(e.school)}</p>` : ""
              }</div></article>`,
        )
        .join("")}</section>`,
    );
  }

  return `<main class="body">${blocks.join("")}</main>`;
}

function styles(theme: CvTheme): string {
  const t = THEMES[theme];
  return `
:root{--accent:${t.accent};--soft:${t.soft};--side:${t.side};--side-text:${t.sideText};--ink:#1b1f24;--muted:#5d6670;--line:#e3e6ea}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#e9ebee}
body{font-family:"Inter","Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:var(--ink);-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{position:relative;width:210mm;min-height:297mm;margin:0 auto;background:linear-gradient(to right,var(--side) 0,var(--side) 72mm,#fff 72mm);display:grid;grid-template-columns:72mm 1fr;overflow:hidden}
.side{padding:15mm 8mm 12mm 9mm;color:var(--side-text);font-size:9.6pt;line-height:1.5}
.monogram{width:26mm;height:26mm;border-radius:50%;display:grid;place-items:center;font:600 22pt/1 Georgia,"Times New Roman",serif;color:#fff;border:1.5px solid rgba(255,255,255,.55);margin:0 0 10mm;letter-spacing:.04em}
.side section{margin-bottom:8mm}
.side h3{margin:0 0 3mm;font-size:8pt;letter-spacing:.18em;text-transform:uppercase;color:#fff;font-weight:700}
.side ul{list-style:none;margin:0;padding:0}
.contact li{display:flex;gap:2.5mm;align-items:flex-start;margin-bottom:2.2mm;word-break:break-word}
.ico{flex:none;width:4mm;height:4mm;margin-top:.6mm;opacity:.9}.ico svg{width:100%;height:100%}
.chips{display:flex;flex-wrap:wrap;gap:1.6mm}
.chips li{padding:1mm 2.6mm;border-radius:99px;background:rgba(255,255,255,.12);color:#fff;font-size:8.6pt}
.chip-ph{height:5.4mm;border-radius:99px;background:rgba(255,255,255,.18)}
.langs li{display:flex;justify-content:space-between;gap:3mm;margin-bottom:1.6mm}.langs li strong{color:#fff;font-weight:600}.langs li span{opacity:.85;text-align:right}
.interests{margin:0}
.body{padding:16mm 14mm 14mm 12mm;font-size:10pt;line-height:1.55}
.head{border-bottom:2px solid var(--accent);padding-bottom:5mm;margin-bottom:7mm}
h1{margin:0;font:600 27pt/1.1 Georgia,"Times New Roman",serif;letter-spacing:-.01em;color:#111}
.headline{margin:2.5mm 0 0;font-size:10.5pt;letter-spacing:.16em;text-transform:uppercase;color:var(--accent);font-weight:700}
.body section{margin-bottom:7mm}
h2{display:flex;align-items:center;gap:3mm;margin:0 0 4mm;font-size:9pt;letter-spacing:.18em;text-transform:uppercase;color:var(--accent);font-weight:800}
h2::after{content:"";flex:1;height:1px;background:var(--line)}
.summary{margin:0 0 2mm;color:#2b3138}
.item{display:grid;grid-template-columns:27mm 1fr;gap:4mm;margin-bottom:5mm;break-inside:avoid}
.when{font-size:8.6pt;color:var(--muted);padding-top:.7mm;font-weight:600}
h4{margin:0;font-size:11pt;color:#111}
.org{margin:.5mm 0 1.5mm;color:var(--accent);font-weight:600;font-size:9.6pt}
.bullets{margin:0;padding-left:4.2mm}.bullets li{margin-bottom:1mm}.bullets li::marker{color:var(--accent)}
.ph{display:block;height:2.6mm;border-radius:2mm;background:#dfe3e8;margin:2mm 0}
.ph-strong{height:3.4mm;background:#c9cfd6}
.ph-light{display:inline-block;height:2.4mm;margin:1.3mm 0;background:rgba(255,255,255,.2)}
.ph-group{margin-top:1.5mm}
.wm{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:5}
.wm span{position:absolute;left:-20%;width:140%;text-align:center;transform:rotate(-28deg);font:800 30pt/1 "Inter","Segoe UI",sans-serif;letter-spacing:.3em;color:rgba(15,23,42,.08);white-space:nowrap}
.lock{position:absolute;left:50%;bottom:14mm;transform:translateX(-50%);z-index:6;background:#111827;color:#fff;padding:3mm 6mm;border-radius:99px;font-size:9.5pt;font-weight:600;box-shadow:0 6px 20px rgba(0,0,0,.18);white-space:nowrap}
.foot{position:absolute;right:14mm;bottom:7mm;font-size:7pt;color:#9aa3ad;letter-spacing:.05em}
.toolbar{position:sticky;top:0;z-index:10;display:flex;justify-content:center;gap:10px;padding:12px;background:#111827}
.toolbar button{font:600 14px/1 system-ui,sans-serif;padding:10px 18px;border-radius:8px;border:0;background:var(--accent);color:#fff;cursor:pointer}
.toolbar span{color:#cbd5e1;font:14px/38px system-ui,sans-serif}
@media screen{.page{margin:24px auto;box-shadow:0 10px 40px rgba(15,23,42,.18)}}
@page{size:A4;margin:0}
@media print{html,body{background:#fff}.toolbar{display:none}.page{margin:0;box-shadow:none}}
`;
}

/** Document HTML complet du CV. */
export function renderCvHtml(data: CvData, options: RenderOptions): string {
  const preview = options.mode === "preview";
  const watermark = preview
    ? `<div class="wm" aria-hidden="true">${[8, 30, 52, 74, 96]
        .map((top) => `<span style="top:${top}%">APERÇU · PREVIEWPAY</span>`)
        .join("")}</div><div class="lock">🔒 Version complète débloquée après paiement</div>`
    : "";
  const toolbar = options.toolbar
    ? `<div class="toolbar"><span>Pour un PDF : Imprimer → « Enregistrer au format PDF »</span><button type="button" onclick="window.print()">Imprimer / PDF</button></div>`
    : "";

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CV — ${esc(data.fullName)}</title><style>${styles(data.theme)}</style></head>
<body>${toolbar}<div class="page">${sidebar(data, preview)}${main(data, preview)}${watermark}${
    preview ? "" : `<div class="foot">Généré avec PreviewPay</div>`
  }</div></body></html>`;
}

/** Version Markdown (copier-coller, ATS, export texte). */
export function renderCvMarkdown(data: CvData): string {
  const contact = [data.email, data.phone, data.city, data.website].filter(Boolean).join(" · ");
  const lines: string[] = [`# ${data.fullName}`, data.headline, ""];
  if (contact) lines.push(contact, "");
  lines.push("## Profil", composeSummary(data), "");
  if (data.skills.length > 0) {
    lines.push("## Compétences", ...data.skills.map((s) => `- ${s}`), "");
  }
  if (data.experiences.length > 0) {
    lines.push("## Expérience professionnelle");
    for (const e of data.experiences) {
      lines.push(
        `### ${[e.role, e.company].filter(Boolean).join(" — ")}`,
        `_${[e.period, e.location].filter(Boolean).join(" · ")}_`,
        ...e.highlights.map((h) => `- ${h}`),
        "",
      );
    }
  }
  if (data.education.length > 0) {
    lines.push(
      "## Formation",
      ...data.education.map(
        (e) => `- **${e.diploma}**${e.school ? `, ${e.school}` : ""}${e.year ? ` (${e.year})` : ""}`,
      ),
      "",
    );
  }
  if (data.languages.length > 0) {
    lines.push("## Langues", ...data.languages.map((l) => `- ${l.name}${l.level ? ` : ${l.level}` : ""}`), "");
  }
  if (data.interests.length > 0) {
    lines.push("## Centres d'intérêt", data.interests.join(" · "), "");
  }
  lines.push("---", "_Généré par PreviewPay — contenu complet libéré après paiement._", "");
  return lines.join("\n");
}
