/**
 * Module CV de la démo : validation, rendu HTML (complet / aperçu), import
 * PDF et analyse heuristique. Aucun accès réseau.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import { Test } from "@nestjs/testing";
import request from "supertest";
import {
  CvPreviewStrategy,
  CvValidationError,
  extractCvFromLines,
  extractPdfLines,
  normalizeCvInput,
  renderCvHtml,
} from "../src/cv/index.js";
import { makeSampleCvPdf } from "./fixtures/sample-cv.js";

process.env["PAYMENT_PROVIDER"] = "mock";
process.env["STORAGE"] = "memory";
process.env["PREVIEWPAY_DOWNLOAD_SECRET"] = "secret_de_test_cv";

describe("normalizeCvInput", () => {
  it("exige le nom et le poste", () => {
    expect(() => normalizeCvInput({ fullName: "Awa" })).toThrow(CvValidationError);
  });

  it("nettoie, plafonne et n'invente aucune section", () => {
    const data = normalizeCvInput({
      fullName: "  Awa   Dossou ",
      headline: "Comptable",
      skills: "Excel, excel, Sage ; Paie",
      languages: "Français : courant, Anglais (B2), Fon",
      experiences: [{ role: "Aide-comptable", company: "", period: "2020", highlights: "• Bilans\n\n- Paie" }],
      theme: "inconnu",
    });
    expect(data.fullName).toBe("Awa Dossou");
    expect(data.skills).toEqual(["Excel", "Sage", "Paie"]);
    expect(data.languages).toEqual([
      { name: "Français", level: "courant" },
      { name: "Anglais", level: "B2" },
      { name: "Fon" },
    ]);
    expect(data.experiences[0]?.highlights).toEqual(["Bilans", "Paie"]);
    expect(data.education).toEqual([]);
    expect(data.theme).toBe("emeraude");
  });
});

describe("renderCvHtml", () => {
  const data = normalizeCvInput({
    fullName: "Jean <script>alert(1)</script>",
    headline: "Data analyst",
    email: "jean@example.com",
    skills: ["SQL", "Python", "Power BI", "Statistiques", "Excel"],
    experiences: [
      { role: "Analyste", company: "Banque X", period: "2020 — 2024", highlights: ["Tableau de bord des risques"] },
      { role: "Stagiaire", company: "Telco Y", period: "2019", highlights: ["Nettoyage de données"] },
    ],
    education: [{ diploma: "Master statistique", school: "ENSEA", year: "2019" }],
  });

  it("échappe toute donnée utilisateur", () => {
    const html = renderCvHtml(data, { mode: "full" });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("l'aperçu ne contient pas les parties payantes", async () => {
    const preview = (await new CvPreviewStrategy().makePreview(
      { format: "cv/v1", data },
      { type: "cv" },
    )) as { html: string; text: string; kind: string };
    expect(preview.kind).toBe("cv");
    for (const secret of ["Tableau de bord des risques", "Nettoyage de données", "Telco Y", "Master statistique", "jean@example.com", "Statistiques"]) {
      expect(preview.html).not.toContain(secret);
    }
    // Ce qui donne envie reste visible.
    expect(preview.html).toContain("Data analyst");
    expect(preview.html).toContain("Banque X");
    expect(preview.html).toContain("SQL");
  });

  it("le CV complet contient tout, sans filigrane", () => {
    const html = renderCvHtml(data, { mode: "full", toolbar: true });
    expect(html).toContain("Nettoyage de données");
    expect(html).toContain("Master statistique");
    expect(html).toContain("window.print()");
    expect(html).not.toContain("APERÇU · PREVIEWPAY");
  });
});

describe("extraction", () => {
  it("lit un vrai PDF et en déduit les champs du CV", async () => {
    const pdf = await extractPdfLines(await makeSampleCvPdf());
    expect(pdf.pages).toBe(1);

    const { fields, found } = extractCvFromLines(pdf.lines);
    expect(fields.fullName).toBe("Koffi Mensah");
    expect(fields.headline).toBe("Développeur Full-Stack");
    expect(fields.email).toBe("koffi.mensah@example.com");
    expect(fields.phone).toBe("+229 97 12 34 56");
    expect(fields.city).toBe("Cotonou, Bénin");
    expect(fields.summary).toContain("5 ans d'expérience");
    expect(fields.skills).toEqual(expect.arrayContaining(["TypeScript", "NestJS", "Méthodes agiles"]));
    expect(fields.languages).toContainEqual({ name: "Fon", level: "langue maternelle" });
    expect(fields.experiences).toHaveLength(2);
    expect(fields.experiences[0]).toMatchObject({
      role: "Lead développeur",
      company: "Kpayo Tech",
      period: "Janv. 2022 – Aujourd'hui",
    });
    expect(fields.experiences[0]?.highlights).toHaveLength(3);
    expect(fields.education).toEqual([
      { diploma: "Licence en Informatique", school: "Université d'Abomey-Calavi", year: "2019" },
      { diploma: "Baccalauréat série C", school: "Lycée Béhanzin", year: "2016" },
    ]);
    expect(fields.interests).toEqual(["Football", "Lecture", "Entrepreneuriat"]);
    expect(found).toHaveLength(12);
  });

  it("gère la mise en page « poste / entreprise / dates » sur trois lignes", () => {
    const { fields } = extractCvFromLines([
      "Mariam Traoré",
      "Assistante de direction",
      "mariam.traore@mail.com | 07 07 12 34 56 | Abidjan",
      "Expériences professionnelles",
      "Assistante de direction",
      "Groupe Sifca",
      "Mars 2020 - Présent",
      "- Gestion de l'agenda de 3 directeurs",
      "- Organisation des conseils d'administration",
      "Secrétaire",
      "Cabinet Koné",
      "2017 - 2020",
      "Langues",
      "Français courant, Anglais intermédiaire",
    ]);
    expect(fields.fullName).toBe("Mariam Traoré");
    expect(fields.city).toBe("Abidjan");
    expect(fields.phone).toBe("07 07 12 34 56");
    expect(fields.experiences).toEqual([
      expect.objectContaining({ role: "Assistante de direction", company: "Groupe Sifca", period: "Mars 2020 - Présent" }),
      expect.objectContaining({ role: "Secrétaire", company: "Cabinet Koné", period: "2017 - 2020" }),
    ]);
    expect(fields.experiences[0]?.highlights).toHaveLength(2);
    expect(fields.languages).toEqual([
      { name: "Français", level: "courant" },
      { name: "Anglais", level: "intermédiaire" },
    ]);
  });

  it("refuse un fichier qui n'est pas un PDF", async () => {
    await expect(extractPdfLines(new TextEncoder().encode("bonjour"))).rejects.toThrow(
      "n'est pas un PDF",
    );
  });
});

describe("POST /demo/cv/import", () => {
  let app: INestApplication;
  let server: App;

  beforeAll(async () => {
    const { AppModule } = await import("../src/app.module.js");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("renvoie les champs détectés sans créer de livrable", async () => {
    const pdf = Buffer.from(await makeSampleCvPdf());
    const res = await request(server)
      .post("/demo/cv/import")
      .attach("file", pdf, { filename: "cv.pdf", contentType: "application/pdf" })
      .expect(200);

    expect(res.body.pages).toBe(1);
    expect(res.body.fields.fullName).toBe("Koffi Mensah");
    expect(res.body.found).toContain("experiences");
  });

  it("422 pour un faux PDF, 400 sans fichier", async () => {
    await request(server)
      .post("/demo/cv/import")
      .attach("file", Buffer.from("pas un pdf"), { filename: "cv.pdf", contentType: "application/pdf" })
      .expect(422);
    await request(server).post("/demo/cv/import").expect(400);
  });
});
