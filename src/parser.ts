import {
  foldNodeProp,
  indentNodeProp,
  languageDataProp,
  type defineLanguageFacet,
  type TreeIndentContext,
} from "@codemirror/language";
import {
  type Input,
  NodeProp,
  type NodePropSource,
  NodeType,
  type ParseWrapper,
  Parser,
  type PartialParse,
  type SyntaxNode,
  Tree,
  type TreeFragment,
} from "@lezer/common";
import { styleTags, type Tag } from "@lezer/highlight";
import type * as TreeSitter from "web-tree-sitter";
import { captureTag, type TqlCaptureTags } from "./tags";

/**
 * The parts of web-tree-sitter that TQL's language support needs: the
 * classes of the instance that loaded the grammar, after `Parser.init()`, and
 * the grammar itself from `Language.load()`.
 */
export interface TqlTreeSitter {
  readonly Parser: typeof TreeSitter.Parser;
  readonly Query: typeof TreeSitter.Query;
  readonly language: TreeSitter.Language;
}

/** The query sources and capture mapping that a TQL parser runs with. */
export interface TqlQueries {
  readonly highlights: string;
  readonly indents: string;
  readonly folds: string;
  readonly tags: TqlCaptureTags;
}

type LanguageData = ReturnType<typeof defineLanguageFacet>;

/** The type id tree-sitter gives error nodes. */
const ERROR_TYPE = 0xffff;

const INDENT = 1;
const OUTDENT = 2;
const FOLD = 4;

/** Flags that captures of the indent and fold queries set on a node. */
const captureFlags: Readonly<Record<string, number>> = {
  indent: INDENT,
  "indent.begin": INDENT,
  outdent: OUTDENT,
  "indent.end": OUTDENT,
  "indent.branch": OUTDENT,
  "indent.dedent": OUTDENT,
  fold: FOLD,
};

const closing: Readonly<Record<string, string>> = { "(": ")", "[": "]", "{": "}" };
const opening: Readonly<Record<string, string>> = { ")": "(", "]": "[", "}": "{" };

/** Nodes whose text is taken as is, quotes and comment markers included. */
const literals = new Set(["string", "format_expr", "comment", "frontmatter"]);

/** Nodes inside which a new line keeps the indentation of the line before. */
const verbatim = new Set(["string", "format_text", "comment", "frontmatter_body"]);

/** Marks tokens that close an indented node, like a block's `}`. */
const outdentProp = new NodeProp<boolean>({ deserialize: (x) => x === "true" });

/**
 * Indents the lines inside a node one unit past the line it starts on, except
 * for a line that starts with the token closing the node.
 */
const indentInside = (cx: TreeIndentContext): number => {
  const after = cx.textAfter;
  const space = /^\s*/.exec(after)![0].length;
  // A new line between brackets pushes the closing one onto a line of its
  // own, where it is not part of the line's text anymore.
  if (space === after.length) return cx.baseIndent + cx.unit;
  const at = cx.pos + space;
  for (let child = cx.node.lastChild; child && child.to >= at; child = child.prevSibling) {
    if (child.from === at && child.type.prop(outdentProp)) return cx.baseIndent;
  }
  return cx.baseIndent + cx.unit;
};

/**
 * Keeps the indentation of the line before at the top level, where TQL's
 * statements and pipes all line up.
 */
const indentTop = (cx: TreeIndentContext): number => cx.lineIndent(cx.pos, -1);

/**
 * Folds between a node's brackets, or from the end of its first line to the
 * start of its last line when that line holds only its closing token, like the
 * fence of front matter.
 */
const foldRange = (
  node: SyntaxNode,
  state: { doc: { lineAt(pos: number): { from: number; to: number } } },
): { from: number; to: number } | null => {
  const first = node.firstChild;
  let last = node.lastChild;
  if (!first || !last) return null;
  const from = first.type.prop(NodeProp.closedBy) ? first.to : state.doc.lineAt(node.from).to;
  while (last.lastChild && last.lastChild.to === last.to) last = last.lastChild;
  let to = node.to;
  if (last.type.prop(NodeProp.openedBy)) {
    to = last.from;
  } else if (last.from > from && state.doc.lineAt(last.from).from === last.from) {
    to = state.doc.lineAt(last.from - 1).to;
  }
  return to > from ? { from, to } : null;
};

/** Quotes a node name for `styleTags`, which splits selectors at spaces. */
const selector = (name: string) => JSON.stringify(name).replace(/ /g, "\\u0020");

/**
 * The string whose opening quote is at `quote`: where it starts, prefixes
 * included, and where its closing quote ends, if it has one.
 */
