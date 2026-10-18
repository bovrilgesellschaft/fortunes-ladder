// Play whole runs, headless, and check the run shell.
//
//   npm run test-runs
//
// For many seeds, plays up to 20 turns with random choices, and checks that:
//   - every beat, label, gate and outcome renders without error or stray template syntax
//   - qualities stay within their ranges
//   - a save, reloaded mid-Venture, replays to exactly the same state
//   - the same seed and the same choices give the same run
//   - heath is offered in October 1724 to a hero who has the Persona, the pistols and the mask
// and reports how often each Venture was offered and played, and the money at the end.

import { Campaign, type CampaignState } from '../engine/src/campaign';
import { odds } from '../engine/src/core';
import { Rng } from '../engine/src/rng';
import { SEGMENTS } from '../engine/src/types';
import { SLOTS, WEEKLY, appearances } from '../engine/src/economy';
import { loadAll } from './build';

const { world, report } = loadAll();
if (report.errors.length) { console.log(report.errors.join('\n')); process.exit(1); }

const BAD = /\{|\}|\[\[|\]\]|undefined|NaN/;
const strip = (h: string) => h.replace(/<span class="cant"[^>]*>|<\/span>|<sup class="fn">[^<]*<\/sup>|<\/?(p|i|b)>/g, '');
const problems: string[] = [];
const offered: Record<string, number> = {}, played: Record<string, number> = {};
let heathChances = 0, heathOffered = 0, endPurse = 0, endDebts = 0, runs = 0, replays = 0;
const tally: Record<string, number> = {};
const count = (k: string) => (tally[k] = (tally[k] ?? 0) + 1);

/** A careless young man's affairs: he shops, pawns, borrows, pays a little, and sometimes pinches. */
function affairs(c: Campaign, pick: Rng) {
  const H = c.hero, r = () => pick.next();
  if (r() < 0.25) { const sl = SLOTS[pick.int(0, 5)]; if (!c.buy(sl, pick.int(1, 3), r() < 0.5)) count('bought ' + (WEEKLY.includes(sl) ? 'a servant or equipage' : 'clothes')); }
  if (r() < 0.12) { const p = c.pawnable(); if (p.length && !c.pawn(p[pick.int(0, p.length - 1)].item)) count('pawned'); }
  if (r() < 0.2 && H.pledges.length && !c.redeem(0)) count('redeemed');
  if (r() < 0.12 && c.canBorrow() >= 1200 && !c.borrow(1200)) count('borrowed £5');
  if (r() < 0.3 && H.loans.length && !c.repay(0, H.purse)) count('repaid');
  if (r() < 0.3 && H.debts && H.purse && !c.payTradesmen(Math.min(H.debts, H.purse))) count('paid tradesmen');
  if (r() < 0.3 && H.notes.length && !c.payNote(0)) count('paid a note');
  if (r() < 0.1) c.setLiving(H.living === 'claimed' ? 'pinching' : 'claimed');
  if (r() < 0.04 && !c.inSavoy()) { c.move('The Savoy', 'garret'); count('went into the Savoy'); }
  if (c.inSavoy() && r() < 0.3) { if (c.move('Fleet Street and the Strand', 'garret')) count('left the Savoy'); else count('kept in the Savoy'); }
  if (H.confined && r() < 0.3) c.setSide(H.confined.side === 'room' ? 'common' : 'room');
  if (H.confined && r() < 0.5 && !c.payOut()) count('paid out of prison');
}

