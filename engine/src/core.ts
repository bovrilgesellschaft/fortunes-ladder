// The headless core of a Venture: state, effects, gates, the Wheel's odds, outcomes,
// the Reckoning and the chapter heading. No DOM here, so it runs in a page or in a test.

import { compile, evaluate, type Fn } from './expr';
import type {
  Amount, Beat, Content, Effect, GlossaryEntry, Option, Passage, Rumour, Segment, Venture,
} from './types';
import { RANKS, SEGMENT_NAMES, type Rank } from './types';
import { nameVars } from './names';

export interface Chip { t: string; tone: 'good' | 'bad' | 'neu' }

export interface State {
  purse: number; debts: number; composure: number; luck: number;
  exposure: number; notoriety: number; celebrity: number;
  attrs: Record<string, number>; hum: Record<string, number>;
  conditions: string[]; tags: string[]; items: string[]; hooks: string[];
  flags: Record<string, number>; log: string[]; rumours: (Rumour & { week: number; persona: string })[];
  spoils: number; story: { text: string; fresh?: boolean }[]; storyAdded: boolean;
  /** The name the hero passes under in this Venture. */
  persona: string;
  /** Pledged and noted during the Venture, for the run to keep. */
  pledges: { item: string; loan: number }[];
  notes: { to: string; amount: number }[];
  /** Every Tag earned in the Venture, including ones already held (a renewal, Step 8). */
  earned: string[];
}

/** The hero a Venture starts from, when it is played inside a run rather than on its own page. */
export interface HeroSeed {
  purse: number; debts: number; luck: number; exposure: number; notoriety: number; celebrity: number;
  attrs: Record<string, number>; hum: Record<string, number>;
  conditions: string[]; tags: string[]; items: string[]; hooks: string[];
  persona: string;
}

export interface RunOpts {
  hero?: HeroSeed;
  /** The week number rumour delays count from (a run's absolute week); default the Venture's week. */
  at?: number;
  /** Extra names for conditions and text: year, week, turn, origin. */
  extra?: Record<string, unknown>;
  /** Whether a Venture has been played in this run. */
  played?: (id: string) => boolean;
  /** Added to every Exposure gain, with the reasons (shabby, pinching, a claim far above the truth). */
  exposureExtra?: { by: number; why: string };
  /** In a run: the Exposure a Persona already has, if the hero has worn it before (Step 7). */
  exposureOf?: (persona: string) => number | undefined;
  /** In a run: the Exposure a new Persona starts at (1, +1 per rank claimed above the truth). */
  newExposure?: number;
  // ----- the Afflictions (Step 8) -----
  /** Prodigal: certain costed options cost double. */
  prodigal?: boolean;
  /** Quarrelsome: every Withdraw at the Crisis is locked, for this reason. */
  noWithdraw?: string;
  /** Torpid: locked lures are not shown. */
  hideLures?: boolean;
  /** Standing with a faction, worked out from the Tag register (Step 8). */
  standing?: (faction: string) => number;
}

const LIM: Record<string, [number, number]> = { composure: [0, 8], exposure: [0, 10], luck: [0, 3], celebrity: [0, 10], notoriety: [0, 10] };
const NAME: Record<string, string> = { purse: 'Purse', debts: 'Debts', composure: 'Composure', luck: 'Luck', exposure: 'Exposure', notoriety: 'Notoriety', celebrity: 'Celebrity' };
export const UPGOOD: Record<string, number> = { purse: 1, composure: 1, luck: 1, celebrity: 1, debts: -1, exposure: -1, notoriety: -1 };

// ---------- money ----------

export function money(p: number): string {
  const n = p < 0; p = Math.abs(p);
  const L = Math.floor(p / 240), s = Math.floor(p % 240 / 12), d = p % 12;
  const a: string[] = [];
  if (L) a.push('£' + L); if (s) a.push(s + 's'); if (d) a.push(d + 'd');
  return (n ? '−' : '') + (a.join(' ') || 'nothing');
}

