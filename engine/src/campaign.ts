// A run: one hero across many turns. Headless, like core.ts, so the same code drives the page
// and the tests. Its whole state is plain JSON (CampaignState), saved after every choice.
//
// The turn (design document, "Each turn: one Venture, one spin, then the bills"):
//   town     read the letters, maybe move lodgings, choose one of three Ventures or idle
//   venture  play it, beat by beat; every choice is recorded so a reload can replay it
//   bills    four weeks of Upkeep, rumours delivered week by week, humours cool
//   → town again, four weeks on.

import { Run, money, parseMoney, type HeroSeed } from './core';
import { compile, evaluate, type Fn } from './expr';
import { Rng } from './rng';
import type { Effect, Origin, Passage, Rank, Room, Segment, Venture, When, World } from './types';
import { drawNames, nameVars, type Names } from './names';
import {
  SLOTS, WEEKLY, amt, appearances, condition, credit, price, rankBelow, rankIndex, valueOf,
  type Confinement, type Dress, type Loan, type Note, type Pledge, type Slot, type Writ,
} from './economy';

export const SAVE_VERSION = 2;
const EPOCH = 1719;
const LIM: Record<string, [number, number]> = { exposure: [0, 10], luck: [0, 3], celebrity: [0, 10], notoriety: [0, 10] };

// ---------- the calendar ----------

/** Weeks since the first week of 1719. */
export const abs = (w: When) => (w.year - EPOCH) * 52 + (w.week - 1);
export const when = (a: number): When => ({ year: EPOCH + Math.floor(a / 52), week: (a % 52) + 1 });

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ORD = ['first', 'second', 'third', 'fourth', 'fifth'];

/** "the third week of October, 1724". Weeks are counted from 1 January, as the bible rules. */
export function dateLabel(a: number): string {
  const { year, week } = when(a);
  const day = (week - 1) * 7; // days since 1 January
  const lens = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let m = 0, d = day;
  while (m < 11 && d >= lens[m]) { d -= lens[m]; m++; }
  return `the ${ORD[Math.min(4, Math.floor(d / 7))]} week of ${MONTHS[m]}, ${year}`;
}

// ---------- state ----------

export interface Hero {
  name: string; styled: string; origin: string; sex: 'man' | 'woman'; history: string;
  /** This run's names, drawn or chosen at the start. */
  names: Names;
  purse: number; debts: number; luck: number; notoriety: number; celebrity: number;
  attrs: Record<string, number>; hum: Record<string, number>;
  conditions: string[]; tags: string[]; items: string[]; hooks: string[];
  /** The name the hero passes under now; the styled true name when there is no Persona. */
  persona: string;
  /** Exposure by Persona. */
  personas: Record<string, number>;
  trueRank: Rank; claimedRank: Rank;
  lodging: { district: string; room: Room };
  // ----- the economy (Step 6). `debts` above is the tradesmen's books. -----
  dress: Partial<Record<Slot, Dress | null>>;
  notes: Note[];
  loans: Loan[];
  pledges: Pledge[];
  writs: Writ[];
  /** Living at the Claimed Rank, or pinching at the rank below. */
  living: 'claimed' | 'pinching';
  confined?: Confinement;
  /** When the hero went into the Savoy. */
  savoySince?: number;
}

export interface Letter {
  id: string; from: string; text: string; effect: string; persona: string;
  at: number; venture: string; on_delivery?: Effect[];
  /** What it did, once delivered. */
  done?: string[];
}

export interface Chapter { no: number; venture: string; title: string; heading: string; passages: Passage[] }
export interface Choice { beat: string; opt: number; seg?: Segment; luck?: boolean }

export interface WeekBill { at: number; upkeep: number; paid: number; owed: number; letters: Letter[] }
export interface Bills { weeks: WeekBill[]; cooled: string[]; total: number; owed: number; events: string[] }

export interface CampaignState {
  v: number;
  seed: number;
  rng: number;
  hero: Hero;
  /** First week of the current turn. */
  at: number;
  turn: number;
  phase: 'town' | 'venture' | 'bills' | 'ended';
  offers: string[];
  played: Record<string, number>;
  post: Letter[];
  /** Letters delivered during the last bills, shown in the town. */
  news: Letter[];
  story: Chapter[];
  current?: { id: string; hero: Hero; at: number; choices: Choice[] };
  raised: Record<string, boolean>;
  bills?: Bills;
  ended?: { how: string; at: number };
  /** One line per turn, for the designer's view. */
  log: string[];
}

// ---------- the run ----------

export class Campaign {
  st: CampaignState;
  readonly world: World;
  readonly byId: Record<string, Venture>;

