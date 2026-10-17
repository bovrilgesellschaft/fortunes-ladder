// Build: read the YAML, check it, and write one self-contained page per Venture to dist/.
//
//   npm run build          check everything and build every Venture
//   npm run check          check only
//
// Errors stop the build; warnings are printed and the build goes on.

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import Ajv from 'ajv';
import * as esbuild from 'esbuild';
import { compile, paths, calls } from '../engine/src/expr';
import { parseMoney } from '../engine/src/core';
import type { Content, Effect, GlossaryEntry, Option, Venture } from '../engine/src/types';
import { SEGMENTS } from '../engine/src/types';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const C = (p: string) => path.join(ROOT, 'content', p);

export const FACTIONS = ['the Quality', 'the Church', 'the Law', 'the Projectors', 'the Army & Navy', 'the Underworld', 'the Wits', 'the Trade', 'the Brethren & the Adepts', 'the Town'];
const ROOTS = new Set(['flags', 'attrs', 'hum', 'purse', 'debts', 'composure', 'luck', 'exposure', 'notoriety', 'celebrity', 'spoils', 'start']);
const FNS = new Set(['money', 'floor', 'ceil', 'min', 'max', 'if', 'has_item', 'has_item_like', 'has_hook', 'has_tag', 'has_condition', 'rumour_says']);

export interface Report { errors: string[]; warnings: string[] }

function loadYaml(file: string) {
  const doc = YAML.parseDocument(fs.readFileSync(file, 'utf8'), { prettyErrors: true });
  if (doc.errors.length) throw new Error(`${path.relative(ROOT, file)}: ${doc.errors.map(e => e.message).join('\n')}`);
  return doc.toJS();
}

export function loadAll() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const vSchema = ajv.compile(JSON.parse(fs.readFileSync(C('schema/venture.schema.json'), 'utf8')));
  const gSchema = ajv.compile(JSON.parse(fs.readFileSync(C('schema/glossary.schema.json'), 'utf8')));
  const report: Report = { errors: [], warnings: [] };

  const glossary = loadYaml(C('glossary.yaml')) as Record<string, GlossaryEntry>;
  if (!gSchema(glossary)) report.errors.push(...gSchema.errors!.map(e => `glossary.yaml ${e.instancePath} ${e.message}`));

  const ventures: Venture[] = [];
  for (const f of fs.readdirSync(C('ventures')).filter(f => f.endsWith('.yaml')).sort()) {
    const v = loadYaml(C('ventures/' + f)) as Venture;
    if (!vSchema(v)) {
      // oneOf errors are noisy: keep the most specific message per location
      const seen = new Set<string>();
      for (const e of vSchema.errors!) {
        const k = e.instancePath;
        if (seen.has(k)) continue; seen.add(k);
        report.errors.push(`${f} ${e.instancePath || '/'} ${e.message}${e.params && 'allowedValues' in e.params ? ': ' + (e.params as any).allowedValues.join(', ') : ''}`);
      }
      continue;
    }
    if (v.id + '.yaml' !== f) report.errors.push(`${f}: id is “${v.id}”, but the file is named ${f}`);
    checkVenture(v, glossary, report, f);
    ventures.push(v);
  }
  return { glossary, ventures, report };
}

// ---------- the semantic checks ----------

