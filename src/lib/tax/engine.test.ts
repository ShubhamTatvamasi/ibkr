import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFlexXml } from '../flex/parse';
import { TtbrTable } from '../fx/ttbr';
import { DEFAULT_SETTINGS } from './common';
import { accountsIn, buildReport } from './engine';
import { Fx } from './fx';
import Decimal from 'decimal.js';
import { nonNegativeAccrual } from './cg';

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

  it('derives insights from the latest holdings', () => {
    const ins = report.insights;
    expect(ins.asOf).toBe('2026-03-31');
    // AAPL 5 + 10, NVDA 15, VOO 8 + 5 → five open lots.
    expect(ins.holdings.map((h) => `${h.symbol} ${h.qty}`)).toEqual(['AAPL 5', 'AAPL 10', 'NVDA 15', 'VOO 8', 'VOO 5']);
    const voo = ins.holdings.find((h) => h.acquired === '2023-11-20')!;
    expect(voo.longTermFrom).toBe('2025-11-21');
    expect(voo.daysToLongTerm).toBe(0);
    expect(ins.usSitusUsd.gt(0)).toBe(true);
    expect(ins.overWithheld).toEqual([]);
    expect(ins.remittances.count).toBe(0);
  });
});

describe('Table F accrual', () => {
  const run = (xs: number[]) => nonNegativeAccrual(xs.map((x) => new Decimal(x))).map((d) => d.toNumber());

  it('passes gains straight through', () => {
    expect(run([100, 0, 50, 0, 0])).toEqual([100, 0, 50, 0, 0]);
  });

  it('absorbs an early loss into later gains', () => {
    expect(run([-80, 100, 30, 0, 0])).toEqual([0, 20, 30, 0, 0]);
  });

  it('nets a later loss against what is left to report, never negative', () => {
    expect(run([100, -150, 70, 0, 0])).toEqual([100, 0, 0, 0, 0]);
  });
});

describe('foreign income schedules (sample)', () => {
  const { data, fx } = load();
  const report = buildReport(data, accountsIn(data)[0], 2026, { ...DEFAULT_SETTINGS, tin: 'P1234567' }, fx);

  it('builds one Form 67 row for US dividends', () => {
    expect(report.foreign.form67.map((f) => `${f.country.iso} ${f.source}`)).toEqual(['US Dividend']);
  });

  it('reports capital gains and other sources in Schedule FSI, relief only on OS', () => {
    const us = report.foreign.fsi[0];
    expect(us.heads.map((h) => h.head)).toEqual(['Capital Gains', 'Other Sources']);
    expect(us.heads[0].reliefInr.isZero()).toBe(true);
    expect(us.total.reliefInr.equals(report.foreign.totals.reliefInr)).toBe(true);
  });

  it('lists every exchange rate it used', () => {
    expect(report.rates.length).toBeGreaterThan(100);
    expect(report.rates.every((r) => r.usedFor.size > 0)).toBe(true);
  });
});

