import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFlexXml } from '../flex/parse';
import { TtbrTable } from '../fx/ttbr';
import { DEFAULT_SETTINGS } from './common';
import { accountsIn, buildCombinedReport, buildReport } from './engine';
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

  it('nets a later loss against earlier gains so the total matches the net gain', () => {
    expect(run([100, -150, 70, 0, 0])).toEqual([0, 0, 20, 0, 0]);
    expect(run([100, -30, 0, 0, 0])).toEqual([70, 0, 0, 0, 0]);
  });

  it('reports nothing when the year ends in a net loss', () => {
    expect(run([50, -80, 10, 0, 0])).toEqual([0, 0, 0, 0, 0]);
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

describe('Form 44 accountant verification (new Act)', () => {
  const fx = load().fx;

  function newActData() {
    // FY 2026-27: a $50,000 dividend with 25% US withholding = $12,500 tax ≈ ₹10.5 lakh.
    const xml = `<FlexQueryResponse type="AF"><FlexStatements><FlexStatement accountId="U1" fromDate="20260401" toDate="20270331">
      <AccountInformation accountId="U1" currency="USD" name="T" dateOpened="20200101" dateFunded="20200101" ibEntity="IBLLC-US" />
      <SecuritiesInfo><SecurityInfo assetCategory="STK" subCategory="COMMON" symbol="AAPL" description="APPLE INC" conid="1" isin="US0378331005" issuerCountryCode="US" currency="USD" /></SecuritiesInfo>
      <CashTransactions>
        <CashTransaction accountId="U1" currency="USD" assetCategory="STK" symbol="AAPL" description="AAPL(US0378331005) Cash Dividend USD 50 per Share" conid="1" isin="US0378331005" issuerCountryCode="US" dateTime="20260615;202000" settleDate="20260615" amount="50000" type="Dividends" transactionID="1" levelOfDetail="DETAIL" />
        <CashTransaction accountId="U1" currency="USD" assetCategory="STK" symbol="AAPL" description="AAPL(US0378331005) Cash Dividend USD 50 per Share - US Tax" conid="1" isin="US0378331005" issuerCountryCode="US" dateTime="20260615;202000" settleDate="20260615" amount="-12500" type="Withholding Tax" transactionID="2" levelOfDetail="DETAIL" />
      </CashTransactions>
    </FlexStatement></FlexStatements></FlexQueryResponse>`;
    return parseFlexXml(xml, 'new.xml');
  }

  it('warns when foreign tax paid is ₹1 lakh or more under the new Act', () => {
    const r = buildReport(newActData(), accountsIn(newActData())[0], 2027, DEFAULT_SETTINGS, fx);
    const msg = r.warnings.find((w) => w.message.includes('accountant'));
    expect(r.year.newAct).toBe(true);
    expect(r.foreign.totals.taxPaidInr.gte(100_000)).toBe(true);
    expect(msg?.message).toContain('Form 44');
    expect(msg?.message).toContain('Rule 76(16)');
  });

  it('does not warn under the old Act', () => {
    const r = buildReport(newActData(), accountsIn(newActData())[0], 2026, DEFAULT_SETTINGS, fx);
    expect(r.warnings.some((w) => w.message.includes('accountant'))).toBe(false);
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

describe('address book', () => {
  it('fills known ISINs and lets the user override', async () => {
    const { entityFor } = await import('../assets');
    const auto = entityFor('VWRA', 'IE00BK5BQT80', 'VANG FTSE AW USDA', {});
    expect(auto).toMatchObject({ source: 'address book', zip: 'D02 R296', nature: 'ETF' });
    expect(auto.name).toContain('Vanguard FTSE All-World');
    const own = entityFor('VWRA', 'IE00BK5BQT80', 'VANG FTSE AW USDA', { VWRA: { address: 'Elsewhere 1' } });
    expect(own).toMatchObject({ source: 'you', address: 'Elsewhere 1', zip: 'D02 R296' });
    expect(entityFor('XYZ', 'US0000000000', 'XYZ CORP', {}).source).toBe('missing');
  });
});

describe('defaultAy', () => {
  it('picks the year whose filing window is open', async () => {
    const { defaultAy } = await import('./years');
    expect(defaultAy(new Date(2026, 9, 10))).toBe(2026); // Oct 2026 → AY 2026-27
    expect(defaultAy(new Date(2027, 2, 31))).toBe(2026); // revised window to 31 Mar 2027
    expect(defaultAy(new Date(2027, 3, 1))).toBe(2027); // Apr 2027 → tax year 2026-27
    expect(defaultAy(new Date(2030, 5, 1))).toBe(2027); // clamped to supported years
  });
});

describe('AIS foreign-assets check', () => {
  const { data, fx } = load();
  const account = accountsIn(data)[0];
  const report = buildReport(data, account, 2026, DEFAULT_SETTINGS, fx, { today: '2026-10-10' });

  it('totals the calendar year in the account currency', () => {
    const a = report.ais[0];
    expect(a.calendarYear).toBe('2025');
    expect(a.currency).toBe(account.baseCurrency || 'USD');
    expect(a.dividends.gt(0)).toBe(true);
    expect(a.balance.toNumber()).toBeCloseTo(a.cash.add(a.holdings).toNumber());
  });

  it('matches within 1% and flags larger differences', async () => {
    const { compareAis, aisRemark } = await import('./ais');
    const a = report.ais[0];
    const rows = compareAis(a, { dividends: a.dividends.mul(1.005).toFixed(2), interest: a.interest.add(500).toFixed(2) });
    expect(rows.find((r) => r.key === 'dividends')!.matches).toBe(true);
    expect(rows.find((r) => r.key === 'interest')!.matches).toBe(false);
    expect(rows.find((r) => r.key === 'balance')!.theirs).toBeUndefined();
    expect(aisRemark(a, rows, 'AY 2026-27').length).toBeLessThanOrEqual(400);
    const cash = compareAis(a, { balance: a.cash.toFixed(2) }).find((r) => r.key === 'balance')!;
    expect(cash.cashOnly).toBe(!a.holdings.isZero());
  });
});

describe('several IBKR accounts in one return', () => {
  const read2 = (f: string) => read(`samples/${f}`).replaceAll('U0000000', 'U1111111');
  const { data, fx } = load();
  parseFlexXml(read2('sample-cy2025.xml'), 'cy2.xml', data);
  parseFlexXml(read2('sample-fy2025-26.xml'), 'fy2.xml', data);
  const accounts = accountsIn(data);
  const one = buildReport(data, accounts[0], 2026, DEFAULT_SETTINGS, fx, { today: '2026-10-10', combined: true });
  const both = buildCombinedReport(data, accounts, 2026, DEFAULT_SETTINGS, fx, { today: '2026-10-10' });

  it('finds both accounts', () => {
    expect(accounts.map((a) => a.accountId).sort()).toEqual(['U0000000', 'U1111111']);
    expect(both.accountLabel).toContain(' + ');
  });

  it('pools capital gains, income and Schedule FA', () => {
    expect(both.cg.rows.length).toBe(one.cg.rows.length * 2);
    expect(both.cg.stcg.gainInr.toNumber()).toBeCloseTo(one.cg.stcg.gainInr.mul(2).toNumber(), 6);
    expect(both.income.dividendTotalInr.toNumber()).toBeCloseTo(one.income.dividendTotalInr.mul(2).toNumber(), 6);
    expect(both.fa.a2.length).toBe(2);
    expect(both.fa.a3.length).toBe(one.fa.a3.length * 2);
    expect(both.ais.length).toBe(2);
  });

  it('recomputes Table F and the foreign tax credit on the pooled figures', () => {
    const sum = (xs: Decimal[]) => xs.reduce((s, x) => s.add(x), new Decimal(0)).toNumber();
    expect(sum(both.cg.ltcg.tableF)).toBeCloseTo(Math.max(0, both.cg.ltcg.gainInr.toNumber()), 6);
    expect(both.foreign.totals.reliefInr.toNumber()).toBeCloseTo(one.foreign.totals.reliefInr.mul(2).toNumber(), 4);
    expect(both.foreign.tr.length).toBe(one.foreign.tr.length);
  });

  it('does not warn that another account is missing', () => {
    expect(both.warnings.some((w) => w.area.startsWith('Accounts'))).toBe(false);
  });
});

describe('lots without cost (transfers in, RSUs)', () => {
  const { data, fx } = load();
  const account = accountsIn(data)[0];
  const sold = data.closedLots.find((c) => c.accountId === account.accountId && c.closeDate >= '2025-04-01' && c.closeDate <= '2026-03-31')!;
  data.closedLots = data.closedLots.map((c) => (c === sold ? { ...c, cost: new Decimal(0) } : c));
  const today = { today: '2026-10-10' };

  it('flags the lot and blocks with a cost-basis error', () => {
    const r = buildReport(data, account, 2026, DEFAULT_SETTINGS, fx, today);
    const l = r.lotsToCheck.find((x) => x.conid === sold.conid && x.openDateTime === sold.openDateTime)!;
    expect(l.reason).toBe('zero-cost');
    expect(r.warnings.some((w) => w.level === 'error' && w.area === 'Cost basis')).toBe(true);
  });

  it('uses the corrected date and cost', async () => {
    const { lotKey } = await import('./common');
    const key = lotKey(account.accountId, sold.conid, sold.openDateTime);
    const unit = sold.proceeds.div(sold.quantity).toFixed(4); // cost = sale price → gain ≈ minus commission
    const settings = { ...DEFAULT_SETTINGS, lotOverrides: { [key]: { unitCost: unit, openDate: '2020-01-02' } } };
    const r = buildReport(data, account, 2026, settings, fx, today);
    const row = r.cg.rows.find((x) => x.lot.conid === sold.conid && x.lot.openDateTime === sold.openDateTime)!;
    expect(row.lot.openDate).toBe('2020-01-02');
    expect(row.term).toBe('LTCG');
    expect(row.gainForeign.abs().lte(sold.commission.add(0.01))).toBe(true);
    expect(r.warnings.some((w) => w.area === 'Cost basis')).toBe(false);
  });
});

describe('residential status', () => {
  const { data, fx } = load();
  const account = accountsIn(data)[0];
  it('marks foreign income as not taxable for RNOR and leaves FSI/TR out of the JSON', async () => {
    const r = buildReport(data, account, 2026, { ...DEFAULT_SETTINGS, residency: 'RNOR' }, fx, { today: '2026-10-10' });
    expect(r.foreignIncomeTaxable).toBe(false);
    expect(r.warnings.some((w) => w.area === 'Residential status')).toBe(true);
    const { itrSchedules } = await import('../itr/json');
    const { schedules } = itrSchedules(r, {});
    expect(schedules.ScheduleFSI).toBeUndefined();
    expect(schedules.ScheduleTR1).toBeUndefined();
    const { buildPack } = await import('../export/pack');
    expect(buildPack(r).filter((f) => f.category === 'schedule' && !f.empty)).toEqual([]);
  });
});

describe('relief without a tax treaty (section 91)', () => {
  it('uses section 91 for jurisdictions with no DTAA', async () => {
    const { reliefSection } = await import('./countries');
    expect(reliefSection('KY')).toBe('91');
    expect(reliefSection('US')).toBe('90');
  });
});

describe('foreign tax refunded for an earlier year', () => {
  const { data, fx } = load();
  const account = accountsIn(data)[0];
  const original = data.cash.find((t) => t.kind === 'withholding' && t.amount.lt(0) && t.date < '2025-04-01' && t.conid);
  it('has an earlier-year withholding in the sample', () => expect(original).toBeDefined());

  it('keeps the refund out of this year’s credit and reports it in Schedule TR', async () => {
    const before = buildReport(data, account, 2026, DEFAULT_SETTINGS, fx, { today: '2026-10-10' });
    const refund = { ...original!, date: '2025-06-02', amount: original!.amount.neg(), description: `${original!.description} - refund` };
    data.cash = [...data.cash, refund];
    const r = buildReport(data, account, 2026, DEFAULT_SETTINGS, fx, { today: '2026-10-10' });
    expect(r.income.refunds).toHaveLength(1);
    expect(r.income.refunds[0].reliefAy).toBe(2025);
    expect(r.foreign.totals.taxPaidInr.toNumber()).toBeCloseTo(before.foreign.totals.taxPaidInr.toNumber(), 6);
    const { itrSchedules } = await import('../itr/json');
    const tr = itrSchedules(r, {}).schedules.ScheduleTR1!;
    expect(tr.TaxPaidOutsideIndFlg).toBe('YES');
    expect(tr.AssmtYrTaxRelief).toBe('2025-26');
    expect(tr.AmtTaxRefunded).toBeGreaterThan(0);
  });
});

describe('treaty caps', () => {
  it('knows the portfolio dividend cap and article for common countries', async () => {
    const { TREATY_CAP, treatyArticle, reliefSection } = await import('./countries');
    expect(TREATY_CAP.IE.dividend).toBe(10);
    expect(TREATY_CAP.CA.dividend).toBe(25);
    expect(treatyArticle('GB', 'dividend')).toBe('Article 11');
    expect(treatyArticle('DE', 'interest')).toBe('Article 11');
    expect(reliefSection('TW')).toBe('90A');
  });
});