const stringAt = (text: string, quote: number): { from: number; to: number | null } => {
  const boundary = (at: number) => at === 0 || !/\w/.test(text[at - 1]);
  let at = quote;
  while (at > 0 && text[at - 1] === "#") at--;
  const hashes = quote - at;
  for (const prefix of ["br", "r"]) {
    const from = at - prefix.length;
    if (from >= 0 && text.startsWith(prefix, from) && boundary(from)) {
      // A raw string ends at the first quote followed by its hashes.
      const close = text.indexOf(`"${"#".repeat(hashes)}`, quote + 1);
      return { from, to: close < 0 ? null : close + 1 + hashes };
    }
  }
  let from = quote;
  if (hashes === 0 && at > 0 && "bf".includes(text[at - 1]) && boundary(at - 1)) from = at - 1;
  // A format string's replacements are expressions, whose strings may hold
  // quotes of their own.
  const format = text[from] === "f";
  let depth = 0;
  for (let pos = quote + 1; pos < text.length; pos++) {
    const char = text[pos];
    if (depth > 0) {
      if (char === "{") depth++;
      else if (char === "}") depth--;
      else if (char === '"' || char === "'") {
        const inner = stringAt(text, pos).to;
        if (inner === null) return { from, to: null };
        pos = inner - 1;
      }
    } else if (char === "\\") {
      pos++;
    } else if (format && (char === "{" || char === "}") && text[pos + 1] === char) {
      pos++;
    } else if (format && char === "{") {
      depth++;
    } else if (char === text[quote]) {
      return { from, to: pos + 1 };
    }
  }
  return { from, to: null };
};

/** A string or block comment that runs to the end of the document. */
type Unterminated = { readonly from: number; readonly capture: number; readonly name: string };

/** The node types, captures, and queries of one TQL parser. */
class Grammar {
  readonly parser: TreeSitter.Parser;
  readonly highlights: TreeSitter.Query;
  readonly indents: TreeSitter.Query;
  readonly folds: TreeSitter.Query;
  /** The tags of the captures that color, by index. */
  readonly tags: Tag[] = [];
  /** The index of a coloring capture, by name. */
  readonly captures = new Map<string, number>();
  readonly top: NodeType;
  readonly types = new Map<string, NodeType>();
  readonly language: TreeSitter.Language;
  nextId = 1;

  constructor(treeSitter: TqlTreeSitter, queries: TqlQueries, data: LanguageData) {
    const { Parser: TSParser, Query, language } = treeSitter;
    this.language = language;
    const owned: Array<{ delete(): void }> = [];
    try {
      this.parser = new TSParser();
      owned.push(this.parser);
      this.parser.setLanguage(language);
      this.highlights = new Query(language, queries.highlights);
      owned.push(this.highlights);
      this.indents = new Query(language, queries.indents);
      owned.push(this.indents);
      this.folds = new Query(language, queries.folds);
      owned.push(this.folds);
    } catch (error) {
      for (const object of owned) object.delete();
      throw error;
    }
    for (const name of [...this.highlights.captureNames, "string", "comment"]) {
      const tag = captureTag(name, queries.tags);
      if (tag && !this.captures.has(name)) {
        this.captures.set(name, this.tags.length);
        this.tags.push(tag);
      }
    }
    this.top = NodeType.define({
      id: 0,
      name: "program",
      top: true,
      props: [
        [languageDataProp, data],
        [indentNodeProp, indentTop],
      ],
    });
  }

  /** The node type for a tree-sitter type with a capture and flags. */
  type(typeId: number, name: () => string, capture: number, flags: number): NodeType {
    const key = `${typeId}:${capture}:${flags}`;
    let type = this.types.get(key);
    if (type === undefined) {
      const error = typeId === ERROR_TYPE;
      const typeName = error ? "⚠" : name();
      const props: Array<NodePropSource | [NodeProp<any>, any]> = [];
      if (closing[typeName]) props.push([NodeProp.closedBy, [closing[typeName]]]);
      if (opening[typeName]) props.push([NodeProp.openedBy, [opening[typeName]]]);
      if (capture >= 0) props.push(styleTags({ [selector(typeName)]: this.tags[capture] }));
      if (flags & INDENT) props.push([indentNodeProp, indentInside]);
      else if (verbatim.has(typeName)) props.push([indentNodeProp, () => null]);
      if (flags & OUTDENT) props.push([outdentProp, true]);
      if (flags & FOLD) props.push([foldNodeProp, foldRange]);
      type = NodeType.define({ id: this.nextId++, name: typeName, error, props });
      this.types.set(key, type);
    }
    return type;
  }

