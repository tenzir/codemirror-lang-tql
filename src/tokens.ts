import { ExternalTokenizer, ContextTracker, Stack } from "@lezer/lr"
import {
  ignoredNewline,
  newline,
  LParen,
  RParen,
  LBrace,
  RBrace,
  LBracket,
  RBracket,
  Comma,
  Ident,
  FnIdent,
  DollarIdent
} from "./parser.terms.js"

type ContextData = {
  ignoreNewlines: boolean
  justHadComma: boolean
}

class MyContext {
  constructor(parent: MyContext | null, data: ContextData) {
    this.parent = parent ?? this
    this.data = data
  }

  public ignoreNewlines(value: boolean): MyContext {
    return new MyContext(this, { ...this.data, ignoreNewlines: value })
  }

  public justHadComma(value: boolean): MyContext {
    return new MyContext(this.parent, { ...this.data, justHadComma: value })
  }

  parent: MyContext
  data: ContextData
}

const startContext = new MyContext(null, { ignoreNewlines: false, justHadComma: false })

export const context = new ContextTracker({
  start: startContext,
  reduce(context, term, stack, input) {
    return context
  },
  shift(context, term, stack, input) {
    context = context.justHadComma(term === Comma)
    if (term === LParen || term == LBracket) {
      return context.ignoreNewlines(true)
    }
    if (term === LBrace) {
      return context.ignoreNewlines(false)
    }
    if (term === RParen || term == RBrace || term == RBracket) {
      return context.parent
    }
    return context
  }
})

function code(x: string): number {
  return x.charCodeAt(0)
}

export const newlines = new ExternalTokenizer((input, stack) => {
  let ctx = stack.context.data;
  if (input.next == code("\n")) {
    let ignore = ctx.ignoreNewlines || ctx.justHadComma
    input.acceptToken(ignore ? ignoredNewline : newline, 1)
    return
  }
}, { contextual: true })

export const identifiers = new ExternalTokenizer((input, stack) => {
  const a = code("a");
  const z = code("z");
  const A = code("A");
  const Z = code("Z");
  const u = code("_");
  const n0 = code("0");
  const n9 = code("9");
  const first = (n: number) => (a <= n && n <= z) || (A <= n && n <= Z) || (n == u);
  const rest = (n: number) => first(n) || (n0 <= n && n <= n9);
  let token = Ident;
  if (!first(input.peek(0))) {
    if (input.peek(0) != code("$")) {
      return;
    }
    token = DollarIdent;
  }
  let n = 1;
  while (rest(input.peek(n))) {
    n += 1;
  }
  if (input.peek(n) == code("(")) {
    token = FnIdent;
  }
  input.acceptToken(token, n);
})