describe('exports built by IBKR "Configure with AI" (default field subsets)', () => {
  const STRIP = ['conid', 'isin', 'levelOfDetail', 'issuerCountryCode', 'transactionID', 'tradeID', 'description', 'reportDate'];
  const strip = (xml: string, extra: string[] = []) =>
    [...STRIP, ...extra].reduce((x, attr) => x.replace(new RegExp(` ${attr}="[^"]*"`, 'g'), ''), xml.replace(/<SecuritiesInfo>[\s\S]*?<\/SecuritiesInfo>/, ''));
  const fx = load().fx;
  const full = load();
  const fullReport = buildReport(full.data, accountsIn(full.data)[0], 2026, DEFAULT_SETTINGS, fx);

  it('still matches lots, prices and dividends by symbol', () => {
    const data = parseFlexXml(strip(read('samples/sample-cy2025.xml')), 'cy.xml');
    parseFlexXml(strip(read('samples/sample-fy2025-26.xml')), 'fy.xml', data);
    const r = buildReport(data, accountsIn(data)[0], 2026, DEFAULT_SETTINGS, fx);
    expect(r.warnings.filter((w) => w.level === 'error')).toEqual([]);
    expect(r.cg.ltcg.gainInr.equals(fullReport.cg.ltcg.gainInr)).toBe(true);
    expect(r.fa.a3.map((x) => x.peak?.inr.toFixed(0))).toEqual(fullReport.fa.a3.map((x) => x.peak?.inr.toFixed(0)));
    expect(r.fa.a3.every((x) => x.peakQuality === 'daily')).toBe(true);
    expect(r.income.dividendTotalInr.equals(fullReport.income.dividendTotalInr)).toBe(true);
    expect(r.warnings.some((w) => w.level === 'info' && w.message.includes('Conid'))).toBe(true);
  });

  it('names the missing Open Date Time field', () => {
    const data = parseFlexXml(strip(read('samples/sample-fy2025-26.xml'), ['openDateTime']), 'fy.xml');
    const r = buildReport(data, accountsIn(data)[0], 2026, DEFAULT_SETTINGS, fx);
    const errors = r.warnings.filter((w) => w.level === 'error').map((w) => w.message).join(' | ');
    expect(errors).toContain('Trades (with Closed Lots) is missing the field Open Date Time');
    expect(errors).toContain('Open Positions (Lot level) is missing the field Open Date Time');
  });
});

describe('periods for a new account and a year in progress', () => {
  const acct = { accountId: 'U1', name: '', baseCurrency: 'USD', dateFunded: '2026-07-22' };
  const cov = [{ from: '2026-07-22', to: '2026-10-02' }];

  it('needs data only from funding to the latest export while the year runs', async () => {
    const { period } = await import('./engine');
    const p = period(cov, acct, '2026-01-01', '2026-12-31', '2026-10-05');
    expect(p).toMatchObject({ needFrom: '2026-07-22', needTo: '2026-10-02', inProgress: true, notApplicable: false, covered: true });
  });

  it('marks earlier years as not applicable', async () => {
    const { period } = await import('./engine');
    expect(period(cov, acct, '2025-04-01', '2026-03-31', '2026-10-05')).toMatchObject({ notApplicable: true, covered: true });
  });

  it('still requires the full window once the year is over', async () => {
    const { period } = await import('./engine');
    const p = period(cov, { ...acct, dateFunded: '2025-01-10' }, '2025-04-01', '2026-03-31', '2026-10-05');
    expect(p).toMatchObject({ needFrom: '2025-04-01', needTo: '2026-03-31', inProgress: false, covered: false });
  });
});

describe('one order filled as several executions', () => {
  it('merges lots sharing an open time with a weighted cost', async () => {
    const { buildLedger } = await import('./lots');
    const row = (q: string, cost: string) =>
      `<OpenPosition accountId="U1" currency="USD" assetCategory="STK" symbol="ETF" conid="9" reportDate="20261002" position="${q}" markPrice="200" costBasisMoney="${cost}" levelOfDetail="LOT" openDateTime="20260722;110511" />`;
    const xml = `<FlexQueryResponse type="AF"><FlexStatements><FlexStatement accountId="U1" fromDate="20260722" toDate="20261002"><OpenPositions>${row('1', '190.27')}${row('1', '188.58')}${row('0.6408', '120.842064')}</OpenPositions></FlexStatement></FlexStatements></FlexQueryResponse>`;
    const lots = buildLedger(parseFlexXml(xml, 'x.xml'), 'U1', '2026-12-31').lots;
    expect(lots).toHaveLength(1);
    expect(lots[0].snapshotQty.toString()).toBe('2.6408');
    expect(lots[0].unitCost.mul(lots[0].snapshotQty).toDecimalPlaces(6).toString()).toBe('499.692064');
  });
});
