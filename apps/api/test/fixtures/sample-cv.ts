/**
 * Fabrique un CV PDF réaliste (deux colonnes, rubriques en majuscules,
 * puces, dates) pour tester l'import sans fichier binaire versionné.
 * Également utilisé par `scripts/make-sample-cv.ts` pour la démo.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export async function makeSampleCvPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const dark = rgb(0.1, 0.12, 0.15);
  const accent = rgb(0.06, 0.46, 0.43);

  let y = 790;
  const left = 50;
  const write = (text: string, opts: { x?: number; size?: number; font?: typeof regular; color?: typeof dark } = {}) => {
    page.drawText(text, {
      x: opts.x ?? left,
      y,
      size: opts.size ?? 10,
      font: opts.font ?? regular,
      color: opts.color ?? dark,
    });
  };
  const line = (text: string, opts: Parameters<typeof write>[1] = {}, step = 15) => {
    write(text, opts);
    y -= step;
  };

  line("KOFFI MENSAH", { size: 22, font: bold }, 22);
  line("Développeur Full-Stack", { size: 13, color: accent }, 20);
  write("koffi.mensah@example.com", { size: 9.5 });
  write("+229 97 12 34 56", { x: 230, size: 9.5 });
  write("Cotonou, Bénin", { x: 380, size: 9.5 });
  y -= 14;
  line("linkedin.com/in/koffi-mensah", { size: 9.5 }, 28);

  line("PROFIL", { font: bold, color: accent, size: 11 }, 16);
  line("Développeur passionné avec 5 ans d'expérience dans la conception d'applications web et mobiles", {}, 13);
  line("pour des PME et ONG d'Afrique de l'Ouest. Orienté produit, à l'aise du back-end au front-end.", {}, 26);

  line("EXPÉRIENCE PROFESSIONNELLE", { font: bold, color: accent, size: 11 }, 18);
  write("Lead développeur — Kpayo Tech", { font: bold });
  write("Janv. 2022 – Aujourd'hui", { x: 400, size: 9.5 });
  y -= 15;
  line("• Conception d'une plateforme de paiement Mobile Money utilisée par 12 000 marchands", {}, 13);
  line("• Encadrement d'une équipe de 4 développeurs", {}, 13);
  line("• Réduction de 35 % du temps de réponse de l'API", {}, 20);
  write("Développeur web — Agence Digitale Bénin", { font: bold });
  write("2019 – 2021", { x: 400, size: 9.5 });
  y -= 15;
  line("• Réalisation de 20 sites vitrines et e-commerce", {}, 13);
  line("• Mise en place de l'intégration continue", {}, 26);

  line("FORMATION", { font: bold, color: accent, size: 11 }, 18);
  write("Licence en Informatique — Université d'Abomey-Calavi");
  write("2019", { x: 400, size: 9.5 });
  y -= 15;
  write("Baccalauréat série C — Lycée Béhanzin");
  write("2016", { x: 400, size: 9.5 });
  y -= 28;

  line("COMPÉTENCES", { font: bold, color: accent, size: 11 }, 18);
  line("TypeScript, React, Node.js, NestJS, PostgreSQL, Docker", {}, 13);
  line("Flutter • Git • Méthodes agiles", {}, 26);

  line("LANGUES", { font: bold, color: accent, size: 11 }, 18);
  line("Français : courant", {}, 13);
  line("Anglais : professionnel", {}, 13);
  line("Fon : langue maternelle", {}, 26);

  line("CENTRES D'INTÉRÊT", { font: bold, color: accent, size: 11 }, 18);
  line("Football, Lecture, Entrepreneuriat", {}, 13);

  return doc.save();
}
