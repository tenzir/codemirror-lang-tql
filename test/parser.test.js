import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { getIndentation, matchBrackets } from "@codemirror/language";
import {
  TreeSitter,
  example,
  language,
  makeSupport,
  parse,
  stateOf,
} from "./helpers.js";

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
    parse(example, support);
    support.language.parser.delete();
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
