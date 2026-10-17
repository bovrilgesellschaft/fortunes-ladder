// Verify that a Venture plays identically from YAML and from its original prototype.
//
//   npm run verify                         every Venture with a reference copy
//   npm run verify -- ball                 one Venture
//
// Walks every reachable path (every enabled option, every Wheel segment) through both
// the prototype (reference/<id>.published.html, run in jsdom) and the new engine, and
// compares at every step: beat prose, gates, odds, outcome prose, Ledger chips, state,
// rumours, Story passages, the Reckoning prose and the chapter heading.

import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { Run } from '../engine/src/core';
import type { Option, Segment } from '../engine/src/types';
import { SEGMENTS } from '../engine/src/types';
import { loadAll } from './build';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const norm = (h: string) => h.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();

function prototype(id: string) {
  const html = fs.readFileSync(path.join(ROOT, 'reference', id + '.published.html'), 'utf8');
  const s = html.indexOf('<script>'), e = html.lastIndexOf('</script>');
  let script = html.slice(s + 8, e);
  const tail = script.lastIndexOf('})();');
  script = script.slice(0, tail) +
    `window.__api={B,fresh,renderReckon,chapterTitle,money,
      addStory: typeof addStory==='function'?addStory:null,
      get S(){return S},set S(v){S=v},get START(){return START},set START(v){START=v},
      get fx(){return fx},set fx(v){fx=v}};\n` + script.slice(tail);
  const dom = new JSDOM(html.slice(0, s + 8) + script + html.slice(e), {
    runScripts: 'dangerously', url: 'https://example.org/',
    beforeParse(w: any) {
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      w.scrollTo = () => {}; w.Element.prototype.scrollIntoView = () => {};
      w.requestAnimationFrame = (f: () => void) => setTimeout(f, 0);
    },
  });
  return { api: (dom.window as any).__api, doc: dom.window.document };
}

function stateView(S: any) {
  const x = clone(S);
  for (const k of Object.keys(x.flags ?? {})) if (k.startsWith('_') || !x.flags[k]) delete x.flags[k];
  x.story = (x.story ?? []).map((p: any) => ({ sm: p.sm, st: p.st }));
  delete x.storyAdded;
  if (Array.isArray(x.conditions) && !x.conditions.length) delete x.conditions;
  return x;
}

function diffs(a: unknown, b: unknown, where: string, out: string[]) {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b as object)])) diffs((a as any)[k], (b as any)[k], `${where}.${k}`, out);
    return;
  }
  out.push(`${where}:\n      prototype: ${JSON.stringify(a)}\n      YAML:      ${JSON.stringify(b)}`);
}

async function verify(id: string) {
  const { glossary, ventures, report } = loadAll();
  if (report.errors.length) throw new Error(report.errors.join('\n'));
  const v = ventures.find(x => x.id === id)!;
  const run = new Run({ venture: v, glossary });
  const { api, doc } = prototype(id);
  const storyEl = doc.querySelector('#story')!;

  api.S = api.fresh(); api.START = clone(api.S);
  run.start();
  const problems: string[] = [];
  let paths = 0, steps = 0;
  const check = (where: string, a: unknown, b: unknown) => { const before = problems.length; diffs(a, b, where, problems); return problems.length === before; };

  const walk = (ps: any, ms: any, beatId: string, trail: string[]) => {
    if (problems.length > 20) return;
    const B = api.B[beatId], beat = run.beats[beatId];
    api.S = clone(ps); run.S = clone(ms);
    check(`[${trail.join(' › ')}] ${beatId} text`, norm(B.text(api.S)), norm(run.prose(beat.text)));
    B.opts.forEach((po: any, i: number) => {
      const mo: Option = beat.options[i];
      api.S = clone(ps); run.S = clone(ms);
      const pg = po.gate ? po.gate(api.S) : { ok: true, need: '' };
      const mg = run.gate(mo);
      check(`[${trail.join(' › ')}] ${beatId}#${i} gate`, { ok: !!pg.ok, need: pg.need ?? '' }, mg);
      const plocked = !pg.ok || (!po.do && !po.check);
      check(`[${trail.join(' › ')}] ${beatId}#${i} locked`, plocked, run.locked(mo));
      check(`[${trail.join(' › ')}] ${beatId}#${i} label`, po.label, run.inline(mo.label));
      if (po.check) {
        const [b, why] = po.check.bonus ? po.check.bonus(api.S) : [0, ''];
        const comp = api.S.composure <= 0 ? -2 : 0;
        const m = Math.max(-3, Math.min(4, api.S.attrs[po.check.attr] + b - po.check.diff + comp));
        check(`[${trail.join(' › ')}] ${beatId}#${i} odds`, { m, b, why, comp }, run.margin(mo));
      }
      if (plocked) return;
      for (const seg of (po.check ? SEGMENTS : [undefined]) as (Segment | undefined)[]) {
        const t = [...trail, `${beatId}#${i}${seg ?? ''}`];
        api.S = clone(ps); api.fx = [];
        const phtml = seg ? po.out[seg](api.S) : po.do(api.S);
        const story = po.story?.[seg ?? 'M'];
        if (story && api.addStory) api.addStory(story);
        const pnext = typeof po.next === 'function' ? po.next(api.S) : po.next;
        const pfx = clone(api.fx), pS = clone(api.S);
        run.S = clone(ms);
        const res = run.resolve(mo, seg);
        const mS = clone(run.S);
        steps++;
        const ok = check(`[${t.join(' › ')}] outcome`, norm(phtml), norm(res.html))
          && check(`[${t.join(' › ')}] chips`, pfx, run.fx)
          && check(`[${t.join(' › ')}] next`, pnext, res.next)
          && check(`[${t.join(' › ')}] state`, stateView(pS), stateView(mS));
        if (!ok) continue;
        if (pnext === 'reckon') {
          paths++;
          api.S = clone(pS); api.fx = [];
          api.renderReckon();
          const sec = storyEl.lastElementChild!;
          const pProse = sec.querySelector('.prose')!.innerHTML.replace(/<p class="storylink-p">.*?<\/p>/, '');
          const pChapter = doc.querySelector('#chapIn')!.textContent;
          const pFinal = clone(api.S);
          storyEl.innerHTML = '';
          run.S = clone(mS);
          const r = run.reckon();
          check(`[${t.join(' › ')}] reckoning`, norm(pProse), norm(r.html))
            && check(`[${t.join(' › ')}] chapter`, pChapter, r.chapter)
            && check(`[${t.join(' › ')}] final state`, stateView(pFinal), stateView(run.S));
        } else walk(pS, mS, pnext, t);
      }
    });
  };
  walk(api.S, run.S, v.first, []);
  return { problems, paths, steps };
}

const only = process.argv[2];
const ids = fs.readdirSync(path.join(ROOT, 'reference')).filter(f => f.endsWith('.published.html')).map(f => f.replace('.published.html', ''))
  .filter(id => (only ? id === only : true))
  .filter(id => fs.existsSync(path.join(ROOT, 'content/ventures', id + '.yaml')));
let failed = false;
for (const id of ids) {
  const t0 = Date.now();
  const { problems, paths, steps } = await verify(id);
  if (problems.length) {
    failed = true;
    console.log(`${id}: ${problems.length} difference(s)${problems.length > 20 ? ' (stopped after 20)' : ''}`);
    for (const p of problems.slice(0, 20)) console.log('  ' + p);
  } else console.log(`${id}: identical on all ${paths.toLocaleString('en-GB')} paths (${steps.toLocaleString('en-GB')} outcomes) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
process.exit(failed ? 1 : 0);
