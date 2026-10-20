// A run: one hero across many turns. Headless, like core.ts, so the same code drives the page
// and the tests. Its whole state is plain JSON (CampaignState), saved after every choice.
//
// The turn (design document, "Each turn: one Venture, one spin, then the bills"):
//   town     read the letters, maybe move lodgings, choose one of three Ventures or idle
//   venture  play it, beat by beat; every choice is recorded so a reload can replay it
//   bills    four weeks of Upkeep, rumours delivered week by week, humours cool
//   → town again, four weeks on.

import { Run, money, odds, parseMoney, type HeroSeed } from './core';
import { compile, evaluate, type Fn } from './expr';
import { Rng } from './rng';
import type { Effect, Humour, Origin, Passage, PersonaKind, Rank, Room, Segment, Told, Venture, When, World, Written } from './types';
import { RANKS, SEGMENTS, SEGMENT_NAMES } from './types';
import { drawNames, nameVars, type Names } from './names';
import {
  SLOTS, WEEKLY, amt, appearances, condition, credit, price, rankBelow, rankIndex, valueOf,
  type Confinement, type Dress, type Loan, type Note, type Pledge, type Slot, type Writ,
} from './economy';

export const SAVE_VERSION = 4;
const HUMOURS: Humour[] = ['Sanguine', 'Choleric', 'Melancholic', 'Phlegmatic'];
const EPOCH = 1719;
/** What each Affliction does, as the bills announce it. */
const AFFLICTION: Record<Humour, string> = {
  Sanguine: 'Your spirits run away with your purse: Upkeep is half as much again, a certain cost is paid twice over, and you will not hear of pinching.',
  Choleric: 'You cannot let anything pass: a quarrel finds you every month, and at the Crisis you will not withdraw.',
  Melancholic: 'You are hipped: every other month passes in your room with the curtains drawn.',
  Phlegmatic: 'You are torpid: fewer chances come your way, those that will not wait pass you by, and you no longer notice the doors you cannot open.',
};
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
  // ----- the false self (Step 7). `personas` above holds each name's Exposure. -----
  /** Every name the hero has passed under, and what became of it. */
  records: Record<string, PersonaRec>;
  /** The Origin's Secret. */
  secret: 'kept' | 'out';
  /** Circles closed to the hero's next Persona after one was blown, until a week. */
  closed: Record<string, number>;
  /** While the Secret is fresh news, Credit is reckoned at a lower rank. */
  lowCredit?: { rank: Rank; until: number };
  // ----- humours and Reputation (Step 8) -----
  /** The week each Tag was last earned, for its lapse. */
  tagSince: Record<string, number>;
  /** Conditions that pass of themselves, until a week. */
  timed: Record<string, number>;
}

/** A name the hero passes under (Step 7 rulings). */
export interface PersonaRec {
  name: string;
  /** The kind (settings.yaml personas.kinds), when known. */
  kind?: string;
  /** The rank this name claims. */
  rank: Rank;
  /** own: the hero's true name. live: worn, or ready to be worn. */
  state: 'own' | 'live' | 'retired' | 'sold' | 'dead';
  /** The circles where it is known. */
  circles: string[];
  /** Weeks since its Exposure last rose, toward cooling. */
  quiet: number;
  /** The tradesmen's debts run up under this name, which go with it if it is sold. */
  debts: number;
  /** When it was taken up. */
  since: number;
  /** At Exposure 10 once already, until it falls below. */
  spent?: boolean;
  /** Made real: the thing claimed has been acquired (a commission, a title, an estate). */
  real?: boolean;
}

