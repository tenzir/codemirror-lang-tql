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
- Indentation from `indents.scm`, folding from `folds.scm`, bracket pairs from
  `brackets.scm`
- Comment toggling
- Nested languages from `injections.scm`, such as YAML in front matter

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

## Migrating from 0.4

0.5 replaces the hand-written Lezer grammar with tree-sitter-tql, which loads
asynchronously:

- `TQL()` and `TenzirQueryLang` are gone. Create the language support once with
  `await loadTql({ runtimeWasmUrl, grammarWasmUrl })`, or load web-tree-sitter
  yourself and call `tql({ Parser, Query, language })`, and share it between
  editors. Until it has loaded, editors can run without it.
- Instead of `TenzirQueryLang.parser`, use `support.language.parser`, for
  example to highlight read-only views with `highlightTree`. It only exists
  once the grammar loaded.
- Highlighting uses the tags of the [capture mapping](#highlighting) instead
  of the coarse tags of 0.4. A `HighlightStyle` for those still matches most
  nodes, since functions and attributes fall back to `name` and numbers and
  booleans to `literal`, but operators are now `operator` rather than
  `punctuation`, `null` falls back to `keyword` rather than `literal`, and `$`
  variables to `name`. Check your style, or style by capture name with
  `tqlHighlighter(classes)`.
- Install `web-tree-sitter` and `tree-sitter-tql` and serve their `.wasm`
  files, for example with Vite's `?url` imports.
- Front matter now parses, and its fences highlight as comments. To edit its
  body as YAML, pass `nested: { yaml: yamlLanguage.parser }`, as shown under
  [Front matter](#front-matter).

## API

```ts
function tql(treeSitter: TqlTreeSitter, options?: TqlOptions): LanguageSupport;

function loadTql(options: LoadTqlOptions): Promise<LanguageSupport>;

function tqlHighlighter(classes: Readonly<Record<string, string>>): Highlighter;

const tqlCaptureTags: Readonly<Record<string, Tag>>;

const tqlQueries: {
  highlights: string;
  indents: string;
  folds: string;
  brackets: string;
  injections: string;
};

interface TqlTreeSitter {
  Parser: typeof import("web-tree-sitter").Parser; // after Parser.init()
  Query: typeof import("web-tree-sitter").Query;
  language: import("web-tree-sitter").Language;
}

interface TqlOptions {
  highlights?: string; // highlight query, tree-sitter-tql's by default
  indents?: string; // indent query, tree-sitter-tql's by default
  folds?: string; // fold query, tree-sitter-tql's by default
  brackets?: string; // bracket query, tree-sitter-tql's by default
  injections?: string; // injection query, tree-sitter-tql's by default
  tags?: TqlCaptureTags; // capture tags over the defaults
  nested?: Readonly<Record<string, Parser>>; // parsers by injected language
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

A node's tag is the tag of its capture with a modifier naming the capture,
so captures that share a tag, like `function` and `function.call`, stay
distinct. Any `@lezer/highlight` highlighter works, like `HighlightStyle` or
`classHighlighter`, and falls back to the tags in the table.
`tqlHighlighter(classes)` styles by capture name instead, the way tree-sitter
themes do: `classes` maps a capture to a CSS class, and an entry also covers the
captures that refine it, so `function` covers `function.call` and
`function.method` unless they have entries of their own. Unlike
`tagHighlighter`, it does not fall back from a tag to its parents.

A tree-sitter theme that leaves a capture unstyled shows the color of the node
around it, such as the parentheses of a call inside a format string. To do the
same, map such captures to `null`:

```ts
const extensions = [
  tql({ Parser, Query, language }, { tags: { punctuation: null } }),
  syntaxHighlighting(tqlHighlighter(classes)),
];
```

## Editing

- **Quote pairing:** `closeBrackets()` pairs `(`, `[`, `{`, `"`, and `'`, also
  after the string prefixes `f` and `b`, and the raw prefixes `r` and `br`
  with up to 8 `#`. tree-sitter-tql parses a string without its closing quote
  as a string that runs to the end of the document, as TQL's strings may span
  lines, so typing the closing quote doesn't insert a pair. The same goes for a
  `/*` comment without its `*/`.
- **Bracket matching:** the tokens that `brackets.scm` pairs as `@open` and
  `@close` (`( )`, `[ ]`, and `{ }`) match in the tree, so brackets in strings
  and comments don't count.
- **Indentation:** lines inside the nodes that `indents.scm` captures as
  `@indent` (blocks, pipelines, records, lists, match arms) are indented one
  unit past the line where the node starts, and a line starting with an
  `@outdent` token (`}` and `]`) lines up with that line. A line that starts
  inside a node captured as `@indent.auto` (strings, the text of format
  strings, comments, and the body of front matter) keeps its indentation, so a
  new line there takes the indentation of the line before, as in
  nvim-treesitter. At the top level, a new line keeps the indentation of the
  line before, too. `indentOnInput()` reindents a line once you type its
  closing bracket.
- **Folding:** the nodes that `folds.scm` captures as `@fold` fold between
  their `@open` and `@close` brackets, and front matter between its fences.
- **Comments:** `//` for lines and `/* */` for blocks.

## Front matter

TQL files may start with YAML front matter between `---` fences. The fences
highlight as comments. tree-sitter-tql's `injections.scm` injects the `yaml`
language into the body, and `nested` maps an injected language to the parser
that parses it. To edit the body as YAML, pass the parser of
`@codemirror/lang-yaml`'s language, which brings YAML's highlighting,
indentation, and `#` comments:

```ts
import { yamlLanguage } from "@codemirror/lang-yaml";

const tqlSupport = tql({ Parser, Query, language }, { nested: { yaml: yamlLanguage.parser } });
```

The bare parser of `@lezer/yaml` only highlights the body. A language without
a parser in `nested` stays part of the TQL tree. The bridge reads the language
from `#set! injection.language`, not from `@injection.language` captures.

## Lifetime and performance

Each parse runs tree-sitter on the document, or the prefix where CodeMirror
asks it to stop, without reusing an earlier tree. A generator yields between
steps targeting 4 ms, so CodeMirror can continue parsing in the background.
The combined highlight, indent, and fold query runs on small subtrees; larger
subtrees are queried one level at a time instead of repeatedly querying their
enclosing nodes.

Each parse owns its native parser and tree and frees them as soon as their
work finishes, also on errors. CodeMirror has no cancellation hook for parses
it drops, so a finalizer frees an abandoned parse's native handles once the
parse is garbage-collected. Active parses are never evicted, including when
several editors share the language. To free the combined query and all
unfinished parses immediately, without waiting for garbage collection, use:

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

- The bundled queries come from tree-sitter-tql 1.3.0 (`tqlQueries`). A query
  that names a node type the loaded grammar lacks does not compile, and `tql()`
  throws. With a different version of the grammar, pass its queries as
  `highlights`, `indents`, `folds`, `brackets`, and `injections`, for example
  as Vite `?raw` imports.
- A nested parse over several ranges sees the gaps between them as spaces, so
  a token cannot continue across a gap.
- Around syntax errors, tree-sitter may recover differently when it resumes a
  parse that yielded than when it parses the whole document at once.
- The 4 ms target is not a hard deadline. Custom queries that match many
  descendants or siblings, large individual tokens, and garbage collection
  can make a step take longer.
- Cleanup of abandoned parses depends on garbage collection and is not
  immediate. Call `delete()` when retiring the language to free all native
  handles deterministically.

## Development

```sh
pnpm install
pnpm build
pnpm test
```

The tests load the real grammar from `node_modules`.
