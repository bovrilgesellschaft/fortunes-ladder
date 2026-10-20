import type { NamePool, Names } from './names';
import type { EconomySettings, Slot } from './economy';

// Shapes of the content as the engine sees it, after the build has read the YAML.
// The YAML is checked against content/schema/venture.schema.json first; these types mirror it.

export type Segment = 'T' | 'S' | 'C' | 'R' | 'X';
export const SEGMENTS: Segment[] = ['T', 'S', 'C', 'R', 'X'];
export const SEGMENT_NAMES: Record<Segment, string> = {
  T: 'Triumph', S: 'Success', C: 'Success at a cost', R: 'Reversal', X: 'Catastrophe',
};

/** An amount: a number (pence, or points for a quality), a money string ("2s 6d", "20 guineas"),
 *  or an expression string starting with "=" ("= -floor(spoils / 2)"). */
export type Amount = number | string;

export type Effect =
  | { adj: string; by: Amount; why?: string }
  | { loot: Amount; why?: string }
  | { set: string | string[] }
  | { unset: string | string[] }
  | { calc: string; to: string }
  | { tag: string; why?: string }
  | { condition: string; why?: string }
  | { item: string; why?: string; quiet?: boolean }
  | { lose: string; why?: string }
  | { lose_matching: string; why?: string }
  | { hook: string; why?: string }
  | { unhook: string; why?: string }
  | { rumour: Rumour }
  /** Take up a Persona: the hero now passes under this name, with a fresh Exposure. */
  | { persona: string; why?: string }
  /** Pledge an item at a pawnbroker's for a loan; redeemable in the run's pawn tickets. */
  | { pledge: string; loan: Amount; why?: string }
  /** A note of hand: a gaming debt or a loan between gentlemen, owed to someone by name. */
  | { note: Amount; to: string; why?: string }
  | { when: string; then: Effect[]; else?: Effect[] };

export interface Rumour {
  id: string;
  /** Weeks after the Venture (1–3 by ruling). */
  delay?: number;
  /** An absolute calendar week; only for faithful copies of older content. */
  week?: number;
  from: string;
  text: string;
  /** What the letter does, as the player reads it: "Exposure +3 (Mrs Delacourt)". */
  effect: string;
  /** What it does to the hero on delivery. If left out, the engine reads simple effects
   *  ("Exposure +3", "Notoriety +1", "Celebrity −1") from the effect text. */
  on_delivery?: Effect[];
  /** A footnote in the Story's voice for this Venture's chapter, when the rumour lands (Step 9). */
  hindsight?: string;
  /** Whose talk it is (Step 7); defaults to the Venture's circle. */
  circle?: string;
}

/** A passage of the Story, in its one voice (ruled 20 October 2026). */
export type Passage = string;

export interface Outcome { effects?: Effect[]; text: string }

export interface Bonus { when?: string; by: number; why: string }

export interface Option {
  label: string;
  gate?: { when: string; need: string };
  cost?: string;
  /** What the option takes from the purse; locked if the purse cannot pay. Worked out from a
   *  certain option's effects when left out. */
  price?: Amount;
  withdraw?: boolean;
  check?: { attr: string; diff: number; bonus?: Bonus[] };
  dev?: string;
  /** A certain option. */
  do?: Outcome;
  /** A risky option: one outcome per Wheel segment. */
  outcomes?: Record<Segment, Outcome>;
  /** Story passages: per segment for risky options, M for a milestone on a certain one. */
  story?: Partial<Record<Segment | 'M', Passage>>;
  next: string | { when?: string; go: string }[];
}

export interface Beat {
  id: string;
  num: string;
  phase: string;
  title: string;
  sid: string;
  dev?: string;
  text: string;
  notes?: string[];
  ask: string;
  options: Option[];
}

export type Step = { do: Effect[]; when?: string } | { say: string; when?: string };