function checkVenture(v: Venture, glossary: Record<string, GlossaryEntry>, r: Report, f: string) {
  const at = (where: string) => `${f} ${where}`;
  const flagsSet = new Set<string>([v.loot_flag]);
  const flagsRead = new Map<string, string>();

  const expr = (src: string | undefined, where: string) => {
    if (src === undefined) return;
    try {
      const n = compile(src);
      for (const p of paths(n)) {
        if (!ROOTS.has(p[0])) r.errors.push(at(`${where}: unknown name “${p.join('.')}” in: ${src}`));
        if (p[0] === 'flags' && p[1]) flagsRead.set(p[1], where);
      }
      for (const c of calls(n)) if (!FNS.has(c)) r.errors.push(at(`${where}: unknown function ${c}() in: ${src}`));
    } catch (e) { r.errors.push(at(`${where}: ${(e as Error).message}`)); }
  };
  const text = (src: string | undefined, where: string) => {
    if (!src) return;
    let depth = 0;
    for (const m of src.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]|\{([^{}]*)\}/g)) {
      if (m[1] !== undefined) { if (!glossary[m[1].trim()]) r.errors.push(at(`${where}: [[${m[1]}]] is not in the glossary`)); continue; }
      const t = m[2].trim();
      if (t.startsWith('if ')) { depth++; expr(t.slice(3), where); }
      else if (t.startsWith('elif ')) { if (!depth) r.errors.push(at(`${where}: {elif} without {if}`)); expr(t.slice(5), where); }
      else if (t === 'else') { if (!depth) r.errors.push(at(`${where}: {else} without {if}`)); }
      else if (t === 'end') { if (!depth--) r.errors.push(at(`${where}: {end} without {if}`)); }
      else if (t.startsWith('fn ')) { /* footnote marker */ }
      else expr(t, where);
    }
    if (depth > 0) r.errors.push(at(`${where}: {if} without {end}`));
  };
  const amount = (a: number | string, where: string, isMoney: boolean) => {
    if (typeof a === 'number') return;
    if (a.trim().startsWith('=')) return expr(a.trim().slice(1), where);
    if (!isMoney) { r.errors.push(at(`${where}: “${a}” is not a number`)); return; }
    try { parseMoney(a); } catch (e) { r.errors.push(at(`${where}: ${(e as Error).message}`)); }
  };
  const tag = (t: string, where: string) => {
    const m = /\(([^)]+)\)$/.exec(t);
    if (!m || !FACTIONS.includes(m[1])) r.warnings.push(at(`${where}: Tag “${t}” should name a faction or the Town, e.g. “Rake (the Town)” (ruling D7)`));
  };
  const effects = (es: Effect[] | undefined, where: string) => {
    for (const e of es ?? []) {
      if ('adj' in e) amount(e.by, where, e.adj === 'purse' || e.adj === 'debts');
      else if ('loot' in e) amount(e.loot, where, true);
      else if ('set' in e) ([] as string[]).concat(e.set).forEach(x => flagsSet.add(x));
      else if ('unset' in e) ([] as string[]).concat(e.unset).forEach(x => flagsSet.add(x));
      else if ('calc' in e) { expr(e.to, where); if (e.calc.startsWith('flags.')) flagsSet.add(e.calc.slice(6)); else if (!ROOTS.has(e.calc)) r.errors.push(at(`${where}: cannot calc “${e.calc}”`)); }
      else if ('tag' in e) tag(e.tag, where);
      else if ('rumour' in e) {
        text(e.rumour.text, where);
        if (e.rumour.week !== undefined && e.rumour.delay !== undefined) r.errors.push(at(`${where}: rumour “${e.rumour.id}” has both week and delay`));
        if (e.rumour.week !== undefined) r.warnings.push(at(`${where}: rumour “${e.rumour.id}” uses an absolute week; rumours arrive 1–3 weeks after the Venture (ruling D13): use delay`));
      }
      else if ('when' in e) { expr(e.when, where); effects(e.then, where); effects(e.else, where); }
    }
  };

  const ids = new Set(v.beats.map(b => b.id));
  if (!ids.has(v.first)) r.errors.push(at(`first: no beat “${v.first}”`));
  v.start.tags.forEach((t, i) => tag(t, `start.tags[${i}]`));
  const reached = new Set<string>([v.first]);

  for (const b of v.beats) {
    text(b.text, `${b.id}.text`);
    b.notes?.forEach((n, i) => text(n, `${b.id}.notes[${i}]`));
    b.options.forEach((o: Option, i) => {
      const w = `${b.id}.options[${i}]`;
      if (o.gate) { expr(o.gate.when, `${w}.gate`); text(o.gate.need, `${w}.gate.need`); }
      text(o.label, `${w}.label`);
      o.check?.bonus?.forEach(x => expr(x.when, `${w}.check.bonus`));
      if (o.check && o.do) r.errors.push(at(`${w}: has both a Wheel check and a certain outcome`));
      if (o.check && !o.outcomes) r.errors.push(at(`${w}: a Wheel check needs outcomes T, S, C, R and X`));
      if (!o.check && o.outcomes) r.errors.push(at(`${w}: outcomes need a Wheel check`));
      if (!o.check && !o.do && !o.gate) r.warnings.push(at(`${w}: has no outcome and no gate, so it can never be chosen`));
      if (o.do) { effects(o.do.effects, `${w}.do`); text(o.do.text, `${w}.do.text`); }
      if (o.outcomes) for (const s of SEGMENTS) { effects(o.outcomes[s].effects, `${w}.outcomes.${s}`); text(o.outcomes[s].text, `${w}.outcomes.${s}.text`); }
      if (o.story) for (const k of Object.keys(o.story)) {
        if (k === 'M' && o.check) r.errors.push(at(`${w}.story: M (milestone) is for certain options; a Wheel check uses T or X`));
        if (k !== 'M' && !o.check) r.errors.push(at(`${w}.story: ${k} needs a Wheel check; use M for a certain option`));
      }
      if (o.do || o.check) {
        if (o.next === undefined) r.errors.push(at(`${w}: no next`));
        const nx = typeof o.next === 'string' ? [{ go: o.next }] : (o.next ?? []);
        for (const n of nx) {
          if ('when' in n) expr(n.when, `${w}.next`);
          if (n.go !== 'reckon' && !ids.has(n.go)) r.errors.push(at(`${w}.next: no beat “${n.go}”`));
          reached.add(n.go);
        }
        if (Array.isArray(o.next) && o.next.at(-1)?.when) r.errors.push(at(`${w}.next: the last route needs no 'when', so one always matches`));
      }
    });
  }
  for (const id of ids) if (!reached.has(id)) r.warnings.push(at(`beat “${id}” is never reached`));
  if (!reached.has('reckon')) r.errors.push(at(`no option leads to the Reckoning`));

  const R = v.reckoning;
  R.steps.forEach((s, i) => { expr(s.when, `reckoning.steps[${i}]`); if ('do' in s) effects(s.do, `reckoning.steps[${i}]`); else text(s.say, `reckoning.steps[${i}]`); });
  text(R.upkeep, 'reckoning.upkeep');
  const ch = v.chapter;
  expr(ch.special?.when, 'chapter.special'); ch.parts.forEach((p, i) => expr(p.when, `chapter.parts[${i}]`)); expr(ch.last.when, 'chapter.last');

  for (const [flag, where] of flagsRead) if (!flagsSet.has(flag) && !flag.startsWith('_')) r.errors.push(at(`${where}: flag “${flag}” is read but never set`));
}

