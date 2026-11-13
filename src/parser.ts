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
  readonly brackets: string;
  readonly injections: string;
  readonly tags: TqlCaptureTags;
}

type LanguageData = ReturnType<typeof defineLanguageFacet>;

/**
 * The most nodes that one query covers: the descendants of a subtree queried
 * at once, or the children among which sibling patterns match.
 */
const QUERY_SIZE = 256;

/** The type id tree-sitter gives error nodes. */
const ERROR_TYPE = 0xffff;

const INDENT = 1;
const OUTDENT = 2;
const FOLD = 4;
const AUTO = 8;
const OPEN = 16;
const CLOSE = 32;

/** Flags that captures of the indent and fold queries set on a node. */
const captureFlags: Readonly<Record<string, number>> = {
  indent: INDENT,
  "indent.begin": INDENT,
  outdent: OUTDENT,
  "indent.end": OUTDENT,
  "indent.branch": OUTDENT,
  "indent.dedent": OUTDENT,
  "indent.auto": AUTO,
  fold: FOLD,
  open: OPEN,
  close: CLOSE,
};

/** The language that the injection query injects into a node. */
export const injectionProp = new NodeProp<string>();

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
 * Leaves the indentation of a line that starts inside a node alone, so that a
 * new line keeps the indentation of the line before, as `@indent.auto` does in
 * nvim-treesitter. Elsewhere, the nodes around it decide.
 */
const indentAuto = (cx: TreeIndentContext): number | null =>
  cx.pos > cx.node.from && cx.pos < cx.node.to ? null : cx.continue();

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

/**
 * The type of the root of an empty document, which is the grammar's start
 * rule, or the language's name if an empty document is an error.
 */
const rootName = (Parser: typeof TreeSitter.Parser, language: TreeSitter.Language): string => {
  const parser = new Parser();
  let tree: TreeSitter.Tree | null = null;
  try {
    parser.setLanguage(language);
    tree = parser.parse("");
    return tree && !tree.rootNode.isError ? tree.rootNode.type : (language.name ?? "document");
  } finally {
    tree?.delete();
    parser.delete();
  }
};

/** Quotes a node name for `styleTags`, which splits selectors at spaces. */
const selector = (name: string) => JSON.stringify(name).replace(/ /g, "\\u0020");

/** How long one step of a parse may take before it yields, in milliseconds. */
const STEP_TIME = 4;

const now = () => performance.now();

/** Native handles only: this must not retain the parse or its generator. */
class ParseResources {
  parser: TreeSitter.Parser | null = null;
  tree: TreeSitter.Tree | null = null;
  cursor: TreeSitter.TreeCursor | null = null;

  delete() {
    this.cursor?.delete();
    this.tree?.delete();
    this.parser?.delete();
    this.cursor = this.tree = this.parser = null;
  }
}

/** The node types, captures, and queries of one TQL parser. */
class Grammar {
  /** All queries in one, which runs faster. */
  readonly query: TreeSitter.Query;
  /** Sibling patterns start one level below the parent that contains them. */
  readonly queryDepth: number;
  /** The index of the first pattern that is not a highlight. */
  readonly #indents: number;
  /** The tags of the captures that color, by index. */
  readonly tags: Tag[] = [];
  /** The index of a coloring capture, by name. */
  readonly captures = new Map<string, number>();
  /** The tokens that a bracket pattern pairs, by pattern index. */
  readonly #pairs = new Map<number, { open?: string; close?: string }>();
  readonly top: NodeType;
  readonly types = new Map<string, NodeType>();
  readonly language: TreeSitter.Language;
  readonly Parser: typeof TreeSitter.Parser;
  /** Handles stay enumerable for delete(), without retaining dropped parses. */
  readonly #pending = new Set<ParseResources>();
  readonly #collected = new FinalizationRegistry<ParseResources>((resources) => this.release(resources));
  nextId = 1;

  constructor(treeSitter: TqlTreeSitter, queries: TqlQueries, data: LanguageData) {
    const { Parser: TSParser, Query, language } = treeSitter;
    this.language = language;
    this.Parser = TSParser;
    const highlights = new Query(language, queries.highlights);
    const names = highlights.captureNames;
    this.#indents = highlights.patternCount();
    try {
      this.query = new Query(
        language,
        [queries.highlights, queries.indents, queries.folds, queries.brackets, queries.injections].join(
          "\n",
        ),
      );
    } finally {
      highlights.delete();
    }
    this.queryDepth = Array.from({ length: this.query.patternCount() }, (_, i) => i).some(
      (i) => !this.query.isPatternRooted(i),
    ) ? 1 : 0;
    for (const name of names) {
      const tag = captureTag(name, queries.tags);
      if (tag && !this.captures.has(name)) {
        this.captures.set(name, this.tags.length);
        this.tags.push(tag);
      }
    }
    this.top = NodeType.define({
      id: 0,
      name: rootName(TSParser, language),
      top: true,
      props: [
        [languageDataProp, data],
        [indentNodeProp, indentTop],
      ],
    });
  }

