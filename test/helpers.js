import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { EditorState } from "@codemirror/state";
import { highlightTree } from "@lezer/highlight";
import * as TreeSitter from "web-tree-sitter";
import { tql, tqlCaptureTags, tqlHighlighter, tqlQueries } from "../dist/index.js";

const require = createRequire(import.meta.url);

await TreeSitter.Parser.init();

/** The grammar, loaded from the installed tree-sitter-tql. */
export const language = await TreeSitter.Language.load(
  require.resolve("tree-sitter-tql/tree-sitter-tql.wasm"),
);

export { TreeSitter };

/** The pipeline that the tests work with. */
export const example = readFileSync(new URL("example.tql", import.meta.url), "utf8");

/** The text of `example` up to and including the first `text`. */
export const exampleUpTo = (text) => example.slice(0, example.indexOf(text) + text.length);

/** TQL's language support for the grammar. */
export const makeSupport = (options) =>
  tql({ Parser: TreeSitter.Parser, Query: TreeSitter.Query, language }, options);

/** TQL's language support with the default options. */
export const support = makeSupport();

/** Parses `text` into a Lezer tree. */
export const parse = (text, with_ = support) => with_.language.parser.parse(text);

/** An editor state for `doc` with the cursor at `▮`, or at the end. */
export const stateOf = (doc, extensions = []) => {
  const cursor = doc.indexOf("▮");
  const text = cursor < 0 ? doc : doc.slice(0, cursor) + doc.slice(cursor + 1);
  return EditorState.create({
    doc: text,
    selection: { anchor: cursor < 0 ? text.length : cursor },
    extensions: [support, extensions],
  });
};

/** A class per capture name: the capture's own name. */
export const captureClasses = Object.fromEntries(
  Object.keys(tqlCaptureTags).map((capture) => [capture, capture]),
);

/** The highlighted ranges of `tree` over `text` as `[text, class]` pairs. */
export const highlight = (text, tree = parse(text), classes = captureClasses) => {
  const spans = [];
  highlightTree(tree, tqlHighlighter(classes), (from, to, cls) => {
    spans.push([text.slice(from, to), cls]);
  });
  return spans;
};

/** The colors of the Tenzir platform, by capture. */
export const platformClasses = {
  keyword: "red",
  operator: "red",
  attribute: "red",
  function: "purple",
  string: "lightblue",
  number: "lightblue",
  boolean: "lightblue",
  constant: "lightblue",
  variable: "lightblue",
  comment: "gray",
};

/** The class of every UTF-16 code unit of `text` in `tree`. */
export const paint = (text, tree, classes = platformClasses) => {
  const painted = new Array(text.length).fill("");
  highlightTree(tree, tqlHighlighter(classes), (from, to, cls) => painted.fill(cls, from, to));
  return painted;
};

/**
 * The class of every UTF-16 code unit of `text` as tree-sitter colors it, by
 * the first component of a capture's name: inner nodes win, and of two
 * captures of the same node the later pattern wins. This is how the Tenzir
 * platform colors its read-only views.
 */
export const paintTreeSitter = (text, classes = platformClasses) => {
  const parser = new TreeSitter.Parser();
  parser.setLanguage(language);
  const query = new TreeSitter.Query(language, tqlQueries.highlights);
  const tree = parser.parse(text);
  try {
    const captures = query
      .captures(tree.rootNode)
      .map(({ name, node }) => ({
        from: node.startIndex,
        to: node.endIndex,
        cls: classes[name.split(".")[0]] ?? "",
      }))
      .filter(({ from, to, cls }) => from < to && cls !== "");
    captures.sort((a, b) => b.to - b.from - (a.to - a.from));
    const painted = new Array(text.length).fill("");
    for (const { from, to, cls } of captures) painted.fill(cls, from, Math.min(to, text.length));
    return painted;
  } finally {
    tree.delete();
    query.delete();
    parser.delete();
  }
};
