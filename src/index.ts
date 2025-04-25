import { parser } from "./tql.grammar";
import { LRLanguage, LanguageSupport } from "@codemirror/language";
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
    ],
    // TODO: add folding later
  }),
});

export function TQL() {
  return new LanguageSupport(TenzirQueryLang);
}
