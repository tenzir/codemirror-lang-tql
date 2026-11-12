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
type Unterminated = { readonly from: number; readonly name: "string" | "comment" };

/** How long one step of a parse may take before it yields, in milliseconds. */
const STEP_TIME = 4;

/** How much text one run of the queries covers at most, in UTF-16 code units. */
const QUERY_SPAN = 4096;

/** How many unfinished parses may hold tree-sitter memory between steps. */
const MAX_PENDING = 4;

const now = () => performance.now();

/** The node types, captures, and queries of one TQL parser. */
class Grammar {
  /** The highlight, indent, and fold queries in one, which runs faster. */
  readonly query: TreeSitter.Query;
  /** The index of the first pattern that is not a highlight. */
  readonly #indents: number;
  /** The tags of the captures that color, by index. */
  readonly tags: Tag[] = [];
  /** The index of a coloring capture, by name. */
  readonly captures = new Map<string, number>();
  readonly top: NodeType;
  readonly types = new Map<string, NodeType>();
  readonly language: TreeSitter.Language;
  readonly #Parser: typeof TreeSitter.Parser;
  /** Tree-sitter parsers that no parse uses. */
  readonly #idle: TreeSitter.Parser[] = [];
  /** The unfinished parses that hold tree-sitter memory. */
  readonly #pending = new Set<TqlParse>();
  nextId = 1;

