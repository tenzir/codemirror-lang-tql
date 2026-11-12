import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { closeBrackets, insertBracket } from "@codemirror/autocomplete";
import { insertNewlineAndIndent, toggleComment } from "@codemirror/commands";
import {
  foldable,
  getIndentation,
  matchBrackets,
  syntaxTree,
} from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { classHighlighter, highlightTree, tags as t } from "@lezer/highlight";
import { parser as yamlParser } from "@lezer/yaml";
import { tqlCaptureTags, tqlHighlighter, tqlQueries } from "../dist/index.js";
import {
  TreeSitter,
  highlight,
  language,
  makeSupport,
  paintLezer,
  paintTreeSitter,
  parse,
  platformClasses,
  platformTags,
  support,
} from "./helpers.js";

/** An editor state for `doc` with the cursor at `▮`, or at the end. */
const stateOf = (doc, extensions = []) => {
  const cursor = doc.indexOf("▮");
  const text = cursor < 0 ? doc : doc.slice(0, cursor) + doc.slice(cursor + 1);
  return EditorState.create({
    doc: text,
    selection: { anchor: cursor < 0 ? text.length : cursor },
    extensions: [support, extensions],
  });
};

/** The document after running `command` on the state for `doc`. */
const run = (command, doc) => {
  let state = stateOf(doc);
  command({ state, dispatch: (tr) => (state = tr.state) });
  return state.doc.toString();
};

/** Checks that `tree` is well formed and covers `text`. */
const checkTree = (tree, text) => {
  assert.equal(tree.length, text.length);
  assert.equal(tree.type.isTop, true);
  const cursor = tree.cursor();
  const check = () => {
    const { from, to } = cursor;
    assert.ok(0 <= from && from <= to && to <= text.length, `${cursor.name} at ${from}-${to}`);
    if (cursor.firstChild()) {
      let end = from;
      do {
        assert.ok(cursor.from >= end, `${cursor.name} at ${cursor.from} overlaps ${end}`);
        assert.ok(cursor.to <= to, `${cursor.name} ends after its parent`);
        end = cursor.to;
        check();
      } while (cursor.nextSibling());
      cursor.parent();
    }
  };
  check();
};

