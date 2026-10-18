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

export const SAVE_VERSION = 1;
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
  purse: number; debts: number; luck: number; notoriety: number; celebrity: number;
  attrs: Record<string, number>; hum: Record<string, number>;
  conditions: string[]; tags: string[]; items: string[]; hooks: string[];
  /** The name the hero passes under now; the styled true name when there is no Persona. */
  persona: string;
  /** Exposure by Persona. */
  personas: Record<string, number>;
  trueRank: Rank; claimedRank: Rank;
  lodging: { district: string; room: Room };
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
export interface Bills { weeks: WeekBill[]; cooled: string[]; total: number; owed: number }

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
  }

  static begin(world: World, originId: string, seed: number, start?: When | null): Campaign {
    const o = world.origins.find(x => x.id === originId);
    if (!o || !o.available || !o.hero) throw new Error(`Origin “${originId}” cannot be played yet`);
    const rng = new Rng(seed);
    const s = start ?? world.settings.start ?? null;
    const at = s ? abs(s) : abs({ year: rng.int(world.settings.start_range.from, world.settings.start_range.to), week: rng.int(1, 52) });
    const h = o.hero, x = h.start;
    const amt = (a: number | string) => (typeof a === 'number' ? a : parseMoney(a));
    const hero: Hero = {
      name: h.name, styled: h.styled, origin: o.id, sex: o.sex === 'woman' ? 'woman' : 'man', history: h.history,
      purse: amt(x.purse), debts: amt(x.debts), luck: x.luck, notoriety: x.notoriety, celebrity: x.celebrity,
      attrs: { ...x.attrs }, hum: { ...x.hum }, conditions: [...(x.conditions ?? [])], tags: [...x.tags], items: [...x.items], hooks: [...x.hooks],
      persona: h.styled, personas: { [h.styled]: x.exposure },
      trueRank: h.true_rank, claimedRank: h.claimed_rank, lodging: { ...h.lodging },
    };
    const st: CampaignState = {
      v: SAVE_VERSION, seed, rng: rng.state, hero, at, turn: 1, phase: 'town', offers: [], played: {},
      post: [], news: [], story: [], raised: {}, log: [],
    };
    const c = new Campaign(world, st);
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

  extra() {
    const d = this.date();
    return { year: d.year, week: d.week, turn: this.st.turn, origin: this.hero.origin };
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
      if (!o || o.arrival) return false;
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
      hero: seed, at: c.at, extra: this.extra(), played: (x) => !!this.st.played[x],
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
      purse: S.purse, debts: S.debts, luck: S.luck, notoriety: S.notoriety, celebrity: S.celebrity,
      attrs: { ...S.attrs }, hum: { ...S.hum }, conditions: [...S.conditions], tags: [...S.tags], items: [...S.items], hooks: [...S.hooks],
    });
    H.persona = S.persona; H.personas[S.persona] = S.exposure;
    // a purse spent below nothing is a debt (until Step 6 gates costs on the purse)
    if (H.purse < 0) { H.debts += -H.purse; this.st.log.push(`Turn ${this.st.turn}: ${money(-H.purse)} overspent, owed`); H.purse = 0; }
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

  // ----- the bills -----

  weeklyUpkeep(): number {
    const s = this.world.settings, H = this.hero;
    const amt = (a: number | string) => (typeof a === 'number' ? a : parseMoney(a));
    const living = amt(s.living[H.claimedRank]);
    const room = Math.round(amt(s.lodging[H.lodging.district]) * s.room[H.lodging.room]);
    return living + room;
  }

  private settle() {
    const H = this.hero, s = this.world.settings, weeks: WeekBill[] = [];
    let total = 0, owedAll = 0;
    for (let i = 0; i < s.turn_weeks; i++) {
      const at = this.st.at + i;
      const up = this.weeklyUpkeep();
      const paid = Math.min(up, Math.max(0, H.purse)), owed = up - paid;
      H.purse -= paid; H.debts += owed; total += up; owedAll += owed;
      const due = this.st.post.filter(r => r.at <= at);
      this.st.post = this.st.post.filter(r => r.at > at);
      for (const r of due) { r.done = this.deliver(r); }
      weeks.push({ at, upkeep: up, paid, owed, letters: due });
    }
    // humours not raised this turn cool by 1, down to 1 (systems spec, Proposed)
    const cooled: string[] = [];
    for (const k of Object.keys(H.hum)) {
      if (!this.st.raised[k] && H.hum[k] > 1) { H.hum[k]--; cooled.push(k); }
    }
    this.st.raised = {};
    this.st.news = weeks.flatMap(w => w.letters);
    this.st.bills = { weeks, cooled, total, owed: owedAll };
    this.st.phase = 'bills';
  }

  /** Apply a letter's effect to the hero; returns chips describing what it did. */
  deliver(r: Letter): string[] {
    const H = this.hero, done: string[] = [];
    const bump = (k: string, d: number) => {
      if (k === 'exposure') {
        const p = r.persona; const [lo, hi] = LIM.exposure;
        H.personas[p] = Math.max(lo, Math.min(hi, (H.personas[p] ?? 0) + d));
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

  /** From the bills to the next turn. */
  nextTurn() {
    this.st.at += this.world.settings.turn_weeks;
    this.st.turn++;
    this.st.bills = undefined;
    this.st.phase = 'town';
    this.drawOffers();
  }

  // ----- in the town -----

  /** Moving lodgings delays every rumour in the post by a week (systems spec, Proposed). */
  move(district: string, room: Room) {
    const H = this.hero;
    if (H.lodging.district === district && H.lodging.room === room) return;
    H.lodging = { district, room };
    for (const r of this.st.post) r.at += 1;
    this.st.log.push(`Turn ${this.st.turn}: moved to a ${room} in ${district}`);
  }

  retire() { this.st.phase = 'ended'; this.st.ended = { how: 'Retirement', at: this.st.at }; }
}
