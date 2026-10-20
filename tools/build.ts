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
import { NAME_ROOTS } from '../engine/src/names';
import type { Content, Effect, GlossaryEntry, Option, Origin, Settings, StoryWords, Venture, World } from '../engine/src/types';
import { SEGMENTS } from '../engine/src/types';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const C = (p: string) => path.join(ROOT, 'content', p);

export const FACTIONS = ['the Quality', 'the Church', 'the Law', 'the Projectors', 'the Army & Navy', 'the Underworld', 'the Wits', 'the Trade', 'the Brethren & the Adepts', 'the Town'];
export const DISTRICTS = ['St Giles', 'Southwark', 'The Savoy', 'Moorfields', 'Fleet Street and the Strand', 'Covent Garden', 'The City', "St James's", 'Mayfair', 'The Environs'];
// names a condition may read: the hero's state, and in a run the calendar (year, week, turn) and Origin
const ROOTS = new Set(['flags', 'attrs', 'hum', 'purse', 'debts', 'composure', 'luck', 'exposure', 'notoriety', 'celebrity', 'spoils', 'start', 'persona', 'year', 'week', 'turn', 'origin', ...NAME_ROOTS, 'writ_amount', 'writ_money', 'creditor', 'prison', 'debts_all', 'debts_money',
  // the false self (Step 7)
  'claimed_rank', 'true_rank', 'secret', 'appearances', 'expected_next', 'lodging_district', 'equipage', 'sale_price', 'sale_money', 'circles_known', 'sex', 'prophecy']);
const FNS = new Set(['money', 'floor', 'ceil', 'min', 'max', 'if', 'has_item', 'has_item_like', 'has_hook', 'has_tag', 'has_condition', 'has_persona', 'played', 'rumour_says', 'rank_at_least', 'known_in', 'has_tag_in', 'standing']);

export interface Report { errors: string[]; warnings: string[] }
let REGISTER: Record<string, unknown> | null = null;

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

  const vJson = JSON.parse(fs.readFileSync(C('schema/venture.schema.json'), 'utf8'));
  const startSchema = ajv.compile({ ...vJson.definitions.start, definitions: vJson.definitions });
  const sSchema = ajv.compile(JSON.parse(fs.readFileSync(C('schema/settings.schema.json'), 'utf8')));
  const oSchema = ajv.compile(JSON.parse(fs.readFileSync(C('schema/origins.schema.json'), 'utf8')));
  const settings = loadYaml(C('settings.yaml')) as Settings;
  if (!sSchema(settings)) report.errors.push(...sSchema.errors!.map(e => `settings.yaml ${e.instancePath} ${e.message}`));
  REGISTER = settings.tags?.register ?? null;
  const origins = loadYaml(C('origins.yaml')) as Origin[];
  const stSchema = ajv.compile(JSON.parse(fs.readFileSync(C('schema/story.schema.json'), 'utf8')));
  const story = loadYaml(C('story.yaml')) as StoryWords;
  if (!stSchema(story)) report.errors.push(...stSchema.errors!.map(e => `story.yaml ${e.instancePath} ${e.message}`));
  if (!oSchema(origins)) report.errors.push(...oSchema.errors!.map(e => `origins.yaml ${e.instancePath} ${e.message}`));

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
  checkRun(origins, settings, ventures, startSchema, report, story);
  const world: World = { story, ventures, origins, settings, glossary };
  return { glossary, ventures, origins, settings, world, report };
}

