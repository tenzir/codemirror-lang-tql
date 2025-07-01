import { parser } from "./tql.grammar";
import { LRLanguage, LanguageSupport, foldNodeProp, foldInside } from "@codemirror/language";
import { styleTags, tags as t } from "@lezer/highlight";

const punctuation = `"+" "-" "*" "/" "=" "." "'" ":" "!" "?" "<" ">" "@" "%" "&" "#" ";" "^" "\`"`;

export const TenzirQueryLang = LRLanguage.define({
  languageData: {
    commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
  },
  parser: parser.configure({
    props: [
      styleTags({
        "Scalar true false null DollarIdent": t.literal,
        String: t.string,
        "StringEsc and else if in let match meta not or this move": t.keyword,
        "OpName! FnIdent": t.name,
        [punctuation]: t.punctuation,
        "LineComment BlockComment": t.comment,
      }),
      foldNodeProp.add({
        "PipeExpr": foldInside,
        "RecordStart": (node) => {
          // Find the corresponding RecordRest to fold the entire record
          let next = node.node.nextSibling;
          while (next && next.name !== "RecordRest") {
            next = next.nextSibling;
          }
          if (next) {
            return { from: node.from + 1, to: next.to - 1 };
          }
          return null;
        },
        "BlockComment": (node) => ({ from: node.from + 2, to: node.to - 2 }),
      }),
    ],
  }),
});

export function TQL() {
  return new LanguageSupport(TenzirQueryLang);
}
