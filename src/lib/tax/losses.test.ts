import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { nonNegativeAccrual, type CgResult, type CgTotals } from './cg';
import { setOffLosses } from './losses';

const d = (n: number) => new Decimal(n);
const totals = (quarters: number[]): CgTotals => {
  const q = quarters.map(d);
  const gain = q.reduce((s, x) => s.add(x), d(0));
  return { saleInr: d(0), costInr: d(0), expensesInr: d(0), gainInr: gain, quarters: q, tableF: nonNegativeAccrual(q) };
};
const cg = (st: number[], lt: number[]): CgResult => ({ rows: [], stcg: totals(st), ltcg: totals(lt) });
const n = (x: Decimal[]) => x.map((v) => v.toNumber());

describe('capital loss set-off and carry-forward', () => {
  it('sets a short-term loss against long-term gains in the same year', () => {
    const r = setOffLosses(cg([0, -300, 0, 0, 0], [0, 1000, 0, 0, 0]), 2026, [], true);
    expect(r.cyla).toHaveLength(1);
    expect(r.taxableStcg.toNumber()).toBe(0);
    expect(r.taxableLtcg.toNumber()).toBe(700);
    expect(n(r.tableF.ltcg)).toEqual([0, 700, 0, 0, 0]);
    expect(r.carryForward).toEqual([]);
  });

  it('never sets a long-term loss against short-term gains, and carries it forward', () => {
    const r = setOffLosses(cg([500, 0, 0, 0, 0], [-200, 0, 0, 0, 0]), 2026, [], true);
    expect(r.taxableStcg.toNumber()).toBe(500);
    expect(r.carryForward).toHaveLength(1);
    expect(r.carryForward[0]).toMatchObject({ ay: 2026, usableUntilAy: 2034 });
    expect(r.carryForward[0].ltcl.toNumber()).toBe(200);
  });

  it('uses brought-forward losses oldest first, short-term against slab gains first', () => {
    const r = setOffLosses(cg([400, 0, 0, 0, 0], [0, 0, 600, 0, 0]), 2026, [
      { ay: 2024, stcl: '', ltcl: '500' },
      { ay: 2022, stcl: '700', ltcl: '' },
    ], true);
    expect(r.bfla.map((b) => [b.ay, b.kind, b.against, b.amount.toNumber()])).toEqual([
      [2022, 'STCL', 'STCG', 400],
      [2022, 'STCL', 'LTCG', 300],
      [2024, 'LTCL', 'LTCG', 300],
    ]);
    expect(r.taxableStcg.toNumber()).toBe(0);
    expect(r.taxableLtcg.toNumber()).toBe(0);
    expect(r.carryForward.map((c) => [c.ay, c.ltcl.toNumber()])).toEqual([[2024, 200]]);
    expect(n(r.tableF.ltcg)).toEqual([0, 0, 0, 0, 0]);
  });

  it('drops losses older than eight years', () => {
    const r = setOffLosses(cg([100, 0, 0, 0, 0], [0, 0, 0, 0, 0]), 2026, [{ ay: 2017, stcl: '1000', ltcl: '' }], true);
    expect(r.expired).toHaveLength(1);
    expect(r.taxableStcg.toNumber()).toBe(100);
  });

  it("doesn't carry this year's loss forward on a belated return", () => {
    const r = setOffLosses(cg([-100, 0, 0, 0, 0], [0, 0, 0, 0, 0]), 2026, [{ ay: 2024, stcl: '50', ltcl: '' }], false);
    expect(r.currentLossLapses).toBe(true);
    expect(r.carryForward.map((c) => c.ay)).toEqual([2024]);
  });
});

describe('year-end file', () => {
  it('round-trips losses into the next year', async () => {
    const { applyYearEnd, parseYearEnd } = await import('../export/yearend');
    const { DEFAULT_SETTINGS } = await import('./common');
    const file = JSON.stringify({
      app: 'ibkr-india-tax', kind: 'year-end', version: 1, ay: 2026, accounts: ['U1'], saved: '2026-10-10',
      carryForward: [{ ay: 2026, stcl: '0', ltcl: '1200' }, { ay: 2023, stcl: '50', ltcl: '0' }],
      lotOverrides: { 'U1|1|x': { unitCost: '10' } }, entities: {},
      choices: { cgFxMethod: 'split', faIncomeRate: 'cyEnd', interestRate: 'fyEnd', tin: 'P123' },
    });
    const { settings } = applyYearEnd(DEFAULT_SETTINGS, parseYearEnd(file), 2027);
    expect(settings.broughtForward).toHaveLength(2);
    expect(settings.cgFxMethod).toBe('split');
    expect(settings.tin).toBe('P123');
    expect(settings.lotOverrides['U1|1|x'].unitCost).toBe('10');
    const same = applyYearEnd(DEFAULT_SETTINGS, parseYearEnd(file), 2026);
    expect(same.settings.broughtForward).toEqual([]);
    expect(() => parseYearEnd('{"app":"other"}')).toThrow(/not a year-end file/);
  });
});
