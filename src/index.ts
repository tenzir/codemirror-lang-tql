import { parser } from "./syntax.grammar";
import { LRLanguage, LanguageSupport } from "@codemirror/language";
import { styleTags, tags as t } from "@lezer/highlight";
import { completeFromList } from "@codemirror/autocomplete";
import { data } from "../output.js";

export const TenzirQueryLang = LRLanguage.define({
  parser: parser.configure({
    props: [
      styleTags({
        "Null Bool Number Ip String Time": t.literal,
        "OperatorName!": t.name,
        "Punct": t.punctuation,
        "Type": t.typeName,
        "Pipe": t.separator,
        "LineComment BlockComment": t.comment,
        "Meta": t.meta,
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
