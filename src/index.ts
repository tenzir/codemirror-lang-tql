import { parser } from "./syntax.grammar";
import { LRLanguage, LanguageSupport } from "@codemirror/language";
import { styleTags, tags as t } from "@lezer/highlight";
import { completeFromList } from "@codemirror/autocomplete";

export const TenzirQueryLang = LRLanguage.define({
  parser: parser.configure({
    props: [
      styleTags({
        Int64: t.integer,
        UInt64: t.integer,
        Ip: t.atom,

        None: t.null,
        Comparison: t.compareOperator,
        "|| &&": t.logicOperator,
        true: t.bool,
        false: t.bool,

        Field: t.variableName,
        LineComment: t.comment,
        "|": t.operatorKeyword,

        Head: t.keyword,
        Where: t.keyword,
        Pass: t.keyword,
        Drop: t.keyword,
      }),
    ],
    // TODO: add folding later
  }),
});

export const tqlCompletion = TenzirQueryLang.data.of({
  autocomplete: completeFromList([
    { label: "drop", type: "keyword" },
    { label: "export", type: "keyword" },
    { label: "extend", type: "keyword" },
    { label: "from", type: "keyword" },
    { label: "hash", type: "keyword" },
    { label: "head", type: "keyword" },
    { label: "import", type: "keyword" },
    { label: "load", type: "keyword" },
    { label: "measure", type: "keyword" },
    { label: "parse", type: "keyword" },
    { label: "pass", type: "keyword" },
    { label: "publish", type: "keyword" },
    { label: "put", type: "keyword" },
    { label: "print", type: "keyword" },
    { label: "read", type: "keyword" },
    { label: "rename", type: "keyword" },
    { label: "repeat", type: "keyword" },
    { label: "replace", type: "keyword" },
    { label: "save", type: "keyword" },
    { label: "select", type: "keyword" },
    { label: "serve", type: "keyword" },
    { label: "shell", type: "keyword" },
    { label: "sigma", type: "keyword" },
    { label: "sort", type: "keyword" },
    { label: "subscribe", type: "keyword" },
    { label: "summarize", type: "keyword" },
    { label: "tail", type: "keyword" },
    { label: "taste", type: "keyword" },
    { label: "to", type: "keyword" },
    { label: "unique", type: "keyword" },
    { label: "version", type: "keyword" },
    { label: "where", type: "keyword" },
    { label: "write", type: "keyword" },
  ]),
});

export function TQL() {
  return new LanguageSupport(TenzirQueryLang, [tqlCompletion]);
}