  constructor(world: World, st: CampaignState) {
    this.world = world; this.st = st;
    this.byId = Object.fromEntries(world.ventures.map(v => [v.id, v]));
    this.migrate();
  }

  /** Saves from before Step 6 gain the economy, with the Origin's starting dress. */
  private migrate() {
    const st = this.st;
    if (st.v === 1) {
      const H = st.hero as Partial<Hero> & Hero;
      const o = this.world.origins.find(x => x.id === H.origin);
      H.dress = this.startingDress(o);
      for (const d of Object.values(H.dress)) if (d && !H.items.includes(d.name)) H.items.push(d.name);
      H.notes = []; H.loans = []; H.pledges = []; H.writs = []; H.living = 'claimed';
      if (st.bills) st.bills.events = [];
      st.v = SAVE_VERSION;
    }
  }

  private startingDress(o?: Origin): Partial<Record<Slot, Dress | null>> {
    const out: Partial<Record<Slot, Dress | null>> = {};
    for (const [slot, d] of Object.entries(o?.hero?.dress ?? {}) as [Slot, { tier: number; name: string }][]) {
      out[slot] = { tier: d.tier, name: d.name, wear: 0, weekly: WEEKLY.includes(slot) ? price(slot, d.tier, this.world.settings.economy) : undefined };
    }
    return out;
  }

  /** Names are drawn from the seed unless the player chose them. */
  static begin(world: World, originId: string, seed: number, start?: When | null, names?: Names): Campaign {
    const o = world.origins.find(x => x.id === originId);
    if (!o || !o.available || !o.hero) throw new Error(`Origin “${originId}” cannot be played yet`);
    const rng = new Rng(seed);
    const s = start ?? world.settings.start ?? null;
    const at = s ? abs(s) : abs({ year: rng.int(world.settings.start_range.from, world.settings.start_range.to), week: rng.int(1, 52) });
    const h = o.hero, x = h.start;
    const sex = o.sex === 'woman' ? 'woman' : 'man';
    // a separate generator for names, so choosing them does not change Fortune's sequence
    const nm: Names = { ...(names ?? drawNames(h.names, new Rng(seed ^ 0x5bd1e995), sex)), sex };
    const nv = nameVars(nm);
    const amt = (a: number | string) => (typeof a === 'number' ? a : parseMoney(a));
    const hero: Hero = {
      name: nv.name, styled: nv.styled, origin: o.id, sex, history: `The History of ${nv.styled.split(' ')[0]} ${nv.name}`, names: nm,
      purse: amt(x.purse), debts: amt(x.debts), luck: x.luck, notoriety: x.notoriety, celebrity: x.celebrity,
      attrs: { ...x.attrs }, hum: { ...x.hum }, conditions: [...(x.conditions ?? [])], tags: [...x.tags], items: [...x.items], hooks: [...x.hooks],
      persona: nv.styled, personas: { [nv.styled]: x.exposure },
      trueRank: h.true_rank, claimedRank: h.claimed_rank, lodging: { ...h.lodging },
      dress: {}, notes: [], loans: [], pledges: [], writs: [], living: 'claimed',
    };
    const st: CampaignState = {
      v: SAVE_VERSION, seed, rng: rng.state, hero, at, turn: 1, phase: 'town', offers: [], played: {},
      post: [], news: [], story: [], raised: {}, log: [],
    };
    const c = new Campaign(world, st);
    hero.dress = c.startingDress(o);
    for (const d of Object.values(hero.dress)) if (d && !hero.items.includes(d.name)) hero.items.push(d.name);
    if (o.arrival && c.byId[o.arrival]) c.startVenture(o.arrival);
    else c.drawOffers();
    return c;
  }

  get hero() { return this.st.hero; }
  get origin(): Origin { return this.world.origins.find(o => o.id === this.hero.origin)!; }
  date() { return when(this.st.at); }

  // ----- expressions over the hero, for offers -----

  private fns(): Record<string, Fn> {
    const H = this.hero;
    return {
      money: (p) => money(p as number),
      floor: (x) => Math.floor(x as number), ceil: (x) => Math.ceil(x as number),
      min: (...a) => Math.min(...(a as number[])), max: (...a) => Math.max(...(a as number[])),
      has_item: (t) => H.items.includes(t as string),
      has_item_like: (t) => H.items.some(i => i.includes(t as string)),
      has_hook: (p) => H.hooks.some(h => h.startsWith(p as string)),
      has_condition: (p) => H.conditions.some(h => h.startsWith(p as string)),
      has_tag: (p) => H.tags.some(h => h.startsWith(p as string)),
      has_persona: (p) => H.persona.startsWith(p as string),
      played: (id) => !!this.st.played[id as string],
      rumour_says: (w) => this.st.post.some(r => r.effect.includes(w as string)),
    };
  }

