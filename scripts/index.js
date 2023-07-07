import fs from "fs";
import path from "path";
import rehypeStringify from "rehype-stringify";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { promisify } from "util";

const readFile = promisify(fs.readFile);
const readDirectory = promisify(fs.readdir);
const writeFile = promisify(fs.writeFile);
const lstat = promisify(fs.lstat);

// TODO: clean up the markdown in detail via remark-format
// TODO: clean up package.json
const processor = unified()
  .use(remarkParse)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeStringify);

let output = [];

const processFile = async (filePath) => {
  try {
    const data = await readFile(filePath, "utf8");
    let detail = "";
    let lines = data.split("\n");
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() !== "") {
        detail = lines[i].trim();
        lines = lines.slice(i + 1);
        break;
      }
    }
    let info = `${lines.join("\n")}`;
    const file = await processor.process(info);
    output.push({
      label: path.basename(filePath, ".md"),
      type: "keyword",
      detail: detail,
      processedHTML: String(file),
    });
  } catch (err) {
    console.error(err);
  }
};

const processDirectory = async (directoryPath, outputPath) => {
  try {
    const files = await readDirectory(directoryPath);
    for (let file of files) {
      file = path.resolve(directoryPath, file);

      // Also ignore README.md files
      if (path.basename(file) === "README.md") {
        continue;
      }

      // ignore files that are not inside sources, transformations, or sinks subdirectories
      // TODO: this is a hacky way to do this, but it works for now
      if (
        !file.includes("sources") &&
        !file.includes("transformations") &&
        !file.includes("sinks")
      ) {
        continue;
      }

      const stat = await lstat(file);

      if (stat.isDirectory()) {
        await processDirectory(file, outputPath);
      } else if (path.extname(file) === ".md") {
        await processFile(file);
      }
    }

    await writeFile(
      outputPath,
      `export const data = ${JSON.stringify(output)};`,
      "utf8"
    );
  } catch (err) {
    console.error(err);
  }
};

const directoryPath = process.argv[2];
const outputPath = process.argv[3];

if (directoryPath && outputPath) {
  processDirectory(directoryPath, outputPath);
} else {
  console.log("Usage: node index.js <directoryPath> <outputFile.js>");
}
