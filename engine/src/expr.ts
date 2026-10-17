// A small, safe expression language for content conditions and amounts.
//
//   flags.will and spoils > 0
//   attrs.Address >= 3
//   not flags.sawFace
//   has_hook("Will Gallow")
//   -floor(spoils / 2)
//   if(flags.willHalf, 1/2, 1/3)
//
// Identifiers are dotted paths into the scope (unknown paths read as 0).
// Operators: or, and, not, == != < <= > >=, + - * /, unary minus, parentheses.
// Functions are supplied by the caller.

export type Scope = Record<string, unknown>;
export type Fn = (...args: unknown[]) => unknown;

type Node =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'path'; v: string[] }
  | { k: 'call'; name: string; args: Node[] }
  | { k: 'un'; op: string; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node };

const TOKEN = /\s*(?:(\d+(?:\.\d+)?)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)|(==|!=|<=|>=|[<>+\-*/(),]))/y;

function tokenize(src: string): string[] {
  const out: string[] = [];
  TOKEN.lastIndex = 0;
  let pos = 0;
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(src);
    if (!m) throw new Error(`Cannot read the expression at “${src.slice(pos).trim()}” in: ${src}`);
    out.push(m[1] ?? m[2] ?? m[3] ?? m[4]);
    pos = TOKEN.lastIndex;
  }
  return out;
}

export function parse(src: string): Node {
  const t = tokenize(src);
  let i = 0;
  const peek = () => t[i];
  const take = (want?: string) => {
    const x = t[i++];
    if (want !== undefined && x !== want) throw new Error(`Expected “${want}” but found “${x ?? 'the end'}” in: ${src}`);
    return x;
  };
  const or = (): Node => { let a = and(); while (peek() === 'or') { take(); a = { k: 'bin', op: 'or', a, b: and() }; } return a; };
  const and = (): Node => { let a = not(); while (peek() === 'and') { take(); a = { k: 'bin', op: 'and', a, b: not() }; } return a; };
  const not = (): Node => { if (peek() === 'not') { take(); return { k: 'un', op: 'not', a: not() }; } return cmp(); };
  const cmp = (): Node => {
    let a = add();
    while (['==', '!=', '<', '<=', '>', '>='].includes(peek())) { const op = take(); a = { k: 'bin', op, a, b: add() }; }
    return a;
  };
  const add = (): Node => { let a = mul(); while (peek() === '+' || peek() === '-') { const op = take(); a = { k: 'bin', op, a, b: mul() }; } return a; };
  const mul = (): Node => { let a = unary(); while (peek() === '*' || peek() === '/') { const op = take(); a = { k: 'bin', op, a, b: unary() }; } return a; };
  const unary = (): Node => { if (peek() === '-') { take(); return { k: 'un', op: '-', a: unary() }; } return atom(); };
  const atom = (): Node => {
    const x = take();
    if (x === undefined) throw new Error(`The expression ends too soon: ${src}`);
    if (x === '(') { const e = or(); take(')'); return e; }
    if (/^\d/.test(x)) return { k: 'num', v: parseFloat(x) };
    if (x[0] === '"' || x[0] === "'") return { k: 'str', v: x.slice(1, -1).replace(/\\(.)/g, '$1') };
    if (/^[A-Za-z_]/.test(x)) {
      if (x === 'true') return { k: 'num', v: 1 };
      if (x === 'false') return { k: 'num', v: 0 };
      if (peek() === '(') {
        take('(');
        const args: Node[] = [];
        if (peek() !== ')') { args.push(or()); while (peek() === ',') { take(); args.push(or()); } }
        take(')');
        return { k: 'call', name: x, args };
      }
      return { k: 'path', v: x.split('.') };
    }
    throw new Error(`Unexpected “${x}” in: ${src}`);
  };
  const tree = or();
  if (i < t.length) throw new Error(`Unexpected “${t[i]}” in: ${src}`);
  return tree;
}

const truthy = (v: unknown) => !!v && v !== 0;

export function evaluate(n: Node, scope: Scope, fns: Record<string, Fn>): unknown {
  switch (n.k) {
    case 'num': case 'str': return n.v;
    case 'path': {
      let v: unknown = scope;
      for (const p of n.v) v = v == null ? undefined : (v as Record<string, unknown>)[p];
      return v ?? 0;
    }
    case 'call': {
      if (n.name === 'if') {
        return truthy(evaluate(n.args[0], scope, fns)) ? evaluate(n.args[1], scope, fns) : evaluate(n.args[2], scope, fns);
      }
      const f = fns[n.name];
      if (!f) throw new Error(`Unknown function ${n.name}()`);
      return f(...n.args.map(a => evaluate(a, scope, fns)));
    }
    case 'un': {
      const a = evaluate(n.a, scope, fns);
      return n.op === 'not' ? !truthy(a) : -(a as number);
    }
    case 'bin': {
      if (n.op === 'and') return truthy(evaluate(n.a, scope, fns)) && truthy(evaluate(n.b, scope, fns));
      if (n.op === 'or') return truthy(evaluate(n.a, scope, fns)) || truthy(evaluate(n.b, scope, fns));
      const a = evaluate(n.a, scope, fns) as number, b = evaluate(n.b, scope, fns) as number;
      switch (n.op) {
        case '==': return a == b; case '!=': return a != b;
        case '<': return a < b; case '<=': return a <= b; case '>': return a > b; case '>=': return a >= b;
        case '+': return a + b; case '-': return a - b; case '*': return a * b; case '/': return a / b;
      }
    }
  }
  throw new Error('Bad expression node');
}

/** Paths an expression reads, for validation (e.g. flags read but never set). */
export function paths(n: Node, out: string[][] = []): string[][] {
  if (n.k === 'path') out.push(n.v);
  if (n.k === 'call') n.args.forEach(a => paths(a, out));
  if (n.k === 'un') paths(n.a, out);
  if (n.k === 'bin') { paths(n.a, out); paths(n.b, out); }
  return out;
}

export function calls(n: Node, out: string[] = []): string[] {
  if (n.k === 'call') { out.push(n.name); n.args.forEach(a => calls(a, out)); }
  if (n.k === 'un') calls(n.a, out);
  if (n.k === 'bin') { calls(n.a, out); calls(n.b, out); }
  return out;
}

const cache = new Map<string, Node>();
export function compile(src: string): Node {
  let n = cache.get(src);
  if (!n) { n = parse(src); cache.set(src, n); }
  return n;
}
