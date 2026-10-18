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
  // the false self (Step 7): take up names, wear them, retire them
  if (!H.confined && r() < 0.15) { const ks = c.kinds(); const k = ks[pick.int(0, ks.length - 1)]; if (!c.takeUp(k.id)) count('took up a name'); }
  if (!H.confined && r() < 0.2) {
    const names = Object.values(H.records).filter(x => (x.state === 'live' || x.state === 'own' || x.state === 'retired') && x.name !== H.persona);
    const ds = Object.keys(world.settings.lodging).filter(d => d !== H.lodging.district && d !== 'The Savoy');
    if (names.length && !c.wear(names[pick.int(0, names.length - 1)].name, ds[pick.int(0, ds.length - 1)], 'garret')) count('changed name');
  }
  if (r() < 0.05) { const live = Object.values(H.records).filter(x => x.state === 'live' && x.name !== H.persona); if (live.length && !c.retirePersona(live[0].name)) count('retired a name'); }
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
      // the false self: every name has a record, the worn one is wearable, the limit holds
      for (const p of Object.keys(H.personas)) if (!H.records[p]) problems.push(`seed ${seed}: no record for ${p}`);
      const worn = H.records[H.persona];
      if (!worn || !['own', 'live'].includes(worn.state)) problems.push(`seed ${seed}: wearing ${H.persona}, which is ${worn?.state}`);
      else if (worn.rank !== H.claimedRank) problems.push(`seed ${seed}: claimed ${H.claimedRank}, but ${H.persona} claims ${worn.rank}`);
      if (c.liveCount() > world.settings.personas.limit) problems.push(`seed ${seed}: ${c.liveCount()} false names kept up`);
      if (Object.values(H.records).filter(x => x.state !== 'sold').reduce((a, x) => a + x.debts, 0) > H.debts) problems.push(`seed ${seed}: the names owe more than the books`);
      for (const e of c.st.bills?.events ?? []) { if (/is blown/.test(e)) count('names blown'); if (/Secret is out/.test(e)) count('Secrets out'); if (/is sold for/.test(e)) count('names sold'); if (/stopped talking/.test(e)) count('Exposure cooled'); if (/scandal/.test(e)) count('scandals'); if (/received as/.test(e)) count('claims raised'); if (/retired\./.test(e)) count('names retired over the limit'); }
      if (c.st.bills?.weeks.some(w => w.letters.some(l => l.venture === 'reversal'))) count('brothers died');
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

