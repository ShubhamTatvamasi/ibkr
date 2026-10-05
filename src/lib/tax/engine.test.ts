import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFlexXml } from '../flex/parse';
import { TtbrTable } from '../fx/ttbr';
import { DEFAULT_SETTINGS } from './common';
import { accountsIn, buildReport } from './engine';
import { Fx } from './fx';

const read = (p: string) => readFileSync(new URL(`../../../public/${p}`, import.meta.url), 'utf8');

function load() {
  const data = parseFlexXml(read('samples/sample-cy2025.xml'), 'cy.xml');
  parseFlexXml(read('samples/sample-fy2025-26.xml'), 'fy.xml', data);
  const fx = new Fx(new Map([['USD', new TtbrTable(JSON.parse(read('data/ttbr/USD.json')))]]));
  return { data, fx };
}

describe('engine on the fictional sample exports (AY 2026-27)', () => {
  const { data, fx } = load();
  const account = accountsIn(data)[0];
  const report = buildReport(data, account, 2026, DEFAULT_SETTINGS, fx);

  it('merges overlapping exports without duplicating cash rows', () => {
    const divs = data.cash.filter((t) => t.kind === 'dividend');
    expect(divs).toHaveLength(13);
    expect(data.closedLots).toHaveLength(3);
  });

  it('reports no errors', () => {
    expect(report.warnings.filter((w) => w.level === 'error')).toEqual([]);
    expect(report.missingRates).toEqual([]);
  });

  it('builds one A3 row per lot held during CY2025', () => {
    const rows = report.fa.a3.map((r) => `${r.lot.symbol} ${r.acquired} ${r.qtyStart}→${r.qtyEnd}`);
    expect(rows).toEqual([
      'AAPL 2022-06-10 20→5',
      'AAPL 2025-02-03 10→10',
      'MSFT 2024-09-16 6→0',
      'NVDA 2025-03-10 25→25',
      'VOO 2023-11-20 8→8',
      'VOO 2025-05-05 5→5',
    ]);
    for (const r of report.fa.a3) {
      expect(r.peakQuality).toBe('daily');
      expect(r.peak!.inr.gte(r.closing?.inr ?? 0)).toBe(true);
    }
    const msft = report.fa.a3.find((r) => r.lot.symbol === 'MSFT')!;
    expect(msft.closing).toBeUndefined();
    expect(msft.proceeds.foreign.toNumber()).toBeCloseTo(2998.14, 2);
  });

  it('attributes dividends only to lots held before the ex-date', () => {
    const voo2025 = report.fa.a3.find((r) => r.lot.symbol === 'VOO' && r.acquired === '2025-05-05')!;
    // Held for the Jun, Sep, Dec 2025 dividends (5 shares each), not for March.
    expect(voo2025.dividends.foreign.toNumber()).toBeCloseTo(5 * (1.74 + 1.74 + 1.85), 2);
  });

  it('classifies FY2025-26 sales with the 24-month rule', () => {
    expect(report.cg.rows.map((r) => `${r.lot.symbol} ${r.term}`)).toEqual(['AAPL LTCG', 'MSFT STCG', 'NVDA STCG']);
    expect(report.cg.rows.every((r) => !r.pnlMismatch)).toBe(true);
    const q = report.cg.ltcg.quarters.reduce((s, x) => s.add(x));
    expect(q.equals(report.cg.ltcg.gainInr)).toBe(true);
  });

  it('computes dividends, interest and FTC for the financial year', () => {
    expect(report.income.dividends).toHaveLength(10);
    expect(report.income.interest).toHaveLength(12);
    const us = report.income.ftc.find((g) => g.head === 'dividend')!;
    expect(us.country.itrCode).toBe('2');
    // 25% withheld ≈ 25% treaty cap (cent rounding pushes tax slightly over), slab 31.2% is higher.
    expect(us.reliefInr.equals(us.treatyCapInr!)).toBe(true);
    expect(us.foreignTaxInr.sub(us.reliefInr).abs().lt(5)).toBe(true);
  });

  it('builds the A2 custodial account row from daily cash', () => {
    const a2 = report.fa.a2[0];
    expect(a2.cashQuality).toBe('daily');
    expect(a2.peak!.inr.gt(a2.closing!)).toBe(true);
    expect(a2.credited.map((c) => c.code)).toEqual(['D', 'I', 'S']);
  });
});
