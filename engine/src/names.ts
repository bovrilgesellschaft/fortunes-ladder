// Names: the hero's and the Persona's, drawn for each run so that runs can be told apart.
// Text uses them as {given}, {surname}, {name}, {styled}, {county}, {alias}, {alias_long},
// {alias_title}, {alias_title_lc}, {alias_surname} and {alias_claim}.

import { Rng } from './rng';

/** One run's names. */
export interface Names {
  given: string; surname: string; county: string;
  /** "Captain", and its short form "Capt." */
  title: string; short_title: string;
  alias_surname: string;
  /** "late of the Imperial service" */
  claim: string;
  sex?: 'man' | 'woman';
}

/** What an Origin's names are drawn from. */
export interface NamePool {
  given: string[]; surname: string[]; county: string[];
  alias: { title: { long: string; short: string }[]; surname: string[]; claim: string[] };
}

/** The names as text sees them. */
export function nameVars(n: Names): Record<string, string> {
  const w = n.sex === 'woman';
  const styled = `${w ? 'Mrs' : 'Mr'} ${n.surname}`;
  return {
    given: n.given, surname: n.surname, name: `${n.given} ${n.surname}`, styled, county: n.county,
    alias: `${n.short_title} ${n.alias_surname}`, alias_long: `${n.title} ${n.alias_surname}`,
    alias_title: n.title, alias_title_lc: n.title.toLowerCase(), alias_surname: n.alias_surname, alias_claim: n.claim,
    // how the world addresses the hero, by sex (Step 10)
    sir: w ? 'madam' : 'sir', Sir: w ? 'Madam' : 'Sir', gent: w ? 'lady' : 'gentleman', fellow: w ? 'woman' : 'man',
    hero_sex: w ? 'woman' : 'man',
    // the Story's pronouns, for a Venture's own passages (Step 10)
    he: w ? 'she' : 'he', his: w ? 'her' : 'his', him: w ? 'her' : 'him', himself: w ? 'herself' : 'himself',
    He: w ? 'She' : 'He', His: w ? 'Her' : 'His', hero: w ? 'our heroine' : 'our hero', Hero: w ? 'Our heroine' : 'Our hero',
  };
}

export const NAME_ROOTS = ['given', 'surname', 'name', 'styled', 'county', 'alias', 'alias_long', 'alias_title', 'alias_title_lc', 'alias_surname', 'alias_claim', 'sir', 'Sir', 'gent', 'fellow', 'hero_sex', 'he', 'his', 'him', 'himself', 'He', 'His', 'hero', 'Hero'];

/** Draw a set of names; the Persona never shares the hero's surname. */
export function drawNames(pool: NamePool, rng: Rng | (() => number), sex: 'man' | 'woman' = 'man'): Names {
  const r = typeof rng === 'function' ? rng : () => rng.next();
  const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)];
  const surname = pick(pool.surname);
  const t = pick(pool.alias.title);
  let alias = pick(pool.alias.surname);
  for (let i = 0; i < 20 && alias === surname; i++) alias = pick(pool.alias.surname);
  return { given: pick(pool.given), surname, county: pick(pool.county), title: t.long, short_title: t.short, alias_surname: alias, claim: pick(pool.alias.claim), sex };
}