/** "£3 4s 6d", "2s 6d", "20 guineas", "-5s" → pence. */
export function parseMoney(src: string): number {
  const s = src.trim();
  const neg = /^[-−]/.test(s);
  const body = s.replace(/^[-−+]\s*/, '');
  const re = /£\s*(\d+)|(\d+)\s*(guineas?|s|d)\b/g;
  let m: RegExpExecArray | null, total = 0, any = false, used = '';
  while ((m = re.exec(body))) {
    any = true; used += m[0];
    if (m[1] !== undefined) total += +m[1] * 240;
    else if (m[3].startsWith('guinea')) total += +m[2] * 252;
    else if (m[3] === 's') total += +m[2] * 12;
    else total += +m[2];
  }
  if (!any || body.replace(re, '').trim() !== '') throw new Error(`Not a sum of money: “${src}”`);
  return neg ? -total : total;
}

export const sgn = (n: number) => (n > 0 ? '+' + n : '−' + Math.abs(n));

// ---------- the Wheel ----------

export function odds(m: number): number[] {
  const w = [10 + 5 * m, 30 + 5 * m, 25, 25 - 5 * m, 10 - 5 * m].map(x => Math.max(3, x));
  const t = w.reduce((a, b) => a + b, 0);
  return w.map(x => x / t);
}

// ---------- a run of one Venture ----------

export class Run {
  S!: State;
  START!: State;
  fx: Chip[] = [];
  readonly v: Venture;
  readonly glossary: Record<string, GlossaryEntry>;
  readonly beats: Record<string, Beat>;
  readonly fns: Record<string, Fn>;

  readonly opts: RunOpts;
  /** The Crisis beats' options, where a Quarrelsome hero cannot withdraw. */
  private crisis = new Set<Option>();

  constructor(content: Content, opts: RunOpts = {}) {
    this.opts = opts;
    this.v = content.venture;
    this.glossary = content.glossary;
    this.beats = Object.fromEntries(this.v.beats.map(b => [b.id, b]));
    const S = () => this.S;
    this.fns = {
      money: (p) => money(p as number),
      floor: (x) => Math.floor(x as number),
      ceil: (x) => Math.ceil(x as number),
      min: (...a) => Math.min(...(a as number[])),
      max: (...a) => Math.max(...(a as number[])),
      has_item: (t) => S().items.includes(t as string),
      has_item_like: (t) => S().items.some(i => i.includes(t as string)),
      has_hook: (p) => S().hooks.some(h => h.startsWith(p as string)),
      has_condition: (p) => S().conditions.some(h => h.startsWith(p as string)),
      has_tag: (p) => S().tags.some(h => h.startsWith(p as string)),
      rumour_says: (w) => S().rumours.some(r => r.effect.includes(w as string)),
      has_persona: (p) => S().persona.startsWith(p as string),
      played: (id) => !!this.opts.played?.(id as string),
      // the false self (Step 7): read from the run's values, or the Venture's sample on its own page
      rank_at_least: (r) => RANKS.indexOf(String(this.scope().claimed_rank ?? 'Gentleman') as Rank) >= RANKS.indexOf(r as Rank),
      known_in: (k) => String(this.scope().circles_known ?? '').split(', ').includes(k as string),
      // Reputation (Step 8): a Tag held with a faction, or with the Town, which counts everywhere
      has_tag_in: (t, f) => S().tags.some(x => x.startsWith(`${t} (`) && (x.endsWith(`(${f})`) || x.endsWith('(the Town)'))),
      standing: (f) => this.opts.standing?.(f as string) ?? 0,
    };
    for (const b of this.v.beats) if (b.phase === 'The Crisis') for (const o of b.options) this.crisis.add(o);
    this.start();
  }