  delete() {
    this.parser.delete();
    this.highlights.delete();
    this.indents.delete();
    this.folds.delete();
  }
}

/** What the queries captured on a node. */
type Captured = { capture: number; pattern: number; flags: number };

/**
 * Converts a tree-sitter tree into a Lezer tree: one node per tree-sitter
 * node, with the type, capture, and flags of the queries, and missing tokens
 * as empty error nodes, as Lezer marks unfinished nodes.
 */
class Conversion {
  readonly captured = new Map<number, Captured>();
  readonly unterminated: Unterminated | null;

  constructor(
    readonly grammar: Grammar,
    readonly tree: TreeSitter.Tree,
    readonly text: string,
  ) {
    const root = tree.rootNode;
    for (const { name, node, patternIndex } of grammar.highlights.captures(root)) {
      const capture = grammar.captures.get(name);
      if (capture === undefined) continue;
      const captured = this.at(node.id);
      // Of two captures of the same node, the later pattern wins.
      if (captured.capture < 0 || patternIndex >= captured.pattern) {
        captured.capture = capture;
        captured.pattern = patternIndex;
      }
    }
    for (const query of [grammar.indents, grammar.folds]) {
      for (const { name, node } of query.captures(root)) {
        const flags = captureFlags[name];
        if (flags) this.at(node.id).flags |= flags;
      }
    }
    this.unterminated = this.findUnterminated(root);
  }

  at(id: number): Captured {
    let captured = this.captured.get(id);
    if (captured === undefined) {
      captured = { capture: -1, pattern: -1, flags: 0 };
      this.captured.set(id, captured);
    }
    return captured;
  }

  /**
   * The first string or block comment that is not closed. Tree-sitter does not
   * see these as strings: its lexer only matches a closed string, so it makes
   * the quote an error and parses on what follows as code. Since strings and
   * block comments may span lines, one that is not closed runs to the end of
   * the document, as tree-sitter would lex it once closed there.
   *
   * This only looks at quotes and comment openers outside the literals that
   * tree-sitter parsed, which during error recovery may include closed ones.
   */
  findUnterminated(root: TreeSitter.Node): Unterminated | null {
    const text = this.text;
    const pattern = /["']|\/\*/g;
    for (let match; (match = pattern.exec(text)); ) {
      const at = match.index;
      const literal = this.literalAround(root, at);
      if (literal !== null) {
        pattern.lastIndex = Math.max(literal, at + 1);
        continue;
      }
      if (match[0] === "/*") {
        const close = text.indexOf("*/", at + 2);
        if (close >= 0) {
          pattern.lastIndex = close + 2;
          continue;
        }
        return { from: at, capture: this.grammar.captures.get("comment") ?? -1, name: "comment" };
      }
      const string = stringAt(text, at);
      if (string.to !== null) {
        pattern.lastIndex = string.to;
        continue;
      }
      return { from: string.from, capture: this.grammar.captures.get("string") ?? -1, name: "string" };
    }
    return null;
  }

  /** The end of the literal around position `at`, if any. */
  literalAround(root: TreeSitter.Node, at: number): number | null {
    for (let node: TreeSitter.Node | null = root.descendantForIndex(at, at + 1); node; node = node.parent) {
      if (literals.has(node.type)) return node.endIndex;
    }
    return null;
  }

  build(): Tree {
    const cursor = this.tree.walk();
    try {
      const children: Tree[] = [];
      const positions: number[] = [];
      if (cursor.nodeType === "program") {
        if (cursor.gotoFirstChild()) {
          this.visitSiblings(cursor, -1, 0, children, positions);
        }
      } else {
        this.visit(cursor, -1, 0, children, positions);
      }
      this.closeUnterminated(0, children, positions);
      return new Tree(this.grammar.top, children, positions, this.text.length);
    } finally {
      cursor.delete();
    }
  }

  visitSiblings(
    cursor: TreeSitter.TreeCursor,
    inherited: number,
    offset: number,
    children: Tree[],
    positions: number[],
  ) {
    const cut = this.unterminated?.from ?? Infinity;
    do {
      if (cursor.startIndex >= cut) break;
      this.visit(cursor, inherited, offset, children, positions);
    } while (cursor.gotoNextSibling());
    cursor.gotoParent();
  }

  visit(
    cursor: TreeSitter.TreeCursor,
    inherited: number,
    offset: number,
    children: Tree[],
    positions: number[],
  ) {
    const from = cursor.startIndex;
    const to = cursor.endIndex;
    const grammar = this.grammar;
    if (cursor.nodeIsMissing) {
      children.push(new Tree(grammar.type(ERROR_TYPE, () => "⚠", -1, 0), [], [], 0));
      positions.push(from - offset);
      return;
    }
    const captured = this.captured.get(cursor.nodeId);
    // An inner node without a color of its own takes the color of the node
    // around it, as tree-sitter colors a node's whole range.
    const capture = captured !== undefined && captured.capture >= 0 ? captured.capture : inherited;
    const type = grammar.type(cursor.nodeTypeId, () => cursor.nodeType, capture, captured?.flags ?? 0);
    const cut = this.unterminated?.from ?? Infinity;
    if (!cursor.gotoFirstChild()) {
      children.push(new Tree(type, [], [], Math.min(to, cut) - from));
      positions.push(from - offset);
      return;
    }
    const inner: Tree[] = [];
    const innerPositions: number[] = [];
    this.visitSiblings(cursor, capture, from, inner, innerPositions);
    let length = to - from;
    if (to > cut) {
      length = this.text.length - from;
      this.closeUnterminated(from, inner, innerPositions);
    }
    children.push(new Tree(type, inner, innerPositions, length));
    positions.push(from - offset);
  }

  /**
   * Adds the unterminated string or comment to the deepest node around its
   * start, which it extends to the end of the document.
   */
  closeUnterminated(offset: number, children: Tree[], positions: number[]) {
    const unterminated = this.unterminated;
    if (unterminated === null) return;
    const last = children.length - 1;
    const end = last < 0 ? offset : offset + positions[last] + children[last].length;
    if (end >= this.text.length) return;
    const { language } = this.grammar;
    const typeId = language.idForNodeType(unterminated.name, true) ?? ERROR_TYPE;
    const type = this.grammar.type(typeId, () => unterminated.name, unterminated.capture, 0);
    children.push(new Tree(type, [], [], this.text.length - unterminated.from));
    positions.push(unterminated.from - offset);
  }
}

/**
 * The text from the first range's start to the last range's end, with the
 * gaps between ranges, which belong to another language, blanked out.
 */
const readRanges = (input: Input, ranges: readonly { from: number; to: number }[]): string => {
  if (ranges.length === 0) return input.read(0, input.length);
  let text = "";
  for (let i = 0; i < ranges.length; i++) {
    if (i > 0) text += " ".repeat(ranges[i].from - ranges[i - 1].to);
    text += input.read(ranges[i].from, ranges[i].to);
  }
  return text;
};

/**
 * A Lezer parser that parses TQL with tree-sitter-tql and converts the result
 * into a Lezer tree, so that CodeMirror's highlighting, bracket matching,
 * indentation, folding, and commands work from TQL's tree-sitter grammar.
 *
 * Every parse reparses the whole document and converts the whole tree, and
 * frees the tree-sitter tree before it returns. The tree-sitter parser and
 * queries live in WebAssembly memory until `delete()` frees them; after that,
 * the parser must not be used anymore.
 */
export class TqlParser extends Parser {
  readonly #grammar: Grammar;
  readonly #wrapper: ParseWrapper | undefined;

