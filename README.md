# @tenzir/codemirror-lang-tql

[Tenzir Query Language (TQL)](https://docs.tenzir.com/tql2) support for
[CodeMirror 6](https://codemirror.net), backed by
[tree-sitter-tql](https://github.com/tenzir/tree-sitter-tql), the grammar that
Zed, VS Code, and Neovim use as well.

The package parses TQL with tree-sitter through
[web-tree-sitter](https://www.npmjs.com/package/web-tree-sitter) and converts
every tree-sitter tree into a Lezer tree, so all of CodeMirror works from the
one grammar:

- Highlighting from tree-sitter-tql's `highlights.scm`, as standard
  `@lezer/highlight` tags
- Bracket matching and quote pairing that skip strings and comments, including
  strings that are not closed yet
- Indentation from `indents.scm`, folding from `folds.scm`
- Comment toggling
- Front matter, optionally highlighted with a nested YAML parser

## Install

```sh
pnpm add @tenzir/codemirror-lang-tql web-tree-sitter tree-sitter-tql
```

`web-tree-sitter`, `@codemirror/language`, `@lezer/common`, and
`@lezer/highlight` are peer dependencies. `tree-sitter-tql` provides the
grammar's WebAssembly; its queries ship inside this package.

## Usage

Tree-sitter runs as WebAssembly, which loads asynchronously, and the host
decides where it comes from. Load web-tree-sitter and the grammar, then pass
both to `tql()`:

```ts
import { syntaxHighlighting } from "@codemirror/language";
import { EditorView, basicSetup } from "codemirror";
import { tql, tqlHighlighter } from "@tenzir/codemirror-lang-tql";
import grammarWasmUrl from "tree-sitter-tql/tree-sitter-tql.wasm?url";
import runtimeWasmUrl from "web-tree-sitter/web-tree-sitter.wasm?url";

// Import web-tree-sitter on demand to keep it out of the main chunk.
const { Language, Parser, Query } = await import("web-tree-sitter");
await Parser.init({ locateFile: () => runtimeWasmUrl });
const language = await Language.load(grammarWasmUrl);

// Create the language once and share it between editors.
const tqlSupport = tql({ Parser, Query, language });

new EditorView({
  parent: document.body,
  doc: 'from "events.json" | where severity == "high"',
  extensions: [
    basicSetup,
    tqlSupport,
    syntaxHighlighting(
      tqlHighlighter({
        keyword: "text-red",
        operator: "text-red",
        attribute: "text-red",
        function: "text-purple",
        string: "text-blue",
        number: "text-blue",
        boolean: "text-blue",
        constant: "text-blue",
        variable: "text-blue",
        comment: "text-gray",
      }),
    ),
  ],
});
```

`tql()` takes web-tree-sitter's classes from the host rather than importing
them, so the package never loads web-tree-sitter by itself, and the parser
always comes from the same web-tree-sitter instance as the grammar.

If you don't need control over loading, `loadTql()` does all of the above:

```ts
import { loadTql } from "@tenzir/codemirror-lang-tql";

const tqlSupport = await loadTql({ runtimeWasmUrl, grammarWasmUrl });
```

It imports web-tree-sitter on demand and only initializes it when nothing
initialized it before, since initializing it again would invalidate grammars
that the host loaded already.

## API

```ts
function tql(treeSitter: TqlTreeSitter, options?: TqlOptions): LanguageSupport;

function loadTql(options: LoadTqlOptions): Promise<LanguageSupport>;

function tqlHighlighter(
  classes: Readonly<Record<string, string>>,
  tags?: TqlCaptureTags,
): Highlighter;

const tqlCaptureTags: Readonly<Record<string, Tag>>;

const tqlQueries: { highlights: string; indents: string; folds: string };

interface TqlTreeSitter {
  Parser: typeof import("web-tree-sitter").Parser; // after Parser.init()
  Query: typeof import("web-tree-sitter").Query;
  language: import("web-tree-sitter").Language;
}

interface TqlOptions {
  highlights?: string; // highlight query, tree-sitter-tql's by default
  indents?: string; // indent query, tree-sitter-tql's by default
  folds?: string; // fold query, tree-sitter-tql's by default
  tags?: TqlCaptureTags; // capture tags over the defaults
  frontmatter?: Parser; // a Lezer parser for the body of front matter
}

interface LoadTqlOptions extends TqlOptions {
  runtimeWasmUrl?: string; // web-tree-sitter.wasm
  grammarWasmUrl: string; // tree-sitter-tql.wasm
}

type TqlCaptureTags = Readonly<Record<string, Tag | null>>;
```

## Highlighting

The highlight query's captures become these tags (`tqlCaptureTags`):

| Capture                 | Tag                                |
| ----------------------- | ---------------------------------- |
| `keyword`               | `tags.keyword`                     |
| `operator`              | `tags.operator`                    |
| `attribute`             | `tags.attributeName`               |
| `function`              | `tags.function(tags.variableName)` |
| `function.call`         | `tags.function(tags.variableName)` |
| `function.method`       | `tags.function(tags.propertyName)` |
| `string`                | `tags.string`                      |
| `string.escape`         | `tags.escape`                      |
| `string.special`        | `tags.special(tags.string)`        |
| `number`                | `tags.number`                      |
| `boolean`               | `tags.bool`                        |
| `constant`              | `tags.constant(tags.name)`         |
| `constant.builtin`      | `tags.null`                        |
| `variable`              | `tags.variableName`                |
| `variable.builtin`      | `tags.special(tags.variableName)`  |
| `variable.parameter`    | `tags.local(tags.variableName)`    |
| `property`              | `tags.propertyName`                |
| `type`                  | `tags.typeName`                    |
| `label`                 | `tags.labelName`                   |
| `comment`               | `tags.comment`                     |
| `punctuation`           | `tags.punctuation`                 |
| `punctuation.bracket`   | `tags.bracket`                     |
| `punctuation.delimiter` | `tags.separator`                   |

A capture without an entry takes the tag of the nearest capture it refines, so
`function.builtin` would be a `function`. Captures starting with `_` never
color.

Captures follow tree-sitter's rules: an inner node's capture wins over the
capture of a node around it, such as the braces of a replacement in a format
string, and of two captures of the same node, the later pattern wins. Nodes
inside a captured node without a capture of their own take its tag, so a whole
format string is a string except where its parts say otherwise.

Any `@lezer/highlight` highlighter works, like `HighlightStyle` or
`classHighlighter`. `tqlHighlighter(classes)` styles by capture name instead,
the way tree-sitter themes do: `classes` maps a capture to a CSS class, and an
entry also covers the captures that refine it, so `function` covers
`function.call` and `function.method`. Unlike `tagHighlighter`, it does not
fall back from a tag to its parents.

A tree-sitter theme that leaves a capture unstyled shows the color of the node
around it, such as the parentheses of a call inside a format string. To do the
same, map such captures to `null` and pass the same `tags` to both functions:

```ts
const tags = { punctuation: null };
const extensions = [
  tql({ Parser, Query, language }, { tags }),
  syntaxHighlighting(tqlHighlighter(classes, tags)),
];
```

## Editing

- **Quote pairing:** `closeBrackets()` pairs `(`, `[`, `{`, `"`, and `'`, also
  after the string prefixes `f` and `b`, and the raw prefixes `r` and `br`
  with up to 8 `#`. Tree-sitter only lexes a
  string once it is closed; until then, it sees an error at the quote and
  parses what follows as code. The bridge turns the first quote that has no
  closing quote into a string that runs to the end of the document, as TQL's
  strings may span lines, so typing the closing quote doesn't insert a pair.
  The same goes for a `/*` comment without its `*/`.
- **Bracket matching:** `(`, `[`, and `{` match their closing brackets in the
  tree, so brackets in strings and comments don't count.
- **Indentation:** lines inside the nodes that `indents.scm` captures as
  `@indent` (blocks, pipelines, records, lists, match arms) are indented one
  unit past the line where the node starts, and a line starting with an
  `@outdent` token (`}` and `]`) lines up with that line. Elsewhere, a new line
  keeps the indentation of the line before. `indentOnInput()` reindents a line
  once you type its closing bracket.
- **Folding:** the nodes that `folds.scm` captures as `@fold` fold between
  their brackets, and front matter between its fences.
- **Comments:** `//` for lines and `/* */` for blocks.

## Front matter

TQL files may start with YAML front matter between `---` fences. The fences
highlight as comments. To edit the body as YAML, pass a YAML parser:

```ts
import { parser as yamlParser } from "@lezer/yaml";

const tqlSupport = tql({ Parser, Query, language }, { frontmatter: yamlParser });
```

## Lifetime and performance

Each parse runs tree-sitter on the whole document, converts the whole tree,
and frees the tree-sitter tree right away, also when something fails, so no
tree outlives a parse. This takes a few milliseconds for a typical pipeline
and about 15 ms for a 30 KB file. Reusing the previous tree with
`Tree.edit()` would need the edits, which Lezer's fragments only hint at, and
would keep a tree alive in WebAssembly memory between parses.

The language owns a tree-sitter parser and three queries, which live in
WebAssembly memory until you free them:

```ts
import type { TqlParser } from "@tenzir/codemirror-lang-tql";

(tqlSupport.language.parser as TqlParser).delete();
```

Afterwards, editors must not use the language anymore. Since the language is
meant to be created once per page, most hosts never need to free it.

The Lezer tree also serves views without an editor:

```ts
import { highlightTree } from "@lezer/highlight";

const tree = tqlSupport.language.parser.parse(text);
highlightTree(tree, highlighter, (from, to, classes) => { /* … */ });
```

## Limitations

- The bundled queries come from tree-sitter-tql 1.2.1 (`tqlQueries`). A query
  that names a node type the loaded grammar lacks does not compile, and `tql()`
  throws. With a different version of the grammar, pass its queries as
  `highlights`, `indents`, and `folds`, for example as Vite `?raw` imports.
- A nested parse over several ranges parses the text from the first range's
  start to the last range's end, gaps included.
- Recognizing strings that are not closed yet looks at the text around quotes
  that tree-sitter did not parse as part of a string, so it knows TQL's quote
  and prefix rules. Of several such strings, the first one wins.

## Development

```sh
pnpm install
pnpm build
pnpm test
```

The tests load the real grammar from `node_modules`.
