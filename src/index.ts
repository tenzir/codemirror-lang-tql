import { parser } from "./syntax.grammar";
import { LRLanguage, LanguageSupport } from "@codemirror/language";
import { styleTags, tags as t } from "@lezer/highlight";
import { completeFromList } from "@codemirror/autocomplete";
import { data } from "../output.js";

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

type GeneretedCompletion = {
  label: string;
  type: string;
  detail: string;
  processedHTML: string;
};

type Completion = {
  label: string;
  type: string;
  detail: string;
  info: () => Node;
};

const getCompletion = (completion: GeneretedCompletion): Completion => {
  return {
    label: completion.label,
    type: completion.type,
    detail: completion.detail,
    info: () => {
      const node = document.createElement("div");
      node.innerHTML = completion.processedHTML;
      return node;
    },
  };
};
const tqlCompletionList = data.map((completion: GeneretedCompletion) =>
  getCompletion(completion)
);

export const tqlCompletion = TenzirQueryLang.data.of({
  autocomplete: completeFromList(tqlCompletionList),
});

export function TQL() {
  return new LanguageSupport(TenzirQueryLang, [tqlCompletion]);
}
