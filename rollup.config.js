import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import typescript from "@rollup/plugin-typescript";
import { dts } from "rollup-plugin-dts";

const require = createRequire(import.meta.url);

/** Bundles tree-sitter query files (`*.scm`) as strings. */
const queries = () => ({
  name: "queries",
  resolveId: (id) => (id.endsWith(".scm") ? require.resolve(id) : null),
  load: (id) => {
    if (!id.endsWith(".scm")) return null;
    return `export default ${JSON.stringify(readFileSync(id, "utf8"))};`;
  },
});

const external = (id) => !id.endsWith(".scm") && !/^(\.?\/|\w:)/.test(id);

export default [
  {
    input: "src/index.ts",
    external,
    output: [
      { file: "dist/index.cjs", format: "cjs" },
      { file: "dist/index.js", format: "es" },
    ],
    plugins: [queries(), typescript({ noEmit: false, declaration: false, noEmitOnError: true })],
  },
  {
    input: "src/index.ts",
    external,
    // CommonJS consumers need declarations of their own, which TypeScript
    // looks up next to `index.cjs`.
    output: [
      { file: "dist/index.d.ts", format: "es" },
      { file: "dist/index.d.cts", format: "es" },
    ],
    plugins: [queries(), dts()],
  },
];
