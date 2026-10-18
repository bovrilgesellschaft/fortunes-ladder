// The core economy (Step 6): Appearances, Credit, the three kinds of debt, the pawnbroker,
// pinching, writs, the Savoy and prison. Pure rules over the hero; campaign.ts applies them.
// Numbers live in content/settings.yaml (economy:), so they can be tuned without code.

import { parseMoney } from './core';
import type { Amount, Rank } from './types';
import { RANKS } from './types';

export const SLOTS = ['Coat', 'Wig', 'Linen', 'Sword', 'Servant', 'Equipage'] as const;
export type Slot = typeof SLOTS[number];
/** Servants and equipage are paid by the week; the rest are bought outright. */
export const WEEKLY: Slot[] = ['Servant', 'Equipage'];

export interface Dress {
  tier: number;
  name: string;
  /** Weeks of wear so far (twice as fast when pinching or in the Savoy). */
  wear: number;
  /** For a servant or equipage, the weekly cost in pence. */
  weekly?: number;
}

export interface Note { to: string; amount: number; since: number }
export interface Loan { from: string; principal: number; owed: number; taken: number; due: number }
export interface Pledge { item: string; loan: number; at: number; slot?: Slot; dress?: Dress }
export interface Writ { kind: 'tradesmen' | 'loan'; amount: number; creditor: string; at: number; loan?: number; quietUntil?: number }
export interface Confinement { where: string; stage: 'sponging-house' | 'prison'; since: number; side: 'common' | 'room'; was: { district: string; room: string } }

export interface CatalogueItem { name: string; price: Amount }
export interface EconomySettings {
  expected: Record<Rank, number>;
  credit: Record<Rank, Amount>;
  wear: { worn: number; shabby: number };
  catalogue: Record<Slot, CatalogueItem[]>;
  values: Record<string, Amount>;
  pawn: { fraction: number; weeks: number; redeem: number };
  lender: { name: string; fee: number; weekly: number; term: number; grace: number; offers: Amount[] };
  notes: { grace: number };
  tradesman: string;
  savoy: { living: Rank; season: number; tag: string };
  prison: { sponging: Amount; room: Amount; fleet: string; marshalsea: string };
}

const amt = (a: Amount) => (typeof a === 'number' ? a : parseMoney(a));

export function condition(d: Dress, e: EconomySettings): 'Fine' | 'Worn' | 'Shabby' {
  return d.wear >= e.wear.shabby ? 'Shabby' : d.wear >= e.wear.worn ? 'Worn' : 'Fine';
}

/** The visible sum of the six slots; a Shabby item counts one tier lower. */
export function appearances(dress: Partial<Record<Slot, Dress | null>>, e: EconomySettings): number {
  let n = 0;
  for (const s of SLOTS) { const d = dress[s]; if (d) n += Math.max(0, d.tier - (condition(d, e) === 'Shabby' ? 1 : 0)); }
  return n;
}

/** What tradesmen will lend: Appearances × the Claimed Rank's multiplier. */
export function credit(app: number, rank: Rank, e: EconomySettings): number { return app * amt(e.credit[rank]); }

export const rankIndex = (r: Rank) => RANKS.indexOf(r);
export const rankBelow = (r: Rank): Rank => RANKS[Math.max(0, rankIndex(r) - 1)];

export function price(slot: Slot, tier: number, e: EconomySettings): number { return amt(e.catalogue[slot][tier - 1].price); }

/** What the pawnbroker reckons an item worth, or null if he will not take it. */
export function valueOf(item: string, dress: Partial<Record<Slot, Dress | null>>, e: EconomySettings): number | null {
  for (const s of SLOTS) {
    const d = dress[s];
    if (d && d.name === item && !WEEKLY.includes(s)) return price(s, d.tier, e);
  }
  return item in e.values ? amt(e.values[item]) : null;
}

export { amt };
