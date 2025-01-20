import { parser } from "./tql.grammar";
import { LRLanguage, LanguageSupport } from "@codemirror/language";
import { styleTags, tags as t } from "@lezer/highlight";
import { completeFromList, Completion } from "@codemirror/autocomplete";
import { data } from "../output.js";

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
        "StringEsc and else if in let match meta not or this": t.keyword,
        "OpName! FnIdent": t.name,
        [punctuation]: t.punctuation,
        "LineComment BlockComment": t.comment,
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
  docLink: string;
};

const getCompletion = (completion: GeneretedCompletion): Completion => {
  return {
    label: completion.label,
    type: completion.type,
    detail: completion.detail,
    info: () => {
      const node = document.createElement("div");
      const div = document.createElement("div");
      div.className = "custom-completioninfoHeader";

      div.innerHTML = `<div><a class="custom-docLink" href="${completion.docLink}" target="_blank"><span>${completion.label}</span><div class="custom-icon"></div></a></div>`;

      node.insertAdjacentElement("afterbegin", div);
      node.innerHTML += completion.processedHTML;
      return node;
    },
  };
};
const tqlCompletionList = data.map((completion: GeneretedCompletion) =>
  getCompletion(completion),
);

export const tqlCompletion = TenzirQueryLang.data.of({
  autocomplete: completeFromList(tqlCompletionList),
});

export function TQL() {
  return new LanguageSupport(TenzirQueryLang, [tqlCompletion]);
}