  /** @internal */
  constructor(
    treeSitter: TqlTreeSitter,
    queries: TqlQueries,
    data: LanguageData,
    wrapper?: ParseWrapper,
  ) {
    super();
    this.#grammar = new Grammar(treeSitter, queries, data);
    this.#wrapper = wrapper;
  }

  override createParse(
    input: Input,
    fragments: readonly TreeFragment[],
    ranges: readonly { from: number; to: number }[],
  ): PartialParse {
    const from = ranges.length ? ranges[0].from : 0;
    const parse = new TqlParse(() => this.#run(readRanges(input, ranges)), from);
    return this.#wrapper ? this.#wrapper(parse, input, fragments, ranges) : parse;
  }

  #run(text: string): Tree {
    const grammar = this.#grammar;
    let tree: TreeSitter.Tree | null = null;
    try {
      tree = grammar.parser.parse(text);
      if (tree !== null) return new Conversion(grammar, tree, text).build();
    } catch (error) {
      console.error("Failed to parse TQL", error);
    } finally {
      tree?.delete();
    }
    return new Tree(grammar.top, [], [], text.length);
  }

  /** Frees the tree-sitter parser and queries. */
  delete(): void {
    this.#grammar.delete();
  }
}

/** A parse that is done in one step, as tree-sitter parses all at once. */
class TqlParse implements PartialParse {
  parsedPos: number;
  stoppedAt: number | null = null;

  constructor(
    private readonly run: () => Tree,
    from: number,
  ) {
    this.parsedPos = from;
  }

  advance(): Tree {
    const tree = this.run();
    this.parsedPos += tree.length;
    return tree;
  }

  // The parse always covers the whole input, which Lezer permits.
  stopAt(): void {}
}