// ---------- the build ----------

export async function bundleEngine(): Promise<string> {
  const out = await esbuild.build({
    entryPoints: [path.join(ROOT, 'engine/src/main.ts')], bundle: true, write: false,
    format: 'iife', target: 'es2020', minify: true, legalComments: 'none',
  });
  return out.outputFiles[0].text;
}

export function page(content: Content, script: string): string {
  const v = content.venture;
  const shell = fs.readFileSync(path.join(ROOT, 'engine/page/shell.html'), 'utf8');
  const style = fs.readFileSync(path.join(ROOT, 'engine/page/style.css'), 'utf8').trim();
  const json = JSON.stringify(content).replace(/</g, '\\u003c');
  const fill: Record<string, string> = {
    title: v.title, runhead: v.runhead, sub: v.sub, prospectus: v.prospectus.trim(),
    chapterNo: v.chapter.no, chapterOpening: v.chapter.opening + '.',
    storyTitle: v.story?.title ?? '', storyByline: v.story?.byline ?? '',
    style, script: `var FL_CONTENT=${json};\n${script}`,
  };
  return shell.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    if (!(k in fill)) throw new Error(`shell.html: unknown placeholder {{${k}}}`);
    return fill[k];
  });
}

async function main() {
  const mode = process.argv[2] ?? 'build';
  const { glossary, ventures, report } = loadAll();
  for (const w of report.warnings) console.log('warning: ' + w);
  for (const e of report.errors) console.log('ERROR:   ' + e);
  if (report.errors.length) { console.log(`\n${report.errors.length} error(s); nothing built.`); process.exit(1); }
  if (mode === 'check') { console.log(`Checked ${ventures.length} Venture(s): no errors.`); return; }
  const script = await bundleEngine();
  fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
  for (const v of ventures) {
    const file = path.join(ROOT, 'dist', v.id + '.html');
    fs.writeFileSync(file, page({ venture: v, glossary }, script));
    console.log(`built dist/${v.id}.html (${Math.round(fs.statSync(file).size / 1024)} KB)`);
  }
}

if (process.argv[1]?.endsWith('build.mjs') || process.argv[1]?.endsWith('build.ts')) main().catch(e => { console.error(e.message); process.exit(1); });