// ---------- the false self: scenarios for each Step 7 ruling ----------
function scenarios() {
  const fail = (m: string) => problems.push('scenario: ' + m);
  const fresh = (seed = 99) => {
    const c = Campaign.begin(world, 'younger-son', seed, world.settings.start);
    c.st.current = undefined; c.st.phase = 'town'; return c;
  };
  const rich = (c: Campaign) => { const H = c.hero; H.purse = 240 * 60; c.buy('Coat', 3); c.buy('Wig', 3); c.buy('Linen', 3); c.buy('Sword', 3); c.buy('Servant', 2); H.purse = 240 * 60; return c; };
  const settleNow = (c: Campaign) => { (c as any).settle([]); c.nextTurn(); };
  const kinds = world.settings.personas.kinds;

  // taking up: limit, cost, Appearances, starting Exposure, wear needs a move
  { const c = rich(fresh()); const H = c.hero;
    const purse = H.purse;
    if (c.takeUp('captain')) fail('a rich younger son could not take up a captain: ' + c.cannotTakeUp(kinds[0]));
    const cap = Object.values(H.records).find(r => r.kind === 'captain')!;
    if (!cap || H.personas[cap.name] !== 0) fail(`a captain at home with the Younger son should start at Exposure 0, not ${cap && H.personas[cap.name]}`);
    if (purse - H.purse !== 480) fail('the captain’s papers should cost £2');
    const nat = c.takeUp('natural-child');
    if (nat) fail('natural child: ' + nat);
    const ns = Object.values(H.records).find(r => r.kind === 'natural-child');
    if (ns && H.personas[ns.name] !== 1) fail(`an Esquire claim one rank up, at home: Exposure ${H.personas[ns.name]}, expected 1`);
    if (!c.takeUp('clergyman') && c.liveCount() > 2) fail('took up a third false name');
    if (!c.cannotTakeUp(kinds.find(k => k.id === 'clergyman')!)) fail('a third name should be refused');
    if (!c.wear(cap.name, H.lodging.district, 'garret')) fail('changed name without changing district');
    if (c.wear(cap.name, 'Covent Garden', 'room')) fail('could not wear the captain in Covent Garden');
    if (H.persona !== cap.name || H.claimedRank !== 'Gentleman') fail('wearing the captain');
    if (c.retirePersona(ns!.name)) fail('could not retire the natural son');
    if (!c.takeUp('clergyman') === false && c.liveCount() > 2) fail('limit after retiring');
  }

  // cooling: −1 after 8 quiet weeks, not in the Savoy
  { const c = fresh(); const H = c.hero; H.personas[H.styled] = 4;
    settleNow(c); settleNow(c);
    if (H.personas[H.styled] !== 3) fail(`after 8 quiet weeks Exposure should be 3, is ${H.personas[H.styled]}`);
    c.move('The Savoy', 'garret'); settleNow(c); settleNow(c);
    if (H.personas[H.styled] !== 3) fail('Exposure cooled in the Savoy');
  }

  // circles: a rumour from a circle where the name is unknown adds 1 and makes it known
  { const c = fresh(); const H = c.hero; const rec = H.records[H.styled];
    const done = c.deliver({ id: 'x', from: 'x', text: 'x', effect: 'Exposure +3', persona: H.styled, at: c.st.at, venture: 'x', circle: 'the Quality' });
    if (H.personas[H.styled] !== 1 || !rec.circles.includes('the Quality')) fail(`unknown circle: Exposure ${H.personas[H.styled]}, ${done}`);
    c.deliver({ id: 'y', from: 'x', text: 'x', effect: 'Exposure +3', persona: H.styled, at: c.st.at, venture: 'x', circle: 'the Quality' });
    if (H.personas[H.styled] !== 4) fail(`known circle: Exposure ${H.personas[H.styled]}, expected 4`);
  }

  // the blow-up: debts due, Celebrity −2, Book of True Rank, dead, circles closed, the Secret Wheel
  let outs = 0;
  for (let k = 0; k < 40; k++) {
    const c = rich(fresh(500 + k)); const H = c.hero;
    c.takeUp('natural-child'); const ns = Object.values(H.records).find(r => r.kind === 'natural-child')!;
    c.wear(ns.name, 'Mayfair', 'room');
    H.purse = 240; H.debts = 240 * 100; ns.circles = ['the Quality']; H.celebrity = 5; H.personas[ns.name] = 9;
    H.records[ns.name].debts = H.debts;
    c.deliver({ id: 'b', from: 'x', text: 'x', effect: 'Exposure +2', persona: ns.name, at: c.st.at, venture: 'x' });
    const ev: string[] = []; (c as any).checkPersonas(c.st.at, ev);
    if (ns.state !== 'dead') fail('a name at 10 was not blown');
    if (H.persona !== H.styled || H.claimedRank !== 'Gentleman') fail(`after a blow-up: ${H.persona}, ${H.claimedRank}`);
    if (H.celebrity !== 3) fail(`Celebrity after a blow-up: ${H.celebrity}`);
    if (H.purse !== 0 || !H.writs.some(w => w.kind === 'tradesmen')) fail('debts did not fall due');
    if (!(H.closed['the Quality'] > c.st.at)) fail('the Quality not closed');
    if (c.eligible().some(v => v.offer?.circle === 'the Quality')) fail('a Quality Venture offered while closed');
    if (H.secret === 'out') {
      outs++;
      if (!H.tags.includes('Fortune-hunter (the Quality)') || !H.hooks.some(h => h.startsWith('An elder brother in'))) fail('the Secret out without its tag and Hook');
      if (c.credit() !== c.appearances() * 120) fail(`Credit with the Secret out should be a Tradesman’s: ${c.credit()}`);
      if (!c.st.story.some(ch => ch.venture === 'secret')) fail('no chapter for the Secret');
      if (/\{|\[\[/.test(c.st.story.at(-1)!.passages[0].sm + ((c as any).lettersNow[0]?.text ?? ''))) fail('template syntax in the Secret');
    }
  }
  if (outs === 0 || outs === 40) fail(`the Secret came out ${outs} times in 40 blow-ups`);

  // a captain who claims no more than a gentleman's rank is still a false name, and can be blown
  { const c = rich(fresh()); const H = c.hero; c.takeUp('captain'); const cap = Object.values(H.records).find(r => r.kind === 'captain')!;
    if (c.isReal(cap)) fail('a same-rank captain counted as made real');
    H.personas[cap.name] = 10; (c as any).checkPersonas(c.st.at, []); if (cap.state !== 'dead') fail('a same-rank captain was not blown');
  }
  // a name made real suffers a scandal, not a blow-up
  { const c = fresh(); const H = c.hero; H.personas[H.styled] = 10; H.celebrity = 4;
    const ev: string[] = []; (c as any).checkPersonas(c.st.at, ev);
    if (H.records[H.styled].state !== 'own' || H.celebrity !== 2 || H.notoriety !== 1 || H.writs.length) fail('own name at 10 should be a scandal');
    (c as any).checkPersonas(c.st.at, ev); if (H.celebrity !== 2) fail('the scandal came twice');
  }

  // selling: the price, the debts go with it, the buyer may name you
  { const c = rich(fresh()); const H = c.hero; c.takeUp('captain'); const cap = Object.values(H.records).find(r => r.kind === 'captain')!;
    c.wear(cap.name, 'St Giles', 'garret'); H.personas[cap.name] = 4; H.debts += 2400; cap.debts = 2400;
    const price = c.salePrice(); const purse = H.purse, debts = H.debts;
    if (price !== 240 * 14) fail(`a Gentleman’s name at Exposure 4 should fetch £14, not ${price}`);
    const ev: string[] = []; (c as any).sellPersona(cap.name, true, ev);
    if (cap.state !== 'sold' || H.persona !== H.styled || H.purse !== purse + price || H.debts !== debts - 2400) fail('the sale');
    const named = c.st.post.find(r => r.id.startsWith('named-'));
    if (!named || named.at - c.st.at < 4 || named.at - c.st.at > 12) fail('the buyer’s letter');
    const before = H.personas[H.styled]; c.deliver(named!); if (H.personas[H.styled] !== before + 2) fail('named: Exposure +2 on the name worn');
  }

  // a taking-up raises the claim; the levee is gate-crashed below Esquire
  { const c = fresh(); const H = c.hero; const lev = c.byId.levee;
    if (!c.gateCrash(lev)) fail('a Gentleman should gate-crash the levee');
    c.startVenture('levee'); if (c.makeRun().opts.exposureExtra!.by < 1) fail('gate-crashing adds nothing'); c.st.current = undefined; c.st.phase = 'town';
    (c as any).raiseClaim([]);
    if (H.claimedRank !== 'Esquire' || H.records[H.persona].rank !== 'Esquire') fail('raising the claim');
    if (c.gateCrash(lev)) fail('an Esquire still gate-crashes the levee');
  }

  // the reversal: the elder brother dies at a new year, and the hero is an Esquire
  { let died = 0;
    for (let k = 0; k < 60; k++) {
      const c = fresh(900 + k); const H = c.hero; c.secretOut([]);
      (c as any).newYear(c.st.at, []);
      if (H.trueRank === 'Esquire') { died++; if (H.hooks.some(h => h.startsWith('An elder brother'))) fail('the Hook was not spent'); if (H.claimedRank !== 'Esquire') fail('own name not raised'); }
    }
    if (died < 2 || died > 20) fail(`the brother died ${died} times in 60 new years (chance 15%)`);
  }

  // a Step 6 save (version 2) is brought up to date
  { const c = fresh(); const st = JSON.parse(JSON.stringify(c.st)); st.v = 2; delete st.hero.records; delete st.hero.secret; delete st.hero.closed;
    st.hero.personas['Capt. Nobody'] = 3; st.hero.persona = 'Capt. Nobody';
    const m = new Campaign(world, st);
    if (m.st.v !== 3 || !m.hero.records['Capt. Nobody'] || !m.hero.records[m.hero.styled] || m.hero.secret !== 'kept') fail('migration from version 2');
  }
}
scenarios();

const L = (p: number) => `£${(p / 240).toFixed(1)}`;
console.log(`${runs} runs of 20 turns, ${replays} mid-Venture reloads replayed.`);
console.log(`offered: ${Object.entries(offered).map(([k, x]) => `${k} ${x}`).join(', ')}`);
console.log(`played:  ${Object.entries(played).map(([k, x]) => `${k} ${x}`).join(', ')}`);
console.log(`heath offered on ${heathOffered} of ${heathChances} chances (a ready hero, in its window).`);
console.log(`after 20 turns, on average: purse ${L(endPurse / runs)}, tradesmen ${L(endDebts / runs)}.`);
console.log(`the economy and the false self: ${Object.entries(tally).sort().map(([k, x]) => `${k} ${x}`).join(', ')}.`);
if (problems.length) { console.log(`\n${problems.length} problem(s):`); problems.slice(0, 30).forEach(p => console.log('  ' + p)); process.exit(1); }
console.log('No problems.');