describe("tree conversion", () => {
  it("maps tree-sitter nodes to Lezer nodes", () => {
    const text = 'from "x" | where a? != null and not b';
    const tree = parse(text);
    checkTree(tree, text);
    assert.equal(
      tree.toString(),
      'program(pipeline(statement(invocation(entity(identifier),arguments(argument(expression(primary_expression(literal(string))))))),"|",statement(invocation(entity(identifier),arguments(argument(expression(binary_expression(expression(binary_expression(expression(primary_expression(identifier,"?")),"!=",expression(primary_expression(literal(null))))),and,expression(unary_expression(not,expression(primary_expression(identifier))))))))))))',
    );
    const string = tree.resolveInner(6, 1);
    assert.equal(string.name, "string");
    assert.deepEqual([string.from, string.to], [5, 8]);
  });

  it("marks missing tokens as empty error nodes", () => {
    const tree = parse("x = ");
    let errors = 0;
    tree.iterate({
      enter: (node) => {
        if (node.type.isError) {
          errors++;
          assert.equal(node.from, node.to);
        }
      },
    });
    assert.equal(errors, 1);
  });

  it("keeps error nodes", () => {
    const tree = parse("x = )");
    let errors = 0;
    tree.iterate({ enter: (node) => void (node.type.isError && errors++) });
    assert.ok(errors > 0);
  });

  it("counts positions in UTF-16 code units", () => {
    const text = 'x = "😀🤨" | y = f(1) // 🎉\nz = "ä"';
    const tree = parse(text);
    checkTree(tree, text);
    assert.deepEqual(highlight(text), [
      ["=", "operator"],
      ['"😀🤨"', "string"],
      ["|", "operator"],
      ["=", "operator"],
      ["f", "function.call"],
      ["(", "punctuation.bracket"],
      ["1", "number"],
      [")", "punctuation.bracket"],
      ["// 🎉", "comment"],
      ["=", "operator"],
      ['"ä"', "string"],
    ]);
  });

  it("parses front matter", () => {
    const text = "---\nname: x\n---\nfrom y";
    const tree = parse(text);
    checkTree(tree, text);
    assert.match(tree.toString(), /^program\(frontmatter\(frontmatter_open,frontmatter_body\(frontmatter_line\),frontmatter_close\),pipeline/);
    assert.deepEqual(highlight(text), [
      ["---\n", "comment"],
      ["---\n", "comment"],
      ["from", "function.call"],
    ]);
  });

  it("parses the body of front matter with a nested parser", () => {
    const yaml = makeSupport({ frontmatter: yamlParser });
    const text = "---\nname: x\n---\nfrom y";
    const state = EditorState.create({ doc: text, extensions: [yaml] });
    const spans = [];
    highlightTree(syntaxTree(state), classHighlighter, (from, to, cls) => {
      spans.push([text.slice(from, to), cls]);
    });
    assert.deepEqual(spans, [
      ["---\n", "tok-comment"],
      ["name", "tok-propertyName tok-definition"],
      [":", "tok-punctuation"],
      ["---\n", "tok-comment"],
      ["from", "tok-variableName"],
    ]);
    yaml.language.parser.delete();
  });

  it("parses parts of a document", () => {
    const text = "// x\nfrom y";
    const tree = support.language.parser.parse(text, [], [{ from: 5, to: text.length }]);
    assert.equal(tree.length, 6);
    assert.equal(tree.toString(), "program(pipeline(statement(invocation(entity(identifier),arguments(argument(expression(primary_expression(identifier))))))))");
  });

  it("does not throw on malformed input", () => {
    const inputs = [
      "",
      "\n\n\n",
      "}}}",
      "{{{",
      ')])}]',
      '"""',
      "'''",
      'f"{',
      'f"{"',
      'f"{x"}',
      "r###\"",
      "/*",
      "*/",
      "---",
      "---\n",
      "---\nfoo: [\n",
      "| | |",
      "let let let",
      "match { => => }",
      "\\\n\\",
      "\u0000\uffff\ud800",
      "x = \"a\\",
    ];
    // Random soup of TQL's tokens, deterministically.
    const pieces = [..."(){}[]\"'\\/*#@$?.,:;=|<>!+-_ \n\tabfr0123", "//", "/*", "*/", "=>", "f\"", "r#\"", "---\n", "let", "if", "else", "match", "😀"];
    let seed = 42;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let i = 0; i < 500; i++) {
      let text = "";
      const length = Math.floor(random() * 40);
      for (let j = 0; j < length; j++) text += pieces[Math.floor(random() * pieces.length)];
      inputs.push(text);
    }
    for (const text of inputs) {
      checkTree(parse(text), text);
      const state = stateOf(text);
      for (let pos = 0; pos <= text.length; pos++) {
        getIndentation(state, pos);
        matchBrackets(state, pos, 1);
        matchBrackets(state, pos, -1);
      }
    }
  });
});

