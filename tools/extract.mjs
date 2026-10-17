// One-off converter: reads a prototype Venture's JavaScript (reference/*.published.html)
// and writes a YAML draft of its beats. Anything it cannot translate is marked TODO
// with the original source, to be finished by hand. Kept for the record; not part of the build.
//
//   node tools/extract.mjs reference/ball.published.html > drafts/ball.beats.yaml

import fs from 'node:fs';
import * as acorn from 'acorn';
import YAML from 'yaml';

const html = fs.readFileSync(process.argv[2], 'utf8');
const src = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
const ast = acorn.parse(src, { ecmaVersion: 2022 });
const code = n => src.slice(n.start, n.end);

// constants such as LETTER and toCrisis
const consts = {};
(function walk(n) {
  if (!n || typeof n !== 'object') return;
  if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier') consts[n.id.name] = n.init;
  for (const k in n) if (k !== 'parent') { const v = n[k]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === 'string') walk(v); }
})(ast);

const todo = [];
const TODO = (what, n) => { todo.push(what); return `TODO(${what}): ${code(n)}`; };

// ---------- JS expression → content expression ----------
function stateRoot(n) {
  const parts = [];
  while (n.type === 'MemberExpression' && !n.computed) { parts.unshift(n.property.name); n = n.object; }
  if (n.type === 'Identifier' && (n.name === 's' || n.name === 'S')) return parts.join('.');
  return null;
}
function isStartsWithSome(n, coll) {
  // s.hooks.some(h=>h.startsWith('X'))
  if (n.type !== 'CallExpression' || n.callee.type !== 'MemberExpression' || n.callee.property.name !== 'some') return null;
  if (stateRoot(n.callee.object) !== coll) return null;
  const f = n.arguments[0];
  if (f?.type !== 'ArrowFunctionExpression' || f.body.type !== 'CallExpression' || f.body.callee.property?.name !== 'startsWith') return null;
  return lit(f.body.arguments[0]);
}
function lit(n) {
  if (n.type === 'Literal') return n.value;
  if (n.type === 'TemplateLiteral' && !n.expressions.length) return n.quasis[0].value.cooked;
  if (n.type === 'Identifier' && consts[n.name]) return lit(consts[n.name]);
  if (n.type === 'UnaryExpression' && n.operator === '-' && n.argument.type === 'Literal') return -n.argument.value;
  throw new Error('not a literal: ' + code(n));
}
const OP = { '===': '==', '!==': '!=', '==': '==', '!=': '!=', '>=': '>=', '<=': '<=', '>': '>', '<': '<', '+': '+', '-': '-', '*': '*', '/': '/' };
function ex(n, parentOp) {
  const wrap = (s, op) => (parentOp && parentOp !== op ? `(${s})` : s);
  switch (n.type) {
    case 'Literal': return typeof n.value === 'string' ? JSON.stringify(n.value) : String(n.value);
    case 'Identifier': if (consts[n.name]) return JSON.stringify(lit(n)); break;
    case 'MemberExpression': { const p = stateRoot(n); if (p) return p; break; }
    case 'UnaryExpression':
      if (n.operator === '!' && n.argument.type === 'UnaryExpression' && n.argument.operator === '!') return ex(n.argument.argument, parentOp);
      if (n.operator === '!') return `not ${ex(n.argument, 'not')}`;
      if (n.operator === '-') return `-${ex(n.argument, 'neg')}`;
      break;
    case 'LogicalExpression': { const op = n.operator === '&&' ? 'and' : 'or'; return wrap(`${ex(n.left, op)} ${op} ${ex(n.right, op)}`, op); }
    case 'BinaryExpression': if (OP[n.operator]) { const op = OP[n.operator]; return wrap(`${ex(n.left, op)} ${op} ${ex(n.right, op)}`, op); } break;
    case 'ConditionalExpression': return `if(${ex(n.test)}, ${ex(n.consequent)}, ${ex(n.alternate)})`;
    case 'CallExpression': {
      const h = isStartsWithSome(n, 'hooks'); if (h !== null) return `has_hook(${JSON.stringify(h)})`;
      const t = isStartsWithSome(n, 'tags'); if (t !== null) return `has_tag(${JSON.stringify(t)})`;
      if (n.callee.type === 'MemberExpression' && n.callee.property.name === 'includes' && stateRoot(n.callee.object) === 'items') return `has_item(${ex(n.arguments[0])})`;
      if (n.callee.type === 'MemberExpression' && n.callee.object.name === 'Math') return `${n.callee.property.name}(${n.arguments.map(a => ex(a)).join(', ')})`;
      if (n.callee.name === 'money') return `money(${ex(n.arguments[0])})`;
      break;
    }
  }
  return TODO('expr', n);
}

