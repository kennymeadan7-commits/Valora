/**
 * Écrit `docs/samples/cv-exemple.pdf` : un CV à importer dans la démo web.
 *   pnpm tsx scripts/make-sample-cv.ts
 */
import { writeFile } from "node:fs/promises";
import { makeSampleCvPdf } from "../apps/api/test/fixtures/sample-cv.js";

const out = new URL("../docs/samples/cv-exemple.pdf", import.meta.url);
await writeFile(out, await makeSampleCvPdf());
console.log(`CV d'exemple écrit : ${out.pathname}`);