  extra(): Record<string, string | number> {
    const d = this.date(), w = this.activeWrit();
    return {
      year: d.year, week: d.week, turn: this.st.turn, origin: this.hero.origin, ...nameVars(this.hero.names),
      // the bailiff's writ, and the prison, for their Ventures
      writ_amount: w ? this.writAmount(w) : 0, writ_money: w ? money(this.writAmount(w)) : 'nothing', creditor: w?.creditor ?? '',
      prison: this.hero.confined?.where ?? (this.hero.lodging.district === 'Southwark' ? this.econ.prison.marshalsea : this.econ.prison.fleet), debts_all: this.enforceable(), debts_money: money(this.enforceable()),
    };
  }

  test(src?: string): boolean {
    if (!src) return true;
    const H = this.hero;
    const scope = { ...this.extra(), ...H, exposure: H.personas[H.persona] ?? 0, flags: {}, spoils: 0, composure: H.attrs.Nerve + 1 };
    return !!evaluate(compile(src), scope as Record<string, unknown>, this.fns());
  }

  // ----- offers -----

  eligible(): Venture[] {
    const now = this.st.at;
    return this.world.ventures.filter(v => {
      const o = v.offer;
      if (!o || o.arrival || v.system) return false;
      if (!o.repeat && this.st.played[v.id]) return false;
      if (o.from && now < abs(o.from)) return false;
      if (o.to && now > abs(o.to)) return false;
      return this.test(o.when);
    });
  }

  drawOffers() {
    const pool = this.eligible(), rng = new Rng(this.st.rng), out: string[] = [];
    while (out.length < 3 && pool.length) {
      const i = rng.weighted(pool.map(v => v.offer!.weight ?? 1));
      out.push(pool[i].id); pool.splice(i, 1);
    }
    this.st.rng = rng.state; this.st.offers = out;
  }

  // ----- a Venture -----

  startVenture(id: string) {
    if (!this.byId[id]) throw new Error(`No Venture “${id}”`);
    this.st.current = { id, hero: JSON.parse(JSON.stringify(this.hero)), at: this.st.at, choices: [] };
    this.st.phase = 'venture';
  }

  /** A fresh Run for the current Venture, starting from the hero as they were at its Approach. */
  makeRun(): Run {
    const c = this.st.current!; const v = this.byId[c.id]; const H = c.hero;
    const seed: HeroSeed = {
      purse: H.purse, debts: H.debts, luck: H.luck, exposure: H.personas[H.persona] ?? 0, notoriety: H.notoriety, celebrity: H.celebrity,
      attrs: H.attrs, hum: H.hum, conditions: H.conditions, tags: H.tags, items: H.items, hooks: H.hooks, persona: H.persona,
    };
    return new Run({ venture: v, glossary: this.world.glossary }, {
      hero: seed, at: c.at, extra: this.extra(), played: (x) => !!this.st.played[x], exposureExtra: this.exposureExtra(),
    });
  }

  /** A number in [0, 1) from the run's own generator, for the Wheel. */
  random(): number {
    const rng = new Rng(this.st.rng);
    const x = rng.next(); this.st.rng = rng.state;
    return x;
  }

  record(ch: Choice) { this.st.current!.choices.push(ch); }

  /** Replay the recorded choices on a fresh Run (after a reload). Returns the Run and the path taken. */
  replay(): { run: Run; path: { beat: string; choice: Choice; html: string; fx: Run['fx'] }[]; next: string } {
    const run = this.makeRun(); const v = this.byId[this.st.current!.id];
    let at = v.first; const path = [];
    for (const ch of this.st.current!.choices) {
      if (at !== ch.beat) throw new Error(`Replay went astray at ${ch.beat} (expected ${at})`);
      const o = run.beats[at].options[ch.opt];
      run.fx = [];
      if (ch.luck) run.spendLuck();
      const luckFx = run.fx.slice();
      const res = run.resolve(o, ch.seg);
      run.fx = luckFx.concat(run.fx);
      path.push({ beat: at, choice: ch, html: res.html, fx: run.fx });
      at = res.next;
      if (at === 'reckon') break;
    }
    return { run, path, next: at };
  }

