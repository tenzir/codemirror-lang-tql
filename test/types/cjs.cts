// The package's declarations as a CommonJS module sees them.
import type { LanguageSupport } from "@codemirror/language";
import { loadTql, tql, tqlHighlighter } from "@tenzir/codemirror-lang-tql";

export const load: (url: string) => Promise<LanguageSupport> = (url) => loadTql({ grammarWasmUrl: url });
export const make: typeof tql = tql;
export const highlighter = tqlHighlighter({ keyword: "k" });
