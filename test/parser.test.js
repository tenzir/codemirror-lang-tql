import assert from "node:assert/strict";
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
    let rounds = 0;
    let tree;
    while (!(tree = ensureSyntaxTree(state, state.doc.length, 20))) rounds++;
    assert.equal(tree.length, state.doc.length);
    assert.ok(rounds > 5, `${rounds} rounds`);
    // Generous bounds for slow machines: the whole parse blocked for
    // seconds before.
    assert.ok(edited < 1000, `created and edited in ${edited} ms`);
    assert.ok(longest < 250, `longest step ${longest} ms`);
    parser.delete();
  });

  it("colors in parts like tree-sitter does at once", () => {
    const text = body.repeat(20);
    const platform = makeSupport({ tags: { punctuation: null } });
    assert.deepEqual(paint(text, parse(text, platform)), paintTreeSitter(text));
    platform.language.parser.delete();
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

  /** Counts the tree-sitter trees and cursors that parses create and free. */
  const track = () => {
    const live = new Set();
    for (const [prototype, method] of [
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

  it("bounds and frees what dropped parses hold", () => {
    const live = track();
    const support = makeSupport();
    // Parses that CodeMirror drops halfway.
    for (let i = 0; i < 10; i++) {
      const parse = support.language.parser.startParse(`${large}// ${i}`);
      while (parse.parsedPos === 0) assert.equal(parse.advance(), null);
    }
    // A tree and a cursor for each of at most four parses.
    assert.ok(live.size <= 8, `${live.size} objects`);
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
    // The queries on their own, which only check the sources.
    assert.deepEqual(deleted.sort(), ["Query", "Query", "Query"]);
    deleted.length = 0;
    parse(example, support);
    support.language.parser.delete();
    // The parser and the queries in one.
    assert.deepEqual(deleted.sort(), ["Parser", "Query"]);
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