  /** After the Reckoning: carry the Venture's consequences into the run. */
  finishVenture(run: Run, chapterHeading: string) {
    const c = this.st.current!; const v = this.byId[c.id]; const S = run.S; const H = this.hero;
    for (const k of Object.keys(H.hum)) if (S.hum[k] > c.hero.hum[k]) this.st.raised[k] = true;
    Object.assign(H, {
      purse: S.purse, debts: Math.max(0, S.debts), luck: S.luck, notoriety: S.notoriety, celebrity: S.celebrity,
      attrs: { ...S.attrs }, hum: { ...S.hum }, conditions: [...S.conditions], tags: [...S.tags], items: [...S.items], hooks: [...S.hooks],
    });
    H.persona = S.persona; H.personas[S.persona] = S.exposure;
    // a purse spent below nothing (a Reversal can cost more than was carried) is owed to the tradesmen
    if (H.purse < 0) { H.debts += -H.purse; this.st.log.push(`Turn ${this.st.turn}: ${money(-H.purse)} overspent, owed`); H.purse = 0; }
    for (const p of S.pledges) {
      const slot = SLOTS.find(sl => H.dress[sl]?.name === p.item);
      const pl: Pledge = { item: p.item, loan: p.loan, at: this.st.at };
      if (slot) { pl.slot = slot; pl.dress = H.dress[slot]!; H.dress[slot] = null; }
      H.pledges.push(pl);
    }
    for (const n of S.notes) H.notes.push({ to: n.to, amount: n.amount, since: this.st.at });
    // clothes lost in the Venture leave their slots
    for (const sl of SLOTS) { const d = H.dress[sl]; if (d && !WEEKLY.includes(sl) && !H.items.includes(d.name)) H.dress[sl] = null; }
    if (v.system) this.afterSystem(v.id, S.flags);
    for (const r of S.rumours) {
      this.st.post.push({ id: r.id, from: r.from, text: r.text, effect: r.effect, persona: r.persona, at: r.week, venture: v.id, on_delivery: r.on_delivery });
    }
    if (S.story.length) {
      this.st.story.push({ no: this.st.story.length + 1, venture: v.id, title: v.title, heading: chapterHeading, passages: S.story.map(p => ({ sm: p.sm, st: p.st })) });
    }
    this.st.played[v.id] = (this.st.played[v.id] ?? 0) + 1;
    this.st.log.push(`Turn ${this.st.turn}: ${v.title}${S.story.length ? ' (a chapter)' : ''}`);
    this.st.current = undefined;
    this.settle();
  }

  /** Idle the month: no Venture, no spin. */
  idle() {
    const H = this.hero;
    H.hum.Phlegmatic = Math.min(5, H.hum.Phlegmatic + 1); this.st.raised.Phlegmatic = true;
    this.st.log.push(`Turn ${this.st.turn}: idled`);
    this.settle();
  }

  // ----- the economy: Appearances, Credit, debts -----

  get econ() { return this.world.settings.economy; }
  appearances() { return appearances(this.hero.dress, this.econ); }
  expected() { return this.econ.expected[this.hero.claimedRank]; }
  inSavoy() { return this.hero.lodging.district === 'The Savoy' && !this.hero.confined; }
  /** Credit is nothing inside the Savoy or a prison, unless reckoned as it would stand outside. */
  credit(outside = false) {
    if (!outside && (this.inSavoy() || this.hero.confined)) return 0;
    return credit(this.appearances(), this.hero.claimedRank, this.econ);
  }
  /** What the law can recover: the tradesmen and the moneylender. Notes of hand cannot be sued for. */
  enforceable() { return this.hero.debts + this.hero.loans.reduce((a, l) => a + l.owed, 0); }
  livingRank(): Rank {
    if (this.inSavoy()) return this.econ.savoy.living;
    return this.hero.living === 'pinching' ? rankBelow(this.hero.claimedRank) : this.hero.claimedRank;
  }
  /** Every Exposure gain is +1 for each: Appearances below the rank, pinching, a claim two ranks above the truth. */
  exposureExtra(): { by: number; why: string } {
    const why: string[] = [], H = this.hero;
    if (this.appearances() < this.expected()) why.push('shabby for the rank');
    if (H.living === 'pinching' && !this.inSavoy()) why.push('pinching');
    if (rankIndex(H.claimedRank) - rankIndex(H.trueRank) >= 2) why.push('a claim far above the truth');
    return { by: why.length, why: why.join(', ') };
  }
  activeWrit(): Writ | undefined { return this.hero.writs.find(w => !w.quietUntil || w.quietUntil <= this.st.at); }
  writAmount(w: Writ): number {
    return w.kind === 'tradesmen' ? this.hero.debts : (this.hero.loans[w.loan ?? 0]?.owed ?? w.amount);
  }

  // ----- the bills -----

  weeklyUpkeep(): number {
    const s = this.world.settings, H = this.hero;
    if (H.confined) {
      if (H.confined.stage === 'sponging-house') return amt(this.econ.prison.sponging);
      return H.confined.side === 'room' ? amt(this.econ.prison.room) : 0;
    }
    const living = amt(s.living[this.livingRank()]);
    const room = Math.round(amt(s.lodging[H.lodging.district]) * s.room[H.lodging.room]);
    const wages = WEEKLY.reduce((a, sl) => a + (H.dress[sl]?.weekly ?? 0), 0);
    return living + room + wages;
  }