describe("highlighting", () => {
  it("colors a pipeline", () => {
    assert.deepEqual(highlight('from "x" | where a? != null and not b'), [
      ["from", "function.call"],
      ['"x"', "string"],
      ["|", "operator"],
      ["where", "function.call"],
      ["?", "keyword"],
      ["!=", "operator"],
      ["null", "constant.builtin"],
      ["and", "keyword"],
      ["not", "keyword"],
    ]);
  });

  it("colors metadata", () => {
    assert.deepEqual(highlight('@name = "ocsf"'), [
      ["@", "keyword"],
      ["name", "attribute"],
      ["=", "operator"],
      ['"ocsf"', "string"],
    ]);
  });

  it("colors variables and durations", () => {
    assert.deepEqual(highlight("$var.x = 1e3s"), [
      ["$", "keyword"],
      ["var", "variable.builtin"],
      [".", "keyword"],
      ["=", "operator"],
      ["1e3s", "number"],
    ]);
  });

  it("colors inner captures over outer ones", () => {
    // The replacement is part of the format string, whose color its
    // uncolored nodes keep, while its braces are keywords.
    assert.deepEqual(highlight('match x { "a" => { y = f"{b}-c" } }'), [
      ["match", "keyword"],
      ["{", "keyword"],
      ['"a"', "string"],
      ["=>", "operator"],
      ["{", "keyword"],
      ["=", "operator"],
      ['f"', "string"],
      ["{", "keyword"],
      ["b", "string"],
      ["}", "keyword"],
      ['-c"', "string"],
      ["}", "keyword"],
      ["}", "keyword"],
    ]);
  });

  it("colors pipeline expressions and records", () => {
    assert.deepEqual(highlight("let $p = { from {x: 1} }"), [
      ["let", "keyword"],
      ["$", "keyword"],
      ["p", "variable.builtin"],
      ["=", "operator"],
      ["{", "keyword"],
      ["from", "function.call"],
      ["{", "keyword"],
      [":", "keyword"],
      ["1", "number"],
      ["}", "keyword"],
      ["}", "keyword"],
    ]);
  });

  it("colors lambdas and methods", () => {
    assert.deepEqual(highlight("y = xs.map(x => x + 1)\nz = map(xs, (x) => x * 2)"), [
      ["=", "operator"],
      [".", "keyword"],
      ["map", "function.method"],
      ["(", "punctuation.bracket"],
      ["=>", "operator"],
      ["+", "keyword"],
      ["1", "number"],
      [")", "punctuation.bracket"],
      ["=", "operator"],
      ["map", "function.call"],
      ["(", "punctuation.bracket"],
      [",", "punctuation.delimiter"],
      ["(", "punctuation.bracket"],
      [")", "punctuation.bracket"],
      ["=>", "operator"],
      ["*", "keyword"],
      ["2", "number"],
      [")", "punctuation.bracket"],
    ]);
  });

  it("colors literals", () => {
    assert.deepEqual(highlight("x = 1.2.3.4 | y = 10.0.0.0/8 | z = 2024-01-01 | w = true | v = _"), [
      ["=", "operator"],
      ["1.2.3.4", "constant"],
      ["|", "operator"],
      ["=", "operator"],
      ["10.0.0.0/8", "constant"],
      ["|", "operator"],
      ["=", "operator"],
      ["2024-01-01", "number"],
      ["|", "operator"],
      ["=", "operator"],
      ["true", "boolean"],
      ["|", "operator"],
      ["=", "operator"],
      ["_", "variable.builtin"],
    ]);
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
    const text = '@x = f(1) // c';
    const spans = [];
    highlightTree(parse(text), classHighlighter, (from, to, cls) => {
      spans.push([text.slice(from, to), cls]);
    });
    assert.deepEqual(spans, [
      ["@", "tok-keyword"],
      ["x", "tok-propertyName"],
      ["=", "tok-operator"],
      ["f", "tok-variableName"],
      ["(", "tok-punctuation"],
      ["1", "tok-number"],
      [")", "tok-punctuation"],
      ["// c", "tok-comment"],
    ]);
  });

  it("takes classes by capture prefix", () => {
    assert.deepEqual(highlight("f(x.g())", { function: "fn" }), [
      ["f", "fn"],
      ["g", "fn"],
    ]);
  });

  it("lets captures show the color around them when left out", () => {
    const text = 'x = f"{g(1, 2)}"';
    assert.deepEqual(highlight(text, platformClasses), [
      ["=", "red"],
      ['f"', "lightblue"],
      ["{", "red"],
      ["g", "purple"],
      ["(", ""],
      ["1", "lightblue"],
      [",", ""],
      [" 2", "lightblue"],
      [")", ""],
      ["}", "red"],
      ['"', "lightblue"],
    ].filter(([, cls]) => cls !== ""));
    assert.deepEqual(highlight(text, platformClasses, platformTags), [
      ["=", "red"],
      ['f"', "lightblue"],
      ["{", "red"],
      ["g", "purple"],
      ["(1, 2)", "lightblue"],
      ["}", "red"],
      ['"', "lightblue"],
    ]);
  });

  it("colors like tree-sitter does", () => {
    const yaml = makeSupport({ tags: platformTags });
    const texts = [
      'from "x" | where a? != null and not b',
      '@name = "ocsf"',
      "$var.x = 1e3s",
      'match x { "a" => { y = f"{b}-c" } }',
      "let $p = { from {x: 1} }",
      "y = xs.map(x => x + 1)\nz = map(xs, (x) => x * 2)",
      "---\nname: x\n---\nfrom y\n",
      'x = f"{g(1, 2)}" + r#"a"b"# + b"x" + \'y\' // z\n/* a\nb */ y = this.x[0]...',
      "if x in [1, 2] {\n  a = 1\n} else {\n  b = -2.5e3\n}\nwhere ::foo::bar(x) and y::z",
    ];
    for (const text of texts) {
      assert.deepEqual(
        paintLezer(text, platformClasses, platformTags, parse(text, yaml)),
        paintTreeSitter(text, platformClasses),
        text,
      );
    }
    yaml.language.parser.delete();
  });
});