export interface Reckoning {
  num: string;
  phase: string;
  title: string;
  sid: string;
  dev?: string;
  steps: Step[];
  post: { some: string; none: string };
  upkeep: string;
  again: string;
  notes?: string[];
  finis: string;
}

export interface ChapterRules {
  no: string;
  opening: string;
  /** If this matches, its parts replace the rest. */
  special?: { when: string; parts: string[] };
  parts: { when: string; text: string }[];
  last: { when: string; text: string; else: string };
}

export interface HeroStart {
  purse: Amount;
  debts: Amount;
  /** Defaults to Nerve + 1 (ruling D2). */
  composure?: number;
  luck: number;
  exposure: number;
  notoriety: number;
  celebrity: number;
  attrs: Record<string, number>;
  hum: Record<string, number>;
  conditions?: string[];
  tags: string[];
  items: string[];
  hooks: string[];
}

/** A calendar date: year and week, 1–52. */
export interface When { year: number; week: number }

/** When and how often a Venture is offered in a run. A Venture without one is never offered. */
export interface Offer {
  /** A short line for the card the player chooses from. */
  blurb: string;
  /** The district, shown on the card. */
  district: string;
  /** A condition on the hero and the calendar (year, week, turn, origin, persona). */
  when?: string;
  /** Relative chance of being drawn; default 1. */
  weight?: number;
  /** May be offered again after it has been played. */
  repeat?: boolean;
  /** Offered only between these dates, inclusive. */
  from?: When;
  to?: When;
  /** Not offered: played at once as this Origin's arrival. */
  arrival?: boolean;
  /** The circle it is set in: playing it makes the Persona known there (Step 7). */
  circle?: string;
  /** The Claimed Rank it expects; below it, it is gate-crashed (Step 7). */
  rank?: Rank;
}

export interface Venture {
  id: string;
  title: string;
  /** The names its text uses ({given}, {alias}…) on the Venture's own page; a run supplies its own. */
  names?: Names;
  /** Other values its text uses on its own page, which a run supplies (the bailiff's writ, say). */
  sample?: Record<string, string | number>;
  /** A Venture the run starts itself (the bailiff, the prison), never offered. */
  system?: boolean;
  /** Test content: placeholder Ventures written to exercise the engine, to be kept, rewritten or dropped. */
  test?: boolean;
  offer?: Offer;
  /** Lent to the hero for this Venture only: given at the Approach, taken back after the Reckoning if still held. */
  kit?: { items: string[]; returned?: string[] };
  runhead: string;
  sub: string;
  prospectus: string;
  /** Calendar week of the Venture, 1–52. */
  week: number;
  year: number;
  loot_flag: string;
  /** Engine rules a Venture can switch off, e.g. for a faithful copy of older content. */
  rules?: { luck?: boolean };
  persona: string;
  who: { name: string; as: string; origin: string };
  start: HeroStart;
  first: string;
  chapter: ChapterRules;
  story?: { title: string; byline: string; preface: Passage; close: Passage };
  beats: Beat[];
  reckoning: Reckoning;
}

export interface GlossaryEntry { dictionary: 'cant' | 'town'; definition: string }

export interface Content { venture: Venture; glossary: Record<string, GlossaryEntry> }

export const RANKS = ['Vagabond', 'Servant', 'Tradesman', 'Gentleman', 'Esquire', 'Baronet or Knight', 'Peer'] as const;
export type Rank = typeof RANKS[number];
export type Room = 'garret' | 'room' | 'first floor';

/** An Origin: who the hero was before London. Only an available one can be played. */
export interface Origin {
  id: string;
  name: string;
  sex: 'man' | 'woman' | 'either';
  arrives: string;
  strengths: string;
  secret: string;
  available: boolean;
  /** The rest is needed only for an available Origin. */
  hero?: {
    /** What the hero's and the Persona's names are drawn from, afresh for each run. */
    names: NamePool;
    true_rank: Rank;
    claimed_rank: Rank;
    lodging: { district: string; room: Room };
    dress: Partial<Record<Slot, { tier: number; name: string }>>;
    start: HeroStart;
    /** The kind of Persona the drawn alias is (Step 7). */
    alias_kind?: string;
    /** What the Secret costs when it comes out, and its late reversal (Step 7). */
    secret_out?: SecretOut;
  };
  /** The arrival Venture, played in the first turn. */
  arrival?: string;
}