  private settle() {
    const H = this.hero, s = this.world.settings, e = this.econ, weeks: WeekBill[] = [], events: string[] = [];
    let total = 0, owedAll = 0;
    for (let i = 0; i < s.turn_weeks; i++) {
      const at = this.st.at + i;
      const up = this.weeklyUpkeep();
      const paid = Math.min(up, Math.max(0, H.purse)), owed = up - paid;
      H.purse -= paid; H.debts += owed; total += up; owedAll += owed;
      if (H.confined?.stage === 'sponging-house') {
        H.confined.stage = 'prison';
        events.push(`After a week in the sponging-house, you are carried to ${H.confined.where}.`);
      }
      // the moneylender's interest
      for (const l of H.loans) l.owed += Math.round(l.principal * e.lender.weekly);
      // wear, twice as fast when pinching, in the Savoy, or in prison
      const fast = (H.living === 'pinching' && !this.inSavoy()) || this.inSavoy() || !!H.confined;
      for (const sl of SLOTS) {
        const d = H.dress[sl]; if (!d || WEEKLY.includes(sl)) continue;
        const before = condition(d, e); d.wear += fast ? 2 : 1; const after = condition(d, e);
        if (after !== before) events.push(`Your ${sl.toLowerCase()} is now ${after.toLowerCase()}.`);
      }
      // notes of hand unpaid past their grace cost a point of Celebrity a week
      for (const n of H.notes) if (at - n.since >= e.notes.grace && H.celebrity > 0) {
        H.celebrity--; events.push(`Your note of hand to ${n.to} is unpaid, and the Town knows it: Celebrity −1.`);
      }
      // pledges unredeemed are forfeit
      for (const p of [...H.pledges]) if (at >= p.at + e.pawn.weeks) {
        H.pledges.splice(H.pledges.indexOf(p), 1); events.push(`The pawnbroker’s twelve weeks are up: ${p.item} is forfeit.`);
      }
      // the post
      const due = this.st.post.filter(r => r.at <= at);
      this.st.post = this.st.post.filter(r => r.at > at);
      for (const r of due) r.done = this.deliver(r, events);
      // the moneylender sends for the bailiff when a loan is long overdue
      H.loans.forEach((l, k) => {
        if (at > l.due + e.lender.grace && !H.writs.some(w => w.kind === 'loan' && w.loan === k) && !H.confined) {
          H.writs.push({ kind: 'loan', amount: l.owed, creditor: l.from, at, loan: k });
          events.push(`${l.from} has taken out a writ for ${money(l.owed)}.`);
        }
      });
      weeks.push({ at, upkeep: up, paid, owed, letters: due });
    }
    // the turn's own weathers
    if (this.inSavoy()) {
      H.hum.Melancholic = Math.min(5, H.hum.Melancholic + 1); this.st.raised.Melancholic = true;
      if (H.celebrity > 0) H.celebrity--;
      events.push('A month in the Liberty of the Savoy: Melancholic +1, Celebrity −1.');
      if (H.savoySince !== undefined && this.st.at + s.turn_weeks - H.savoySince >= e.savoy.season && !H.tags.includes(e.savoy.tag)) {
        H.tags.push(e.savoy.tag); events.push(`A season in the Savoy: you are now ${e.savoy.tag.replace(/ \(.*\)$/, '')}, and the Quality has forgotten your face.`);
      }
    }
    if (H.confined?.stage === 'prison' && H.confined.side === 'common') {
      H.hum.Melancholic = Math.min(5, H.hum.Melancholic + 1); this.st.raised.Melancholic = true;
      events.push('A month on the common side: Melancholic +1.');
    }
    // humours not raised this turn cool by 1, down to 1 (systems spec, Proposed)
    const cooled: string[] = [];
    for (const k of Object.keys(H.hum)) {
      if (!this.st.raised[k] && H.hum[k] > 1) { H.hum[k]--; cooled.push(k); }
    }
    this.st.raised = {};
    this.st.news = weeks.flatMap(w => w.letters);
    this.st.bills = { weeks, cooled, total, owed: owedAll, events };
    this.st.phase = 'bills';
  }

