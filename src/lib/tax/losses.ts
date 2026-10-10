import Decimal from 'decimal.js';
import type { CgResult } from './cg';
import type { BroughtForwardLoss } from './common';

/** Capital losses can be carried forward for 8 assessment years (s.74 / s.111 of the 2025 Act). */
export const CARRY_YEARS = 8;

export interface SetOff {
  /** Assessment year in which the loss arose (current year for CYLA). */
  ay: number;
  kind: 'STCL' | 'LTCL';
  against: 'STCG' | 'LTCG';
  amount: Decimal;
}

export interface LossResult {
  /** Net gain per category from the year's sales (negative = loss). */
  netStcg: Decimal;
  netLtcg: Decimal;
  /** Current-year set-off across categories (short-term loss against long-term gain). */
  cyla: SetOff[];
  /** Brought-forward losses used, oldest first. */
  bfla: SetOff[];
  /** Gains left to tax after both set-offs. */
  taxableStcg: Decimal;
  taxableLtcg: Decimal;
  /** Losses still available after this year, with the last year they can be used. */
  carryForward: { ay: number; stcl: Decimal; ltcl: Decimal; usableUntilAy: number }[];
  /** Brought-forward losses older than 8 years, dropped. */
  expired: { ay: number; stcl: Decimal; ltcl: Decimal }[];
  /** This year's loss can't be carried forward: the return is not filed by the due date (s.80). */
  currentLossLapses: boolean;
  /** Table F after all set-offs (sums equal the taxable gains). */
  tableF: { stcg: Decimal[]; ltcg: Decimal[] };
}

const zero = () => new Decimal(0);
const pos = (d: Decimal) => Decimal.max(d, 0);
const parse = (s: string | undefined) => {
  const n = Number((s ?? '').replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? new Decimal(n) : zero();
};

/** Takes `amount` out of the per-quarter values, earliest quarter first (losses already on hand at the start of the year). */
function absorb(quarters: Decimal[], amount: Decimal): Decimal[] {
  let left = amount;
  return quarters.map((q) => {
    const take = Decimal.min(q, left);
    left = left.sub(take);
    return q.sub(take);
  });
}

/**
 * Set-off of the IBKR capital gains and losses for one year: within each category, then short-term
 * loss against long-term gain (s.70/71), then brought-forward losses oldest first — short-term
 * against any gain (slab-rate gains first), long-term only against long-term gains (s.74).
 */
export function setOffLosses(cg: CgResult, ayStart: number, broughtForward: BroughtForwardLoss[], filedByDueDate: boolean): LossResult {
  const netStcg = cg.stcg.gainInr;
  const netLtcg = cg.ltcg.gainInr;
  let stcg = pos(netStcg);
  let ltcg = pos(netLtcg);
  let stcl = pos(netStcg.neg());
  let ltcl = pos(netLtcg.neg());
  const cyla: SetOff[] = [];
  const bfla: SetOff[] = [];

  const crossUse = Decimal.min(stcl, ltcg);
  if (crossUse.gt(0)) {
    cyla.push({ ay: ayStart, kind: 'STCL', against: 'LTCG', amount: crossUse });
    stcl = stcl.sub(crossUse);
    ltcg = ltcg.sub(crossUse);
  }
  const fromCyla = { stcg: zero(), ltcg: crossUse };

  const expired: LossResult['expired'] = [];
  const pool = broughtForward
    .map((b) => ({ ay: b.ay, stcl: parse(b.stcl), ltcl: parse(b.ltcl) }))
    .filter((b) => b.ay < ayStart && (b.stcl.gt(0) || b.ltcl.gt(0)))
    .sort((a, b) => a.ay - b.ay)
    .filter((b) => {
      if (b.ay + CARRY_YEARS < ayStart) {
        expired.push(b);
        return false;
      }
      return true;
    });

  const fromBfla = { stcg: zero(), ltcg: zero() };
  for (const b of pool) {
    for (const against of ['STCG', 'LTCG'] as const) {
      const gain = against === 'STCG' ? stcg : ltcg;
      const use = Decimal.min(b.stcl, gain);
      if (use.lte(0)) continue;
      bfla.push({ ay: b.ay, kind: 'STCL', against, amount: use });
      b.stcl = b.stcl.sub(use);
      if (against === 'STCG') stcg = stcg.sub(use);
      else ltcg = ltcg.sub(use);
      fromBfla[against === 'STCG' ? 'stcg' : 'ltcg'] = fromBfla[against === 'STCG' ? 'stcg' : 'ltcg'].add(use);
    }
    const use = Decimal.min(b.ltcl, ltcg);
    if (use.gt(0)) {
      bfla.push({ ay: b.ay, kind: 'LTCL', against: 'LTCG', amount: use });
      b.ltcl = b.ltcl.sub(use);
      ltcg = ltcg.sub(use);
      fromBfla.ltcg = fromBfla.ltcg.add(use);
    }
  }

  const carryForward: LossResult['carryForward'] = pool
    .filter((b) => b.stcl.gt(0) || b.ltcl.gt(0))
    .map((b) => ({ ay: b.ay, stcl: b.stcl, ltcl: b.ltcl, usableUntilAy: b.ay + CARRY_YEARS }));
  const currentLossLapses = !filedByDueDate && (stcl.gt(0) || ltcl.gt(0));
  if (!currentLossLapses && (stcl.gt(0) || ltcl.gt(0))) {
    carryForward.push({ ay: ayStart, stcl, ltcl, usableUntilAy: ayStart + CARRY_YEARS });
  }

  return {
    netStcg,
    netLtcg,
    cyla,
    bfla,
    taxableStcg: stcg,
    taxableLtcg: ltcg,
    carryForward,
    expired,
    currentLossLapses,
    tableF: {
      stcg: absorb(cg.stcg.tableF, fromCyla.stcg.add(fromBfla.stcg)),
      ltcg: absorb(cg.ltcg.tableF, fromCyla.ltcg.add(fromBfla.ltcg)),
    },
  };
}
