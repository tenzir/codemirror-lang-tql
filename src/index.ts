import { parser } from "./syntax.grammar";
import { LRLanguage, LanguageSupport } from "@codemirror/language";
import { styleTags, tags as t } from "@lezer/highlight";
import { completeFromList } from "@codemirror/autocomplete";

export const VastLanguage = LRLanguage.define({
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

export const vastCompletion = VastLanguage.data.of({
  autocomplete: completeFromList([
    { label: "head", type: "keyword" },
    { label: "where", type: "keyword" },
    { label: "drop", type: "keyword" },
    { label: "pass", type: "keyword" },
  ]),
});

export function Vast() {
  return new LanguageSupport(VastLanguage, [vastCompletion]);
}