  /** Apply a letter's effect to the hero; returns chips describing what it did. */
  deliver(r: Letter, events: string[] = []): string[] {
    const H = this.hero, done: string[] = [];
    const bump = (k: string, d: number) => {
      if (k === 'exposure') {
        const p = r.persona; const [lo, hi] = LIM.exposure;
        if (d > 0) d += this.exposureExtra().by;
        H.personas[p] = Math.max(lo, Math.min(hi, (H.personas[p] ?? 0) + d));
        // a damaging rumour, while the tradesmen are owed more than Credit, brings a writ (systems spec)
        if (d > 0 && H.debts > this.credit() && !this.inSavoy() && !H.confined && !H.writs.some(w => w.kind === 'tradesmen')) {
          H.writs.push({ kind: 'tradesmen', amount: H.debts, creditor: this.econ.tradesman, at: r.at });
          events.push(`The rumour reaches ${this.econ.tradesman}, who has taken out a writ for ${money(H.debts)}.`);
          done.push('A writ');
        }
        done.push(`Exposure (${p}) ${d > 0 ? '+' : '−'}${Math.abs(d)}`);
      } else if (k in LIM) {
        const [lo, hi] = LIM[k]; (H as any)[k] = Math.max(lo, Math.min(hi, (H as any)[k] + d));
        done.push(`${k[0].toUpperCase() + k.slice(1)} ${d > 0 ? '+' : '−'}${Math.abs(d)}`);
      } else if (k === 'purse' || k === 'debts') {
        (H as any)[k] += d; done.push(`${k === 'purse' ? 'Purse' : 'Debts'} ${d > 0 ? '+' : '−'}${money(Math.abs(d))}`);
      } else if (k.startsWith('hum.')) {
        const h = k.slice(4); H.hum[h] = Math.max(0, Math.min(5, H.hum[h] + d)); if (d > 0) this.st.raised[h] = true;
        done.push(`${h} ${d > 0 ? '+' : '−'}${Math.abs(d)}`);
      }
    };
    if (r.on_delivery) {
      for (const e of r.on_delivery) {
        if ('adj' in e) bump(e.adj, typeof e.by === 'number' ? e.by : parseMoney(String(e.by)));
        else if ('tag' in e) { if (!H.tags.includes(e.tag)) { H.tags.push(e.tag); done.push('Tag: ' + e.tag); } }
        else if ('hook' in e) { H.hooks.push(e.hook); done.push('New hook'); }
        else if ('unhook' in e) { const i = H.hooks.findIndex(h => h.startsWith(e.unhook)); if (i > -1) { H.hooks.splice(i, 1); done.push('Hook spent'); } }
        else if ('item' in e) { H.items.push(e.item); done.push('Gained: ' + e.item.split(',')[0]); }
        else if ('lose' in e) { const i = H.items.indexOf(e.lose); if (i > -1) { H.items.splice(i, 1); done.push('Lost: ' + e.lose.split(',')[0]); } }
        else if ('condition' in e) { if (!H.conditions.includes(e.condition)) { H.conditions.push(e.condition); done.push('Condition: ' + e.condition); } }
      }
    } else {
      // read the simple effects from the text: "Exposure +3 (Mrs Delacourt) · Notoriety +1 · …"
      for (const part of r.effect.split('·')) {
        const m = /^\s*(Exposure|Notoriety|Celebrity|Luck)\s*([+−-])\s*(\d+)/.exec(part);
        if (m) bump(m[1].toLowerCase(), (m[2] === '+' ? 1 : -1) * Number(m[3]));
      }
    }
    return done;
  }

  /** From the bills to the next turn: a writ brings the bailiff, a prison keeps its own. */
  nextTurn() {
    this.st.at += this.world.settings.turn_weeks;
    this.st.turn++;
    this.st.bills = undefined;
    this.st.phase = 'town';
    this.beginTurn();
  }

  private beginTurn() {
    const H = this.hero;
    if (H.confined) {
      if (H.purse >= this.enforceable()) this.release('You pay what is owed, every farthing, and the turnkey lets you out into the street.');
      else { this.st.offers = this.byId.fleet ? ['fleet'] : []; return; }
    }
    if (this.activeWrit() && !this.inSavoy() && this.byId.bailiff) { this.startVenture('bailiff'); return; }
    this.drawOffers();
  }

  /** What the bailiff and the prison Ventures decided. */
  private afterSystem(id: string, f: Record<string, number>) {
    const H = this.hero, w = this.activeWrit();
    if (id === 'bailiff' && w) {
      if (f.paid) {
        if (w.kind === 'tradesmen') H.debts = 0; else if (w.loan !== undefined) H.loans.splice(w.loan, 1);
        H.writs.splice(H.writs.indexOf(w), 1);
        this.reindexLoanWrits();
        this.st.log.push(`Turn ${this.st.turn}: paid the writ`);
      } else if (f.bribed) {
        w.quietUntil = this.st.at + this.world.settings.turn_weeks + 1;
        this.st.log.push(`Turn ${this.st.turn}: the bailiff bought off for a month`);
      } else if (f.fled) {
        H.savoySince = this.st.at; this.move('The Savoy', 'garret', true);
        this.st.log.push(`Turn ${this.st.turn}: fled into the Savoy`);
      } else this.confine();
    }
    if (id === 'fleet' && f.pound) this.compose(f.pound);
  }