  start() {
    const h = this.v.start, o = this.opts.hero;
    this.S = o
      ? {
        purse: o.purse, debts: o.debts, composure: o.attrs.Nerve + 1, luck: o.luck,
        exposure: o.exposure, notoriety: o.notoriety, celebrity: o.celebrity,
        attrs: { ...o.attrs }, hum: { ...o.hum }, conditions: [...o.conditions], tags: [...o.tags], items: [...o.items], hooks: [...o.hooks],
        flags: {}, log: [], rumours: [], spoils: 0, story: [], storyAdded: false, persona: o.persona, pledges: [], notes: [], earned: [],
      }
      : {
        purse: this.amount(h.purse), debts: this.amount(h.debts), composure: h.composure ?? h.attrs.Nerve + 1, luck: h.luck,
        exposure: h.exposure, notoriety: h.notoriety, celebrity: h.celebrity,
        attrs: { ...h.attrs }, hum: { ...h.hum }, conditions: [...(h.conditions ?? [])], tags: [...h.tags], items: [...h.items], hooks: [...h.hooks],
        flags: {}, log: [], rumours: [], spoils: 0, story: [], storyAdded: false, persona: this.v.persona, pledges: [], notes: [], earned: [],
      };
    // a kit is lent for the Venture: in a run the hero may not own it yet
    for (const it of this.v.kit?.items ?? []) if (!this.S.items.includes(it)) this.S.items.push(it);
    this.START = JSON.parse(JSON.stringify(this.S));
    this.fx = [];
  }

  // ----- expressions and text -----

  scope() {
    const x = this.opts.extra ?? { year: this.v.year, week: this.v.week, turn: 0, origin: '', ...(this.v.names ? nameVars(this.v.names) : {}), ...(this.v.sample ?? {}) };
    return { ...x, ...this.S, start: this.START } as Record<string, unknown>;
  }

  eval(src: string): unknown { return evaluate(compile(src), this.scope(), this.fns); }
  test(src?: string): boolean { return src === undefined ? true : !!this.eval(src); }

  amount(a: Amount): number {
    if (typeof a === 'number') return a;
    if (a.trim().startsWith('=')) return Number(this.eval(a.trim().slice(1)));
    return parseMoney(a);
  }

  cant(term: string, shown?: string) {
    return `<span class="cant" tabindex="0" role="button" data-t="${term}">${shown || term}</span>`;
  }

