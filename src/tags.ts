import { type Highlighter, Tag, tags as t } from "@lezer/highlight";

/**
 * The style tags that the highlight query's captures map to by default.
 *
 * A capture without an entry of its own falls back to its parent capture by
 * dropping trailing components, so `@function.builtin` resolves like
 * `@function`. Captures that resolve to no tag do not color anything.
 */
export const tqlCaptureTags: Readonly<Record<string, Tag>> = {
  keyword: t.keyword,
  operator: t.operator,
  attribute: t.attributeName,
  function: t.function(t.variableName),
  "function.call": t.function(t.variableName),
  "function.operator": t.function(t.variableName),
  "function.method": t.function(t.propertyName),
  string: t.string,
  "string.escape": t.escape,
  "string.special": t.special(t.string),
  number: t.number,
  "number.time": t.number,
  "number.duration": t.number,
  boolean: t.bool,
  constant: t.constant(t.name),
  "constant.ip": t.constant(t.name),
  "constant.subnet": t.constant(t.name),
  "constant.builtin": t.null,
  variable: t.variableName,
  "variable.builtin": t.special(t.variableName),
  "variable.parameter": t.local(t.variableName),
  property: t.propertyName,
  type: t.typeName,
  label: t.labelName,
  comment: t.comment,
  punctuation: t.punctuation,
  "punctuation.bracket": t.bracket,
  "punctuation.delimiter": t.separator,
};

/**
 * Style tags by capture name that replace the defaults of `tqlCaptureTags`.
 * An entry covers the captures that refine it unless they have entries of
 * their own, so `punctuation` covers `punctuation.bracket`. `null` leaves a
 * capture out: its node then shows the color of the node around it, as
 * tree-sitter themes do for captures they do not style.
 */
export type TqlCaptureTags = Readonly<Record<string, Tag | null>>;

/** The entry of `table` for `capture` or the nearest capture it refines. */
export const lookupCapture = <T>(
  table: Readonly<Record<string, T>>,
  capture: string,
): T | undefined => {
  for (let name = capture; ; ) {
    if (Object.prototype.hasOwnProperty.call(table, name)) return table[name];
    const dot = name.lastIndexOf(".");
    if (dot < 0) return undefined;
    name = name.slice(0, dot);
  }
};

/** The modifier that marks a tag as coming from a capture, by capture name. */
const modifiers = new Map<string, (tag: Tag) => Tag>();

/** The capture name of a tag that `captureTag` returned. */
const captureNames = new Map<Tag, string>();

/**
 * The tag of a capture, if it has one, with `tags` over the defaults. It is
 * the capture's standard tag with a modifier for the capture, so standard
 * highlighters fall back to the standard tag, while `tqlHighlighter` tells
 * captures apart that share one.
 */
export const captureTag = (capture: string, tags: TqlCaptureTags = {}): Tag | undefined => {
  if (capture.startsWith("_")) return undefined;
  let tag = lookupCapture(tags, capture);
  if (tag === undefined) tag = lookupCapture(tqlCaptureTags, capture);
  if (!tag) return undefined;
  let modifier = modifiers.get(capture);
  if (modifier === undefined) {
    modifier = Tag.defineModifier(`@${capture}`);
    modifiers.set(capture, modifier);
  }
  const captured = modifier(tag);
  captureNames.set(captured, capture);
  return captured;
};

/**
 * A highlighter that styles TQL by capture name, the way tree-sitter themes
 * do: `classes` maps capture names to CSS classes, and a capture without an
 * entry takes the class of the nearest capture it refines, so a `function`
 * entry covers `function.call` and `function.method`. Unlike `tagHighlighter`,
 * this does not fall back to a tag's parents, so `function.call` never takes
 * the class of `variable`.
 */
export const tqlHighlighter = (classes: Readonly<Record<string, string>>): Highlighter => {
  return {
    style: (styles) => {
      let result: string | null = null;
      for (const tag of styles) {
        const capture = captureNames.get(tag);
        const cls = capture === undefined ? undefined : lookupCapture(classes, capture);
        if (cls) result = result ? `${result} ${cls}` : cls;
      }
      return result;
    },
  };
};