  private reindexLoanWrits() {
    // loans are addressed by position; keep the writs pointing at the right ones
    const H = this.hero;
    H.writs = H.writs.filter(w => w.kind === 'tradesmen' || (w.loan !== undefined && w.loan < H.loans.length));
  }

  /** Taken: a week in the sponging-house, then prison. Servants and equipage are given up. */
  confine() {
    const H = this.hero, e = this.econ;
    const where = H.lodging.district === 'Southwark' ? e.prison.marshalsea : e.prison.fleet;
    H.confined = { where, stage: 'sponging-house', since: this.st.at, side: 'common', was: { ...H.lodging } };
    for (const sl of WEEKLY) H.dress[sl] = null;
    H.writs = [];
    this.st.log.push(`Turn ${this.st.turn}: taken for debt, to ${where}`);
  }

  /** The creditors accept so many pence in the pound; if the purse can pay it, the hero walks out. */
  compose(pencePerPound: number) {
    const H = this.hero, due = this.enforceable(), offer = Math.round(due * pencePerPound / 240);
    if (H.purse >= offer) {
      H.purse -= offer; H.debts = 0; H.loans = [];
      this.release(`Your creditors take ${money(pencePerPound)} in the pound, ${money(offer)} in all, and you walk out of ${H.confined?.where ?? 'prison'}.`);
    } else {
      // the composition stands; the money must be found
      const k = pencePerPound / 240;
      H.debts = Math.round(H.debts * k);
      for (const l of H.loans) { l.owed = Math.round(l.owed * k); l.principal = Math.round(l.principal * k); }
      this.st.log.push(`Turn ${this.st.turn}: a composition at ${money(pencePerPound)} in the pound, still to be paid`);
    }
  }

  private release(why: string) {
    const H = this.hero;
    const was = H.confined?.was ?? { district: 'Fleet Street and the Strand', room: 'garret' };
    H.confined = undefined; H.writs = [];
    H.lodging = { district: was.district, room: 'garret' };
    this.st.news = [{ id: 'released', from: 'The turnkey', text: why, effect: '', persona: H.persona, at: this.st.at, venture: 'fleet' }, ...this.st.news];
    this.st.log.push(`Turn ${this.st.turn}: released`);
  }

  // ----- in the town -----

  /** Moving lodgings delays every rumour in the post by a week (systems spec, Proposed).
   *  The Savoy may be left only when what is owed falls below the Credit outside. */
  canLeaveSavoy() { return !this.hero.writs.length || this.enforceable() < this.credit(true); }
  move(district: string, room: Room, force = false): boolean {
    const H = this.hero;
    if (H.confined) return false;
    if (H.lodging.district === district && H.lodging.room === room) return true;
    if (!force && H.lodging.district === 'The Savoy' && district !== 'The Savoy' && !this.canLeaveSavoy()) return false;
    if (H.lodging.district === 'The Savoy' && district !== 'The Savoy') { H.writs = []; H.savoySince = undefined; }
    if (district === 'The Savoy' && H.lodging.district !== 'The Savoy') H.savoySince = this.st.at;
    H.lodging = { district, room };
    for (const r of this.st.post) r.at += 1;
    this.st.log.push(`Turn ${this.st.turn}: moved to a ${room} in ${district}`);
    return true;
  }

  retire() { this.st.phase = 'ended'; this.st.ended = { how: 'Retirement', at: this.st.at }; }

  // ----- the hero's affairs, in the town -----

  /** Buy (or hire, for a servant or equipage) a slot's item; on account if Credit will bear it. */
  buy(slot: Slot, tier: number, onAccount = false): string | null {
    const H = this.hero, e = this.econ, item = e.catalogue[slot][tier - 1], cost = price(slot, tier, e);
    if (H.confined) return 'Not from prison.';
    if (WEEKLY.includes(slot)) {
      H.dress[slot] = { tier, name: item.name, wear: 0, weekly: cost };
      this.st.log.push(`Turn ${this.st.turn}: hired ${item.name}`); return null;
    }
    if (onAccount) {
      if (H.debts + cost > this.credit()) return `Your Credit (${money(this.credit())}) will not bear it.`;
      H.debts += cost;
    } else {
      if (H.purse < cost) return `It costs ${money(cost)}; you have ${money(H.purse)}.`;
      H.purse -= cost;
    }
    const old = H.dress[slot];
    if (old) { const i = H.items.indexOf(old.name); if (i > -1) H.items.splice(i, 1); }
    H.dress[slot] = { tier, name: item.name, wear: 0 };
    H.items.push(item.name);
    this.st.log.push(`Turn ${this.st.turn}: bought ${item.name}${onAccount ? ' on account' : ''}`);
    return null;
  }

