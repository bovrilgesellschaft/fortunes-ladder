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
}

export interface Passage { sm: string; st: string }

export interface Outcome { effects?: Effect[]; text: string }

export interface Bonus { when?: string; by: number; why: string }

export interface Option {
  label: string;
  gate?: { when: string; need: string };
  cost?: string;
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
}

export interface Venture {
  id: string;
  title: string;
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
    name: string;
    /** "Mr Byrne": how the Town addresses the hero under the true name. */
    styled: string;
    /** The History's title in the Story tab. */
    history: string;
    true_rank: Rank;
    claimed_rank: Rank;
    lodging: { district: string; room: Room };
    start: HeroStart;
  };
  /** The arrival Venture, played in the first turn. */
  arrival?: string;
}

export interface Settings {
  living: Record<Rank, Amount>;
  lodging: Record<string, Amount>;
  room: Record<Room, number>;
  /** Weeks in a turn (ruling: four). */
  turn_weeks: number;
  /** The run's start date when none is chosen; null = a random week in the range. */
  start?: When | null;
  start_range: { from: number; to: number };
}

/** Everything a run page needs. */
export interface World {
  ventures: Venture[];
  origins: Origin[];
  settings: Settings;
  glossary: Record<string, GlossaryEntry>;
}