describe("unterminated strings", () => {
  it("run to the end of the document", () => {
    for (const [text, string] of [
      ['x = "a, ', '"a, '],
      ['x = "hello \\', '"hello \\'],
      ['x = "a\ny = 1', '"a\ny = 1'],
      ["x = 'a\ny = 1", "'a\ny = 1"],
      ['x = "a" + "b', '"b'],
      ['x = b"abc', 'b"abc'],
      ['x = r"abc', 'r"abc'],
      ['x = r#"abc"', 'r#"abc"'],
      ['x = f"a{b', 'f"a{b'],
    ]) {
      const tree = parse(text);
      checkTree(tree, text);
      const node = tree.resolveInner(text.length, -1);
      assert.equal(node.name, "string", text);
      assert.equal(text.slice(node.from, node.to), string, text);
    }
  });

  it("make block comments run to the end of the document", () => {
    const text = "x = 1 /* a\ny = 2";
    const node = parse(text).resolveInner(text.length, -1);
    assert.equal(node.name, "comment");
    assert.equal(node.from, 6);
    assert.deepEqual(highlight(text).at(-1), ["/* a\ny = 2", "comment"]);
  });

  it("leave closed strings that tree-sitter recovered from alone", () => {
    const text = 'match x {\n  "a", "b" => {\n    y = 1\n  }\n}\n';
    assert.deepEqual(
      paintLezer(text, platformClasses, platformTags, parse(text, makeSupport({ tags: platformTags }))),
      paintTreeSitter(text, platformClasses),
    );
  });
});

describe("quote pairing", () => {
  const insert = (doc, bracket) => {
    const state = stateOf(doc, closeBrackets());
    const tr = insertBracket(state, bracket);
    return tr === null ? null : tr.state.doc.toString();
  };

  it("pairs a quote that opens a string", () => {
    assert.equal(insert("x = ", '"'), 'x = ""');
    assert.equal(insert("x = f(▮)", '"'), 'x = f("")');
    assert.equal(insert("x = ", "'"), "x = ''");
    assert.equal(insert("x = f", '"'), 'x = f""');
  });

  it("does not pair a quote that closes an open string", () => {
    assert.equal(insert('x = "a, ', '"'), null);
    assert.equal(insert('x = "hello \\', '"'), null);
    assert.equal(insert('x = "a, ▮\ny = 1', '"'), null);
    assert.equal(insert("x = 'a", "'"), null);
    assert.equal(insert('x = f"a{b}', '"'), null);
  });

  it("steps over the quote it inserted", () => {
    const paired = insertBracket(stateOf("x = ", closeBrackets()), '"').state;
    const stepped = insertBracket(paired, '"').state;
    assert.equal(stepped.doc.toString(), 'x = ""');
    assert.equal(stepped.selection.main.head, 6);
  });

  it("pairs brackets", () => {
    assert.equal(insert("x = ", "{"), "x = {}");
    assert.equal(insert("x = f", "("), "x = f()");
  });
});

