import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import type { Report } from './engine';
import { advanceTax, compareRegimes, harvestIdeas } from './planning';

const d = (n: number) => new Decimal(n);
const zeros = () => [0, 0, 0, 0, 0].map(d);
function stub(over: { stcg?: number; ltcg?: number; dividends?: number[]; relief?: number; holdings?: { gain: number; lt: boolean }[]; tableF?: { stcg: number[]; ltcg: number[] } } = {}): Report {
  const divQ = (over.dividends ?? [0, 0, 0, 0, 0]).map(d);
  return {
    year: { fyStart: '2026-04-01', fyEnd: '2027-03-31' },
    settings: { marginalRatePct: 31.2 },
    losses: {
      taxableStcg: d(over.stcg ?? 0),
      taxableLtcg: d(over.ltcg ?? 0),
      tableF: { stcg: (over.tableF?.stcg ?? [0, 0, 0, 0, 0]).map(d), ltcg: (over.tableF?.ltcg ?? [0, 0, 0, 0, 0]).map(d) },
    },
    income: { dividendQuarters: divQ, dividendTotalInr: divQ.reduce((s, x) => s.add(x), d(0)), interestTotalInr: d(0), interest: [] },
    foreign: { totals: { reliefInr: d(over.relief ?? 0) } },
    insights: {
      holdings: (over.holdings ?? []).map((h, i) => ({ symbol: `S${i}`, gainInr: d(h.gain), daysToLongTerm: h.lt ? 0 : 100 })),
    },
  } as unknown as Report;
}

describe('regime comparison', () => {
  it('matches the slab tables for plain income', () => {
    const r = compareRegimes(stub(), { salary: 1575000, otherIncome: 0, oldDeductions: 75000 });
    // New: 15,00,000 after ₹75,000 standard deduction → 20,000 + 40,000 + 45,000 = 1,05,000 + 4% cess.
    expect(r.new.taxableNormal.toNumber()).toBe(1500000);
    expect(r.new.total.toNumber()).toBeCloseTo(109200, 0);
    // Old: 15,75,000 − 50,000 − 75,000 = 14,50,000 → 12,500 + 1,00,000 + 1,35,000 = 2,47,500 + cess.
    expect(r.old.total.toNumber()).toBeCloseTo(257400, 0);
  });

  it('gives the full rebate up to ₹12 lakh but not against long-term gains', () => {
    const r = compareRegimes(stub({ ltcg: 100000 }), { salary: 1075000, otherIncome: 0, oldDeductions: 0 });
    // Normal income 10,00,000: slab tax 40,000, fully rebated; LTCG 1,00,000 × 12.5% = 12,500 + cess.
    expect(r.new.rebate.toNumber()).toBe(40000);
    expect(r.new.total.toNumber()).toBeCloseTo(13000, 0);
  });

  it('uses the unused basic exemption against long-term gains', () => {
    const r = compareRegimes(stub({ ltcg: 500000 }), { salary: 0, otherIncome: 0, oldDeductions: 0 });
    expect(r.new.ltcg.toNumber()).toBe(100000);
    expect(r.old.ltcg.toNumber()).toBe(250000);
  });
});

describe('tax-loss harvesting', () => {
  it('offsets slab-rate gains first and long-term losses only against long-term gains', () => {
    const { ideas, totalSaving } = harvestIdeas(stub({ stcg: 50000, ltcg: 100000, holdings: [{ gain: -80000, lt: false }, { gain: -30000, lt: true }] }));
    expect(ideas[0].offsets.map((o) => [o.against, o.amount.toNumber()])).toEqual([['STCG', 50000], ['LTCG', 30000]]);
    expect(ideas[1].offsets.map((o) => [o.against, o.amount.toNumber()])).toEqual([['LTCG', 30000]]);
    expect(totalSaving.toNumber()).toBeCloseTo(50000 * 0.312 + 60000 * 0.13, 4);
  });
});

describe('advance tax', () => {
  it('asks for tax on gains and dividends from the instalment after they arise', () => {
    const rows = advanceTax(stub({ dividends: [1000, 0, 2000, 0, 500], tableF: { stcg: [0, 10000, 0, 0, 0], ltcg: [0, 0, 0, 20000, 0] } }), '2026-10-10');
    expect(rows.map((x) => x.label)).toEqual(['15 June', '15 September', '15 December', '15 March', '31 March']);
    expect(rows[0].dueInr.toNumber()).toBeCloseTo(312, 4);
    expect(rows[1].dueInr.toNumber()).toBeCloseTo(3120, 4);
    expect(rows[3].dueInr.toNumber()).toBeCloseTo(2600, 4);
    expect(rows[1].past).toBe(true);
    expect(rows[2].past).toBe(false);
  });
});
