// Play every path through every Venture and check that nothing breaks.
//
//   npm test
//
// For every enabled option and every Wheel segment, down to the Reckoning, this checks:
//   - every expression and template evaluates (no exceptions)
//   - no prose contains a stray {, }, [[, ]], "undefined" or "NaN"
//   - every glossary term used is defined (the build checks this too)
//   - qualities stay within their ranges
//   - every outcome with a Story passage writes one, and the Story closes at the Reckoning
// It also reports the spread of chapter headings, endings and Luck earned, as a sanity check.

import { Run } from '../engine/src/core';
import type { Option, Segment } from '../engine/src/types';
import { SEGMENTS } from '../engine/src/types';
import { loadAll } from './build';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const BAD = /\{|\}|\[\[|\]\]|undefined|NaN/;
const RANGES: Record<string, [number, number]> = { composure: [0, 8], exposure: [0, 10], luck: [0, 3], celebrity: [0, 10], notoriety: [0, 10] };

const { glossary, ventures, report } = loadAll();
if (report.errors.length) { console.log(report.errors.join('\n')); process.exit(1); }
let failed = false;

for (const v of ventures) {
  const run = new Run({ venture: v, glossary });
  const problems: string[] = [];
  const chapters = new Map<string, number>();
  let paths = 0, outcomes = 0, luckEarned = 0, storyPaths = 0;

  const look = (where: string, html: string) => {
    const text = html.replace(/<span class="cant"[^>]*>|<\/span>|<sup class="fn">[^<]*<\/sup>|<\/?(p|i|b)>/g, '');
    if (BAD.test(text)) problems.push(`${where}: suspicious text: ${text.slice(0, 160)}`);
  };
  const ranges = (where: string) => {
    const S = run.S as unknown as Record<string, number>;
    for (const [k, [lo, hi]] of Object.entries(RANGES)) if (S[k] < lo || S[k] > hi) problems.push(`${where}: ${k} is ${S[k]}`);
    for (const [k, x] of Object.entries(run.S.hum)) if (x < 0 || x > 5) problems.push(`${where}: ${k} is ${x}`);
  };

  const walk = (state: string, beatId: string, trail: string[]) => {
    if (problems.length > 20) return;
    const beat = run.beats[beatId];
    run.S = JSON.parse(state);
    try { look(`${trail.join(' › ')} ${beatId}`, run.prose(beat.text)); } catch (e) { problems.push(`${beatId} text: ${(e as Error).message}`); return; }
    beat.options.forEach((o: Option, i) => {
      run.S = JSON.parse(state);
      try { if (o.gate) look(`${beatId}#${i} gate`, run.gate(o).need); if (run.locked(o)) return; } catch (e) { problems.push(`${beatId}#${i} gate: ${(e as Error).message}`); return; }
      for (const seg of (o.check ? SEGMENTS : [undefined]) as (Segment | undefined)[]) {
        const where = [...trail, `${beatId}#${i}${seg ?? ''}`].join(' › ');
        run.S = JSON.parse(state);
        const luckBefore = run.S.luck, storyBefore = run.S.story.length;
        let res;
        try { res = run.resolve(o, seg); } catch (e) { problems.push(`${where}: ${(e as Error).message}`); continue; }
        outcomes++;
        look(where, res.html);
        ranges(where);
        if (run.S.luck > luckBefore) luckEarned++;
        const wanted = o.story?.[seg ?? 'M'];
        if (wanted && run.S.story.length === storyBefore) problems.push(`${where}: a Story passage should have been written`);
        if (res.next === 'reckon') {
          paths++;
          try {
            const r = run.reckon();
            look(`${where} › reckoning`, r.html);
            look(`${where} › upkeep`, run.inline(v.reckoning.upkeep));
            run.S.rumours.forEach(x => look(`${where} › rumour ${x.id}`, x.text));
            chapters.set(r.chapter, (chapters.get(r.chapter) ?? 0) + 1);
            if (run.S.story.length) {
              storyPaths++;
              const last = run.S.story.at(-1)!;
              if (v.story && last.sm !== v.story.close.sm) problems.push(`${where}: the Story did not close`);
            }
            ranges(`${where} › reckoning`);
          } catch (e) { problems.push(`${where} › reckoning: ${(e as Error).message}`); }
        } else walk(JSON.stringify(run.S), res.next, [...trail, `${beatId}#${i}${seg ?? ''}`]);
      }
    });
  };

  run.start();
  walk(JSON.stringify(run.S), v.first, []);
  if (problems.length) {
    failed = true;
    console.log(`${v.id}: ${problems.length} problem(s)`);
    problems.slice(0, 20).forEach(p => console.log('  ' + p));
  } else {
    console.log(`${v.id}: ${paths.toLocaleString('en-GB')} paths and ${outcomes.toLocaleString('en-GB')} outcomes played; no problems. ` +
      `Story written on ${Math.round(100 * storyPaths / paths)}% of paths; Luck earned at ${luckEarned} outcomes; ${chapters.size} distinct chapter headings.`);
  }
}
process.exit(failed ? 1 : 0);
