import { type Highlighter, type Tag, tags as t } from "@lezer/highlight";

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
  "function.method": t.function(t.propertyName),
  string: t.string,
  "string.escape": t.escape,
  "string.special": t.special(t.string),
  number: t.number,
  boolean: t.bool,
  constant: t.constant(t.name),
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

/** The tag of a capture, if it has one, with `tags` over the defaults. */
export const captureTag = (capture: string, tags: TqlCaptureTags = {}): Tag | undefined => {
  if (capture.startsWith("_")) return undefined;
  const tag = lookupCapture(tags, capture);
  if (tag !== undefined) return tag ?? undefined;
  return lookupCapture(tqlCaptureTags, capture);
};

/**
 * A highlighter that styles TQL by capture name, the way tree-sitter themes
 * do: `classes` maps capture names to CSS classes, and a capture without an
 * entry takes the class of the nearest capture it refines, so a `function`
 * entry covers `function.call` and `function.method`. Unlike `tagHighlighter`,
 * this does not fall back to a tag's parents, so `function.call` never takes
 * the class of `variable`.
 *
 * Pass the same `tags` as to `tql` if you configured them there.
 */
export const tqlHighlighter = (
  classes: Readonly<Record<string, string>>,
  tags: TqlCaptureTags = {},
): Highlighter => {
  // Captures that share a tag take the class of the most specific one.
  const captures = [...new Set([...Object.keys(tqlCaptureTags), ...Object.keys(tags)])];
  captures.sort((a, b) => a.split(".").length - b.split(".").length);
  const byTag = new Map<Tag, string>();
  for (const capture of captures) {
    const tag = captureTag(capture, tags);
    const cls = lookupCapture(classes, capture);
    if (tag && cls) byTag.set(tag, cls);
  }
  return {
    style: (styles) => {
      let result: string | null = null;
      for (const tag of styles) {
        const cls = byTag.get(tag);
        if (cls) result = result ? `${result} ${cls}` : cls;
      }
      return result;
    },
  };
};