  constructor(treeSitter: TqlTreeSitter, queries: TqlQueries, data: LanguageData) {
    const { Parser: TSParser, Query, language } = treeSitter;
    this.language = language;
    this.#Parser = TSParser;
    const owned: Array<{ delete(): void }> = [];
    let names: string[];
    try {
      const parser = new TSParser();
      owned.push(parser);
      parser.setLanguage(language);
      // Each query on its own first, for its errors and capture names.
      const highlights = new Query(language, queries.highlights);
      owned.push(highlights);
      const indents = new Query(language, queries.indents);
      owned.push(indents);
      const folds = new Query(language, queries.folds);
      owned.push(folds);
      names = highlights.captureNames;
      this.#indents = highlights.patternCount();
      const sources = [queries.highlights, queries.indents, queries.folds];
      this.query = new Query(language, sources.join("\n"));
      for (const query of owned.splice(1)) query.delete();
      this.#idle.push(parser);
    } catch (error) {
      for (const object of owned) object.delete();
      throw error;
    }
    for (const name of [...names, "string", "comment"]) {
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

  /**
   * A tree-sitter parser for one parse, until `release`. A parse that yields
   * halfway keeps its parser, which resumes from where it stopped, so parses
   * that take turns each need their own.
   */
  acquire(): TreeSitter.Parser {
    const idle = this.#idle.pop();
    if (idle) return idle;
    const parser = new this.#Parser();
    try {
      parser.setLanguage(this.language);
    } catch (error) {
      parser.delete();
      throw error;
    }
    return parser;
  }

  /** Takes back a parser from `acquire`, dropping what it parsed halfway. */
  release(parser: TreeSitter.Parser) {
    parser.reset();
    if (this.#idle.length < 2) this.#idle.push(parser);
    else parser.delete();
  }

  /**
   * Notes that `parse` holds tree-sitter memory until it settles, and frees
   * that of the oldest unfinished parses, which CodeMirror may have dropped.
   */
  pend(parse: TqlParse) {
    this.#pending.delete(parse);
    this.#pending.add(parse);
    for (const pending of this.#pending) {
      if (this.#pending.size <= MAX_PENDING) break;
      pending.dispose();
    }
  }

  settle(parse: TqlParse) {
    this.#pending.delete(parse);
  }

  /** Runs the queries on `node` and records what they capture on nodes. */
  capture(node: TreeSitter.Node, options: TreeSitter.QueryOptions, captured: Map<number, Captured>) {
    for (const { name, node: target, patternIndex } of this.query.captures(node, options)) {
      if (patternIndex >= this.#indents) {
        const flags = captureFlags[name];
        if (flags) capturedAt(captured, target.id).flags |= flags;
        continue;
      }
      const capture = this.captures.get(name);
      if (capture === undefined) continue;
      const entry = capturedAt(captured, target.id);
      // Of two captures of the same node, the later pattern wins.
      if (entry.capture < 0 || patternIndex >= entry.pattern) {
        entry.capture = capture;
        entry.pattern = patternIndex;
      }
    }
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

  /** The node type of an unterminated string or comment. */
  unterminated(name: Unterminated["name"]): NodeType {
    const typeId = this.language.idForNodeType(name, true) ?? ERROR_TYPE;
    return this.type(typeId, () => name, this.captures.get(name) ?? -1, 0);
  }

  delete() {
    for (const parse of [...this.#pending]) parse.dispose();
    for (const parser of this.#idle.splice(0)) parser.delete();
    this.query.delete();
  }
}

/** What the queries captured on a node. */
type Captured = { capture: number; pattern: number; flags: number };

const capturedAt = (captured: Map<number, Captured>, id: number): Captured => {
  let entry = captured.get(id);
  if (entry === undefined) {
    entry = { capture: -1, pattern: -1, flags: 0 };
    captured.set(id, entry);
  }
  return entry;
};

/** Where the lines of `text` start. */
const lineStarts = (text: string): number[] => {
  const starts = [0];
  for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1)) starts.push(at + 1);
  return starts;
};

/** The row and column of `index` in a text whose lines start at `lines`. */
const pointAt = (lines: readonly number[], index: number): TreeSitter.Point => {
  let low = 0;
  let high = lines.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (lines[middle] <= index) low = middle;
    else high = middle - 1;
  }
  return { row: low, column: index - lines[low] };
};

/**
 * `tree`, which starts at `offset`, cut at `at`, where an unterminated string
 * or comment starts: without the nodes after it, except a first child that
 * `keep` says to keep, with the tokens across it shortened, and with the
 * nodes across it extended to `end`, the deepest of which takes `literal`.
 */
const cutAt = (tree: Tree, offset: number, at: number, end: number, literal: Tree, keep = false): Tree => {
  const children: Tree[] = [];
  const positions: number[] = [];
  for (let i = 0; i < tree.children.length; i++) {
    const start = offset + tree.positions[i];
    if (start >= at && !(keep && i === 0)) break;
    let child = tree.children[i] as Tree;
    if (start + child.length > at) {
      child =
        child.children.length > 0
          ? cutAt(child, start, at, end, literal)
          : new Tree(child.type, [], [], at - start);
    }
    children.push(child);
    positions.push(start - offset);
  }
  const last = children.length - 1;
  if ((last < 0 ? offset : offset + positions[last] + children[last].length) < end) {
    children.push(literal);
    positions.push(at - offset);
  }
  return new Tree(tree.type, children, positions, end - offset);
};

/**
 * The text from the first range's start to the last range's end, or to
 * `end`, with the gaps between ranges, which belong to another language,
 * blanked out.
 */
const readRanges = (
  input: Input,
  ranges: readonly { from: number; to: number }[],
  end = Infinity,
): string => {
  if (ranges.length === 0) return input.read(0, Math.min(input.length, end));
  let text = "";
  for (let i = 0; i < ranges.length && ranges[i].from < end; i++) {
    if (i > 0) text += " ".repeat(ranges[i].from - ranges[i - 1].to);
    text += input.read(ranges[i].from, Math.min(ranges[i].to, end));
  }
  return text;
};

/**
 * A Lezer parser that parses TQL with tree-sitter-tql and converts the result
 * into a Lezer tree, so that CodeMirror's highlighting, bracket matching,
 * indentation, folding, and commands work from TQL's tree-sitter grammar.
 *
 * Every parse parses the whole document, or the part before where CodeMirror
 * asks it to stop, in steps of a few milliseconds, so that parsing a large
 * document does not block the editor. The tree-sitter parser and queries live
 * in WebAssembly memory until `delete()` frees them, as do the trees of parses
 * that have not finished; after that, the parser must not be used anymore.
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
    const parse = new TqlParse(this.#grammar, input, ranges, from);
    return this.#wrapper ? this.#wrapper(parse, input, fragments, ranges) : parse;
  }

  /** Frees the tree-sitter parser, queries, and trees. */
  delete(): void {
    this.#grammar.delete();
  }
}

/** A node that the conversion builds, with the children so far. */
interface Frame {
  readonly type: NodeType;
  readonly from: number;
  readonly to: number;
  /** The capture that the node's children take unless they have their own. */
  readonly capture: number;
  readonly literal: boolean;
  readonly children: Tree[];
  readonly positions: number[];
}

const START = 0;
const PARSE = 1;
const BUILD = 2;
const SCAN = 3;
const DONE = 4;

/**
 * A parse that works in steps: it parses with tree-sitter, converts the tree
 * into a Lezer tree with one node per tree-sitter node, with the type,
 * capture, and flags of the queries, and finds an unterminated string or
 * comment.
 */
class TqlParse implements PartialParse {
  stoppedAt: number | null = null;
  #phase = START;
  #text = "";
  #lines: number[] = [];
  /** The tree-sitter parser while it parses halfway. */
  #treeSitter: TreeSitter.Parser | null = null;
  #tree: TreeSitter.Tree | null = null;
  #cursor: TreeSitter.TreeCursor | null = null;
  #frames: Frame[] = [];
  #captured = new Map<number, Captured>();
  /** The nodes that start before this have their captures. */
  #queried = 0;
  /** The literals that are not inside other ones, as start and end pairs. */
  #literals: number[] = [];
  #literalDepth = 0;
  #exhausted = false;
  /** Whether the tree-sitter root is a program, which becomes the top. */
  #program = true;
  /** Up to where the Lezer tree is complete. */
  #pos = 0;
  #lezer: Tree | null = null;
  #scan = 0;
  #literal = 0;
  #result: Tree | null = null;

  constructor(
    private readonly grammar: Grammar,
    private readonly input: Input,
    private readonly ranges: readonly { from: number; to: number }[],
    private readonly from: number,
  ) {}

  get parsedPos(): number {
    return this.from + (this.#phase >= BUILD ? this.#pos : 0);
  }

  stopAt(pos: number): void {
    this.stoppedAt = pos;
  }

  advance(): Tree | null {
    const deadline = now() + STEP_TIME;
    try {
      for (;;) {
        switch (this.#phase) {
          case START:
            this.#start();
            break;
          case PARSE:
            // Tree-sitter has no tree before it is done, so a parse that
            // has to stop before then returns an empty one.
            if (this.stoppedAt !== null && this.stoppedAt <= this.from) {
              this.dispose();
              return this.#finish(new Tree(this.grammar.top, [], [], 0));
            }
            if (!this.#parse(deadline)) return this.#pend();
            break;
          case BUILD:
            if (!this.#build(deadline)) return this.#pend();
            break;
          case SCAN:
            if (!this.#scanStep(deadline)) return this.#pend();
            break;
          default:
            return this.#result;
        }
      }
    } catch (error) {
      console.error("Failed to parse TQL", error);
      this.dispose();
      this.#pos = this.#text.length;
      return this.#finish(new Tree(this.grammar.top, [], [], this.#text.length));
    }
  }

  #pend(): null {
    this.grammar.pend(this);
    return null;
  }

  #finish(tree: Tree): Tree {
    this.grammar.settle(this);
    this.#phase = DONE;
    this.#result = tree;
    return tree;
  }

  /** Frees the tree-sitter memory of the parse, which then starts over. */
  dispose() {
    this.grammar.settle(this);
    if (this.#treeSitter) this.grammar.release(this.#treeSitter);
    this.#cursor?.delete();
    this.#tree?.delete();
    this.#treeSitter = this.#cursor = this.#tree = null;
    this.#frames = [];
    this.#captured = new Map();
    this.#literals = [];
    this.#literalDepth = this.#queried = this.#scan = this.#literal = this.#pos = 0;
    this.#exhausted = false;
    this.#lezer = null;
    this.#phase = START;
  }

  /** Reads the text, up to where the parse stops if CodeMirror said so. */
  #start() {
    this.#phase = PARSE;
    if (this.stoppedAt !== null && this.stoppedAt <= this.from) return;
    this.#text = readRanges(this.input, this.ranges, this.stoppedAt ?? Infinity);
    this.#lines = lineStarts(this.#text);
  }

  /** Parses with tree-sitter until done or past the deadline. */
  #parse(deadline: number): boolean {
    const parser = (this.#treeSitter ??= this.grammar.acquire());
    let late = false;
    const tree = parser.parse(this.#text, null, {
      progressCallback: () => (late = now() > deadline),
    });
    if (tree === null) {
      if (!late) throw new Error("tree-sitter did not parse");
      return false;
    }
    this.#tree = tree;
    this.#treeSitter = null;
    this.grammar.release(parser);
    const cursor = (this.#cursor = tree.walk());
    // When the root is not a program, it is the top's child.
    const program = (this.#program = cursor.nodeType === "program");
    this.#frames = [
      {
        type: this.grammar.top,
        from: 0,
        to: this.#text.length,
        capture: -1,
        literal: false,
        children: [],
        positions: [],
      },
    ];
    this.#exhausted = program && !cursor.gotoFirstChild();
    this.#phase = BUILD;
    return true;
  }

  /** Converts nodes until done, stopped, or past the deadline. */
  #build(deadline: number): boolean {
    const cursor = this.#cursor!;
    for (let steps = 1; ; steps++) {
      if (this.#exhausted) {
        this.#endBuild(this.#text.length);
        return true;
      }
      if ((steps & 15) === 0 && now() > deadline) return false;
      const from = cursor.startIndex;
      if (this.stoppedAt !== null && this.from + from >= this.stoppedAt) {
        this.#endBuild(from);
        return true;
      }
      this.#pos = from;
      if (this.#visit(cursor, from)) continue;
      while (!cursor.gotoNextSibling()) {
        if (this.#frames.length === 1) {
          this.#exhausted = true;
          break;
        }
        const frame = this.#frames.pop()!;
        if (frame.literal) this.#literalDepth--;
        this.#add(new Tree(frame.type, frame.children, frame.positions, frame.to - frame.from), frame.from);
        cursor.gotoParent();
      }
    }
  }

  /** Converts the node at the cursor, and enters it if it has children. */
  #visit(cursor: TreeSitter.TreeCursor, from: number): boolean {
    const grammar = this.grammar;
    const frame = this.#frames[this.#frames.length - 1];
    if (cursor.nodeIsMissing) {
      // Lezer marks unfinished nodes with empty error nodes.
      this.#add(new Tree(grammar.type(ERROR_TYPE, () => "⚠", -1, 0), [], [], 0), from);
      return false;
    }
    const to = cursor.endIndex;
    this.#cover(from);
    const captured = this.#captured.get(cursor.nodeId);
    // An inner node without a color of its own takes the color of the node
    // around it, as tree-sitter colors a node's whole range.
    const capture = captured !== undefined && captured.capture >= 0 ? captured.capture : frame.capture;
    const type = grammar.type(cursor.nodeTypeId, () => cursor.nodeType, capture, captured?.flags ?? 0);
    const literal = literals.has(type.name);
    if (literal && this.#literalDepth === 0 && to > from) this.#literals.push(from, to);
    if (!cursor.gotoFirstChild()) {
      this.#add(new Tree(type, [], [], to - from), from);
      return false;
    }
    if (literal) this.#literalDepth++;
    this.#frames.push({ type, from, to, capture, literal, children: [], positions: [] });
    return true;
  }

  #add(tree: Tree, from: number) {
    const frame = this.#frames[this.#frames.length - 1];
    frame.children.push(tree);
    frame.positions.push(from - frame.from);
  }

  /**
   * Runs the queries over the text from just before `from` on, a part at a
   * time, so that the node at `from` and the ones after it in the part have
   * their captures. A part covers the nodes that overlap it, and runs the
   * patterns of the nodes around it too, so that captures do not depend on
   * where the parts end.
   */
  #cover(from: number) {
    if (from < this.#queried) return;
    // Ranges in points, as web-tree-sitter 0.26 passes index ranges to
    // tree-sitter as bytes rather than UTF-16 code units. Starting before
    // `from` includes an empty node at `from`.
    const options: TreeSitter.QueryOptions = {
      startPosition: pointAt(this.#lines, Math.max(0, from - 1)),
    };
    const end = from + QUERY_SPAN;
    if (end < this.#text.length) {
      options.endPosition = pointAt(this.#lines, end);
      this.#queried = end;
    } else {
      this.#queried = Infinity;
    }
    this.grammar.capture(this.#tree!.rootNode, options, this.#captured);
  }

  /** Ends the conversion at `end`, where the top node then ends. */
  #endBuild(end: number) {
    const frames = this.#frames;
    while (frames.length > 1) {
      const frame = frames.pop()!;
      this.#add(new Tree(frame.type, frame.children, frame.positions, end - frame.from), frame.from);
    }
    const top = frames[0];
    this.#lezer = new Tree(top.type, top.children, top.positions, end);
    this.#frames = [];
    this.#pos = end;
    this.#cursor!.delete();
    this.#cursor = null;
    this.#tree!.delete();
    this.#tree = null;
    this.#phase = SCAN;
  }

  /**
   * Looks for the first string or block comment that is not closed, until
   * done or past the deadline. Tree-sitter does not see these as strings: its
   * lexer only matches a closed string, so it makes the quote an error and
   * parses on what follows as code. Since strings and block comments may span
   * lines, one that is not closed runs to the end of the document, as
   * tree-sitter would lex it once closed there.
   *
   * This only looks at quotes and comment openers outside the literals that
   * tree-sitter parsed, which during error recovery may include closed ones.
   */
  #scanStep(deadline: number): boolean {
    const text = this.#text;
    const end = this.#pos;
    const literals = this.#literals;
    const pattern = /["']|\/\*/g;
    pattern.lastIndex = this.#scan;
    for (let steps = 1; ; steps++) {
      if ((steps & 255) === 0 && now() > deadline) {
        this.#scan = pattern.lastIndex;
        return false;
      }
      const match = pattern.exec(text);
      if (match === null || match.index >= end) return this.#done(null);
      const at = match.index;
      let i = this.#literal;
      while (i < literals.length && literals[i + 1] <= at) i += 2;
      this.#literal = i;
      if (i < literals.length && literals[i] <= at) {
        pattern.lastIndex = Math.max(literals[i + 1], at + 1);
        continue;
      }
      if (match[0] === "/*") {
        const close = text.indexOf("*/", at + 2);
        if (close >= 0) {
          pattern.lastIndex = close + 2;
          continue;
        }
        return this.#done({ from: at, name: "comment" });
      }
      const string = stringAt(text, at);
      if (string.to !== null) {
        pattern.lastIndex = string.to;
        continue;
      }
      return this.#done({ from: string.from, name: "string" });
    }
  }

  /**
   * Returns the Lezer tree, with an unterminated string or comment extending
   * the deepest node around its start to the end.
   */
  #done(unterminated: Unterminated | null): true {
    let tree = this.#lezer!;
    if (unterminated !== null) {
      const { from, name } = unterminated;
      const end = this.#pos;
      const literal = new Tree(this.grammar.unterminated(name), [], [], end - from);
      // Another root stays the top's child, wherever the literal starts.
      tree = cutAt(tree, 0, from, end, literal, !this.#program);
    }
    this.#finish(tree);
    return true;
  }
}