  /** CodeMirror drops parses without cancelling them. Never evict live ones. */
  track(parse: object): ParseResources {
    const resources = new ParseResources();
    this.#pending.add(resources);
    this.#collected.register(parse, resources, resources);
    return resources;
  }

  release(resources: ParseResources) {
    this.#collected.unregister(resources);
    this.#pending.delete(resources);
    resources.delete();
  }

  /**
   * Runs the queries on all of a small subtree at once. On a larger one, it
   * runs the patterns that start at `node` and, unless it has too many
   * children for one step, the sibling patterns among them. Returns whether
   * the queries covered the whole subtree.
   */
  captureAt(node: TreeSitter.Node, captured: Map<number, Captured>): boolean {
    if (node.descendantCount <= QUERY_SIZE) {
      this.capture(node, {}, captured);
      return true;
    }
    const maxStartDepth = node.childCount <= QUERY_SIZE ? this.queryDepth : 0;
    this.capture(node, { maxStartDepth }, captured);
    return false;
  }

  /** Runs the queries on `node` and records what they capture on nodes. */
  capture(node: TreeSitter.Node, options: TreeSitter.QueryOptions, captured: Map<number, Captured>) {
    // Unlike captures, matches need not wait for earlier matches to finish,
    // which would buffer all of a wide node behind its opening bracket.
    for (const { patternIndex, captures, setProperties } of this.query.matches(node, options)) {
      for (const { name, node: target } of captures) {
        if (patternIndex >= this.#indents) {
          const injection = name === "injection.content" && setProperties?.["injection.language"];
          if (injection) capturedAt(captured, target.id).injection = injection;
          const flags = captureFlags[name];
          if (!flags) continue;
          const entry = capturedAt(captured, target.id);
          entry.flags |= flags;
          if (flags & (OPEN | CLOSE)) {
            // Each bracket pattern pairs one opening and one closing token.
            let pair = this.#pairs.get(patternIndex);
            if (pair === undefined) this.#pairs.set(patternIndex, (pair = {}));
            pair[name as "open" | "close"] = target.type;
            entry.bracket = patternIndex;
          }
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
  }

  /** The node type for a tree-sitter type with what the queries captured. */
  type(typeId: number, name: () => string, capture: number, entry?: Captured): NodeType {
    const flags = entry?.flags ?? 0;
    const pair = entry && this.#pairs.get(entry.bracket);
    const partner = flags & OPEN ? pair?.close : flags & CLOSE ? pair?.open : undefined;
    const injection = entry?.injection;
    const key = `${typeId}:${capture}:${flags}:${partner ?? ""}:${injection ?? ""}`;
    let type = this.types.get(key);
    if (type === undefined) {
      const error = typeId === ERROR_TYPE;
      const typeName = error ? "⚠" : name();
      const props: Array<NodePropSource | [NodeProp<any>, any]> = [];
      if (partner && flags & OPEN) props.push([NodeProp.closedBy, [partner]]);
      if (partner && flags & CLOSE) props.push([NodeProp.openedBy, [partner]]);
      if (capture >= 0) props.push(styleTags({ [selector(typeName)]: this.tags[capture] }));
      if (flags & INDENT) props.push([indentNodeProp, indentInside]);
      else if (flags & AUTO) props.push([indentNodeProp, indentAuto]);
      if (flags & OUTDENT) props.push([outdentProp, true]);
      if (flags & FOLD) props.push([foldNodeProp, foldRange]);
      if (injection) props.push([injectionProp, injection]);
      type = NodeType.define({ id: this.nextId++, name: typeName, error, props });
      this.types.set(key, type);
    }
    return type;
  }

  delete() {
    for (const resources of this.#pending) this.release(resources);
    this.query.delete();
  }
}

/** What the queries captured on a node. */
type Captured = {
  capture: number;
  pattern: number;
  flags: number;
  bracket: number;
  injection?: string;
};

const capturedAt = (captured: Map<number, Captured>, id: number): Captured => {
  let entry = captured.get(id);
  if (entry === undefined) {
    entry = { capture: -1, pattern: -1, flags: 0, bracket: -1 };
    captured.set(id, entry);
  }
  return entry;
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
 * asks it to stop, in steps targeting a few milliseconds. Native parsers and
 * trees are freed when their work finishes. `delete()` frees the combined
 * query and any unfinished parses; afterwards, this parser must not be used.
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
  readonly children: Tree[];
  readonly positions: number[];
}

/**
 * The generator keeps local parse state across bounded advances. Its finally
 * block frees native handles on completion or errors; Grammar also owns those
 * handles for explicit deletion and finalization of abandoned parses.
 */
class TqlParse implements PartialParse {
  stoppedAt: number | null = null;
  parsedPos: number;
  #deadline = 0;
  #work: Generator<undefined, Tree> | null = null;
  #result: Tree | null = null;

  constructor(
    private readonly grammar: Grammar,
    private readonly input: Input,
    private readonly ranges: readonly { from: number; to: number }[],
    private readonly from: number,
  ) {
    this.parsedPos = from;
  }

  stopAt(pos: number): void {
    this.stoppedAt = pos;
  }

  advance(): Tree | null {
    if (this.#result) return this.#result;
    if (!this.#work) this.#work = this.run();
    this.#deadline = now() + STEP_TIME;
    const step = this.#work.next();
    if (!step.done) return null;
    this.#work = null;
    return (this.#result = step.value);
  }

  private *run(): Generator<undefined, Tree> {
    const grammar = this.grammar;
    const resources = grammar.track(this);
    let text = "";
    let parser: TreeSitter.Parser | null = null;
    let tree: TreeSitter.Tree | null = null;
    let cursor: TreeSitter.TreeCursor | null = null;
    try {
      text = readRanges(this.input, this.ranges, this.stoppedAt ?? Infinity);
      parser = resources.parser = new grammar.Parser();
      parser.setLanguage(grammar.language);
      while (!tree) {
        if (this.stoppedAt !== null && this.stoppedAt <= this.from)
          return new Tree(grammar.top, [], [], 0);
        let interrupted = false;
        tree = resources.tree = parser.parse(text, null, {
          progressCallback: () => (interrupted = now() > this.#deadline),
        });
        if (!tree) {
          if (!interrupted) throw new Error("tree-sitter did not parse");
          yield;
        }
      }
      parser.delete();
      parser = resources.parser = null;

      const captured = new Map<number, Captured>();
      cursor = resources.cursor = tree.walk();
      // An error at the root becomes a node of its own.
      const inlineRoot = cursor.nodeTypeId !== ERROR_TYPE;
      // The depth up to which nodes are queried as the walk enters them.
      let queriedDepth = inlineRoot && grammar.captureAt(tree.rootNode, captured) ? 0 : Infinity;
      const frames: Frame[] = [{
        type: grammar.top,
        from: 0,
        to: text.length,
        capture: -1,
        children: [],
        positions: [],
      }];
      const add = (node: Tree, from: number) => {
        const parent = frames[frames.length - 1];
        parent.children.push(node);
        parent.positions.push(from - parent.from);
      };
      const close = (end?: number) => {
        const frame = frames.pop()!;
        add(new Tree(frame.type, frame.children, frame.positions, (end ?? frame.to) - frame.from), frame.from);
      };

      let exhausted = inlineRoot && !cursor.gotoFirstChild();
      let end = text.length;
      for (let steps = 0; !exhausted; steps++) {
        const from = cursor.startIndex;
        this.parsedPos = this.from + from;
        if ((steps & 15) === 0 && now() > this.#deadline) yield;
        if (this.stoppedAt !== null && this.parsedPos >= this.stoppedAt) {
          end = from;
          break;
        }

        if (cursor.nodeIsMissing) {
          add(new Tree(grammar.type(ERROR_TYPE, () => "⚠", -1), [], [], 0), from);
        } else {
          // Query small subtrees once. For larger ones, query the node, then
          // visit its children.
          if (frames.length <= queriedDepth) {
            queriedDepth = grammar.captureAt(cursor.currentNode, captured) ? frames.length : Infinity;
          }
          const entry = captured.get(cursor.nodeId);
          const parent = frames[frames.length - 1];
          // Uncolored descendants inherit the enclosing capture.
          const capture = entry && entry.capture >= 0 ? entry.capture : parent.capture;
          const type = grammar.type(cursor.nodeTypeId, () => cursor!.nodeType, capture, entry);
          const to = cursor.endIndex;
          if (cursor.gotoFirstChild()) {
            frames.push({ type, from, to, capture, children: [], positions: [] });
            continue;
          }
          add(new Tree(type, [], [], to - from), from);
        }
        while (!cursor.gotoNextSibling()) {
          if (frames.length === 1) {
            exhausted = true;
            break;
          }
          close();
          cursor.gotoParent();
        }
      }
      while (frames.length > 1) close(end);
      const top = frames[0];
      const result = new Tree(top.type, top.children, top.positions, end);
      this.parsedPos = this.from + end;
      cursor.delete();
      cursor = resources.cursor = null;
      tree.delete();
      tree = resources.tree = null;
      return result;
    } catch (error) {
      console.error("Failed to parse TQL", error);
      this.parsedPos = this.from + text.length;
      return new Tree(grammar.top, [], [], text.length);
    } finally {
      grammar.release(resources);
    }
  }
}
