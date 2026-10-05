import Decimal from 'decimal.js';
import type { IsoDate } from '../dates';
import type { Account, FlexData } from '../flex/model';
import { capitalGains, type CgResult } from './cg';
import { Collector, type Settings, type Warning } from './common';
import { scheduleFA, type FaResult } from './fa';
import type { Fx } from './fx';
import { income, type IncomeResult } from './income';
import { addDays, taxYear, type TaxYear } from './years';

export interface Report {
  year: TaxYear;
  account: Account;
  settings: Settings;
  fa: FaResult;
  cg: CgResult;
  income: IncomeResult;
  warnings: Warning[];
  missingRates: { currency: string; date: IsoDate }[];
  coverage: { from: IsoDate; to: IsoDate }[];
  summary: {
    stcg: Decimal;
    ltcg: Decimal;
    dividends: Decimal;
    interest: Decimal;
    foreignTax: Decimal;
    ftcRelief: Decimal;
    faPeakTotal: Decimal;
    faClosingTotal: Decimal;
    a3Rows: number;
  };
}

/** Merged, sorted date ranges covered by the uploaded statements for one account. */
export function coverage(data: FlexData, accountId: string): { from: IsoDate; to: IsoDate }[] {
  const ranges = data.statements
    .filter((s) => s.accountId === accountId)
    .map((s) => ({ from: s.fromDate, to: s.toDate }))
    .sort((a, b) => a.from.localeCompare(b.from));
  const out: { from: IsoDate; to: IsoDate }[] = [];
  for (const r of ranges) {
    const last = out.at(-1);
    if (last && r.from <= addDays(last.to, 1)) {
      if (r.to > last.to) last.to = r.to;
    } else out.push({ ...r });
  }
  return out;
}

function covers(ranges: { from: IsoDate; to: IsoDate }[], from: IsoDate, to: IsoDate) {
  return ranges.some((r) => r.from <= from && r.to >= to);
}

export function accountsIn(data: FlexData): Account[] {
  const ids = new Set(data.statements.map((s) => s.accountId));
  return [...ids].map(
    (id) => data.accounts.find((a) => a.accountId === id) ?? { accountId: id, name: '', baseCurrency: 'USD' },
  );
}

export function currenciesIn(data: FlexData): Set<string> {
  const s = new Set<string>(['USD']);
  for (const l of data.openLots) s.add(l.currency);
  for (const l of data.closedLots) s.add(l.currency);
  for (const t of data.cash) s.add(t.currency);
  for (const f of data.funds) if (f.currency !== 'BASE_SUMMARY') s.add(f.currency);
  return s;
}

export function buildReport(data: FlexData, account: Account, ayStart: number, settings: Settings, fx: Fx): Report {
  const ty = taxYear(ayStart);
  const log = new Collector();
  const cov = coverage(data, account.accountId);

  if (!covers(cov, ty.cyStart, ty.cyEnd)) {
    log.add('warn', 'Coverage', `Schedule FA needs data for the whole of ${ty.cyStart} – ${ty.cyEnd}; your files don't fully cover it. Upload the calendar-year export.`);
  }
  if (!covers(cov, ty.fyStart, ty.fyEnd)) {
    log.add('warn', 'Coverage', `Capital gains and income need ${ty.fyStart} – ${ty.fyEnd}; your files don't fully cover it. Upload the financial-year export.`);
  }
  for (const [section, why] of [
    ['Trades', 'capital gains'],
    ['CashTransactions', 'dividends, interest and withholding tax'],
    ['OpenPositions', 'Schedule FA holdings'],
  ] as const) {
    if (!data.sections.has(section)) log.add('error', 'Flex Query', `Section "${section}" not found — needed for ${why}.`);
  }
  if (!data.sections.has('SecuritiesInfo')) {
    log.add('info', 'Flex Query', 'Add "Financial Instrument Information" for full company names and ISIN-based country detection.');
  }
  const unsupported = data.unsupportedTrades.filter((t) => t.date >= ty.cyStart && t.date <= ty.fyEnd);
  if (unsupported.length) {
    const cats = [...new Set(unsupported.map((t) => t.assetCategory))].join(', ');
    log.add('warn', 'Scope', `Trades in ${cats} were found and are not computed (only stocks and ETFs are). Report them separately with your CA.`);
  }
  for (const ca of data.corporateActions.filter((c) => c.accountId === account.accountId && c.date >= ty.cyStart && c.date <= ty.fyEnd)) {
    log.add('warn', 'Corporate actions', `${ca.symbol} ${ca.type} on ${ca.date} (${ca.description}). Check the affected lots' quantities and peak values.`);
  }

  const fa = scheduleFA(data, account, ty, settings, fx, log);
  const cg = capitalGains(data, account, ty, settings, fx, log);
  const inc = income(data, account, ty, settings, fx, log);

  const sum = (xs: (Decimal | undefined)[]) => xs.reduce<Decimal>((s, x) => s.add(x ?? 0), new Decimal(0));
  const order = { error: 0, warn: 1, info: 2 };
  return {
    year: ty,
    account,
    settings,
    fa,
    cg,
    income: inc,
    warnings: [...log.warnings].sort((a, b) => order[a.level] - order[b.level]),
    missingRates: [...log.missingRates.values()].sort((a, b) => a.date.localeCompare(b.date)),
    coverage: cov,
    summary: {
      stcg: cg.stcg.gainInr,
      ltcg: cg.ltcg.gainInr,
      dividends: inc.dividendTotalInr,
      interest: inc.interestTotalInr,
      foreignTax: sum(inc.taxes.map((t) => t.conv?.inr)),
      ftcRelief: sum(inc.ftc.map((g) => g.reliefInr)),
      faPeakTotal: sum(fa.a3.map((r) => r.peak?.inr)),
      faClosingTotal: sum(fa.a3.map((r) => r.closing?.inr)),
      a3Rows: fa.a3.length,
    },
  };
}