function playRun(seed: number, policySeed: number, turns = 20): CampaignState {
  const c = Campaign.begin(world, 'younger-son', seed, world.settings.start);
  const pick = new Rng(policySeed);
  for (let t = 0; t < turns; t++) {
    if (c.st.phase === 'town') {
      affairs(c, pick);
      if (c.hero.confined && c.st.offers.some(o => o !== 'fleet')) problems.push(`seed ${seed}: offered ${c.st.offers} in prison`);
      const ready = c.hero.persona === (c.extra() as Record<string, unknown>).alias && c.hero.items.some(i => i.includes('pistol')) && c.hero.items.includes('A crape mask');
      const d = c.date();
      if (ready && d.year === 1724 && d.week >= 41 && d.week <= 46 && !c.st.played.heath) { heathChances++; if (c.st.offers.includes('heath')) heathOffered++; }
      c.st.offers.forEach(id => (offered[id] = (offered[id] ?? 0) + 1));
      if (c.st.phase !== 'town') { /* paying out of prison may have redrawn the offers */ }
      if (!c.st.offers.length || pick.next() < 0.08) c.idle();
      else {
        // prefer heath when it is offered, to exercise it
        const id = c.st.offers.includes('heath') ? 'heath' : c.st.offers[pick.int(0, c.st.offers.length - 1)];
        c.startVenture(id);
      }
    }
    if (c.st.phase === 'venture') {
      const id = c.st.current!.id; played[id] = (played[id] ?? 0) + 1;
      if (id === 'bailiff' && (!c.activeWrit() || c.inSavoy())) problems.push(`seed ${seed}: the bailiff came with no writ, or into the Savoy`);
      let run = c.makeRun(); let at = c.byId[id].first; let steps = 0;
      const where = () => `seed ${seed} turn ${c.st.turn} ${id}/${at}`;
      while (at !== 'reckon') {
        const beat = run.beats[at];
        try { const h = strip(run.prose(beat.text)); if (BAD.test(h)) problems.push(`${where()}: text: ${h.slice(0, 120)}`); } catch (e) { problems.push(`${where()}: ${(e as Error).message}`); break; }
        const open = beat.options.map((o, i) => ({ o, i })).filter(({ o }) => { const g = run.gate(o); if (BAD.test(strip(g.need))) problems.push(`${where()}: gate text`); return !run.locked(o); });
        if (!open.length) { problems.push(`${where()}: no option can be chosen`); break; }
        const { o, i } = open[pick.int(0, open.length - 1)];
        let seg; let luck = false;
        if (o.check) {
          const p = odds(run.margin(o).m);
          let k = (() => { const x = c.random(); let acc = 0; for (let j = 0; j < 5; j++) { acc += p[j]; if (x < acc) return j; } return 4; })();
          run.fx = [];
          if (k > 0 && run.S.luck > 0 && pick.next() < 0.5) { run.spendLuck(); k--; luck = true; }
          seg = SEGMENTS[k];
        } else run.fx = [];
        const luckFx = run.fx.slice();
        const res = run.resolve(o, seg); run.fx = luckFx.concat(run.fx);
        if (BAD.test(strip(res.html))) problems.push(`${where()}: outcome: ${strip(res.html).slice(0, 120)}`);
        // the canon sample names must not leak into a run that drew others
        const all = res.html + run.S.story.map(x => x.sm + x.st).join('') + run.prose(beat.text);
        for (const [n, w] of [[c.hero.names.surname, 'Byrne'], [c.hero.names.alias_surname, 'O’Rourke'], [c.hero.names.given, 'Cornelius']])
          if (n !== w && all.includes(w)) problems.push(`${where()}: “${w}” appears in a run whose hero is ${c.hero.name}, alias ${(c.extra() as Record<string, unknown>).alias}`);
        c.record({ beat: at, opt: i, seg, luck });
        at = res.next;
        // reload mid-Venture now and then: the replay must match exactly
        if (pick.next() < 0.3) {
          const saved = JSON.parse(JSON.stringify(c.st)) as CampaignState;
          const again = new Campaign(world, saved).replay();
          replays++;
          if (JSON.stringify(again.run.S) !== JSON.stringify(run.S)) problems.push(`${where()}: replay differs from play`);
          if (again.next !== at) problems.push(`${where()}: replay ended at ${again.next}, play at ${at}`);
          run = again.run; // carry on with the replayed Run, as the page does after a reload
        }
        if (++steps > 12) { problems.push(`${where()}: too many beats`); break; }
      }
      const r = run.reckon();
      if (BAD.test(strip(r.html))) problems.push(`${where()}: reckoning: ${strip(r.html).slice(0, 120)}`);
      for (const x of run.S.rumours) if (BAD.test(strip(x.text))) problems.push(`${where()}: rumour ${x.id}`);
      const before = { conf: !!c.hero.confined, savoy: c.inSavoy() };
      c.finishVenture(run, r.chapter);
      if (id === 'bailiff') count(c.hero.confined ? 'taken by the bailiff' : c.inSavoy() && !before.savoy ? 'fled into the Savoy' : run.S.flags.paid ? 'paid the bailiff' : 'bought a month of the bailiff');
      if (id === 'fleet' && run.S.flags.pound) count(c.hero.confined ? 'composed, still owing' : 'composed and released');
    }
    if (c.st.phase === 'bills') {
      const H = c.hero;
      for (const [k, [lo, hi]] of Object.entries({ luck: [0, 3], celebrity: [0, 10], notoriety: [0, 10] }) as [string, number[]][]) {
        const x = (H as any)[k]; if (x < lo || x > hi) problems.push(`seed ${seed} turn ${c.st.turn}: ${k} is ${x}`);
      }
      for (const [p, x] of Object.entries(H.personas)) if (x < 0 || x > 10) problems.push(`seed ${seed}: Exposure (${p}) is ${x}`);
      for (const [h, x] of Object.entries(H.hum)) if (x < 0 || x > 5) problems.push(`seed ${seed}: ${h} is ${x}`);
      if (H.purse < 0) problems.push(`seed ${seed} turn ${c.st.turn}: purse below nothing`);
      if (H.debts < 0 || H.loans.some(l => l.owed < 0)) problems.push(`seed ${seed} turn ${c.st.turn}: a debt below nothing`);
      const app = appearances(H.dress, world.settings.economy); if (app < 0 || app > 18) problems.push(`seed ${seed}: Appearances ${app}`);
      for (const sl of SLOTS) { const d = H.dress[sl]; if (d && !WEEKLY.includes(sl) && !H.items.includes(d.name)) problems.push(`seed ${seed}: ${sl} worn but not possessed`); }
      if (H.writs.some(w => w.kind === 'loan' && (w.loan === undefined || w.loan >= H.loans.length))) problems.push(`seed ${seed}: a writ for a loan that is gone`);
      for (const e of c.st.bills?.events ?? []) { if (/writ/.test(e)) count('writs taken out'); if (/forfeit/.test(e)) count('pledges forfeit'); if (/Savoyard/.test(e)) count('became Savoyards'); }
      if (H.confined) count('turns in prison');
      c.nextTurn();
    }
    // the save must survive a round trip at every turn boundary
    const st2 = JSON.parse(JSON.stringify(c.st));
    if (JSON.stringify(st2) !== JSON.stringify(c.st)) problems.push(`seed ${seed}: save does not round-trip`);
  }
  runs++; endPurse += c.hero.purse; endDebts += c.hero.debts;
  return c.st;
}

