import Decimal from 'decimal.js';
import type { Holding } from './insights';
import type { Report } from './engine';

const zero = () => new Decimal(0);
const pos = (d: Decimal) => Decimal.max(d, 0);
/** 12.5% on long-term gains plus 4% cess (surcharge ignored). */
export const LTCG_RATE = new Decimal(0.13);

// ---------------------------------------------------------------------------------------------
// Tax-loss harvesting

export interface HarvestIdea {
  holding: Holding;
  term: 'STCL' | 'LTCL';
  lossInr: Decimal;
  /** Gain it would offset this year, and the tax that saves. */
  offsets: { against: 'STCG' | 'LTCG'; amount: Decimal }[];
  savingInr: Decimal;
}

/**
 * Open lots standing at a loss, and the tax each would save if sold now against this year's
 * taxable gains: short-term losses against slab-rate gains first, then long-term gains;
 * long-term losses only against long-term gains. Unused losses carry forward.
 */
export function harvestIdeas(r: Report): { ideas: HarvestIdea[]; totalLoss: Decimal; totalSaving: Decimal; gainsLeft: { stcg: Decimal; ltcg: Decimal } } {
  const marginal = new Decimal(r.settings.marginalRatePct).div(100);
  let stcg = r.losses.taxableStcg;
  let ltcg = r.losses.taxableLtcg;
  const losers = r.insights.holdings
    .filter((h) => h.gainInr?.lt(0))
    .map((h) => ({ h, loss: h.gainInr!.neg(), term: h.daysToLongTerm === 0 ? ('LTCL' as const) : ('STCL' as const) }))
    // Short-term losses are more flexible, so use them first; biggest first within each.
    .sort((a, b) => (a.term === b.term ? b.loss.cmp(a.loss) : a.term === 'STCL' ? -1 : 1));

  const ideas: HarvestIdea[] = [];
  for (const { h, loss, term } of losers) {
    let left = loss;
    const offsets: HarvestIdea['offsets'] = [];
    let saving = zero();
    const use = (against: 'STCG' | 'LTCG') => {
      const gain = against === 'STCG' ? stcg : ltcg;
      const amount = Decimal.min(left, gain);
      if (amount.lte(0)) return;
      offsets.push({ against, amount });
      saving = saving.add(amount.mul(against === 'STCG' ? marginal : LTCG_RATE));
      left = left.sub(amount);
      if (against === 'STCG') stcg = stcg.sub(amount);
      else ltcg = ltcg.sub(amount);
    };
    if (term === 'STCL') use('STCG');
    use('LTCG');
    ideas.push({ holding: h, term, lossInr: loss, offsets, savingInr: saving });
  }
  return {
    ideas,
    totalLoss: ideas.reduce((s, i) => s.add(i.lossInr), zero()),
    totalSaving: ideas.reduce((s, i) => s.add(i.savingInr), zero()),
    gainsLeft: { stcg, ltcg },
  };
}

// ---------------------------------------------------------------------------------------------
// Advance tax

export const INSTALMENTS = [
  { due: '06-15', label: '15 June', pct: 15 },
  { due: '09-15', label: '15 September', pct: 45 },
  { due: '12-15', label: '15 December', pct: 75 },
  { due: '03-15', label: '15 March', pct: 100 },
] as const;

export interface AdvanceTaxRow {
  label: string;
  /** Calendar date of the instalment. */
  date: string;
  /** Tax on the IBKR income that arose before this instalment (after foreign tax credit). */
  cumulativeInr: Decimal;
  /** Of which still to pay at this instalment (vs the previous one). */
  dueInr: Decimal;
  past: boolean;
}

/**
 * Advance tax on the IBKR income of the financial year so far. Capital gains and dividends only
 * need to be covered from the instalment after they arise (proviso to s.234C), so each instalment
 * covers the tax on what accrued before it; income after 15 March is due by 31 March.
 */