  dismiss(slot: Slot) { if (WEEKLY.includes(slot)) this.hero.dress[slot] = null; }

  pawnable(): { item: string; value: number; loan: number }[] {
    const H = this.hero, e = this.econ;
    return H.items.map(item => ({ item, value: valueOf(item, H.dress, e) }))
      .filter((x): x is { item: string; value: number } => x.value !== null)
      // to the nearest shilling, as a pawnbroker would
      .map(x => ({ ...x, loan: Math.max(12, Math.round(x.value * e.pawn.fraction / 12) * 12) }));
  }

  pawn(item: string): string | null {
    const H = this.hero, x = this.pawnable().find(p => p.item === item);
    if (!x) return 'The pawnbroker will not take it.';
    H.items.splice(H.items.indexOf(item), 1);
    const slot = SLOTS.find(sl => H.dress[sl]?.name === item);
    const pl: Pledge = { item, loan: x.loan, at: this.st.at };
    if (slot) { pl.slot = slot; pl.dress = H.dress[slot]!; H.dress[slot] = null; }
    H.pledges.push(pl); H.purse += x.loan;
    this.st.log.push(`Turn ${this.st.turn}: pledged ${item} for ${money(x.loan)}`);
    return null;
  }

  redeemCost(p: Pledge) { return p.loan + Math.round(p.loan * this.econ.pawn.redeem); }
  redeem(i: number): string | null {
    const H = this.hero, p = H.pledges[i]; if (!p) return 'No such ticket.';
    const cost = this.redeemCost(p);
    if (H.purse < cost) return `It costs ${money(cost)} to redeem; you have ${money(H.purse)}.`;
    H.purse -= cost; H.pledges.splice(i, 1); H.items.push(p.item);
    if (p.slot && p.dress && !H.dress[p.slot]) H.dress[p.slot] = p.dress;
    this.st.log.push(`Turn ${this.st.turn}: redeemed ${p.item}`);
    return null;
  }

  /** The moneylender lends against Appearances: no more in all than Credit. */
  canBorrow(): number { return Math.max(0, this.credit() - this.hero.loans.reduce((a, l) => a + l.principal, 0)); }
  borrow(sum: number): string | null {
    const H = this.hero, e = this.econ.lender;
    if (sum > this.canBorrow()) return `${e.name.split(',')[0]} will lend you no more than ${money(this.canBorrow())}.`;
    H.purse += Math.round(sum * (1 - e.fee));
    H.loans.push({ from: e.name.split(',')[0], principal: sum, owed: sum, taken: this.st.at, due: this.st.at + e.term });
    this.st.log.push(`Turn ${this.st.turn}: borrowed ${money(sum)} of ${e.name}`);
    return null;
  }
  repay(i: number, sum: number): string | null {
    const H = this.hero, l = H.loans[i]; if (!l) return 'No such loan.';
    sum = Math.min(sum, l.owed, H.purse); if (sum <= 0) return 'Nothing to pay with.';
    H.purse -= sum; l.owed -= sum;
    if (l.owed <= 0) {
      H.loans.splice(i, 1);
      H.writs = H.writs.filter(w => !(w.kind === 'loan' && w.loan === i)).map(w => (w.kind === 'loan' && w.loan! > i ? { ...w, loan: w.loan! - 1 } : w));
    }
    return null;
  }
  payNote(i: number): string | null {
    const H = this.hero, n = H.notes[i]; if (!n) return 'No such note.';
    if (H.purse < n.amount) return `The note is for ${money(n.amount)}; you have ${money(H.purse)}.`;
    H.purse -= n.amount; H.notes.splice(i, 1);
    return null;
  }
  payTradesmen(sum: number): string | null {
    const H = this.hero; sum = Math.min(sum, H.debts, H.purse); if (sum <= 0) return 'Nothing to pay with.';
    H.purse -= sum; H.debts -= sum;
    if (H.debts <= this.credit()) H.writs = H.writs.filter(w => w.kind !== 'tradesmen');
    return null;
  }
  /** In prison, with the money in hand: pay every farthing and walk out. */
  payOut(): string | null {
    const H = this.hero, due = this.enforceable();
    if (!H.confined) return null;
    if (H.purse < due) return `You owe ${money(due)}; you have ${money(H.purse)}.`;
    H.purse -= due; H.debts = 0; H.loans = [];
    this.release('You pay what is owed, every farthing, and the turnkey lets you out into the street.');
    this.drawOffers();
    return null;
  }
  setLiving(mode: 'claimed' | 'pinching') { this.hero.living = mode; }
  setSide(side: 'common' | 'room') { if (this.hero.confined) this.hero.confined.side = side; }
}