const N = Number(process.argv[2] ?? 300);
for (let s = 1; s <= N && problems.length < 30; s++) playRun(s * 7919, s * 104729);

// determinism: the same seed and the same choices give the same run
const a = JSON.stringify(playRun(42, 4242)), b = JSON.stringify(playRun(42, 4242));
if (a !== b) problems.push('the same seed and choices gave different runs');

// random start dates work too
for (let s = 1; s <= 20; s++) { const c = Campaign.begin(world, 'younger-son', s, null); const d = c.date(); if (d.year < 1719 || d.year > 1741) problems.push(`random start ${d.year}`); }

// names vary between seeds
const names = new Set(Array.from({ length: 30 }, (_, s) => Campaign.begin(world, 'younger-son', s + 1, world.settings.start).hero.name));
if (names.size < 20) problems.push(`only ${names.size} different names in 30 runs`);

const L = (p: number) => `£${(p / 240).toFixed(1)}`;
console.log(`${runs} runs of 20 turns, ${replays} mid-Venture reloads replayed.`);
console.log(`offered: ${Object.entries(offered).map(([k, x]) => `${k} ${x}`).join(', ')}`);
console.log(`played:  ${Object.entries(played).map(([k, x]) => `${k} ${x}`).join(', ')}`);
console.log(`heath offered on ${heathOffered} of ${heathChances} chances (a ready hero, in its window).`);
console.log(`after 20 turns, on average: purse ${L(endPurse / runs)}, tradesmen ${L(endDebts / runs)}.`);
console.log(`the economy: ${Object.entries(tally).sort().map(([k, x]) => `${k} ${x}`).join(', ')}.`);
if (problems.length) { console.log(`\n${problems.length} problem(s):`); problems.slice(0, 30).forEach(p => console.log('  ' + p)); process.exit(1); }
console.log('No problems.');