describe("bracket matching", () => {
  it("matches brackets", () => {
    const state = stateOf("x = f(a, [1, {y: 2}])");
    const match = matchBrackets(state, 5, 1);
    assert.equal(match.matched, true);
    assert.deepEqual(match.end, { from: 20, to: 21 });
    const record = matchBrackets(state, 19, -1);
    assert.equal(record.matched, true);
    assert.deepEqual(record.end, { from: 13, to: 14 });
  });

  it("ignores brackets in strings and comments", () => {
    const doc = 'x = f(")", /* ) */ "(" // )\n)';
    const state = stateOf(doc);
    const match = matchBrackets(state, 5, 1);
    assert.equal(match.matched, true);
    assert.deepEqual(match.end, { from: doc.length - 1, to: doc.length });
    assert.equal(matchBrackets(state, 7, 1), null);
  });

  it("reports unmatched brackets", () => {
    const state = stateOf("x = f(a");
    assert.equal(matchBrackets(state, 5, 1).matched, false);
  });
});

describe("indentation", () => {
  const indentAt = (doc, line) => {
    const state = stateOf(doc);
    return getIndentation(state, state.doc.line(line).from);
  };

  it("indents inside braces and brackets", () => {
    assert.equal(indentAt("let $p = {\nfrom x\n}", 2), 2);
    assert.equal(indentAt("let $p = {\nfrom x\n}", 3), 0);
    assert.equal(indentAt("x = [\n1,\n]", 2), 2);
    assert.equal(indentAt("x = [\n1,\n]", 3), 0);
    assert.equal(indentAt("x = {\na: 1,\n}", 2), 2);
    assert.equal(indentAt("if x {\na\n} else {\nb\n}", 2), 2);
    assert.equal(indentAt("if x {\na\n} else {\nb\n}", 3), 0);
    assert.equal(indentAt("if x {\na\n} else {\nb\n}", 4), 2);
    assert.equal(indentAt("  match x {\n\"a\" => {\ny\n}\n}", 2), 4);
    assert.equal(indentAt("match x {\n  \"a\" => {\ny\n}\n}", 3), 4);
    assert.equal(indentAt("match x {\n  \"a\" => {\n    y\n}\n}", 4), 2);
    assert.equal(indentAt("match x {\n  \"a\" => {\n    y\n  }\n}", 5), 0);
  });

  it("keeps the indentation of the line before at the top level", () => {
    assert.equal(run(insertNewlineAndIndent, "from x"), "from x\n");
    assert.equal(run(insertNewlineAndIndent, "  from x"), "  from x\n  ");
    assert.equal(run(insertNewlineAndIndent, "from x\n  | where y"), "from x\n  | where y\n  ");
    assert.equal(indentAt("  from x\n  where y", 2), 2);
  });

  it("indents new lines in blocks", () => {
    assert.equal(run(insertNewlineAndIndent, "let $p = {"), "let $p = {\n  ");
    assert.equal(run(insertNewlineAndIndent, "let $p = {▮}"), "let $p = {\n  \n}");
    assert.equal(run(insertNewlineAndIndent, "if x {\n  a▮\n}"), "if x {\n  a\n  \n}");
    assert.equal(run(insertNewlineAndIndent, "if x {\n  a\n}▮"), "if x {\n  a\n}\n");
  });

  it("reindents closing brackets", () => {
    assert.ok(support.language.data);
    const state = stateOf("x = {\n  a: 1\n  }");
    assert.ok(state.languageDataAt("indentOnInput", 0).some((re) => re.test("  }")));
    assert.equal(getIndentation(state, state.doc.line(3).from), 0);
  });
});