export interface Letter {
  id: string; from: string; text: string; effect: string; persona: string;
  at: number; venture: string; on_delivery?: Effect[];
  /** Whose talk it is (Step 7). A letter without a circle is felt in full. */
  circle?: string;
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
  // ----- Step 8 -----
  /** The engine's own humour rises this turn, at most one each. */
  auto?: Record<string, boolean>;
  /** A Hipped hero's lost turn: only Idle, and idling does not raise Phlegmatic. */
  lost?: boolean;
  /** Whether the last Hipped turn was lost, so that they alternate. */
  lastLost?: boolean;
  /** The Venture played last turn, for routine. */
  lastVenture?: string;
  /** The turn of the last relief: one a turn. */
  relieved?: number;
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
      st.v = 2;
    }
    if (st.v === 2) {
      // Step 7: the names the hero has passed under become records
      const H = st.hero as Partial<Hero> & Hero, alias = nameVars(H.names).alias;
      H.records = {};
      H.records[H.styled] = this.newRec(H.styled, H.persona === H.styled ? H.claimedRank : H.trueRank, 'own', H.debts);
      for (const p of Object.keys(H.personas)) if (p !== H.styled) {
        H.records[p] = { ...this.newRec(p, H.claimedRank, 'live', 0), kind: p === alias ? this.origin.hero?.alias_kind : undefined };
      }
      H.secret = 'kept'; H.closed = {};
      st.v = 3;
    }
    if (st.v === 3) {
      // Step 8: the circles are the factions; Tags date from now
      const H = st.hero, MAP: Record<string, string> = { 'the City': 'the Projectors', 'the Trade': 'the Town' };
      const fix = (c: string) => MAP[c] ?? c;
      for (const r of Object.values(H.records)) r.circles = [...new Set(r.circles.map(fix))];
      H.closed = Object.fromEntries(Object.entries(H.closed).map(([k, u]) => [fix(k), u]));
      for (const l of st.post) if (l.circle) l.circle = fix(l.circle);
      H.tagSince = Object.fromEntries(H.tags.map(t => [t, st.at]));
      H.timed = {};
      st.v = SAVE_VERSION;
    }
  }

  private newRec(name: string, rank: Rank, state: PersonaRec['state'], debts = 0): PersonaRec {
    return { name, rank, state, circles: [], quiet: 0, debts, since: this.st?.at ?? 0 };
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
      records: {}, secret: 'kept', closed: {}, tagSince: Object.fromEntries(x.tags.map(t => [t, at])), timed: {},
    };
    const st: CampaignState = {
      v: SAVE_VERSION, seed, rng: rng.state, hero, at, turn: 1, phase: 'town', offers: [], played: {},
      post: [], news: [], story: [], raised: {}, log: [],
    };
    const c = new Campaign(world, st);
    hero.records[nv.styled] = c.newRec(nv.styled, h.claimed_rank, 'own', hero.debts);
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
      rank_at_least: (r) => rankIndex(H.claimedRank) >= rankIndex(r as Rank),
      known_in: (k) => !!H.records[H.persona]?.circles.includes(k as string),
      has_tag_in: (t, f) => H.tags.some(x => x.startsWith(`${t} (`) && (x.endsWith(`(${f})`) || x.endsWith('(the Town)'))),
      standing: (f) => this.standing(f as string),
    };
  }

  extra(): Record<string, string | number> {
    const d = this.date(), w = this.activeWrit();
    return {
      year: d.year, week: d.week, turn: this.st.turn, origin: this.hero.origin, ...nameVars(this.hero.names),
      // the bailiff's writ, and the prison, for their Ventures
      writ_amount: w ? this.writAmount(w) : 0, writ_money: w ? money(this.writAmount(w)) : 'nothing', creditor: w?.creditor ?? '',
      prison: this.hero.confined?.where ?? (this.hero.lodging.district === 'Southwark' ? this.econ.prison.marshalsea : this.econ.prison.fleet), debts_all: this.enforceable(), debts_money: money(this.enforceable()),
      // the false self (Step 7)
      claimed_rank: this.hero.claimedRank, true_rank: this.hero.trueRank, secret: this.hero.secret ?? 'kept',
      appearances: this.appearances(), expected_next: this.expectedNext(), lodging_district: this.hero.lodging.district,
      equipage: this.hero.dress.Equipage?.tier ?? 0, sale_price: this.salePrice(), sale_money: money(this.salePrice()),
      circles_known: (this.hero.records?.[this.hero.persona]?.circles ?? []).join(', '),
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
      if (o.circle && (this.hero.closed?.[o.circle] ?? 0) > now) return false;
      return this.test(o.when);
    });
  }

  drawOffers() {
    const rng = new Rng(this.st.rng), out: string[] = [], hu = this.world.settings.humours;
    let pool = this.eligible();
    // Torpid: fewer offers, and nothing that will not wait (Step 8)
    const n = this.afflicted('Phlegmatic') ? hu.torpid_offers : 3;
    if (this.afflicted('Phlegmatic')) pool = pool.filter(v => !v.offer!.from && !v.offer!.to);
    // Quarrelsome: a quarrel is always among them
    if (this.afflicted('Choleric')) { const q = pool.find(v => v.id === hu.quarrel); if (q) { out.push(q.id); pool.splice(pool.indexOf(q), 1); } }
    else pool = pool.filter(v => v.id !== hu.quarrel);
    while (out.length < n && pool.length) {
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
    const xx = this.exposureExtra(), crash = this.gateCrash(v);
    if (crash) { xx.by++; xx.why = xx.why ? `${xx.why}, ${crash}` : crash; }
    return new Run({ venture: v, glossary: this.world.glossary }, {
      hero: seed, at: c.at, extra: this.extra(), played: (x) => !!this.st.played[x], exposureExtra: xx,
      exposureOf: (p) => (H.records[p] && !['sold', 'dead'].includes(H.records[p].state) ? H.personas[p] : undefined),
      newExposure: this.startExposure(H.claimedRank, true),
      // the Afflictions, as they stood at the Approach
      prodigal: H.conditions.includes(this.affName('Sanguine')),
      noWithdraw: H.conditions.includes(this.affName('Choleric')) ? 'Quarrelsome: you cannot back down' : undefined,
      hideLures: H.conditions.includes(this.affName('Phlegmatic')),
      standing: (f) => this.standing(f, H.tags),
    });
  }

  /** A Venture played below the Claimed Rank it expects is gate-crashed (Step 7). */
  gateCrash(v: Venture): string {
    const r = v.offer?.rank;
    return r && rankIndex(this.hero.claimedRank) < rankIndex(r) ? `gate-crashing a ${r}’s company` : '';
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
    const events: string[] = [];
    Object.assign(H, {
      purse: S.purse, debts: Math.max(0, S.debts), luck: S.luck, notoriety: S.notoriety, celebrity: S.celebrity,
      attrs: { ...S.attrs }, hum: { ...S.hum }, conditions: [...S.conditions], tags: [...S.tags], items: [...S.items], hooks: [...S.hooks],
    });
    // the name worn: a new one becomes a record; an old one brings back its claim
    const was = c.hero.records[S.persona] ? c.hero.personas[S.persona] : this.startExposure(c.hero.claimedRank, true);
    if (!H.records[S.persona]) {
      const alias = nameVars(H.names).alias;
      H.records[S.persona] = { ...this.newRec(S.persona, H.claimedRank, 'live'), kind: S.persona === alias ? this.origin.hero?.alias_kind : undefined };
      this.st.log.push(`Turn ${this.st.turn}: took up the name ${S.persona}`);
      this.trimPersonas(S.persona, events);
    } else if (H.records[S.persona].state === 'retired') H.records[S.persona].state = 'live';
    H.persona = S.persona; H.personas[S.persona] = S.exposure;
    const rec = H.records[S.persona];
    H.claimedRank = rec.rank;
    if (S.exposure > was) rec.quiet = 0;
    if (v.offer?.circle && !rec.circles.includes(v.offer.circle)) rec.circles.push(v.offer.circle);
    // a purse spent below nothing (a Reversal can cost more than was carried) is owed to the tradesmen
    if (H.purse < 0) { H.debts += -H.purse; this.st.log.push(`Turn ${this.st.turn}: ${money(-H.purse)} overspent, owed`); H.purse = 0; }
    if (H.debts > c.hero.debts) rec.debts += H.debts - c.hero.debts;
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
    // what a Venture can ask of the false self (Step 7): flags the engine reads
    if (S.flags.claim_up) this.raiseClaim(events);
    if (S.flags.sold_name && H.persona !== H.styled) this.sellPersona(H.persona, !!S.flags.named, events);
    if (S.flags.secret_out) this.secretOut(events);
    if (S.flags.made_real) this.makeReal(H.persona, events);
    // Reputation: renewals, opposites and the short list (Step 8)
    H.tags = c.hero.tags.filter(t => S.tags.includes(t)).concat(S.tags.filter(t => !c.hero.tags.includes(t)));
    this.earnTags(S.earned, events);
    // the engine's own humour rises (Step 8)
    const R = this.world.settings.humours.rises, worth = (h: { purse: number; debts: number }) => h.purse - h.debts;
    if (c.choices.some(ch => ch.seg === 'T')) this.rise('Sanguine', 'A Triumph goes to your head', events);
    if (S.spoils >= amt(R.spoils)) this.rise('Sanguine', `Spoils of ${money(S.spoils)}`, events);
    if (worth(c.hero) - worth(H) >= amt(R.loss)) this.rise('Choleric', `${money(worth(c.hero) - worth(H))} lost in a month`, events);
    if (v.id === 'bailiff') this.rise('Choleric', 'A writ served', events);
    if (this.st.lastVenture === v.id && !v.system) this.rise('Phlegmatic', 'The same scene twice running', events);
    this.st.lastVenture = v.id;
    for (const r of S.rumours) {
      // talk from another district takes a week longer to reach the hero's lodging
      const far = v.offer?.district && v.offer.district !== H.lodging.district ? 1 : 0;
      this.st.post.push({ id: r.id, from: r.from, text: r.text, effect: r.effect, persona: r.persona, at: r.week + far, venture: v.id, on_delivery: r.on_delivery, circle: r.circle ?? v.offer?.circle });
    }
    if (S.story.length) {
      this.st.story.push({ no: this.st.story.length + 1, venture: v.id, title: v.title, heading: chapterHeading, passages: S.story.map(p => ({ sm: p.sm, st: p.st })) });
    }
    this.st.played[v.id] = (this.st.played[v.id] ?? 0) + 1;
    this.st.log.push(`Turn ${this.st.turn}: ${v.title}${S.story.length ? ' (a chapter)' : ''}`);
    this.st.current = undefined;
    this.settle(events);
  }

  /** Idle the month: no Venture, no spin. */
  idle() {
    const events: string[] = [];
    // a Hipped hero's lost month is not idleness, and does not raise Phlegmatic (Step 8)
    if (!this.st.lost) this.rise('Phlegmatic', 'An idle month', events);
    this.st.log.push(`Turn ${this.st.turn}: ${this.st.lost ? 'lost to the hip' : 'idled'}`);
    this.st.lastVenture = undefined;
    this.settle(events);
  }

  // ----- the economy: Appearances, Credit, debts -----

  get econ() { return this.world.settings.economy; }
  appearances() { return appearances(this.hero.dress, this.econ); }
  expected() { return this.econ.expected[this.hero.claimedRank]; }
  inSavoy() { return this.hero.lodging.district === 'The Savoy' && !this.hero.confined; }
  /** Credit is nothing inside the Savoy or a prison, unless reckoned as it would stand outside. */
  credit(outside = false) {
    if (!outside && (this.inSavoy() || this.hero.confined)) return 0;
    const H = this.hero, low = H.lowCredit && H.lowCredit.until > this.st.at ? H.lowCredit.rank : null;
    const r = low && rankIndex(low) < rankIndex(H.claimedRank) ? low : H.claimedRank;
    return credit(this.appearances(), r, this.econ);
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
    // Prodigal: Upkeep +50% (Step 8)
    return Math.round((living + room + wages) * (this.afflicted('Sanguine') ? s.humours.prodigal_upkeep : 1));
  }

  private settle(events: string[] = []) {
    const H = this.hero, s = this.world.settings, e = this.econ, weeks: WeekBill[] = [];
    let total = 0, owedAll = 0;
    this.checkPersonas(this.st.at, events);
    for (let i = 0; i < s.turn_weeks; i++) {
      const at = this.st.at + i;
      if (when(at).week === 1) this.newYear(at, events);
      this.cool(events);
      this.lapseTags(at, events);
      const up = this.weeklyUpkeep();
      const paid = Math.min(up, Math.max(0, H.purse)), owed = up - paid;
      H.purse -= paid; H.debts += owed; total += up; owedAll += owed;
      if (owed) H.records[H.persona].debts += owed;
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
      this.checkPersonas(at, events);
      due.push(...this.lettersNow.splice(0));
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
        this.addTag(e.savoy.tag); events.push(`A season in the Savoy: you are now ${e.savoy.tag.replace(/ \(.*\)$/, '')}, and the Quality has forgotten your face.`);
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
    this.st.raised = {}; this.st.auto = {};
    this.updateAfflictions(events);
    this.syncDebts();
    this.st.news = weeks.flatMap(w => w.letters);
    this.st.bills = { weeks, cooled, total, owed: owedAll, events };
    this.st.phase = 'bills';
  }

  /** Apply a letter's effect to the hero; returns chips describing what it did. */
  deliver(r: Letter, events: string[] = []): string[] {
    const H = this.hero, done: string[] = [];
    const bump = (k: string, d: number) => {
      if (k === 'exposure') {
        const p = r.persona === '*' ? H.persona : r.persona; const [lo, hi] = LIM.exposure;
        const rec = H.records[p];
        // a name sold or dead is beyond the reach of talk
        if (rec && (rec.state === 'sold' || rec.state === 'dead')) { done.push(`${p} is past caring`); return; }
        if (d > 0) {
          // talk from a circle where the name is unknown does less harm, but makes it known there
          if (rec && r.circle && !rec.circles.includes(r.circle)) { d = 1; rec.circles.push(r.circle); done.push(`Now known in ${r.circle}`); }
          else d += this.exposureExtra().by;
          if (rec) rec.quiet = 0;
        }
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
        else if ('tag' in e) { if (!H.tags.includes(e.tag)) done.push('Tag: ' + e.tag); this.addTag(e.tag, events); }
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
    // conditions that pass of themselves
    for (const [k, u] of Object.entries(H.timed)) if (u <= this.st.at) { delete H.timed[k]; H.conditions = H.conditions.filter(x => x !== k); }
    // Hipped: every other turn is lost (Step 8)
    this.st.lost = this.afflicted('Melancholic') ? !this.st.lastLost : false;
    this.st.lastLost = this.st.lost;
    if (this.st.lost) { this.st.offers = []; return; }
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

  // ----- the false self (Step 7) -----

  get pset() { return this.world.settings.personas; }
  /** What the next rank up expects of Appearances; out of reach for a Peer. */
  expectedNext(): number {
    const i = rankIndex(this.hero.claimedRank);
    return i >= RANKS.length - 1 ? 99 : this.econ.expected[RANKS[i + 1]];
  }
  /** Exposure 1 for a new name, +1 per rank claimed above the truth, −1 for a kind at home with the Origin. */
  startExposure(rank: Rank, home: boolean): number {
    return Math.max(0, 1 + Math.max(0, rankIndex(rank) - rankIndex(this.hero.trueRank)) - (home ? 1 : 0));
  }
  /** The hero's own name is true while it claims no more than the True Rank. A false name is made
   *  real only when the thing claimed is acquired (a Venture's flags.made_real), and the True Rank
   *  has caught up with it: a captain who claims no more than a gentleman's rank is still no captain. */
  isReal(r: PersonaRec) {
    const caught = rankIndex(r.rank) <= rankIndex(this.hero.trueRank);
    return r.state === 'own' ? caught : !!r.real && caught;
  }
  /** Personas that count against the limit: live, and not yet made real. */
  liveCount(except?: string) {
    return Object.values(this.hero.records).filter(r => r.state === 'live' && r.name !== except && !this.isReal(r)).length;
  }
  /** Over the limit, the oldest Persona not worn is retired. */
  private trimPersonas(keep: string, events: string[]) {
    const H = this.hero;
    while (this.liveCount() > this.pset.limit) {
      const old = Object.values(H.records).filter(r => r.state === 'live' && r.name !== keep && r.name !== H.persona && !this.isReal(r)).sort((a, b) => a.since - b.since)[0];
      if (!old) break;
      old.state = 'retired'; events.push(`You cannot be everybody at once: ${old.name} is retired.`);
    }
  }
  kinds(): PersonaKind[] {
    const sex = this.hero.sex;
    return this.pset.kinds.filter(k => k.sex === 'either' || k.sex === sex);
  }
  isHome(k: PersonaKind) { return k.home.includes(this.hero.origin); }
  /** Why a kind cannot be taken up now, or null. */
  cannotTakeUp(k: PersonaKind): string | null {
    const H = this.hero, cost = amt(k.cost);
    if (H.confined) return 'Not from prison.';
    if (this.liveCount() >= this.pset.limit) return `You already keep up ${this.pset.limit} false names; retire one first.`;
    if (H.purse < cost) return `The papers and props cost ${money(cost)}; you have ${money(H.purse)}.`;
    if (this.appearances() < this.econ.expected[k.rank]) return `A ${k.rank} is expected to show Appearances of ${this.econ.expected[k.rank]}; you show ${this.appearances()}.`;
    if (k.test && !this.isHome(k) && !this.test(k.test)) return `It needs ${k.needs.charAt(0).toLowerCase() + k.needs.slice(1)}.`;
    return null;
  }
  /** Take up a new Persona of a kind. It is not worn until the hero moves (Ruling 1). */
  takeUp(id: string): string | null {
    const H = this.hero, k = this.pset.kinds.find(x => x.id === id);
    if (!k) return 'No such kind.';
    const why = this.cannotTakeUp(k); if (why) return why;
    const rng = new Rng(this.st.rng), pick = <T>(a: T[]) => a[rng.int(0, a.length - 1)];
    const t = pick(k.titles[H.sex] ?? k.titles.man ?? [{ long: 'Mr', short: 'Mr' }]);
    let name = '';
    for (let i = 0; i < 30 && (!name || H.records[name]); i++) name = `${t.short} ${pick(k.surnames)}`;
    if (H.records[name]) return 'No name could be found that you have not used.';
    const claim = pick(k.claims);
    this.st.rng = rng.state;
    H.purse -= amt(k.cost);
    H.records[name] = { ...this.newRec(name, k.rank, 'live'), kind: k.id };
    H.personas[name] = this.startExposure(k.rank, this.isHome(k));
    this.st.log.push(`Turn ${this.st.turn}: took up ${name}, ${claim} (${k.rank}, Exposure ${H.personas[name]})`);
    return null;
  }
  /** Change the name worn: the same landlady cannot know you by two, so it needs a move (Ruling 1). */
  wear(name: string, district: string, room: Room): string | null {
    const H = this.hero, r = H.records[name];
    if (!r || r.state === 'sold' || r.state === 'dead') return 'That name is not yours to wear.';
    if (name === H.persona) return null;
    if (district === H.lodging.district) return 'To change your name you must change your district: the same landlady cannot know you by two.';
    if (r.state === 'retired' && !this.isReal(r) && this.liveCount() >= this.pset.limit) return `You already keep up ${this.pset.limit} false names; retire one first.`;
    if (!this.move(district, room)) return 'The bailiffs are waiting at the gate. You cannot leave the Liberty until what you owe falls below your Credit outside.';
    if (r.state === 'retired') r.state = 'live';
    H.persona = name; H.claimedRank = r.rank;
    this.st.log.push(`Turn ${this.st.turn}: now passing as ${name}`);
    return null;
  }
  retirePersona(name: string): string | null {
    const r = this.hero.records[name];
    if (!r || r.state !== 'live') return 'Nothing to retire.';
    if (name === this.hero.persona) return 'Change to another name first; then this one may be retired.';
    r.state = 'retired'; this.st.log.push(`Turn ${this.st.turn}: retired ${name}`);
    return null;
  }
  /** What another rogue will give for the name worn: more for a high claim, less for a known one. */
  salePrice(name = this.hero.persona): number {
    const sale = this.pset.sale, lo = amt(sale.min), hi = amt(sale.max), r = this.hero.records?.[name];
    if (!r) return lo;
    const x = hi - (hi - lo) * (this.hero.personas[name] ?? 0) / 10 + 480 * Math.max(0, rankIndex(r.rank) - rankIndex('Gentleman'));
    return Math.round(Math.max(lo, Math.min(hi, x)) / 12) * 12;
  }
  /** Sold, with its debts; the hero goes back to his own name. The buyer may one day name his seller. */
  private sellPersona(name: string, named: boolean, events: string[]) {
    this.syncDebts();
    const H = this.hero, r = H.records[name], price = this.salePrice(name), sale = this.pset.sale;
    H.purse += price;
    const off = Math.min(r.debts, H.debts); H.debts -= off; r.debts = 0;
    r.state = 'sold';
    const own = H.records[H.styled];
    H.persona = H.styled; H.claimedRank = own.rank;
    events.push(`${name} is sold for ${money(price)}${off ? `, and ${money(off)} of debts go with the name` : ''}. You are ${H.styled} again.`);
    if (named) {
      const rng = new Rng(this.st.rng), delay = rng.int(sale.named_from, sale.named_to); this.st.rng = rng.state;
      this.st.post.push({
        id: 'named-' + name, from: 'A turnkey at Newgate', persona: '*', at: this.st.at + delay, venture: 'sale',
        text: `The man who bought the name of ${name} has been taken, and is telling the Ordinary everything, including where he had it.`,
        effect: `Exposure +${sale.named_exposure}`,
      });
    }
    this.st.log.push(`Turn ${this.st.turn}: sold ${name} for ${money(price)}`);
  }
  /** The thing claimed is acquired: the name is made real, and the True Rank rises to its claim (Ruling 3). */
  private makeReal(name: string, events: string[]) {
    const H = this.hero, r = H.records[name];
    if (!r || r.state !== 'live') return;
    r.real = true;
    if (rankIndex(H.trueRank) < rankIndex(r.rank)) H.trueRank = r.rank;
    events.push(`${name} is made real: what was claimed is now true, and the name no longer counts among your false ones.`);
    this.st.log.push(`Turn ${this.st.turn}: ${name} made real`);
  }
  /** A taking-up: the claim rises a rank (Ruling 3). */
  private raiseClaim(events: string[]) {
    const H = this.hero, r = H.records[H.persona], i = rankIndex(r.rank);
    if (i >= RANKS.length - 1) return;
    r.rank = RANKS[i + 1]; H.claimedRank = r.rank;
    events.push(`You are received as a ${r.rank}. The Town will expect you to live like one.`);
    this.st.log.push(`Turn ${this.st.turn}: ${H.persona} raised to ${r.rank}`);
  }
  /** Talk dies down: −1 after every so many weeks with no gain, but not in the Savoy or prison. */
  private cool(events: string[]) {
    const H = this.hero; if (this.inSavoy() || H.confined) return;
    for (const r of Object.values(H.records)) {
      if (r.state === 'sold' || r.state === 'dead' || !(H.personas[r.name] > 0)) continue;
      if (++r.quiet >= this.pset.cool_weeks) {
        r.quiet = 0; H.personas[r.name]--;
        events.push(`The Town has stopped talking about ${r.name}: Exposure −1.`);
      }
    }
  }
  /** At Exposure 10: a name made real suffers a scandal; any other is blown. */
  private checkPersonas(at: number, events: string[]) {
    const H = this.hero;
    for (const r of Object.values(H.records)) {
      const x = H.personas[r.name] ?? 0;
      if (r.state === 'sold' || r.state === 'dead') continue;
      if (x < 10) { r.spent = false; continue; }
      if (r.spent) continue;
      r.spent = true;
      if (this.isReal(r)) {
        const k = this.pset.scandal;
        H.celebrity = Math.max(0, H.celebrity - k.celebrity); H.notoriety = Math.min(10, H.notoriety + k.notoriety);
        events.push(`A scandal: the Town talks of nothing but ${r.name}. Celebrity −${k.celebrity}, Notoriety +${k.notoriety}. But what is claimed is true, and nothing falls due.`);
        this.st.log.push(`Turn ${this.st.turn}: a scandal (${r.name})`);
      } else this.blow(r, at, events);
    }
  }
  /** The Persona is blown (Ruling 4). */
  private blow(r: PersonaRec, at: number, events: string[]) {
    const H = this.hero, P = this.pset, twice = H.tags.some(t => t.startsWith('Brother')) && r.circles.length ? 2 : 1;
    events.push(`<b>${r.name} is blown.</b> The whole Town knows the name for a lie.`);
    // the hero falls to the Book of the True Rank
    if (H.persona === r.name || r.state === 'own') {
      const own = H.records[H.styled];
      own.rank = H.trueRank;
      H.persona = H.styled; H.claimedRank = H.trueRank;
      events.push(`You are ${H.styled} again, and a ${H.trueRank}, as you always were.`);
    }
    if (r.state !== 'own') r.state = 'dead';
    this.rise('Melancholic', 'A name blown', events);
    H.celebrity = Math.max(0, H.celebrity - P.blown_celebrity * twice);
    events.push(`Celebrity −${P.blown_celebrity * twice}.`);
    // every tradesman's debt falls due at once
    if (H.debts > 0) {
      const pay = Math.min(H.debts, Math.max(0, H.purse));
      if (pay) { H.purse -= pay; H.debts -= pay; events.push(`The tradesmen come with their bills at once: you pay ${money(pay)}.`); }
      if (H.debts > this.credit() && !this.inSavoy() && !H.confined && !H.writs.some(w => w.kind === 'tradesmen')) {
        H.writs.push({ kind: 'tradesmen', amount: H.debts, creditor: this.econ.tradesman, at });
        events.push(`${this.econ.tradesman[0].toUpperCase() + this.econ.tradesman.slice(1)} has taken out a writ for ${money(H.debts)}.`);
      }
    }
    for (const k of r.circles) H.closed[k] = Math.max(H.closed[k] ?? 0, at + P.closed_weeks * twice);
    if (r.circles.length) events.push(`${r.circles.join(', ').replace(/^./, x => x.toUpperCase())} will not receive you for ${P.closed_weeks * twice} weeks, whatever you call yourself.`);
    this.st.log.push(`Turn ${this.st.turn}: ${r.name} blown`);
    // a Wheel on Nerve decides the Secret
    if (H.secret === 'kept') {
      const m = Math.max(-3, Math.min(4, H.attrs.Nerve - P.secret_diff));
      const p = odds(m), x = this.random();
      let k = 0, acc = 0; for (; k < 4; k++) { acc += p[k]; if (x < acc) break; }
      const seg = SEGMENTS[k];
      const out = seg === 'R' || seg === 'X';
      events.push(`Fortune’s Wheel, Nerve ${H.attrs.Nerve} against ${P.secret_diff}: ${SEGMENT_NAMES[seg]}. ${out ? 'The Secret is out.' : 'The Secret, for now, is kept.'}`);
      if (out) this.secretOut(events, at);
    }
  }
  /** The Origin's Secret comes out (Ruling 5): its cost, a letter, a chapter, and the Hook for a late reversal. */
  secretOut(events: string[], at = this.st.at) {
    const H = this.hero, so = this.origin.hero?.secret_out;
    if (H.secret === 'out') return;
    H.secret = 'out';
    this.st.log.push(`Turn ${this.st.turn}: the Secret is out`);
    if (!so) return;
    const chips: string[] = [];
    if (so.credit_rank && so.weeks) { H.lowCredit = { rank: so.credit_rank, until: at + so.weeks }; chips.push(`Credit as a ${so.credit_rank}, ${so.weeks} weeks`); }
    if (so.tag) { this.addTag(so.tag, events); chips.push('Tag: ' + so.tag); }
    if (so.hook) { H.hooks.push(this.fill(so.hook)); chips.push('New hook'); }
    this.tell(so.letter, so.story, at, 'secret', chips, events);
  }
  /** Each new year, the Hook a Secret left may pay off. */
  private newYear(at: number, events: string[]) {
    const H = this.hero, rv = this.origin.hero?.secret_out?.reversal;
    if (!rv) return;
    const i = H.hooks.findIndex(h => h.startsWith(rv.hook)); if (i < 0) return;
    if (this.random() >= rv.chance) return;
    H.hooks.splice(i, 1);
    const chips = ['Hook spent'];
    if (rv.true_rank && rankIndex(rv.true_rank) > rankIndex(H.trueRank)) {
      H.trueRank = rv.true_rank; chips.push(`True Rank: ${rv.true_rank}`);
      const own = H.records[H.styled];
      if (rankIndex(own.rank) < rankIndex(rv.true_rank)) own.rank = rv.true_rank;
      if (H.persona === H.styled) H.claimedRank = own.rank;
    }
    this.tell(rv.letter, rv.story, at, 'reversal', chips, events);
    this.st.log.push(`Turn ${this.st.turn}: the reversal`);
  }
  /** A letter delivered at once, and a chapter of the Story. */
  private tell(l: Told, w: Written, at: number, id: string, chips: string[], events: string[]) {
    const letter: Letter = { id, from: this.fill(l.from), text: this.fill(l.text), effect: chips.join(' · '), persona: this.hero.persona, at, venture: id, done: chips };
    this.lettersNow.push(letter);
    events.push(`A letter from ${letter.from.replace(/^The /, 'the ')}.`);
    this.st.story.push({ no: this.st.story.length + 1, venture: id, title: w.heading, heading: w.heading, passages: [{ sm: this.fill(w.sm), st: this.fill(w.st) }] });
  }
  /** Letters written by the engine this month, shown with the post. */
  private lettersNow: Letter[] = [];
  /** {name}-style slots, and [[glossary]] terms, in text the engine writes itself. */
  fill(src: string): string {
    const v: Record<string, unknown> = { ...nameVars(this.hero.names) };
    return src.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, t: string, sh?: string) => `<span class="cant" tabindex="0" role="button" data-t="${t.trim()}">${(sh ?? t).trim()}</span>`)
      .replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m));
  }
  /** The debts run up under each name never total more than the books hold. */
  private syncDebts() {
    const H = this.hero, recs = Object.values(H.records).filter(r => r.state !== 'sold');
    const total = recs.reduce((a, r) => a + r.debts, 0);
    if (total <= H.debts) return;
    let left = H.debts;
    recs.forEach((r, i) => { r.debts = i === recs.length - 1 ? left : Math.floor(r.debts * H.debts / total); left -= r.debts; });
  }

  // ----- humours and Reputation (Step 8) -----

  get hset() { return this.world.settings.humours; }
  affName(h: Humour) { return `Afflicted: ${this.hset.afflictions[h]}`; }
  afflicted(h: Humour) { return this.hero.conditions.includes(this.affName(h)); }
  /** The engine's own rise: +1, at most once per humour per turn. */
  private rise(h: Humour, why: string, events: string[]) {
    const H = this.hero, st = this.st; st.auto ??= {};
    if (st.auto[h]) return;
    st.auto[h] = true;
    if (H.hum[h] >= this.hset.peak) { st.raised[h] = true; return; }
    H.hum[h]++; st.raised[h] = true;
    events.push(`${why}: ${h} +1.`);
  }
  /** An Affliction begins at the peak and ends when the humour has fallen far enough. */
  updateAfflictions(events: string[]) {
    const H = this.hero, hs = this.hset;
    for (const h of HUMOURS) {
      const name = this.affName(h), has = H.conditions.includes(name);
      if (!has && H.hum[h] >= hs.peak) {
        H.conditions.push(name);
        events.push(`<b>${hs.afflictions[h]}.</b> ${AFFLICTION[h]}`);
        if (h === 'Sanguine' && H.living === 'pinching') H.living = 'claimed';
        this.st.log.push(`Turn ${this.st.turn}: afflicted, ${hs.afflictions[h]}`);
      } else if (has && H.hum[h] <= hs.relieved_at) {
        H.conditions = H.conditions.filter(c => c !== name);
        events.push(`${h} has fallen to ${H.hum[h]}: you are no longer ${hs.afflictions[h].toLowerCase()}.`);
      }
    }
  }

  /** One relief a turn: vice, religion, or a physician (Ruling 3). Returns what happened. */
  relieve(kind: 'vice' | 'religion' | 'physician', humour?: Humour): string {
    const H = this.hero, st = this.st, R = this.hset.relief, ev: string[] = [];
    if (st.relieved === st.turn) return 'You have sought relief once this month already.';
    let out = '';
    if (kind === 'vice') {
      const h: Humour = H.hum.Sanguine > H.hum.Choleric ? 'Sanguine' : 'Choleric';
      const cost = amt(this.world.settings.living[this.livingRank()]);
      if (H.purse < cost) return `A night of it costs ${money(cost)}; you have ${money(H.purse)}.`;
      H.purse -= cost; H.hum[h] = Math.max(0, H.hum[h] - R.vice.by);
      out = `A night at the tavern, and later at the bagnio, of which the less said the better. It costs ${money(cost)}. ${h} −${R.vice.by}.`;
      if (this.random() < R.vice.notoriety) { H.notoriety = Math.min(10, H.notoriety + 1); out += ' The watch took your name on the way home: Notoriety +1.'; }
    } else if (kind === 'religion') {
      const late = abs(R.religion.moorfields) <= st.at;
      H.hum.Melancholic = Math.max(0, H.hum.Melancholic - R.religion.by);
      this.addTag(R.religion.tag, ev);
      out = (late ? 'You stand in the crowd at Moorfields while a young clergyman preaches in the open air, and weep, and are comforted. '
        : H.confined ? 'You hear the chaplain read prayers in the prison chapel, and sit with him afterwards. '
        : 'You go to divine service, and afterwards the parson talks with you an hour. ')
        + `Melancholic −${R.religion.by}. The Church marks you down as ${R.religion.tag.replace(/ \(.*$/, '')}.`;
    } else {
      const h = humour ?? HUMOURS.reduce((a, b) => (H.hum[b] > H.hum[a] ? b : a));
      const fee = amt(R.physician.fee);
      if (H.purse < fee) return `The physician’s fee is ${money(fee)}; you have ${money(H.purse)}.`;
      H.purse -= fee;
      const m = Math.max(-3, Math.min(4, (H.attrs[R.physician.attr] ?? 0) - R.physician.diff));
      const p = odds(m), x = this.random(); let k = 0, acc = 0; for (; k < 4; k++) { acc += p[k]; if (x < acc) break; }
      const seg = SEGMENTS[k];
      out = `The physician takes his guinea. Fortune’s Wheel, ${R.physician.attr} ${H.attrs[R.physician.attr]} against ${R.physician.diff}: ${SEGMENT_NAMES[seg]}. `;
      if (seg === 'R') out += 'His draught does nothing whatever.';
      else if (seg === 'X') {
        H.hum[h] = Math.min(5, H.hum[h] + 1);
        if (!H.conditions.includes(R.physician.condition)) H.conditions.push(R.physician.condition);
        H.timed[R.physician.condition] = st.at + R.physician.weeks;
        out += `He bleeds you, and purges you, and you are worse: ${h} +1, and ${R.physician.condition.toLowerCase()} for a month.`;
      } else { H.hum[h] = Math.max(0, H.hum[h] - R.physician.by); out += `${h} −${R.physician.by}.`; }
    }
    st.relieved = st.turn;
    this.updateAfflictions(ev);
    st.log.push(`Turn ${st.turn}: relief (${kind})`);
    return [out, ...ev].join(' ').replace(/<[^>]+>/g, '');
  }

  // Tags: "Brave (the Underworld)"
  private parseTag(t: string) { const m = /^(.*) \((.+)\)$/.exec(t); return m ? { name: m[1], faction: m[2] } : { name: t, faction: '' }; }
  private lastsOf(name: string): number {
    const e = this.world.settings.tags.register[name], l = e?.lasts;
    return l === undefined ? this.world.settings.tags.lapse : typeof l === 'number' ? l : Infinity;
  }
  /** Gain or renew a Tag, with its opposite cancelled and the short list kept. */
  addTag(t: string, events: string[] = []) {
    const H = this.hero;
    if (!H.tags.includes(t)) H.tags.push(t);
    this.earnTags([t], events);
  }
  private earnTags(earned: string[], events: string[]) {
    const H = this.hero, T = this.world.settings.tags;
    for (const t of earned) {
      H.tagSince[t] = this.st.at;
      const { name, faction } = this.parseTag(t);
      const opp = T.register[name]?.opposite;
      if (opp) {
        const o = `${opp} (${faction})`;
        if (H.tags.includes(o)) { H.tags = H.tags.filter(x => x !== o); delete H.tagSince[o]; events.push(`${name} with ${faction}, so no longer ${opp}.`); }
      }
      if (!faction) continue;
      const mine = H.tags.filter(x => this.parseTag(x).faction === faction);
      while (mine.length > T.limit) {
        const old = mine.filter(x => x !== t).sort((a, b) => (H.tagSince[a] ?? 0) - (H.tagSince[b] ?? 0))[0];
        mine.splice(mine.indexOf(old), 1); H.tags = H.tags.filter(x => x !== old); delete H.tagSince[old];
        events.push(`${faction.replace(/^./, c => c.toUpperCase())} can only think of you in so many ways: ${this.parseTag(old).name} is forgotten.`);
      }
    }
  }
  /** Tags lapse a year after they were last earned (some never). */
  private lapseTags(at: number, events: string[]) {
    const H = this.hero;
    for (const t of [...H.tags]) {
      const since = H.tagSince[t] ?? (H.tagSince[t] = at);
      if (at - since >= this.lastsOf(this.parseTag(t).name)) {
        H.tags = H.tags.filter(x => x !== t); delete H.tagSince[t];
        const { name, faction } = this.parseTag(t);
        events.push(`${faction ? faction.replace(/^./, c => c.toUpperCase()) + ' has' : 'The Town has'} forgotten that you were ${name}.`);
      }
    }
  }
  /** Standing with a faction: the Tags it likes, less the ones it does not; the Town's count everywhere. */
  standing(f: string, tags = this.hero.tags): number {
    const reg = this.world.settings.tags.register;
    let n = 0;
    for (const t of tags) {
      const { name, faction } = this.parseTag(t);
      if (faction !== f && faction !== 'the Town') continue;
      const e = reg[name]; if (!e) continue;
      const good = (e.valence === 'good') !== !!e.except?.includes(f);
      n += good ? 1 : -1;
    }
    return n;
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
  setLiving(mode: 'claimed' | 'pinching'): string | null {
    if (mode === 'pinching' && this.afflicted('Sanguine')) return 'Prodigal: you cannot bring yourself to live below your rank.';
    this.hero.living = mode; return null;
  }
  setSide(side: 'common' | 'room') { if (this.hero.confined) this.hero.confined.side = side; }
}
