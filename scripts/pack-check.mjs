/**
 * Vérifie que chaque paquet de `packages/*` est publiable, sans rien publier :
 *
 * 1. `pnpm pack` (déclenche `prepack` → build) dans un dossier de sortie ;
 * 2. contrôle du tarball : `dist/` complet (ESM, CJS, types), README, aucun
 *    fichier source ni test, manifeste réécrit (pas de `workspace:*`,
 *    `main`/`exports` vers `dist/`, pas de `private`).
 *
 *   node scripts/pack-check.mjs [--out <dossier>] [--strict]
 *
 * `--strict` transforme les avertissements (licence absente…) en erreurs :
 * à utiliser juste avant une vraie publication.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const strict = args.includes("--strict");
const outIndex = args.indexOf("--out");
const out =
  outIndex >= 0 && args[outIndex + 1]
    ? args[outIndex + 1]
    : mkdtempSync(join(tmpdir(), "previewpay-pack-"));
mkdirSync(out, { recursive: true });

const REQUIRED = [
  "package/package.json",
  "package/README.md",
  "package/dist/index.js",
  "package/dist/index.cjs",
  "package/dist/index.d.ts",
  "package/dist/index.d.cts",
];

const errors = [];
const warnings = [];
const tarballs = [];

const names = readdirSync(join(root, "packages"), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

for (const name of names) {
  const dir = join(root, "packages", name);
  const before = new Set(readdirSync(out));
  execFileSync("pnpm", ["pack", "--pack-destination", out], { cwd: dir, stdio: "pipe" });
  const tarball = readdirSync(out).find((f) => f.endsWith(".tgz") && !before.has(f));
  if (!tarball) {
    errors.push(`${name} : aucun tarball produit`);
    continue;
  }
  const path = join(out, tarball);
  tarballs.push(path);

  const entries = execFileSync("tar", ["-tzf", path], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  const manifest = JSON.parse(
    execFileSync("tar", ["-xzOf", path, "package/package.json"], { encoding: "utf8" }),
  );
  const label = manifest.name ?? name;

  for (const file of REQUIRED) {
    if (!entries.includes(file)) errors.push(`${label} : fichier manquant ${file}`);
  }
  const leaked = entries.filter((e) => /^package\/(src|test)\//.test(e) || /\.test\.[cm]?[jt]sx?$/.test(e));
  if (leaked.length > 0) errors.push(`${label} : fichiers non publiables ${leaked.slice(0, 3).join(", ")}`);

  const raw = JSON.stringify(manifest);
  if (raw.includes("workspace:")) errors.push(`${label} : dépendance workspace:* non réécrite`);
  if (manifest.private) errors.push(`${label} : "private": true`);
  if (!String(manifest.main ?? "").startsWith("./dist/")) errors.push(`${label} : main ne pointe pas vers dist/`);
  if (!String(manifest.types ?? "").startsWith("./dist/")) errors.push(`${label} : types ne pointe pas vers dist/`);
  if (raw.includes("./src/")) errors.push(`${label} : le manifeste publié référence encore src/`);
  if (manifest.scripts?.postinstall) errors.push(`${label} : script postinstall publié`);

  if (!manifest.license) warnings.push(`${label} : champ "license" absent`);
  if (!entries.includes("package/LICENSE")) warnings.push(`${label} : fichier LICENSE absent`);

  const kb = (readFileSync(path).length / 1024).toFixed(1);
  console.log(`📦 ${label}@${manifest.version} — ${entries.length} fichiers, ${kb} Ko`);
}

for (const w of warnings) console.warn(`⚠️  ${w}`);
for (const e of errors) console.error(`✗ ${e}`);

if (errors.length > 0 || (strict && warnings.length > 0)) {
  console.error(`\nÉchec : ${errors.length} erreur(s), ${warnings.length} avertissement(s).`);
  process.exit(1);
}
console.log(`\n✓ ${tarballs.length} paquets publiables — tarballs dans ${out}`);