// ---------- template literal → content template ----------
function tpl(n) {
  if (n.type === 'Literal') return String(n.value);
  if (n.type === 'TemplateLiteral') {
    let s = '';
    n.quasis.forEach((q, i) => { s += q.value.cooked; if (i < n.expressions.length) s += tplExpr(n.expressions[i]); });
    return s;
  }
  return tplExpr(n);
}
function tplExpr(e) {
  if (e.type === 'CallExpression' && e.callee.name === 'c') {
    const a = e.arguments.map(lit);
    return a[1] ? `[[${a[0]}|${a[1]}]]` : `[[${a[0]}]]`;
  }
  if (e.type === 'ConditionalExpression') {
    const a = tpl(e.consequent), b = tpl(e.alternate);
    return `{if ${ex(e.test)}}${a}${b ? `{else}${b}` : ''}{end}`;
  }
  if (e.type === 'CallExpression' && e.callee.name === 'money') return `{money(${ex(e.arguments[0])})}`;
  const p = e.type === 'MemberExpression' && stateRoot(e);
  if (p) return `{${p}}`;
  return TODO('template', e);
}
function prose(s) {
  s = s.replace(/<sup class="fn">([^<]*)<\/sup>/g, '{fn $1}')
    .replace(/\{if ([^}]*)\}<p>/g, '<p>{if $1}')
    .replace(/<\/p>\{else\}<p>/g, '{else}')
    .replace(/<\/p>\{end\}/g, '{end}</p>');
  const paras = s.split(/<\/p>/).map(p => p.replace(/<p>/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  return paras.join('\n\n');
}

// ---------- statements → effects ----------
function effects(stmts) {
  const out = []; let text;
  for (const st of stmts) {
    if (st.type === 'ReturnStatement') { text = prose(tpl(st.argument)); continue; }
    if (st.type !== 'ExpressionStatement') { out.push(TODO('statement', st)); continue; }
    const e = st.expression;
    if (e.type === 'AssignmentExpression' && e.operator === '=') {
      const p = stateRoot(e.left);
      if (p?.startsWith('flags.') && e.right.type === 'Literal') { out.push(e.right.value ? { set: p.slice(6) } : { unset: p.slice(6) }); continue; }
    }
    if (e.type === 'CallExpression') {
      const fn = e.callee.type === 'Identifier' ? e.callee.name : null;
      const A = e.arguments;
      try {
        if (fn === 'adj') { const why = lit(A[2]); const by = A[1].type === 'Literal' || A[1].type === 'UnaryExpression' ? lit(A[1]) : `= ${ex(A[1])}`; out.push({ adj: lit(A[0]), by: lit(A[0]) === 'purse' || lit(A[0]) === 'debts' ? moneyStr(by) : by, why }); continue; }
        if (fn === 'loot') { out.push({ loot: moneyStr(lit(A[0])), why: lit(A[1]) }); continue; }
        if (fn === 'tag') { out.push({ tag: lit(A[0]), why: lit(A[1]) }); continue; }
        if (fn === 'item') { out.push({ item: lit(A[0]), why: lit(A[1]) }); continue; }
        if (fn === 'lose') { out.push({ lose: lit(A[0]), why: lit(A[1]) }); continue; }
        if (fn === 'hook') { out.push({ hook: lit(A[0]), why: lit(A[1]) }); continue; }
        if (fn === 'unhook') { out.push({ unhook: lit(A[0]), why: lit(A[1]) }); continue; }
        if (fn === 'rumour') { out.push({ rumour: Object.fromEntries(A[0].properties.map(p => [p.key.name, lit(p.value)])) }); continue; }
      } catch { /* fall through */ }
      if (e.callee.type === 'MemberExpression' && e.callee.property.name === 'push' && stateRoot(e.callee.object) === 'items') { out.push({ item: lit(A[0]), quiet: true }); continue; }
    }
    out.push(TODO('effect', st));
  }
  return { effects: out.length ? out : undefined, text };
}
function moneyStr(p) {
  if (typeof p === 'string') return p;
  const neg = p < 0; p = Math.abs(p);
  const L = Math.floor(p / 240), s = Math.floor(p % 240 / 12), d = p % 12;
  const a = []; if (L) a.push('£' + L); if (s) a.push(s + 's'); if (d) a.push(d + 'd');
  return (neg ? '-' : '') + (a.join(' ') || '0d');
}
function fnBody(f) {
  if (f.body.type === 'BlockStatement') return effects(f.body.body);
  return { text: prose(tpl(f.body)) };
}

// ---------- beats ----------
const props = o => Object.fromEntries(o.properties.map(p => [p.key.name ?? p.key.value, p.value]));
const beats = [];
for (const st of ast.body[0].expression.callee.body.body) {
  if (st.type !== 'ExpressionStatement' || st.expression.type !== 'AssignmentExpression') continue;
  const L = st.expression.left;
  if (L.type !== 'MemberExpression' || L.object.name !== 'B') continue;
  const P = props(st.expression.right);
  const beat = { id: L.property.name, num: lit(P.num), phase: lit(P.phase), title: lit(P.title), sid: lit(P.sid) };
  if (P.dev) beat.dev = lit(P.dev);
  beat.text = prose(tpl(P.text.body));
  if (P.notes) beat.notes = P.notes.elements.map(lit);
  beat.ask = lit(P.ask);
  beat.options = P.opts.elements.map(oe => {
    const o = props(oe); const r = { label: lit(o.label) };
    if (o.gate) { const g = props(o.gate.body); r.gate = { when: ex(g.ok), need: tpl(g.need) }; }
    if (o.cost) r.cost = lit(o.cost);
    if (o.withdraw) r.withdraw = true;
    if (o.check) {
      const c = props(o.check); r.check = { attr: lit(c.attr), diff: lit(c.diff) };
      if (c.bonus) {
        const b = c.bonus.body;
        if (b.type === 'ConditionalExpression' && b.consequent.type === 'ArrayExpression') {
          const [by, why] = b.consequent.elements.map(lit);
          r.check.bonus = [{ when: ex(b.test), by, why }];
        } else if (b.type === 'ArrayExpression') {
          const [by, why] = b.elements.map(lit); r.check.bonus = [{ by, why }];
        } else r.check.bonus = TODO('bonus', c.bonus);
      }
    }
    if (o.dev) r.dev = lit(o.dev);
    if (o.do) r.do = fnBody(o.do);
    if (o.out) r.outcomes = Object.fromEntries(props(o.out) && o.out.properties.map(p => [p.key.name, fnBody(p.value)]));
    if (o.story) r.story = Object.fromEntries(o.story.properties.map(p => [p.key.name, Object.fromEntries(p.value.properties.map(q => [q.key.name, lit(q.value)]))]));
    if (o.next) {
      const n = o.next;
      if (n.type === 'Literal') r.next = n.value;
      else {
        const f = n.type === 'Identifier' ? consts[n.name] : n;
        const body = f.body;
        if (body.type === 'ConditionalExpression') r.next = [{ when: ex(body.test), go: lit(body.consequent) }, { go: lit(body.alternate) }];
        else r.next = TODO('next', n);
      }
    }
    return r;
  });
  beats.push(beat);
}

const doc = new YAML.Document({ beats });
YAML.visit(doc, { Pair(_, pair) { if (pair.key?.value === 'effects' && YAML.isSeq(pair.value)) for (const it of pair.value.items) if (YAML.isMap(it) && !it.has('rumour')) it.flow = true; if ((pair.key?.value === 'bonus' || pair.key?.value === 'next') && YAML.isSeq(pair.value)) for (const it of pair.value.items) if (YAML.isMap(it)) it.flow = true; } });
YAML.visit(doc, { Scalar(key, node) { if (typeof node.value === 'string' && node.value.includes('\n')) node.type = 'BLOCK_LITERAL'; } });
process.stdout.write(doc.toString({ lineWidth: 0 }));
if (todo.length) process.stderr.write(`TODO: ${todo.length} (${[...new Set(todo)].join(', ')})\n`);