export interface Told { from: string; text: string }
export interface Written { heading: string; text: string }
export interface SecretOut {
  credit_rank?: Rank; weeks?: number; tag?: string; hook?: string;
  letter: Told; story: Written;
  reversal?: { hook: string; chance: number; true_rank?: Rank; letter: Told; story: Written };
}

/** A kind of Persona the hero may take up in town (Step 7). */
export interface PersonaKind {
  id: string; name: string; rank: Rank; sex: 'man' | 'woman' | 'either';
  needs: string; test?: string; cost: Amount; home: string[];
  titles: Partial<Record<'man' | 'woman', { long: string; short: string }[]>>;
  surnames: string[]; claims: string[];
}
export interface PersonaSettings {
  limit: number; cool_weeks: number; closed_weeks: number;
  blown_celebrity: number; secret_diff: number;
  scandal: { celebrity: number; notoriety: number };
  sale: { min: Amount; max: Amount; named_from: number; named_to: number; named_exposure: number };
  kinds: PersonaKind[];
}

export type Humour = 'Sanguine' | 'Choleric' | 'Melancholic' | 'Phlegmatic';
export interface HumourSettings {
  peak: number; relieved_at: number;
  afflictions: Record<Humour, string>;
  prodigal_upkeep: number; torpid_offers: number; quarrel: string;
  rises: { spoils: Amount; loss: Amount };
  relief: {
    vice: { by: number; notoriety: number };
    religion: { by: number; tag: string; moorfields: When };
    physician: { by: number; fee: Amount; attr: string; diff: number; condition: string; weeks: number };
  };
}
export interface TagEntry { valence: 'good' | 'bad'; except?: string[]; opposite?: string; lasts?: number | string }
export interface TagSettings { limit: number; lapse: number; register: Record<string, TagEntry> }

export interface Settings {
  living: Record<Rank, Amount>;
  lodging: Record<string, Amount>;
  room: Record<Room, number>;
  /** Weeks in a turn (ruling: four). */
  turn_weeks: number;
  /** The run's start date when none is chosen; null = a random week in the range. */
  start?: When | null;
  start_range: { from: number; to: number };
  economy: EconomySettings;
  personas: PersonaSettings;
  /** The nine factions and the Town (Step 8): Reputation, and the circles where a name is known. */
  factions: string[];
  humours: HumourSettings;
  tags: TagSettings;
  score: { celebrity: number; climbed: number; fallen: number; altered: number; endings: Record<Ending, number>; ruin_weeks: number; last_year: number };
}

export type Mood = 'mockheroic' | 'easy' | 'rueful' | 'moralising';
export type Ending = 'apotheosis' | 'retirement' | 'ruin' | 'transportation' | 'death';
export interface StoryVariant { text: string; mood?: Mood }
export interface StoryWords {
  books: Record<'I' | 'II' | 'III', { title: string; opening: string; again: string }>;
  milestones: Record<string, { heading: string; variants: StoryVariant[] }>;
  connectives: { text: string; gap?: 'next' | 'months' | 'year'; season?: 'spring' | 'summer' | 'autumn' | 'winter' | 'frost'; moved?: boolean; mood?: Mood }[];
  endings: Record<Ending, { framing: string; closing: string; dedication: string }> & { calendar: string };
  dedication_public: string; subtitles: string[]; imprint: string; hindsight_editor: string; subscribers: string[];
}

/** Everything a run page needs. */
export interface World {
  /** The Story's own words (Step 9). */
  story: StoryWords;
  ventures: Venture[];
  origins: Origin[];
  settings: Settings;
  glossary: Record<string, GlossaryEntry>;
}