describe("language data", () => {
  it("toggles line comments", () => {
    assert.equal(run(toggleComment, "from x"), "// from x");
    assert.equal(run(toggleComment, "// from x"), "from x");
  });

  it("knows block comments", () => {
    const state = stateOf("from x");
    assert.deepEqual(state.languageDataAt("commentTokens", 0)[0], {
      line: "//",
      block: { open: "/*", close: "*/" },
    });
  });
});

describe("folding", () => {
  it("folds blocks, records, and front matter", () => {
    const fold = (doc, line) => {
      const state = stateOf(doc);
      const { from, to } = state.doc.line(line);
      return foldable(state, from, to);
    };
    assert.deepEqual(fold("let $p = {\n  from x\n}", 1), { from: 10, to: 20 });
    assert.deepEqual(fold("x = [\n  1,\n]", 1), { from: 5, to: 11 });
    assert.deepEqual(fold("---\na: 1\nb: 2\n---\nfrom x", 1), { from: 3, to: 13 });
    assert.equal(fold("from x\nwhere y", 1), null);
  });
});

describe("resources", () => {
  afterEach(() => mock.restoreAll());

  /** Counts the tree-sitter trees and cursors that parses create and free. */
  const track = () => {
    const live = new Set();
    const wrap = (prototype, method) => {
      const original = prototype[method];
      mock.method(prototype, method, function (...args) {
        const object = original.apply(this, args);
        if (object) {
          live.add(object);
          const free = object.delete;
          object.delete = function () {
            live.delete(this);
            return free.call(this);
          };
        }
        return object;
      });
    };
    wrap(TreeSitter.Parser.prototype, "parse");
    wrap(TreeSitter.Tree.prototype, "walk");
    return live;
  };

  it("frees tree-sitter trees", () => {
    const live = track();
    for (const text of ["from x", 'x = "a', "}{", ""]) parse(text);
    stateOf("from x | where y").update({ changes: { from: 0, insert: "x = 1\n" } }).state;
    assert.equal(live.size, 0);
  });

  it("frees tree-sitter trees when converting them fails", () => {
    const live = track();
    const error = mock.method(console, "error", () => {});
    mock.method(TreeSitter.Query.prototype, "captures", () => {
      throw new Error("boom");
    });
    const tree = parse("from x");
    assert.equal(tree.toString(), "program");
    assert.equal(tree.length, 6);
    assert.equal(error.mock.callCount(), 1);
    assert.equal(live.size, 0);
  });

  it("frees the parser and queries", () => {
    const deleted = [];
    for (const Class of [TreeSitter.Parser, TreeSitter.Query]) {
      const original = Class.prototype.delete;
      mock.method(Class.prototype, "delete", function () {
        deleted.push(Class.name);
        return original.call(this);
      });
    }
    makeSupport().language.parser.delete();
    assert.deepEqual(deleted.sort(), ["Parser", "Query", "Query", "Query"]);
  });

  it("frees what it created when a query does not compile", () => {
    const deleted = [];
    const original = TreeSitter.Parser.prototype.delete;
    mock.method(TreeSitter.Parser.prototype, "delete", function () {
      deleted.push("Parser");
      return original.call(this);
    });
    assert.throws(() => makeSupport({ indents: "(nope) @indent" }));
    assert.deepEqual(deleted, ["Parser"]);
  });
});

describe("queries", () => {
  it("bundles the queries of tree-sitter-tql", () => {
    assert.match(tqlQueries.highlights, /@keyword/);
    assert.match(tqlQueries.indents, /@indent/);
    assert.match(tqlQueries.folds, /@fold/);
    assert.ok(language.nodeTypeCount > 0);
  });

  it("takes other queries", () => {
    const custom = makeSupport({ highlights: "(identifier) @variable", indents: "", folds: "" });
    const text = "from x";
    const spans = [];
    highlightTree(custom.language.parser.parse(text), tqlHighlighter({ variable: "v" }), (from, to, cls) => {
      spans.push([text.slice(from, to), cls]);
    });
    assert.deepEqual(spans, [["from", "v"], ["x", "v"]]);
    custom.language.parser.delete();
  });
});
