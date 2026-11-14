import { useRef, useState } from "react";
import type { DragEvent, FormEvent, ReactNode } from "react";
import { describeError, importCvPdf } from "./api.js";
import {
  FIELD_LABELS,
  THEMES,
  emptyEducation,
  emptyExperience,
  mergeImport,
  sampleDraft,
  type CvDraft,
  type EducationDraft,
  type ExperienceDraft,
} from "./draft.js";

/**
 * Étape 1 : les informations de la personne. Deux entrées possibles —
 * importer un CV PDF existant (pré-remplissage côté serveur) ou saisir à la
 * main — et toujours un formulaire relisible avant de générer.
 */

interface CvFormProps {
  draft: CvDraft;
  onChange: (next: CvDraft) => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
  price: string;
}

const MAX_PDF_BYTES = 5 * 1024 * 1024;

function Field(props: {
  label: string;
  hint?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={`field${props.wide ? " field-wide" : ""}`}>
      <span className="field-label">
        {props.label}
        {props.hint ? <span className="optional"> {props.hint}</span> : null}
      </span>
      {props.children}
    </label>
  );
}

export function CvForm({ draft, onChange, onSubmit, submitting, error, price }: CvFormProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importInfo, setImportInfo] = useState<{ name: string; found: string[] } | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const set = <K extends keyof CvDraft>(key: K, value: CvDraft[K]) => onChange({ ...draft, [key]: value });

  const setExperience = (key: string, patch: Partial<ExperienceDraft>) =>
    set(
      "experiences",
      draft.experiences.map((e) => (e.key === key ? { ...e, ...patch } : e)),
    );
  const setEducation = (key: string, patch: Partial<EducationDraft>) =>
    set(
      "education",
      draft.education.map((e) => (e.key === key ? { ...e, ...patch } : e)),
    );

  async function handleFile(file: File | undefined): Promise<void> {
    if (!file) return;
    setImportError(null);
    setImportInfo(null);
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setImportError("Seuls les fichiers PDF sont acceptés.");
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      setImportError("PDF trop volumineux (5 Mo maximum).");
      return;
    }
    setImporting(file.name);
    try {
      const result = await importCvPdf(file);
      onChange(mergeImport(draft, result));
      setImportInfo({ name: file.name, found: result.found });
    } catch (cause) {
      setImportError(describeError(cause));
    } finally {
      setImporting(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragging(false);
    void handleFile(event.dataTransfer.files[0]);
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (draft.fullName.trim() === "" || draft.headline.trim() === "") {
      setLocalError("Le nom complet et le poste visé sont obligatoires.");
      return;
    }
    setLocalError(null);
    onSubmit();
  }

  return (
    <form className="cv-form" onSubmit={submit} noValidate>
      <div
        className={`dropzone${dragging ? " dragging" : ""}${importing ? " busy" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <div className="dropzone-icon" aria-hidden="true">
          {importing ? <span className="spinner" /> : "⇪"}
        </div>
        <div className="dropzone-text">
          <strong>{importing ? `Lecture de « ${importing} »…` : "Vous avez déjà un CV ? Importez-le en PDF"}</strong>
          <span>
            {importing
              ? "Extraction du texte et repérage des rubriques sur le serveur."
              : "Nom, contact, expériences, formation, compétences et langues sont repérés automatiquement. Rien n'est conservé."}
          </span>
        </div>
        <div className="dropzone-actions">
          <button
            type="button"
            className="button button-ghost"
            disabled={importing !== null || submitting}
            onClick={() => inputRef.current?.click()}
          >
            Choisir un PDF
          </button>
          <button
            type="button"
            className="link-button small"
            disabled={importing !== null || submitting}
            onClick={() => {
              onChange(sampleDraft());
              setImportInfo(null);
            }}
          >
            ou remplir avec un exemple
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={(event) => void handleFile(event.target.files?.[0])}
        />
      </div>

      {importInfo ? (
        <p className="notice" role="status">
          <strong>{importInfo.found.length} rubrique{importInfo.found.length > 1 ? "s" : ""} détectée{importInfo.found.length > 1 ? "s" : ""}</strong>{" "}
          dans « {importInfo.name} » : {importInfo.found.map((f) => FIELD_LABELS[f] ?? f).join(", ")}. Relisez et
          complétez avant de générer.
        </p>
      ) : null}
      {importError ? (
        <p className="alert" role="alert">
          {importError}
        </p>
      ) : null}

      <fieldset className="section">
        <legend>Identité</legend>
        <div className="grid">
          <Field label="Nom complet">
            <input value={draft.fullName} autoComplete="name" placeholder="Awa Dossou" onChange={(e) => set("fullName", e.target.value)} required />
          </Field>
          <Field label="Poste visé">
            <input value={draft.headline} placeholder="Chargée de projet" onChange={(e) => set("headline", e.target.value)} required />
          </Field>
          <Field label="Email">
            <input type="email" value={draft.email} autoComplete="email" placeholder="awa@example.com" onChange={(e) => set("email", e.target.value)} />
          </Field>
          <Field label="Téléphone">
            <input type="tel" value={draft.phone} autoComplete="tel" placeholder="+229 97 00 00 00" onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field label="Ville">
            <input value={draft.city} placeholder="Cotonou, Bénin" onChange={(e) => set("city", e.target.value)} />
          </Field>
          <Field label="LinkedIn / site" hint="(facultatif)">
            <input value={draft.website} placeholder="linkedin.com/in/…" onChange={(e) => set("website", e.target.value)} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="section">
        <legend>Profil</legend>
        <Field label="Accroche" hint="(laisser vide : rédigée automatiquement à partir de vos infos)" wide>
          <textarea rows={3} value={draft.summary} onChange={(e) => set("summary", e.target.value)} />
        </Field>
      </fieldset>

      <fieldset className="section">
        <legend>
          Expériences <span className="count">{draft.experiences.length}</span>
        </legend>
        {draft.experiences.length === 0 ? <p className="muted small">Aucune expérience pour l'instant.</p> : null}
        {draft.experiences.map((e, index) => (
          <div className="entry" key={e.key}>
            <div className="entry-head">
              <span className="entry-index">{index + 1}</span>
              <button type="button" className="link-button small danger" onClick={() => set("experiences", draft.experiences.filter((x) => x.key !== e.key))}>
                Retirer
              </button>
            </div>
            <div className="grid">
              <Field label="Poste">
                <input value={e.role} onChange={(ev) => setExperience(e.key, { role: ev.target.value })} />
              </Field>
              <Field label="Entreprise">
                <input value={e.company} onChange={(ev) => setExperience(e.key, { company: ev.target.value })} />
              </Field>
              <Field label="Période">
                <input value={e.period} placeholder="2021 — aujourd'hui" onChange={(ev) => setExperience(e.key, { period: ev.target.value })} />
              </Field>
              <Field label="Lieu" hint="(facultatif)">
                <input value={e.location} onChange={(ev) => setExperience(e.key, { location: ev.target.value })} />
              </Field>
              <Field label="Réalisations" hint="(une par ligne)" wide>
                <textarea rows={3} value={e.highlights} onChange={(ev) => setExperience(e.key, { highlights: ev.target.value })} />
              </Field>
            </div>
          </div>
        ))}
        <button type="button" className="button button-ghost button-sm" onClick={() => set("experiences", [...draft.experiences, emptyExperience()])}>
          + Ajouter une expérience
        </button>
      </fieldset>

      <fieldset className="section">
        <legend>
          Formation <span className="count">{draft.education.length}</span>
        </legend>
        {draft.education.map((e, index) => (
          <div className="entry entry-compact" key={e.key}>
            <span className="entry-index">{index + 1}</span>
            <div className="grid grid-3">
              <Field label="Diplôme">
                <input value={e.diploma} onChange={(ev) => setEducation(e.key, { diploma: ev.target.value })} />
              </Field>
              <Field label="Établissement">
                <input value={e.school} onChange={(ev) => setEducation(e.key, { school: ev.target.value })} />
              </Field>
              <Field label="Année">
                <input value={e.year} onChange={(ev) => setEducation(e.key, { year: ev.target.value })} />
              </Field>
            </div>
            <button type="button" className="icon-button" aria-label="Retirer cette formation" onClick={() => set("education", draft.education.filter((x) => x.key !== e.key))}>
              ×
            </button>
          </div>
        ))}
        <button type="button" className="button button-ghost button-sm" onClick={() => set("education", [...draft.education, emptyEducation()])}>
          + Ajouter une formation
        </button>
      </fieldset>

      <fieldset className="section">
        <legend>Compétences & langues</legend>
        <div className="grid">
          <Field label="Compétences" hint="(séparées par des virgules)" wide>
            <input value={draft.skills} placeholder="Gestion de projet, Excel, Rédaction" onChange={(e) => set("skills", e.target.value)} />
          </Field>
          <Field label="Langues" hint="(« Français : courant, Anglais : intermédiaire »)" wide>
            <input value={draft.languages} onChange={(e) => set("languages", e.target.value)} />
          </Field>
          <Field label="Centres d'intérêt" hint="(facultatif)" wide>
            <input value={draft.interests} onChange={(e) => set("interests", e.target.value)} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="section">
        <legend>Modèle</legend>
        <div className="themes" role="radiogroup" aria-label="Couleur du modèle">
          {THEMES.map((t) => (
            <label key={t.value} className={`theme${draft.theme === t.value ? " selected" : ""}`}>
              <input type="radio" name="theme" value={t.value} checked={draft.theme === t.value} onChange={() => set("theme", t.value)} />
              <span className="theme-swatch" style={{ background: `linear-gradient(90deg, ${t.color} 0 34%, #fff 34%)` }} aria-hidden="true">
                <i style={{ background: t.color }} />
                <i />
                <i />
              </span>
              {t.label}
            </label>
          ))}
        </div>
      </fieldset>

      {localError || error ? (
        <p className="alert" role="alert">
          {localError ?? error}
        </p>
      ) : null}

      <div className="submit-bar">
        <p className="muted small">
          L'aperçu est gratuit. Vous ne payez <strong>{price}</strong> que s'il vous convient.
        </p>
        <button className="button button-lg" type="submit" disabled={submitting || importing !== null}>
          {submitting ? "Génération…" : "Générer l'aperçu de mon CV →"}
        </button>
      </div>
    </form>
  );
}
