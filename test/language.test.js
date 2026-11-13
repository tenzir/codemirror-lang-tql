import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { closeBrackets, insertBracket } from "@codemirror/autocomplete";
import { insertNewlineAndIndent, toggleComment } from "@codemirror/commands";
import { yamlLanguage } from "@codemirror/lang-yaml";
import { ensureSyntaxTree, foldable, getIndentation, matchBrackets, syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { NodeProp, parseMixed } from "@lezer/common";
import { classHighlighter, highlightTree, tags as t } from "@lezer/highlight";
import { tqlCaptureTags, tqlHighlighter } from "../dist/index.js";
import {
  example,
  exampleUpTo,
  highlight,
  makeSupport,
  paint,
  paintTreeSitter,
  parse,
  stateOf,
  support,
} from "./helpers.js";

/** The document after running `command` on the state for `doc`. */
const run = (command, doc) => {
  let state = stateOf(doc);
  command({ state, dispatch: (tr) => (state = tr.state) });
  return state.doc.toString();
};

describe("highlighting", () => {
  it("colors the example", () => {
    const spans = highlight(example);
    for (const span of [
      ["---\n", "comment"],
      ["// The networks and ports to watch.", "comment"],
      ["/* Name the service by its port\n   (or keep the port for others). */", "comment"],
      ["let", "keyword"],
      ["$", "keyword"],
      ["internal", "variable.builtin"],
      ["from_file", "function.call"],
      ["to_upper", "function.method"],
      ["sum", "function.call"],
      ["@", "keyword"],
      ["name", "attribute"],
      ["?", "keyword"],
      ["else", "keyword"],
      ["match", "keyword"],
      ["=>", "operator"],
      ["_", "variable.builtin"],
      ["==", "operator"],
      ['"zeek.conn"', "string"],
      ['r#"Uploaded "{orig_bytes}" bytes"#', "string"],
      ['b"\\x00\\x01"', "string"],
      ["10.0.0.0/8", "constant"],
      ["192.168.0.1", "constant"],
      ["30s", "number"],
      ["1Mi", "number"],
      ["2.5e3", "number"],
      ["true", "boolean"],
      ["null", "constant.builtin"],
      ["(", "punctuation.bracket"],
      [",", "punctuation.delimiter"],
    ]) {
      assert.ok(spans.some(([text, cls]) => text === span[0] && cls === span[1]), span.join(" "));
    }
  });

  it("colors inner captures over outer ones", () => {
    // The replacement is part of the format string, whose color its
    // uncolored nodes keep, while its braces are keywords.
    const text = 'service = f"port-{id.resp_p}"';
    assert.deepEqual(highlight(text), [
      ["=", "operator"],
      ['f"port-', "string"],
      ["{", "keyword"],
      ["id", "string"],
      [".", "keyword"],
      ["resp_p", "string"],
      ["}", "keyword"],
      ['"', "string"],
    ]);
  });

  it("colors like tree-sitter does", () => {
    // As the Tenzir platform colors, which leaves punctuation uncolored.
    const platform = makeSupport({ tags: { punctuation: null } });
    assert.deepEqual(paint(example, parse(example, platform)), paintTreeSitter(example));
    platform.language.parser.delete();
  });

  it("maps captures to the documented tags", () => {
    assert.equal(tqlCaptureTags.keyword, t.keyword);
    assert.equal(tqlCaptureTags.operator, t.operator);
    assert.equal(tqlCaptureTags.attribute, t.attributeName);
    assert.equal(tqlCaptureTags["function.call"], t.function(t.variableName));
    assert.equal(tqlCaptureTags["function.method"], t.function(t.propertyName));
    assert.equal(tqlCaptureTags.string, t.string);
    assert.equal(tqlCaptureTags.number, t.number);
    assert.equal(tqlCaptureTags.boolean, t.bool);
    assert.equal(tqlCaptureTags.constant, t.constant(t.name));
    assert.equal(tqlCaptureTags["constant.builtin"], t.null);
    assert.equal(tqlCaptureTags["variable.builtin"], t.special(t.variableName));
    assert.equal(tqlCaptureTags.comment, t.comment);
    assert.equal(tqlCaptureTags["punctuation.bracket"], t.bracket);
    assert.equal(tqlCaptureTags["punctuation.delimiter"], t.separator);
  });

  it("works with standard highlighters", () => {
    const text = '@name = "zeek.conn" // c';
    const spans = [];
    highlightTree(parse(text), classHighlighter, (from, to, cls) => {
      spans.push([text.slice(from, to), cls]);
    });
    assert.deepEqual(spans, [
      ["@", "tok-keyword"],
      ["name", "tok-propertyName"],
      ["=", "tok-operator"],
      ['"zeek.conn"', "tok-string"],
      ["// c", "tok-comment"],
    ]);
  });

  it("takes classes by capture prefix", () => {
    const text = "x = f(y.g())";
    assert.deepEqual(highlight(text, parse(text), { function: "fn" }), [
      ["f", "fn"],
      ["g", "fn"],
    ]);
  });

  it("takes other queries and tells apart captures that share a tag", () => {
    const custom = makeSupport({
      highlights: "(identifier) @function\n(number) @function.call\n(string) @function.builtin",
      indents: "",
      folds: "",
    });
    const text = 'x = 1 + "a"';
    const classes = { function: "fn", "function.call": "call", "function.builtin": "builtin" };
    assert.deepEqual(highlight(text, parse(text, custom), classes), [
      ["x", "fn"],
      ["1", "call"],
      ['"a"', "builtin"],
    ]);
    custom.language.parser.delete();
  });
});

describe("quote pairing", () => {
  /** What typing `quote` at the cursor inserts, if it inserts anything. */
  const insert = (doc, quote) => {
    const state = stateOf(doc, closeBrackets());
    const tr = insertBracket(state, quote);
    return tr === null ? null : tr.state.doc.toString();
  };

  it("pairs quotes and brackets that open something", () => {
    assert.equal(insert("x = ", '"'), 'x = ""');
    assert.equal(insert("x = ", "'"), "x = ''");
    assert.equal(insert("x = f(▮)", '"'), 'x = f("")');
    assert.equal(insert("x = ", "{"), "x = {}");
    for (const prefix of ["f", "b", "r", "r#", "br##"]) {
      assert.equal(insert(`x = ${prefix}`, '"'), `x = ${prefix}""`, prefix);
    }
  });

  it("does not pair a quote that closes an open string", () => {
    for (const text of [
      '"Grüße 👋',
      'f"port-',
      'f"port-{id.',
      'r#"Uploaded "{orig_bytes}',
      'b"\\x00',
    ]) {
      const doc = exampleUpTo(text);
      // The string runs to the end of the document until it is closed.
      const node = parse(doc).resolveInner(doc.length, -1);
      assert.ok(["string", "format_text"].includes(node.name), `${node.name} in ${text}`);
      assert.equal(insert(doc, '"'), null, text);
    }
    assert.equal(insert('x = "a, ▮\ny = 1', '"'), null);
    assert.equal(insert('x = f"{g("abc, ', '"'), null);
    assert.equal(insert("x = r########\"abc, ", '"'), null);
  });

  it("ignores braces in comments of a format string's replacement", () => {
    assert.equal(insert('x = f"{g(/* } */ "abc, ', '"'), null);
    assert.equal(insert('x = f"{g(// }\n "abc, ', '"'), null);
  });

  it("steps over the quote it inserted", () => {
    const paired = insertBracket(stateOf("x = ", closeBrackets()), '"').state;
    const stepped = insertBracket(paired, '"').state;
    assert.equal(stepped.doc.toString(), 'x = ""');
    assert.equal(stepped.selection.main.head, 6);
  });

  it("runs open strings and block comments to the end of the document", () => {
    for (const [text, literal, name] of [
      ['x = "a\ny = 1', '"a\ny = 1', "string"],
      ['x = f"a{b', 'f"a{b', "format_expr"],
      ["x = 1 /* a\ny = 2", "/* a\ny = 2", "comment"],
    ]) {
      let node = parse(text).resolveInner(text.length, -1);
      while (node.name !== name && node.parent) node = node.parent;
      assert.equal(text.slice(node.from, node.to), literal, text);
    }
  });
});

describe("editing", () => {
  it("matches brackets, but not in strings and comments", () => {
    const state = stateOf(example);
    const open = example.indexOf("(port =>");
    assert.deepEqual(matchBrackets(state, open, 1).end, {
      from: example.indexOf(")", open),
      to: example.indexOf(")", open) + 1,
    });
    // Over the braces of the arms and of the format string's replacement.
    const match = example.indexOf("{", example.indexOf("match"));
    const close = example.indexOf("\n}", match) + 1;
    assert.deepEqual(matchBrackets(state, match, 1).end, { from: close, to: close + 1 });
    const doc = 'x = f(")", /* ) */ "(" // )\n)';
    assert.deepEqual(matchBrackets(stateOf(doc), 5, 1).end, { from: doc.length - 1, to: doc.length });
    assert.equal(matchBrackets(stateOf("x = f(a"), 5, 1).matched, false);
    // The brackets of a list too wide for the bracket query match by name.
    const wide = `x = [${'"]",'.repeat(300)}1]`;
    assert.deepEqual(matchBrackets(stateOf(wide), 4, 1).end, { from: wide.length - 1, to: wide.length });
  });

  it("indents the example as written", () => {
    const state = stateOf(example);
    let checked = 0;
    for (let n = 1; n <= state.doc.lines; n++) {
      const line = state.doc.line(n);
      const indent = getIndentation(state, line.from);
      // Lines in front matter and block comments keep their indentation.
      if (indent === null) continue;
      assert.equal(indent, /^ */.exec(line.text)[0].length, `line ${n}: ${line.text}`);
      checked++;
    }
    assert.ok(checked > 30);
  });

  it("indents new lines", () => {
    assert.equal(run(insertNewlineAndIndent, "let $p = {"), "let $p = {\n  ");
    assert.equal(run(insertNewlineAndIndent, "let $p = {▮}"), "let $p = {\n  \n}");
    assert.equal(run(insertNewlineAndIndent, "if x {\n  a\n}▮"), "if x {\n  a\n}\n");
    // At the top level, a new line keeps the indentation of the line before.
    assert.equal(run(insertNewlineAndIndent, "from x\n  | where y"), "from x\n  | where y\n  ");
    // A closing bracket reindents its line.
    const state = stateOf("x = {\n  a: 1\n  }");
    assert.ok(state.languageDataAt("indentOnInput", 0).some((re) => re.test("  }")));
    assert.equal(getIndentation(state, state.doc.line(3).from), 0);
  });

  it("keeps the indentation inside verbatim text", () => {
    // The `@indent.auto` nodes: strings, the text of format strings, comments.
    assert.equal(run(insertNewlineAndIndent, 'if x {\n  y = "a\n      b▮c"\n}'), 'if x {\n  y = "a\n      b\n      c"\n}');
    assert.equal(run(insertNewlineAndIndent, 'x = f"a\n    b▮c"'), 'x = f"a\n    b\n    c"');
    assert.equal(run(insertNewlineAndIndent, "/* a\n     b▮ */"), "/* a\n     b\n     */");
    // Replacements and the end of a line comment indent by structure.
    assert.equal(run(insertNewlineAndIndent, 'if x {\n  y = f"{[▮]}"\n}'), 'if x {\n  y = f"{[\n    \n  ]}"\n}');
    assert.equal(run(insertNewlineAndIndent, "let $p = {a: 1, // c▮\n}"), "let $p = {a: 1, // c\n  \n}");
    // So does the end of the document, which lies inside no node, even after
    // a string that is not closed yet.
    for (const end of ['"a\n      b"', '"a\n      b', "1 // c"]) {
      const doc = `if x {\n  y = ${end}`;
      assert.equal(run(insertNewlineAndIndent, doc), `${doc}\n  `, end);
    }
  });

  it("folds blocks and front matter", () => {
    const state = stateOf(example);
    const fold = (text) => {
      const line = state.doc.lineAt(example.indexOf(text));
      const range = foldable(state, line.from, line.to);
      return range && example.slice(range.from, range.to);
    };
    assert.equal(fold("---"), "\nname: Flag large uploads\ndescription: |\n  Reads Zeek connection logs and flags large uploads.");
    assert.equal(fold("from_file"), "\n  read_zeek_tsv\n");
    assert.match(fold("match"), /^\n {2}22 => .*\n$/s);
    assert.equal(fold("if orig_bytes"), '\n  severity = "high"\n  note = r#"Uploaded "{orig_bytes}" bytes"#\n');
    assert.equal(fold("gateway"), null);
  });

  it("pairs the brackets of the bracket query", () => {
    const doc = "x = {a: 1,\n  b: [2,\n  3]\n}";
    const squares = makeSupport({ brackets: '("[" @open "]" @close)' });
    const closedBy = (with_) => parse(doc, with_).resolveInner(4, 1).type.prop(NodeProp.closedBy);
    assert.deepEqual(closedBy(support), ["}"]);
    assert.equal(closedBy(squares), undefined);
    // A fold starts after an opening bracket, or else at the end of the line.
    const fold = (with_) => {
      const state = EditorState.create({ doc, extensions: [with_] });
      const range = foldable(state, 0, state.doc.line(1).to);
      return doc.slice(range.from, range.to);
    };
    assert.equal(fold(support), "a: 1,\n  b: [2,\n  3]\n");
    assert.equal(fold(squares), "\n  b: [2,\n  3]");
    squares.language.parser.delete();
  });

  it("toggles comments", () => {
    assert.equal(run(toggleComment, "from x"), "// from x");
    assert.equal(run(toggleComment, "// from x"), "from x");
    assert.deepEqual(stateOf("").languageDataAt("commentTokens", 0)[0], {
      line: "//",
      block: { open: "/*", close: "*/" },
    });
  });
});

describe("front matter", () => {
  /** The highlighted spans of the front matter. */
  const frontMatter = (state) => {
    const spans = [];
    highlightTree(ensureSyntaxTree(state, example.length, 5000), classHighlighter, (from, to, cls) => {
      if (to <= example.indexOf("---", 3) + 4) spans.push([example.slice(from, to), cls]);
    });
    return spans;
  };

  it("highlights and edits the body as YAML with a nested parser", () => {
    const yaml = makeSupport({ nested: { yaml: yamlLanguage.parser } });
    let state = EditorState.create({ doc: example, selection: { anchor: 5 }, extensions: [yaml] });
    assert.deepEqual(frontMatter(state).slice(0, 4), [
      ["---\n", "tok-comment"],
      ["name", "tok-propertyName tok-definition"],
      [":", "tok-punctuation"],
      ["description", "tok-propertyName tok-definition"],
    ]);
    toggleComment({ state, dispatch: (tr) => (state = tr.state) });
    assert.equal(state.doc.line(2).text, "# name: Flag large uploads");
    state = state.update({ selection: { anchor: state.doc.line(3).to } }).state;
    insertNewlineAndIndent({ state, dispatch: (tr) => (state = tr.state) });
    assert.equal(state.doc.line(4).text, "  ");
    yaml.language.parser.delete();
  });

  it("nests the languages of the injection query", () => {
    for (const [injections, nested] of [
      [undefined, { json: yamlLanguage.parser }],
      ["", { yaml: yamlLanguage.parser }],
    ]) {
      const support = makeSupport({ injections, nested });
      const state = EditorState.create({ doc: example, extensions: [support] });
      assert.deepEqual(frontMatter(state), [["---\n", "tok-comment"], ["---\n", "tok-comment"]]);
      support.language.parser.delete();
    }
    // Into the root, too.
    const injections = '((program) @injection.content (#set! injection.language "yaml"))';
    const support = makeSupport({ injections, nested: { yaml: yamlLanguage.parser } });
    const state = EditorState.create({ doc: "name: x", extensions: [support] });
    assert.equal(syntaxTree(state).resolveInner(1, 1).name, "Literal");
    support.language.parser.delete();
  });
});

describe("parse ranges", () => {
  it("parses the text of the ranges only", () => {
    const text = "// x\nfrom y";
    const tree = support.language.parser.parse(text, [], [{ from: 5, to: text.length }]);
    assert.equal(tree.length, 6);
    assert.equal(tree.resolveInner(0, 1).name, "identifier");
    // The gaps between ranges, like the quote here, belong to someone else.
    const gaps = support.language.parser.parse('x = "XX1', [], [
      { from: 0, to: 4 },
      { from: 7, to: 8 },
    ]);
    assert.equal(gaps.resolveInner(7, 1).name, "number");
    // As in an overlay of an outer language, which owns the gaps.
    const outer = yamlLanguage.parser.configure({
      wrap: parseMixed((node) => {
        if (node.name !== "Document") return null;
        return { parser: support.language.parser, overlay: [{ from: 3, to: 7 }, { from: 18, to: 19 }] };
      }),
    });
    assert.equal(outer.parse('a: x = \nb: "XX\nc: 1').resolveInner(18, 1).name, "number");
  });
});
