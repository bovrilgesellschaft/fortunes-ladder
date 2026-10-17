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
  | { when: string; then: Effect[]; else?: Effect[] };

export interface Rumour {
  id: string;
  /** Weeks after the Venture (1–3 by ruling). */
  delay?: number;
  /** An absolute calendar week; only for faithful copies of older content. */
  week?: number;
  from: string;
  text: string;
  effect: string;
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

export interface Venture {
  id: string;
  title: string;
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
