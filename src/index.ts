import { defineLanguageFacet, Language, LanguageSupport } from "@codemirror/language";
import { type Parser, parseMixed } from "@lezer/common";
import brackets from "tree-sitter-tql/queries/tql/brackets.scm";
import folds from "tree-sitter-tql/queries/tql/folds.scm";
import highlights from "tree-sitter-tql/queries/tql/highlights.scm";
import indents from "tree-sitter-tql/queries/tql/indents.scm";
import { TqlParser, type TqlTreeSitter } from "./parser";
import type { TqlCaptureTags } from "./tags";

export { TqlParser, type TqlTreeSitter } from "./parser";
export { type TqlCaptureTags, tqlCaptureTags, tqlHighlighter } from "./tags";

/** The queries of tree-sitter-tql that `tql` uses unless given others. */
export const tqlQueries: {
  readonly highlights: string;
  readonly indents: string;
  readonly folds: string;
  readonly brackets: string;
} = { highlights, indents, folds, brackets };

const rawPrefixes = ["r", "br"].flatMap((prefix) => {
  return Array.from({ length: 9 }, (_, hashes) => prefix + "#".repeat(hashes));
});

/** How `tql` sets up the language. */
export interface TqlOptions {
  /** The highlight query; tree-sitter-tql's `highlights.scm` by default. */
  readonly highlights?: string;
  /** The indent query; tree-sitter-tql's `indents.scm` by default. */
  readonly indents?: string;
  /** The fold query; tree-sitter-tql's `folds.scm` by default. */
  readonly folds?: string;
  /** The bracket query; tree-sitter-tql's `brackets.scm` by default. */
  readonly brackets?: string;
  /**
   * Style tags by capture name over the defaults of `tqlCaptureTags`, where
   * `null` leaves a capture out so that the node around it shows through.
   */
  readonly tags?: TqlCaptureTags;
  /**
   * A parser for the body of front matter. `yamlLanguage.parser` from
   * `@codemirror/lang-yaml` highlights and edits it as YAML; the bare parser
   * of `@lezer/yaml` only highlights it.
   */
  readonly frontmatter?: Parser;
}

/**
 * TQL language support for CodeMirror from tree-sitter-tql: highlighting,
 * bracket matching, quote pairing, indentation, folding, and comment
 * toggling.
 *
 * Takes web-tree-sitter's classes and the grammar the host loaded, after
 * `Parser.init()` and `Language.load()`, so the host decides where the
 * WebAssembly comes from and when it loads. The language owns a tree-sitter
 * parser and queries, which live in WebAssembly memory until
 * `(support.language.parser as TqlParser).delete()` frees them, so create it
 * once and share it between editors.
 */
export function tql(treeSitter: TqlTreeSitter, options: TqlOptions = {}): LanguageSupport {
  const data = defineLanguageFacet({
    commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
    closeBrackets: {
      // Raw strings take up to 8 hashes, as in tree-sitter-tql.
      stringPrefixes: ["f", "b", ...rawPrefixes],
    },
    indentOnInput: /^\s*[}\]]$/,
  });
  const frontmatter = options.frontmatter;
  const wrapper = frontmatter
    ? parseMixed((node) => (node.name === "frontmatter_body" ? { parser: frontmatter } : null))
    : undefined;
  const parser = new TqlParser(
    treeSitter,
    {
      highlights: options.highlights ?? highlights,
      indents: options.indents ?? indents,
      folds: options.folds ?? folds,
      brackets: options.brackets ?? brackets,
      tags: options.tags ?? {},
    },
    data,
    wrapper,
  );
  return new LanguageSupport(new Language(data, parser, [], "tql"));
}

/** Where `loadTql` loads web-tree-sitter and the grammar from. */
export interface LoadTqlOptions extends TqlOptions {
  /**
   * The URL of web-tree-sitter's `web-tree-sitter.wasm`. Without it,
   * web-tree-sitter looks next to its script. Ignored when web-tree-sitter
   * was initialized already.
   */
  readonly runtimeWasmUrl?: string;
  /** The URL of tree-sitter-tql's `tree-sitter-tql.wasm`. */
  readonly grammarWasmUrl: string;
}

let initialized: Promise<void> | undefined;

/**
 * Imports web-tree-sitter on demand, initializes it unless that happened
 * already, loads the grammar, and returns `tql()` for it.
 */
export async function loadTql(options: LoadTqlOptions): Promise<LanguageSupport> {
  const { Language: TreeSitterLanguage, Parser: TreeSitterParser, Query } = await import(
    "web-tree-sitter"
  );
  initialized ??= (async () => {
    try {
      // Initializing again would replace the runtime under the grammars that
      // the host loaded already, so only initialize what cannot parse yet.
      new TreeSitterParser().delete();
    } catch {
      const url = options.runtimeWasmUrl;
      await TreeSitterParser.init(url === undefined ? undefined : { locateFile: () => url });
    }
  })().catch((error) => {
    initialized = undefined;
    throw error;
  });
  await initialized;
  const language = await TreeSitterLanguage.load(options.grammarWasmUrl);
  return tql({ Parser: TreeSitterParser, Query, language }, options);
}
