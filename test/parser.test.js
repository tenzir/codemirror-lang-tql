import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { afterEach, describe, it, mock } from "node:test";
import { ensureSyntaxTree, getIndentation, matchBrackets, syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import {
  TreeSitter,
  example,
  language,
  makeSupport,
  paint,
  paintTreeSitter,
  parse,
  stateOf,
} from "./helpers.js";

/** The example's pipeline, without its front matter. */
const body = example.slice(example.indexOf("---", 3) + 4);

/** A document far larger than real TQL, from about 500 copies of the example. */
const large = body.repeat(500);

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

/** The number of nodes in `tree`. */
const count = (tree) => {
  let nodes = 0;
  tree.iterate({ enter: () => void nodes++ });
  return nodes;
};

describe("tree conversion", () => {
  it("converts every tree-sitter node", () => {
    const tree = parse(example);
    checkTree(tree, example);
    const parser = new TreeSitter.Parser();
    parser.setLanguage(language);
    const original = parser.parse(example);
    // One Lezer node per visible tree-sitter node, plus the top.
    assert.equal(count(tree), original.rootNode.descendantCount);
    original.delete();
    parser.delete();
    const at = example.indexOf('"zeek.conn"');
    const string = tree.resolveInner(at, 1);
    assert.equal(string.name, "string");
    assert.deepEqual([string.from, string.to], [at, at + '"zeek.conn"'.length]);
  });

  it("counts positions in UTF-16 code units", () => {
    const tree = parse(example);
    const at = example.indexOf('"Grüße 👋 (from the edge)"');
    const string = tree.resolveInner(at, 1);
    assert.equal(example.slice(string.from, string.to), '"Grüße 👋 (from the edge)"');
    const next = tree.resolveInner(example.indexOf("watched"), 1);
    assert.equal(example.slice(next.from, next.to), "watched");
  });

  it("marks missing tokens as empty error nodes and keeps error nodes", () => {
    const errors = (text) => {
      const found = [];
      parse(text).iterate({ enter: (node) => void (node.type.isError && found.push([node.from, node.to])) });
      return found;
    };
    const missing = errors("x = ");
    assert.equal(missing.length, 1);
    assert.equal(missing[0][0], missing[0][1]);
    assert.ok(errors("x = )").length > 0);
  });

  it("never throws on the example cut short", () => {
    for (let end = 0; end <= example.length; end++) {
      const text = example.slice(0, end);
      checkTree(parse(text), text);
      if (end % 50 === 0) {
        const state = stateOf(text);
        getIndentation(state, end);
        matchBrackets(state, end, -1);
      }
    }
  });
});

describe("parsing in steps", () => {
  it("stops where asked", () => {
    const support = makeSupport();
    const parse = support.language.parser.startParse(large);
    parse.stopAt(100);
    assert.equal(parse.stoppedAt, 100);
    let tree;
    while (!(tree = parse.advance()));
    // A parse that stops before it starts parses only that much.
    assert.equal(tree.length, 100);
    assert.equal(tree.resolveInner(body.indexOf("10.0.0.0/8"), 1).name, "subnet");
    support.language.parser.delete();
  });

  it("returns the tree so far when stopped where it is", () => {
    const support = makeSupport();
    const parse = support.language.parser.startParse(large);
    let steps = 0;
    while (parse.parsedPos < 1000) {
      assert.equal(parse.advance(), null);
      steps++;
    }
    // As CodeMirror does when a parse runs out of time.
    parse.stopAt(parse.parsedPos);
    const tree = parse.advance();
    assert.equal(tree.length, parse.parsedPos);
    assert.ok(steps > 1);
    support.language.parser.delete();
  });

  it("does not block on a large document", () => {
    const support = makeSupport();
    const parser = support.language.parser;
    let longest = 0;
    const createParse = parser.createParse.bind(parser);
    parser.createParse = (...args) => {
      const parse = createParse(...args);
      const advance = parse.advance.bind(parse);
      parse.advance = () => {
        const start = performance.now();
        try {
          return advance();
        } finally {
          longest = Math.max(longest, performance.now() - start);
        }
      };
      return parse;
    };
    const start = performance.now();
    let state = EditorState.create({ doc: large, extensions: [support] });
    // Without a view, CodeMirror parses only the start of the document.
    assert.ok(syntaxTree(state).length < large.length);
    state = state.update({ changes: { from: 10, insert: "y" } }).state;
    const edited = performance.now() - start;
    // Parsing the whole document takes many steps, none of them long.
    let tree;
    while (!(tree = ensureSyntaxTree(state, state.doc.length, 20)));
    assert.equal(tree.length, state.doc.length);
    // Generous bounds for slow machines: the whole parse blocked for
    // seconds before.
    assert.ok(edited < 1000, `created and edited in ${edited} ms`);
    assert.ok(longest < 250, `longest step ${longest} ms`);
    parser.delete();
  });

  it("yields when its step budget expires", () => {
    const support = makeSupport();
    let time = 0;
    const clock = mock.method(performance, "now", () => time++);
    try {
      assert.equal(support.language.parser.startParse(large).advance(), null);
    } finally {
      clock.mock.restore();
      support.language.parser.delete();
    }
  });

  it("finishes five editors sharing one language", () => {
    const support = makeSupport();
    const states = Array.from({ length: 5 }, (_, i) =>
      EditorState.create({ doc: `x = ${i}\n${body.repeat(150)}`, extensions: [support] }),
    );
    const trees = states.map(() => null);
    for (let round = 0; round < 200 && trees.some((tree) => !tree); round++) {
      states.forEach((state, i) => {
        if (!trees[i]) trees[i] = ensureSyntaxTree(state, state.doc.length, 10);
      });
    }
    trees.forEach((tree, i) => assert.equal(tree?.length, states[i].doc.length, `editor ${i}`));
    support.language.parser.delete();
  });

  it("colors in parts like tree-sitter does at once", () => {
    const text = body.repeat(20);
    const platform = makeSupport({ tags: { punctuation: null } });
    assert.deepEqual(paint(text, parse(text, platform)), paintTreeSitter(text));
    platform.language.parser.delete();
  });

  it("queries parents and sibling patterns across subtree boundaries", () => {
    const text = "x = 1\ny = 2\nz = 3\n".repeat(30);
    for (const highlights of [
      "(pipeline) @string\n(identifier) @keyword",
      "(pipeline (statement) @keyword)",
      "((statement) @keyword . (statement) @string)",
    ]) {
      const support = makeSupport({ highlights, indents: "", folds: "" });
      assert.deepEqual(paint(text, parse(text, support)), paintTreeSitter(text, undefined, highlights));
      support.language.parser.delete();
    }
  });

  it("bounds query work on deeply nested lists", () => {
    const support = makeSupport();
    const text = `x = ${"[".repeat(30000)}1${"]".repeat(30000)}`;
    const parse = support.language.parser.startParse(text);
    let longest = 0;
    let tree;
    while (!tree) {
      const start = performance.now();
      tree = parse.advance();
      longest = Math.max(longest, performance.now() - start);
    }
    assert.equal(tree.length, text.length);
    assert.ok(count(tree) > 30000);
    assert.ok(longest < 250, `longest step ${longest} ms`);
    support.language.parser.delete();
  });

  it("recovers an unterminated string inside deeply nested lists", () => {
    const error = mock.method(console, "error", () => {});
    try {
      const text = `x = ${"[".repeat(2000)}"hello${"]".repeat(2000)}`;
      const tree = parse(text);
      const literal = tree.resolveInner(text.length, -1);
      assert.equal(literal.name, "string");
      assert.equal(literal.from, 2004);
      assert.equal(literal.to, text.length);
      assert.ok(count(tree) > 2000);
      assert.equal(error.mock.callCount(), 0);
    } finally {
      error.mock.restore();
    }
  });

  it("converts deeply nested and long expressions", () => {
    const error = mock.method(console, "error", () => {});
    for (const text of [
      `x = ${"[".repeat(2000)}1${"]".repeat(2000)}`,
      `x = ${"1 + ".repeat(5000)}1`,
      `x = "${"[".repeat(3000)}`,
    ]) {
      const tree = parse(text);
      assert.equal(tree.length, text.length);
      assert.ok(count(tree) > 5, text.slice(0, 20));
    }
    assert.equal(error.mock.callCount(), 0);
    mock.restoreAll();
  });
});

describe("resources", () => {
  afterEach(() => mock.restoreAll());

  /** Counts the tree-sitter parsers, trees, and cursors that parses create and free. */
  const track = () => {
    const live = new Set();
    for (const [prototype, method] of [
      [TreeSitter.Parser.prototype, "setLanguage"],
      [TreeSitter.Parser.prototype, "parse"],
      [TreeSitter.Tree.prototype, "walk"],
    ]) {
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
    }
    return live;
  };

  it("frees tree-sitter trees", () => {
    const live = track();
    parse(example);
    stateOf(example).update({ changes: { from: 0, insert: "x = 1\n" } }).state;
    assert.equal(live.size, 0);
  });

  it("frees dropped parses when the language is deleted", () => {
    const live = track();
    const support = makeSupport();
    // Parses that CodeMirror drops halfway.
    for (let i = 0; i < 10; i++) {
      const parse = support.language.parser.startParse(`${large}// ${i}`);
      while (parse.parsedPos === 0) assert.equal(parse.advance(), null);
    }
    assert.ok(live.size > 0);
    support.language.parser.delete();
    assert.equal(live.size, 0);
  });

  it("frees native parsers suspended before a tree exists", () => {
    const live = track();
    const support = makeSupport();
    const parser = support.language.parser;
    const parses = Array.from({ length: 8 }, (_, i) => parser.startParse(`${large}// ${i}`));
    for (const parse of parses) assert.equal(parse.advance(), null);
    assert.ok(live.size > 0);
    let tree;
    while (!(tree = parses[0].advance()));
    assert.equal(tree.length, large.length + 4);
    parser.delete();
    assert.equal(live.size, 0);
  });

  it("collects abandoned native parses without retaining their generators", () => {
    // A separate process exposes GC without changing the normal test runner.
    const result = spawnSync(process.execPath, ["--expose-gc", "--input-type=module", "-e", `
      import assert from "node:assert/strict";
      import { setTimeout } from "node:timers/promises";
      import { tql } from ${JSON.stringify(new URL("../dist/index.js", import.meta.url).href)};
      import { TreeSitter, language, example } from ${JSON.stringify(new URL("./helpers.js", import.meta.url).href)};
      let live = 0;
      const track = (object) => {
        live++;
        const free = object.delete;
        object.delete = function () { live--; free.call(this); };
        return object;
      };
      class TrackedParser extends TreeSitter.Parser {
        constructor() { super(); track(this); }
        parse(...args) {
          const tree = super.parse(...args);
          if (tree) {
            track(tree);
            const walk = tree.walk.bind(tree);
            tree.walk = () => track(walk());
          }
          return tree;
        }
      }
      const support = tql({ Parser: TrackedParser, Query: TreeSitter.Query, language });
      const text = example.repeat(500);
      const active = support.language.parser.startParse(text);
      active.advance();
      const abandon = () => {
        for (let i = 0; i < 10; i++) {
          const parse = support.language.parser.startParse(text);
          parse.advance();
          // Drop some during native parsing, others during conversion.
          if (i >= 5) while (parse.parsedPos === 0) parse.advance();
        }
      };
      abandon();
      assert.ok(live > 1);
      for (let i = 0; i < 100 && live > 1; i++) {
        await setTimeout(10);
        global.gc();
      }
      assert.equal(live, 1, "only the active parse remains");
      while (!active.advance());
      support.language.parser.delete();
      assert.equal(live, 0);
    `], { encoding: "utf8", timeout: 15000 });
    assert.equal(result.status, 0, result.stderr || String(result.error));
  });

  it("can interleave parses without mixing their native state", () => {
    const live = track();
    const support = makeSupport();
    const texts = [body.repeat(20), "x = 1\n".repeat(5000)];
    const parses = texts.map((text) => support.language.parser.startParse(text));
    const trees = [null, null];
    while (trees.some((tree) => !tree)) {
      parses.forEach((parse, i) => { if (!trees[i]) trees[i] = parse.advance(); });
    }
    trees.forEach((tree, i) => {
      checkTree(tree, texts[i]);
      assert.deepEqual(paint(texts[i], tree), paintTreeSitter(texts[i]));
    });
    support.language.parser.delete();
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
    const support = makeSupport();
    // The temporary highlight query supplies capture names and the pattern boundary.
    assert.deepEqual(deleted, ["Query"]);
    deleted.length = 0;
    parse(example, support);
    support.language.parser.delete();
    // The per-parse parser and the combined query.
    assert.deepEqual(deleted.sort(), ["Parser", "Query"]);
  });

  it("frees what it created when a query does not compile", () => {
    const deleted = [];
    const original = TreeSitter.Query.prototype.delete;
    mock.method(TreeSitter.Query.prototype, "delete", function () {
      deleted.push("Query");
      return original.call(this);
    });
    assert.throws(() => makeSupport({ indents: "(nope) @indent" }));
    assert.deepEqual(deleted, ["Query"]);
  });
});