  /** Inline template: [[term]] [[term|shown]] {fn *} {if x}…{else}…{end} {expr}. */
  inline(src: string): string {
    let out = '';
    const stack: { live: boolean; done: boolean; parent: boolean }[] = [];
    const live = () => stack.every(f => f.live);
    const re = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|\{([^{}]*)\}/g;
    let last = 0, m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      if (live()) out += src.slice(last, m.index);
      last = re.lastIndex;
      if (m[1] !== undefined) { if (live()) out += this.cant(m[1].trim(), m[2]?.trim()); continue; }
      const tag = m[3].trim();
      if (tag.startsWith('if ')) {
        const parent = live();
        const ok = parent && this.test(tag.slice(3));
        stack.push({ live: ok, done: ok, parent });
      } else if (tag === 'else') {
        const f = stack.at(-1); if (!f) throw new Error(`{else} without {if} in: ${src}`);
        f.live = f.parent && !f.done; f.done = true;
      } else if (tag.startsWith('elif ')) {
        const f = stack.at(-1); if (!f) throw new Error(`{elif} without {if} in: ${src}`);
        const ok = f.parent && !f.done && this.test(tag.slice(5));
        f.live = ok; if (ok) f.done = true;
      } else if (tag === 'end') {
        if (!stack.pop()) throw new Error(`{end} without {if} in: ${src}`);
      } else if (tag.startsWith('fn ')) {
        if (live()) out += `<sup class="fn">${tag.slice(3).trim()}</sup>`;
      } else if (live()) {
        out += String(this.eval(tag));
      }
    }
    if (stack.length) throw new Error(`{if} without {end} in: ${src}`);
    out += src.slice(last);
    return out;
  }

  /** Paragraphs separated by blank lines; a paragraph that renders empty is dropped. */
  prose(src: string): string {
    return src.trim().split(/\n\s*\n/)
      .map(p => this.inline(p.replace(/\s*\n\s*/g, ' ')).trim())
      .filter(p => p.length)
      .map(p => `<p>${p}</p>`).join('');
  }

  // ----- effects (the prototypes' adj, loot, tag, item, lose, hook, unhook, rumour) -----

  adj(path: string, d: number, why: string) {
    if (!d) return;
    const xx = this.opts.exposureExtra;
    if (path === 'exposure' && d > 0 && xx?.by) { d += xx.by; why += ` (+${xx.by}: ${xx.why})`; }
    const S = this.S as unknown as Record<string, any>;
    const [a, b] = path.split('.');
    if (b) S[a][b] = Math.max(0, Math.min(5, S[a][b] + d));
    else { let v = S[a] + d; if (LIM[a]) v = Math.max(LIM[a][0], Math.min(LIM[a][1], v)); S[a] = v; }
    const nm = b || NAME[a]; const isM = a === 'purse' || a === 'debts';
    const tone = b ? (a === 'hum' ? 'neu' : (d > 0 ? 'good' : 'bad')) : ((UPGOOD[a] || 0) * d > 0 ? 'good' : 'bad');
    const txt = `${nm} ${isM ? (d > 0 ? '+' : '−') + money(Math.abs(d)) : sgn(d)}`;
    this.fx.push({ t: txt, tone });
    this.S.log.push(`${txt} — ${why}`);
  }

  apply(effects: Effect[] | undefined) {
    if (!effects) return;
    const S = this.S;
    for (const e of effects) {
      if ('adj' in e) this.adj(e.adj, this.amount(e.by), e.why ?? '');
      else if ('loot' in e) { const p = this.amount(e.loot); this.adj('purse', p, e.why ?? ''); S.spoils += p; S.flags[this.v.loot_flag] = 1; }
      else if ('set' in e) ([] as string[]).concat(e.set).forEach(f => (S.flags[f] = 1));
      else if ('unset' in e) ([] as string[]).concat(e.unset).forEach(f => (S.flags[f] = 0));
      else if ('calc' in e) { const v = Number(this.eval(e.to)); if (e.calc.startsWith('flags.')) S.flags[e.calc.slice(6)] = v; else (S as any)[e.calc] = v; }
      else if ('tag' in e) { S.earned.push(e.tag); if (!S.tags.includes(e.tag)) { S.tags.push(e.tag); this.fx.push({ t: 'Tag: ' + e.tag, tone: 'neu' }); S.log.push(`Tag gained: ${e.tag} — ${e.why ?? ''}`); } }
      else if ('condition' in e) { if (!S.conditions.includes(e.condition)) { S.conditions.push(e.condition); this.fx.push({ t: 'Condition: ' + e.condition, tone: 'bad' }); S.log.push(`Condition: ${e.condition} — ${e.why ?? ''}`); } }
      else if ('item' in e) { S.items.push(e.item); if (!e.quiet) { this.fx.push({ t: 'Gained: ' + e.item.split(',')[0], tone: 'good' }); S.log.push(`Item gained: ${e.item} — ${e.why ?? ''}`); } }
      else if ('lose' in e) this.lose(e.lose, e.why ?? '');
      else if ('lose_matching' in e) this.lose(S.items.find(i => i.includes(e.lose_matching)), e.why ?? '');
      else if ('hook' in e) { S.hooks.push(e.hook); this.fx.push({ t: 'New hook', tone: 'neu' }); S.log.push(`Hook: ${e.hook} — ${e.why ?? ''}`); }
      else if ('unhook' in e) {
        const i = S.hooks.findIndex(h => h.startsWith(e.unhook));
        if (i > -1) { S.log.push(`Hook spent: ${S.hooks[i]} — ${e.why ?? ''}`); S.hooks.splice(i, 1); this.fx.push({ t: 'Hook spent', tone: 'bad' }); }
      }
      else if ('rumour' in e) this.rumour(e.rumour);
      else if ('pledge' in e) {
        const i = S.items.indexOf(e.pledge);
        if (i > -1) {
          const loan = this.amount(e.loan);
          S.items.splice(i, 1); S.pledges.push({ item: e.pledge, loan });
          this.adj('purse', loan, e.why ?? 'a pledge');
          this.fx.push({ t: 'Pledged: ' + e.pledge.split(',')[0], tone: 'bad' }); S.log.push(`Pledged: ${e.pledge} for ${money(loan)}`);
        }
      }
      else if ('note' in e) {
        const amount = this.amount(e.note), to = this.inline(e.to);
        S.notes.push({ to, amount });
        this.fx.push({ t: `Note of hand ${money(amount)}`, tone: 'bad' }); S.log.push(`Note of hand: ${money(amount)} to ${to} — ${e.why ?? ''}`);
      }
      else if ('persona' in e) {
        // "= alias": the run's drawn Persona name; otherwise the name as written
        const p = e.persona.trim().startsWith('=') ? String(this.eval(e.persona.trim().slice(1))) : e.persona;
        if (S.persona !== p) {
          S.persona = p; S.exposure = this.opts.exposureOf?.(p) ?? this.opts.newExposure ?? 1;
          this.fx.push({ t: 'Persona: ' + p, tone: 'neu' }); S.log.push(`Persona taken up: ${p}, Exposure ${S.exposure} — ${e.why ?? ''}`);
        }
      }
      else if ('when' in e) this.apply(this.test(e.when) ? e.then : e.else);
    }
  }

  lose(t: string | undefined, why: string) {
    const i = t === undefined ? -1 : this.S.items.indexOf(t);
    if (i > -1) { this.S.items.splice(i, 1); this.fx.push({ t: 'Lost: ' + t!.split(',')[0], tone: 'bad' }); this.S.log.push(`Item lost: ${t} — ${why}`); }
  }

  rumour(r: Rumour) {
    const S = this.S;
    if (S.rumours.some(x => x.id === r.id)) return;
    const week = r.week ?? (this.opts.at ?? this.v.week) + (r.delay ?? 1);
    const q = { ...r, week, text: this.inline(r.text), effect: this.inline(r.effect), from: this.inline(r.from), persona: S.persona };
    S.rumours.push(q);
    this.fx.push({ t: 'A rumour is abroad', tone: 'bad' });
    S.log.push(`Rumour queued (week ${week}): ${r.from} — ${r.effect}`);
  }

  addStory(p: Passage) {
    const S = this.S;
    const ink = (x: Passage) => ({ text: this.inline(x), fresh: true });
    if (!S.story.length && this.v.story) S.story.push(ink(this.v.story.preface));
    S.story.push(ink(p)); S.storyAdded = true;
    this.fx.push({ t: '❧ The Story is enlarged', tone: 'neu' }); S.log.push('Story passage written');
  }

  // ----- options -----

  gate(o: Option) { return o.gate ? { ok: this.test(o.gate.when), need: this.inline(o.gate.need) } : { ok: true, need: '' }; }

  /** What the option takes from the purse: its price, or a certain option's plain purse costs. */
  price(o: Option): number {
    if (o.price !== undefined) return this.amount(o.price);
    let p = 0;
    for (const e of o.do?.effects ?? []) {
      if ('adj' in e && e.adj === 'purse' && !(typeof e.by === 'string' && e.by.trim().startsWith('='))) {
        const d = this.amount(e.by); if (d < 0) p -= d;
      }
    }
    return p;
  }
  /** What it will actually take: double, for a Prodigal on a certain option (Step 8). */
  cost(o: Option): number { return this.price(o) * (this.opts.prodigal && o.do ? 2 : 1); }
  /** A costed option the purse cannot pay is locked (ruling, Step 6). */
  affordable(o: Option) { return this.cost(o) <= Math.max(0, this.S.purse); }
  /** Why an option is barred by an Affliction, or ''. */
  barred(o: Option): string { return this.opts.noWithdraw && o.withdraw && this.crisis.has(o) ? this.opts.noWithdraw : ''; }
  /** A lure: shown locked, with no outcome; hidden from a Torpid hero. */
  hidden(o: Option) { return !!this.opts.hideLures && !o.do && !o.check; }
  locked(o: Option) { return !this.gate(o).ok || (!o.do && !o.check) || !this.affordable(o) || !!this.barred(o); }

  margin(o: Option) {
    const ch = o.check!;
    let b = 0; const why: string[] = [];
    for (const x of ch.bonus ?? []) if (this.test(x.when)) { b += x.by; why.push(x.why); }
    const comp = this.S.composure <= 0 ? -2 : 0;
    const m = Math.max(-3, Math.min(4, this.S.attrs[ch.attr] + b - ch.diff + comp));
    return { m, b, why: why.join(', '), comp };
  }

  next(o: Option): string {
    if (typeof o.next === 'string') return o.next;
    for (const n of o.next) if (this.test(n.when)) return n.go;
    throw new Error('No route matches');
  }

  /** Resolve an option; seg is required for a Wheel check. Returns the outcome HTML. */
  resolve(o: Option, seg?: Segment): { html: string; next: string; story: boolean } {
    this.fx = [];
    let html: string, story: Passage | undefined;
    if (o.check) {
      if (!seg) throw new Error('A Wheel check needs a segment');
      const m = this.margin(o).m;
      const out = o.outcomes![seg];
      this.apply(out.effects); html = this.prose(out.text);
      story = o.story?.[seg];
      // Ruling D6: a Catastrophe at odds where Success or better was more likely than not
      // (margin −1 or above) earns a point of Luck.
      if (seg === 'X' && m >= -1 && this.v.rules?.luck !== false) this.adj('luck', 1, 'Fortune owes you one');
    } else {
      this.apply(o.do!.effects); html = this.prose(o.do!.text);
      if (this.opts.prodigal && this.price(o) > 0) this.adj('purse', -this.price(o), 'Prodigal: paid twice over');
      story = o.story?.M;
    }
    if (story) this.addStory(story);
    return { html, next: this.next(o), story: !!story };
  }

  /** Spend a point of Luck to move the result up one segment (applied before resolve). */
  spendLuck() { this.fx = this.fx || []; this.adj('luck', -1, 'a nudge to the Wheel'); }

  // ----- the Reckoning -----

  reckon(): { html: string; chapter: string } {
    this.fx = [];
    const lines: string[] = [];
    for (const s of this.v.reckoning.steps) {
      if (!this.test(s.when)) continue;
      if ('do' in s) this.apply(s.do);
      else lines.push(this.prose(s.say));
    }
    if (this.v.story && this.S.story.length) this.S.story.push({ text: this.inline(this.v.story.close), fresh: true });
    const chapter = this.chapter();
    for (const it of this.v.kit?.returned ?? []) {
      const i = this.S.items.indexOf(it);
      if (i > -1) { this.S.items.splice(i, 1); this.S.log.push(`Returned: ${it}`); }
    }
    return { html: lines.join(''), chapter };
  }

  chapter(): string {
    const c = this.v.chapter;
    const p = [c.opening];
    if (c.special && this.test(c.special.when)) p.push(...c.special.parts);
    else {
      for (const x of c.parts) if (this.test(x.when)) p.push(x.text);
      p.push(this.test(c.last.when) ? c.last.text : c.last.else);
    }
    return p.length > 1 ? p.slice(0, -1).join('; ') + '; and ' + p.at(-1) + '.' : p[0] + '.';
  }

  segmentName(s: Segment) { return SEGMENT_NAMES[s]; }
}
