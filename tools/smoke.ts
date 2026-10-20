// Drive the built pages in jsdom, clicking as a player would, and report any error.
//
//   npm run build && npm run smoke
//
// The run page: begins a run, plays turns by clicking offers, options, the Wheel's buttons,
// the bills and the next turn; reloads the page from its save in the middle of Ventures and
// carries on. Each Venture page: plays to the Reckoning a few times.

import fs from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const errors: string[] = [];

function open(file: string, storage: Record<string, string> = {}) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(`${file}: ${e.message}`));
  vc.on('error', e => errors.push(`${file}: console.error ${e}`));
  const html = fs.readFileSync(file, 'utf8');
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`, {
    url: 'https://fortunes-ladder.test/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      // reduced motion, so the Wheel stops in 50ms; wide screen, so the Ledger is open
      (w as any).matchMedia = (q: string) => ({ matches: /reduce|min-width/.test(q), addEventListener() {}, removeEventListener() {} });
      (w as any).scrollTo = () => {};
      (w as any).HTMLElement.prototype.scrollIntoView = () => {};
      for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
    },
  });
  return dom;
}

function visibleButtons(doc: Document) {
  return [...doc.querySelectorAll<HTMLButtonElement>('#story button')].filter(b => !b.disabled && !b.closest('.choices.done'));
}

async function playRun(seed: string, actions: number, reloadEvery: number) {
  let dom = open('dist/index.html');
  let doc = dom.window.document;
  doc.querySelector<HTMLInputElement>('#seed')!.value = seed;
  doc.querySelector<HTMLButtonElement>('#go')!.click();
  let turns = 0, beats = 0, reloads = 0, chapters = 0, affairs = 0;
  for (let i = 0; i < actions; i++) {
    await sleep(70);
    if (reloadEvery && i % reloadEvery === reloadEvery - 1) {
      const store: Record<string, string> = {};
      const ls = dom.window.localStorage;
      for (let k = 0; k < ls.length; k++) { const key = ls.key(k)!; store[key] = ls.getItem(key)!; }
      dom.window.close();
      dom = open('dist/index.html', store); doc = dom.window.document; reloads++;
      const cont = doc.querySelector<HTMLButtonElement>('#cont');
      // a run that ended, and was put away with "Begin a new run", leaves nothing to continue
      if (!cont) { if (store['picaresque-run']) { errors.push(`seed ${seed}: no Continue after reload`); break; } doc.querySelector<HTMLButtonElement>('#go')!.click(); await sleep(30); continue; }
      cont.click(); await sleep(30);
      continue;
    }
    const wheel = [...doc.querySelectorAll<HTMLButtonElement>('.wheelctl button')];
    if (wheel.length) { wheel[Math.random() < 0.5 ? 0 : 1].click(); continue; }
    const opts = visibleButtons(doc).filter(b => b.classList.contains('opt'));
    if (opts.length) { opts[Math.floor(Math.random() * opts.length)].click(); beats++; continue; }
    const again = doc.querySelector<HTMLButtonElement>('#again');
    if (again) { again.click(); continue; }
    const turn = doc.querySelector<HTMLButtonElement>('#turn');
    if (turn) { turn.click(); turns++; continue; }
    // now and then, the hero's affairs: shops, the pawnbroker, the lender, the debts, the prison side
    const aff = [...doc.querySelectorAll<HTMLButtonElement>('[data-buy],[data-acct],[data-dismiss],[data-pawn],[data-redeem],[data-borrow],[data-trade],[data-repay],[data-note],[data-retire],[data-relief],#takeup,#side,#payout')];
    if (aff.length && Math.random() < 0.3) { aff[Math.floor(Math.random() * aff.length)].click(); affairs++; continue; }
    const offers = [...doc.querySelectorAll<HTMLButtonElement>('[data-v]')];
    if (offers.length) { offers[Math.floor(Math.random() * offers.length)].click(); continue; }
    const idle = doc.querySelector<HTMLButtonElement>('#idle');
    if (idle) { idle.click(); continue; }
  }
  chapters = doc.querySelectorAll('#storyBody .chap').length;
  const text = doc.querySelector('#story')!.textContent ?? '';
  if (/undefined|NaN|\{if|\[\[/.test(text)) errors.push(`seed ${seed}: stray text on the page`);
  dom.window.close();
  return { turns, beats, reloads, chapters, affairs };
}

async function playVenture(file: string, times: number) {
  const dom = open(file); const doc = dom.window.document;
  let done = 0;
  for (let i = 0; i < 400 && done < times; i++) {
    await sleep(70);
    const wheel = [...doc.querySelectorAll<HTMLButtonElement>('.wheelctl button')];
    if (wheel.length) { wheel[1].click(); continue; }
    const opts = visibleButtons(doc).filter(b => b.classList.contains('opt'));
    if (opts.length) { opts[Math.floor(Math.random() * opts.length)].click(); continue; }
    const again = doc.querySelector<HTMLButtonElement>('#again');
    if (again) { done++; again.click(); }
  }
  dom.window.close();
  return done;
}

const totals = { turns: 0, beats: 0, reloads: 0, affairs: 0 };
for (let s = 1; s <= 4; s++) {
  const r = await playRun('smoke-' + s, 320, 23);
  totals.turns += r.turns; totals.beats += r.beats; totals.reloads += r.reloads; totals.affairs += r.affairs;
}
console.log(`run page: ${totals.turns} turns, ${totals.beats} choices, ${totals.affairs} clicks on the hero's affairs, ${totals.reloads} reloads from the save.`);
for (const f of fs.readdirSync('dist').filter(f => f.endsWith('.html') && f !== 'index.html')) {
  console.log(`${f}: played to the Reckoning ${await playVenture('dist/' + f, 3)} times.`);
}
if (errors.length) { console.log(`\n${errors.length} error(s):`); [...new Set(errors)].slice(0, 20).forEach(e => console.log('  ' + e)); process.exit(1); }
console.log('No errors.');