function checkRun(origins: Origin[], settings: Settings, ventures: Venture[], startSchema: any, r: Report, story: StoryWords) {
  const ids = new Set(ventures.map(v => v.id));
  for (const d of Object.keys(settings.lodging ?? {})) if (!DISTRICTS.includes(d)) r.errors.push(`settings.yaml lodging: “${d}” is not one of the ten districts`);
  for (const o of origins ?? []) {
    const at = `origins.yaml ${o.id}`;
    if (o.available && !o.hero) r.errors.push(`${at}: an available Origin needs a hero`);
    if (o.hero) {
      if (!startSchema(o.hero.start)) r.errors.push(...startSchema.errors!.map((e: any) => `${at} hero.start${e.instancePath} ${e.message}`));
      if (!(o.hero.lodging.district in settings.lodging)) r.errors.push(`${at}: no lodging price for ${o.hero.lodging.district}`);
      for (const k of ['purse', 'debts'] as const) { const a = o.hero.start[k]; if (typeof a === 'string') try { parseMoney(a); } catch (e) { r.errors.push(`${at} hero.start.${k}: ${(e as Error).message}`); } }
    }
    if (o.arrival) {
      const v = ventures.find(x => x.id === o.arrival);
      if (!v) r.errors.push(`${at}: arrival Venture “${o.arrival}” does not exist`);
      else if (!v.offer?.arrival) r.errors.push(`${at}: “${o.arrival}” should have offer.arrival: true`);
    }
  }
  // the Story's own words (Step 9): every slot must be one the engine fills
  const SLOTS = new Set([...NAME_ROOTS, 'hero', 'Hero', 'adventurer', 'he', 'his', 'him', 'himself', 'He', 'His', 'his_cap', 'himself_cap', 'a_gentleman', 'rank', 'old_rank', 'persona', 'district', 'prison', 'name_blown', 'patron', 'from', 'date', 'text']);
  const walk = (x: unknown, where: string): void => {
    if (typeof x === 'string') { for (const m of x.matchAll(/\{(\w+)\}/g)) if (!SLOTS.has(m[1])) r.errors.push(`story.yaml ${where}: unknown slot {${m[1]}}`); }
    else if (Array.isArray(x)) x.forEach((y, i) => walk(y, `${where}[${i}]`));
    else if (x && typeof x === 'object') for (const [k, y] of Object.entries(x)) walk(y, where ? `${where}.${k}` : k);
  };
  walk(story, '');
  for (const o of origins ?? []) walk(o.hero?.secret_out, `(origins.yaml ${o.id} secret_out)`);

  // the false self (Step 7)
  const P = settings.personas, circles = new Set(settings.factions ?? []);
  const kinds = new Set((P?.kinds ?? []).map(k => k.id));
  for (const k of P?.kinds ?? []) {
    const at = `settings.yaml personas.kinds ${k.id}`;
    for (const h of k.home) if (!origins.some(o => o.id === h)) r.errors.push(`${at}: home “${h}” is not an Origin`);
    if (k.sex !== 'woman' && !k.titles.man) r.errors.push(`${at}: a kind for men needs titles.man`);
    if (k.sex !== 'man' && !k.titles.woman) r.errors.push(`${at}: a kind for women needs titles.woman`);
    if (k.test) try { const n = compile(k.test); for (const p of paths(n)) if (!ROOTS.has(p[0])) r.errors.push(`${at}: unknown name “${p.join('.')}” in its test`); for (const c of calls(n)) if (!FNS.has(c)) r.errors.push(`${at}: unknown function ${c}()`); } catch (e) { r.errors.push(`${at}: ${(e as Error).message}`); }
    try { parseMoney(String(k.cost)); } catch (e) { r.errors.push(`${at} cost: ${(e as Error).message}`); }
  }
  for (const c of settings.factions ?? []) if (!FACTIONS.includes(c)) r.errors.push(`settings.yaml factions: “${c}” is not one of the design document's factions`);
  // the Tag register (Step 8)
  const reg = settings.tags?.register ?? {};
  for (const [n, e] of Object.entries(reg)) {
    if (e.opposite && !reg[e.opposite]) r.errors.push(`settings.yaml tags: ${n}'s opposite “${e.opposite}” is not in the register`);
    for (const f of e.except ?? []) if (!FACTIONS.includes(f)) r.errors.push(`settings.yaml tags: ${n} excepts “${f}”, not a faction`);
  }
  const tagCheck = (t: string, where: string) => { const m = /^(.*) \((.+)\)$/.exec(t); if (m && !reg[m[1]]) r.warnings.push(`${where}: Tag “${m[1]}” is not in the register (settings.yaml tags)`); };
  for (const o of origins ?? []) { o.hero?.start.tags.forEach(t => tagCheck(t, `origins.yaml ${o.id}`)); if (o.hero?.secret_out?.tag) tagCheck(o.hero.secret_out.tag, `origins.yaml ${o.id} secret_out`); }
  tagCheck(settings.economy.savoy.tag, 'settings.yaml economy.savoy'); tagCheck(settings.humours.relief.religion.tag, 'settings.yaml humours.relief');
  if (!ventures.some(v => v.id === settings.humours.quarrel)) r.errors.push(`settings.yaml humours.quarrel: no Venture “${settings.humours.quarrel}”`);
  REGISTER = reg;
  for (const o of origins ?? []) {
    if (o.hero?.alias_kind && !kinds.has(o.hero.alias_kind)) r.errors.push(`origins.yaml ${o.id}: alias_kind “${o.hero.alias_kind}” is not a kind of Persona`);
    if (o.available && !o.hero?.secret_out) r.warnings.push(`origins.yaml ${o.id}: no secret_out, so its Secret costs nothing when it comes out`);
  }
  for (const v of ventures) {
    if (v.offer?.circle && !circles.has(v.offer.circle)) r.errors.push(`${v.id}.yaml offer.circle: “${v.offer.circle}” is not a circle`);
    if (!v.offer) continue;
    if (!DISTRICTS.includes(v.offer.district)) r.errors.push(`${v.id}.yaml offer.district: “${v.offer.district}” is not one of the ten districts`);
    if (v.test) r.warnings.push(`${v.id}.yaml: placeholder test content (Step 5)`);
  }
  void ids;
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
    // each paragraph is rendered on its own, so an {if} must close within its paragraph
    const paras = src.trim().split(/\n\s*\n/);
    if (paras.length > 1) { paras.forEach(p => text(p, where)); return; }
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
    else if (REGISTER && !REGISTER[t.slice(0, t.lastIndexOf(' ('))]) r.warnings.push(at(`${where}: Tag “${t}” is not in the register (settings.yaml tags)`));
  };
  const effects = (es: Effect[] | undefined, where: string) => {
    for (const e of es ?? []) {
      if ('adj' in e) amount(e.by, where, e.adj === 'purse' || e.adj === 'debts');
      else if ('pledge' in e) amount(e.loan, where, true);
      else if ('note' in e) { amount(e.note, where, true); text(e.to, where); }
      else if ('loot' in e) amount(e.loot, where, true);
      else if ('set' in e) ([] as string[]).concat(e.set).forEach(x => flagsSet.add(x));
      else if ('unset' in e) ([] as string[]).concat(e.unset).forEach(x => flagsSet.add(x));
      else if ('calc' in e) { expr(e.to, where); if (e.calc.startsWith('flags.')) flagsSet.add(e.calc.slice(6)); else if (!ROOTS.has(e.calc)) r.errors.push(at(`${where}: cannot calc “${e.calc}”`)); }
      else if ('tag' in e) tag(e.tag, where);
      else if ('rumour' in e) {
        text(e.rumour.text, where);
        if (e.rumour.hindsight) text(e.rumour.hindsight, where + '.hindsight');
        effects(e.rumour.on_delivery, where + '.on_delivery');
        if (e.rumour.week !== undefined && e.rumour.delay !== undefined) r.errors.push(at(`${where}: rumour “${e.rumour.id}” has both week and delay`));
        if (e.rumour.week !== undefined) r.warnings.push(at(`${where}: rumour “${e.rumour.id}” uses an absolute week; rumours arrive 1–3 weeks after the Venture (ruling D13): use delay`));
      }
      else if ('when' in e) { expr(e.when, where); effects(e.then, where); effects(e.else, where); }
    }
  };

  expr(v.offer?.when, 'offer.when');
  const ids = new Set(v.beats.map(b => b.id));
  if (!ids.has(v.first)) r.errors.push(at(`first: no beat “${v.first}”`));
  v.start.tags.forEach((t, i) => tag(t, `start.tags[${i}]`));
  const reached = new Set<string>([v.first]);

  for (const b of v.beats) {
    text(b.text, `${b.id}.text`);
    text(b.ask, `${b.id}.ask`);
    b.notes?.forEach((n, i) => text(n, `${b.id}.notes[${i}]`));
    b.options.forEach((o: Option, i) => {
      const w = `${b.id}.options[${i}]`;
      if (o.gate) { expr(o.gate.when, `${w}.gate`); text(o.gate.need, `${w}.gate.need`); }
      if (o.price !== undefined) amount(o.price, `${w}.price`, true);
      text(o.label, `${w}.label`);
      o.check?.bonus?.forEach(x => expr(x.when, `${w}.check.bonus`));
      if (o.check && o.do) r.errors.push(at(`${w}: has both a Wheel check and a certain outcome`));
      if (o.check && !o.outcomes) r.errors.push(at(`${w}: a Wheel check needs outcomes T, S, C, R and X`));
      if (!o.check && o.outcomes) r.errors.push(at(`${w}: outcomes need a Wheel check`));
      if (!o.check && !o.do && !o.gate) r.warnings.push(at(`${w}: has no outcome and no gate, so it can never be chosen`));
      if (o.do) { effects(o.do.effects, `${w}.do`); text(o.do.text, `${w}.do.text`); }
      if (o.outcomes) for (const s of SEGMENTS) { effects(o.outcomes[s].effects, `${w}.outcomes.${s}`); text(o.outcomes[s].text, `${w}.outcomes.${s}.text`); }
      if (o.story) for (const [k, ps] of Object.entries(o.story)) {
        text(ps!, `${w}.story.${k}`);
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

  if (v.story) for (const k of ['preface', 'close'] as const) text(v.story[k], `story.${k}`);
  const R = v.reckoning;
  R.steps.forEach((s, i) => { expr(s.when, `reckoning.steps[${i}]`); if ('do' in s) effects(s.do, `reckoning.steps[${i}]`); else text(s.say, `reckoning.steps[${i}]`); });
  text(R.upkeep, 'reckoning.upkeep');
  const ch = v.chapter;
  expr(ch.special?.when, 'chapter.special'); ch.parts.forEach((p, i) => expr(p.when, `chapter.parts[${i}]`)); expr(ch.last.when, 'chapter.last');

  for (const [flag, where] of flagsRead) if (!flagsSet.has(flag) && !flag.startsWith('_')) r.errors.push(at(`${where}: flag “${flag}” is read but never set`));
}

// ---------- the build ----------

export async function bundleEngine(entry = 'main.ts'): Promise<string> {
  const out = await esbuild.build({
    entryPoints: [path.join(ROOT, 'engine/src', entry)], bundle: true, write: false,
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

/** The run page: the whole game so far, every Venture and Origin in one page. */
export function runPage(world: World, script: string): string {
  const shell = fs.readFileSync(path.join(ROOT, 'engine/page/run.html'), 'utf8');
  const style = fs.readFileSync(path.join(ROOT, 'engine/page/style.css'), 'utf8').trim() + '\n' + fs.readFileSync(path.join(ROOT, 'engine/page/run.css'), 'utf8').trim();
  const json = JSON.stringify(world).replace(/</g, '\\u003c');
  return shell.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    if (k === 'style') return style;
    if (k === 'script') return `var FL_WORLD=${json};\n${script}`;
    throw new Error(`run.html: unknown placeholder {{${k}}}`);
  });
}

async function main() {
  const mode = process.argv[2] ?? 'build';
  const { glossary, ventures, world, report } = loadAll();
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
  const runFile = path.join(ROOT, 'dist', 'index.html');
  fs.writeFileSync(runFile, runPage(world, await bundleEngine('run-main.ts')));
  console.log(`built dist/index.html, the run (${Math.round(fs.statSync(runFile).size / 1024)} KB)`);
}

if (process.argv[1]?.endsWith('build.mjs') || process.argv[1]?.endsWith('build.ts')) main().catch(e => { console.error(e.message); process.exit(1); });
