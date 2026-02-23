import { TenzirQueryLang } from "../dist/index.js";
import { fileTests } from "@lezer/generator/dist/test";

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
let caseDir = path.dirname(fileURLToPath(import.meta.url));

let total = 0;
let failed = 0;

for (let file of fs.readdirSync(caseDir)) {
  if (!/\.txt$/.test(file)) continue;

  let suite = /^[^\.]*/.exec(file)[0];
  for (let { name, run } of fileTests(
    fs.readFileSync(path.join(caseDir, file), "utf8"),
    file
  )) {
    total++;
    try {
      run(TenzirQueryLang.parser);
      process.stdout.write(`ok - ${suite}: ${name}\n`);
    } catch (error) {
      failed++;
      process.stderr.write(`not ok - ${suite}: ${name}\n`);
      process.stderr.write(`${error?.stack ?? error}\n`);
    }
  }
}

if (failed > 0) {
  process.stderr.write(`\n${failed}/${total} tests failed\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`\nAll ${total} tests passed\n`);
}
