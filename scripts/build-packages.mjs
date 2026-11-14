/**
 * Compile chaque paquet publiable de `packages/*` vers `dist/` :
 * ESM (`index.js`), CommonJS (`index.cjs`) et déclarations (`index.d.ts`,
 * `index.d.cts`). Les dépendances et peerDependencies restent externes.
 *
 *   pnpm build              # tous les paquets
 *   pnpm build core react   # une sélection
 *
 * En développement, le monorepo continue de consommer `src/` directement
 * (`main: ./src/index.ts`) ; c'est `publishConfig` qui fait pointer la
 * version publiée vers `dist/`.
 */
import { build } from "tsup";
import { readdir, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const only = new Set(process.argv.slice(2));

const dirs = (await readdir(`${root}packages`, { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .filter((name) => only.size === 0 || only.has(name))
  .sort();

for (const name of dirs) {
  const dir = `${root}packages/${name}`;
  const pkg = JSON.parse(await readFile(`${dir}/package.json`, "utf8"));
  const external = [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
    /^@previewpay\//,
    /^node:/,
  ];

  await rm(`${dir}/dist`, { recursive: true, force: true });
  await build({
    entry: { index: `${dir}/src/index.ts` },
    outDir: `${dir}/dist`,
    format: ["esm", "cjs"],
    dts: { compilerOptions: { composite: false, incremental: false } },
    tsconfig: `${root}tsconfig.build.json`,
    target: "node20",
    platform: name === "react" ? "neutral" : "node",
    sourcemap: true,
    clean: false,
    splitting: false,
    treeshake: true,
    external,
    silent: true,
  });
  console.log(`✓ ${pkg.name} → packages/${name}/dist`);
}