export function advanceTax(r: Report, today: string): AdvanceTaxRow[] {
  const marginal = new Decimal(r.settings.marginalRatePct).div(100);
  const fyStartYear = Number(r.year.fyStart.slice(0, 4));
  const stcg = r.losses.tableF.stcg;
  const ltcg = r.losses.tableF.ltcg;
  const div = r.income.dividendQuarters;
  const interest = [0, 1, 2, 3, 4].map((q) => r.income.interest.filter((x) => x.quarter === q).reduce((s, x) => s.add(x.conv?.inr ?? 0), zero()));
  const divTotal = div.reduce((s, x) => s.add(x), zero());
  const relief = r.foreign.totals.reliefInr;
  const taxIn = (q: number) => {
    const credit = divTotal.gt(0) ? relief.mul(div[q]).div(divTotal) : zero();
    return pos(stcg[q].add(div[q]).add(interest[q]).mul(marginal).add(ltcg[q].mul(LTCG_RATE)).sub(credit));
  };
  const rows: AdvanceTaxRow[] = [];
  let cumulative = zero();
  let previous = zero();
  // Instalment i covers income that accrued in buckets 0..i (bucket i ends on the due date itself).
  [...INSTALMENTS, { due: '03-31', label: '31 March', pct: 100 }].forEach((inst, i) => {
    cumulative = cumulative.add(taxIn(i));
    const date = `${inst.due < '04-01' ? fyStartYear + 1 : fyStartYear}-${inst.due}`;
    rows.push({ label: inst.label, date, cumulativeInr: cumulative, dueInr: pos(cumulative.sub(previous)), past: date < today });
    previous = cumulative;
  });
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Old vs new regime

export interface RegimeInputs {
  /** Salary before the standard deduction. */
  salary: number;
  /** Other income taxed at slab rates (Indian interest, rent after deductions, …). */
  otherIncome: number;
  /** Old-regime deductions: 80C, 80D, HRA, home-loan interest and so on. */
  oldDeductions: number;
}

export interface RegimeResult {
  regime: 'new' | 'old';
  taxableNormal: Decimal;
  ltcg: Decimal;
  tax: Decimal;
  rebate: Decimal;
  surcharge: Decimal;
  cess: Decimal;
  credit: Decimal;
  total: Decimal;
}

const NEW_SLABS: [number, number][] = [[400000, 0], [800000, 0.05], [1200000, 0.1], [1600000, 0.15], [2000000, 0.2], [2400000, 0.25], [Infinity, 0.3]];
const OLD_SLABS: [number, number][] = [[250000, 0], [500000, 0.05], [1000000, 0.2], [Infinity, 0.3]];

function slabTax(income: Decimal, slabs: [number, number][]): Decimal {
  let tax = zero();
  let lower = 0;
  for (const [upper, rate] of slabs) {
    if (income.lte(lower)) break;
    tax = tax.add(Decimal.min(income, upper === Infinity ? income : upper).sub(lower).mul(rate));
    lower = upper;
  }
  return tax;
}

/**
 * Estimated tax for FY 2025-26 / tax year 2026-27 under each regime, including the IBKR income.
 * Simplifications: no surcharge marginal relief, standard deduction only on salary, resident
 * individual below 60.
 */
export function compareRegimes(r: Report, inp: RegimeInputs): { new: RegimeResult; old: RegimeResult } {
  const ibkrSlab = r.losses.taxableStcg.add(r.income.dividendTotalInr).add(r.income.interestTotalInr);
  const ltcgGross = r.losses.taxableLtcg;
  const dividends = r.income.dividendTotalInr;
  const calc = (regime: 'new' | 'old'): RegimeResult => {
    const std = regime === 'new' ? 75000 : 50000;
    const exemption = regime === 'new' ? 400000 : 250000;
    const salary = Math.max(0, inp.salary - (inp.salary > 0 ? std : 0));
    const normal = pos(new Decimal(salary).add(inp.otherIncome).add(ibkrSlab).sub(regime === 'old' ? inp.oldDeductions : 0));
    // Residents may use any unused basic exemption against long-term gains (proviso to s.112(1)).
    const ltcg = pos(ltcgGross.sub(pos(new Decimal(exemption).sub(normal))));
    const normalTax = slabTax(normal, regime === 'new' ? NEW_SLABS : OLD_SLABS);
    const ltcgTax = ltcg.mul(0.125);
    const total = normal.add(ltcg);
    let rebate = zero();
    if (regime === 'new') {
      // s.87A: up to ₹60,000 against slab-rate tax when total income is ₹12 lakh or less; marginal relief just above.
      if (total.lte(1200000)) rebate = Decimal.min(normalTax, 60000);
      else if (normalTax.gt(total.sub(1200000))) rebate = normalTax.sub(total.sub(1200000));
    } else if (total.lte(500000)) {
      rebate = Decimal.min(normalTax.add(ltcgTax), 12500);
    }
    const tax = normalTax.add(ltcgTax).sub(rebate);
    const rate = total.gt(20000000) ? (regime === 'new' ? 0.25 : total.gt(50000000) ? 0.37 : 0.25) : total.gt(10000000) ? 0.15 : total.gt(5000000) ? 0.1 : 0;
    // Surcharge on long-term gains and dividends is capped at 15%.
    const capped = Math.min(rate, 0.15);
    const divShare = normal.gt(0) ? Decimal.min(dividends, normal).div(normal) : zero();
    const normalAfter = pos(normalTax.sub(regime === 'new' ? rebate : 0));
    const surcharge = rate === 0 ? zero() : normalAfter.mul(divShare).mul(capped).add(normalAfter.mul(new Decimal(1).sub(divShare)).mul(rate)).add(ltcgTax.mul(capped));
    const cess = tax.add(surcharge).mul(0.04);
    const gross = pos(tax.add(surcharge).add(cess));
    const credit = Decimal.min(r.foreign.totals.reliefInr, gross);
    return { regime, taxableNormal: normal, ltcg, tax: normalTax.add(ltcgTax), rebate, surcharge, cess, credit, total: gross.sub(credit) };
  };
  return { new: calc('new'), old: calc('old') };
}
