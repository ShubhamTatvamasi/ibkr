import Decimal from 'decimal.js';
import { formatDate, type IsoDate } from '../dates';
import type { Account, FlexData } from '../flex/model';
import { capitalGains, type CgResult } from './cg';
import { Collector, type Settings, type Warning } from './common';
import { scheduleFA, type FaResult } from './fa';
import type { Fx } from './fx';
import { income, type IncomeResult } from './income';
import { insights, type Insights } from './insights';
import { foreignIncome, type ForeignResult } from './foreign';
import type { RateUse } from './common';
import { addDays, taxYear, type TaxYear } from './years';

export interface Report {
  year: TaxYear;
  account: Account;
  settings: Settings;
  fa: FaResult;
  cg: CgResult;
  income: IncomeResult;
  insights: Insights;
  foreign: ForeignResult;
  rates: RateUse[];
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
  const covered = cov.length ? cov.map((r) => (r.from === r.to ? `only ${formatDate(r.from)}` : `${formatDate(r.from)} – ${formatDate(r.to)}`)).join(', ') : 'no dates';

  if (!covers(cov, ty.cyStart, ty.cyEnd)) {
    log.add('error', 'Coverage', `Schedule FA needs ${formatDate(ty.cyStart)} – ${formatDate(ty.cyEnd)}, but your files cover ${covered}. In IBKR, run the query with a Custom Date Range of exactly those dates and add that file.`);
  }
  if (!covers(cov, ty.fyStart, ty.fyEnd)) {
    log.add('error', 'Coverage', `Capital gains, dividends and the foreign tax credit need ${formatDate(ty.fyStart)} – ${formatDate(ty.fyEnd)}, but your files cover ${covered}. In IBKR, run the query with a Custom Date Range of exactly those dates and add that file.`);
  }
  for (const c of sectionChecklist(data)) {
    if (c.required && !c.present) {
      log.add('error', 'Flex Query', `Section “${c.label}” not found — needed for ${c.purpose.toLowerCase()}.`);
    }
    if (c.missingCritical.length) {
      log.add('error', 'Flex Query', `${c.label} is missing the field${c.missingCritical.length > 1 ? 's' : ''} ${c.missingCritical.join(', ')}. In IBKR, edit the query, open ${c.label.replace(/ \(.*\)/, '')} and click Select All, then export again.`);
    }
    if (c.missingRecommended.length) {
      log.add('info', 'Flex Query', `${c.label} has no ${c.missingRecommended.join(', ')}. Results still work; selecting all fields makes matching and names more reliable.`);
    }
  }
  if (data.saleExecutions > 0 && !data.closedLots.length && data.fields.get('Trades')?.has('openDateTime')) {
    log.add('error', 'Flex Query', 'Sales were found but no closed-lot rows. In IBKR, edit the query, open Trades and tick “Closed Lots” under Options.');
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
  const ins = insights(data, account, ty, fa, fx, log);
  const foreign = foreignIncome(data, cg, inc, settings);
  if (settings.residency !== 'ROR') {
    log.add('info', 'Schedule FA', `Schedule FA applies only to residents who are ordinarily resident; as ${settings.residency === 'RNOR' ? 'RNOR' : 'a non-resident'} you do not fill it. The FA figures are shown for reference.`);
  }
  if (foreign.fsi.length && !settings.tin.trim()) {
    log.add('warn', 'Schedule FSI', 'Taxpayer Identification Number is empty. Use your US TIN if you have one, otherwise your passport number (as the official guide allows).');
  }

  const sum = (xs: (Decimal | undefined)[]) => xs.reduce<Decimal>((s, x) => s.add(x ?? 0), new Decimal(0));
  const order = { error: 0, warn: 1, info: 2 };
  return {
    year: ty,
    account,
    settings,
    fa,
    cg,
    income: inc,
    insights: ins,
    foreign,
    rates: [...log.rates.values()].sort((a, b) => a.currency.localeCompare(b.currency) || a.requestedDate.localeCompare(b.requestedDate)),
    warnings: [...log.warnings].sort((a, b) => order[a.level] - order[b.level]),
    missingRates: [...log.missingRates.values()].sort((a, b) => a.date.localeCompare(b.date)),
    coverage: cov,
    summary: {
      stcg: cg.stcg.gainInr,
      ltcg: cg.ltcg.gainInr,
      dividends: inc.dividendTotalInr,
      interest: inc.interestTotalInr,
      foreignTax: sum(inc.taxes.map((t) => t.conv?.inr)),
      ftcRelief: foreign.totals.reliefInr,
      faPeakTotal: sum(fa.a3.map((r) => r.peak?.inr)),
      faClosingTotal: sum(fa.a3.map((r) => r.closing?.inr)),
      a3Rows: fa.a3.length,
    },
  };
}

export interface SectionCheck {
  section: string;
  label: string;
  required: boolean;
  present: boolean;
  purpose: string;
  /** IBKR field labels missing from the export that the calculation needs. */
  missingCritical: string[];
  /** Missing fields that improve accuracy (fallbacks exist). */
  missingRecommended: string[];
}

/** IBKR's on-screen field labels for the XML attributes we rely on. */
const FIELD_LABEL: Record<string, string> = {
  openDateTime: 'Open Date Time',
  conid: 'Conid',
  isin: 'ISIN',
  levelOfDetail: 'Level of Detail',
  reportDate: 'Report Date',
  description: 'Description',
  issuerCountryCode: 'Issuer Country Code',
  tradeID: 'Trade ID',
  transactionID: 'Transaction ID',
  fifoPnlRealized: 'Realized P/L',
  cost: 'Cost Basis',
  costBasisMoney: 'Cost Basis Money',
  markPrice: 'Mark Price',
  dateOpened: 'Date Opened',
  price: 'Price',
  date: 'Date',
  ibCommission: 'IB Commission',
  proceeds: 'Proceeds',
  quantity: 'Quantity',
  position: 'Quantity',
  tradeDate: 'Trade Date',
  type: 'Type',
  amount: 'Amount',
  dateTime: 'Date/Time',
  balance: 'Balance',
  symbol: 'Symbol',
  currency: 'Currency',
  subCategory: 'Sub Category',
};

const SPEC: { section: string; label: string; required: boolean; purpose: string; critical: string[][]; recommended: string[] }[] = [
  { section: 'Trades', label: 'Trades (with Closed Lots)', required: true, purpose: 'Capital gains, lot history', critical: [['openDateTime'], ['cost'], ['proceeds'], ['quantity'], ['tradeDate', 'dateTime'], ['currency']], recommended: ['conid', 'ibCommission', 'fifoPnlRealized', 'levelOfDetail', 'tradeID', 'isin', 'description'] },
  { section: 'OpenPositions', label: 'Open Positions (Lot level)', required: true, purpose: 'Schedule FA holdings', critical: [['openDateTime'], ['position', 'quantity'], ['markPrice'], ['costBasisMoney'], ['currency']], recommended: ['conid', 'reportDate', 'levelOfDetail', 'description', 'isin'] },
  { section: 'CashTransactions', label: 'Cash Transactions', required: true, purpose: 'Dividends, interest, US tax withheld', critical: [['type'], ['amount'], ['dateTime'], ['currency'], ['symbol']], recommended: ['conid', 'description', 'transactionID', 'issuerCountryCode', 'isin'] },
  { section: 'AccountInformation', label: 'Account Information', required: false, purpose: 'Account number and opening date', critical: [['dateOpened']], recommended: [] },
  { section: 'PriorPeriodPositions', label: 'Prior Period Positions', required: false, purpose: 'Exact daily peak values', critical: [['date'], ['price']], recommended: ['conid'] },
  { section: 'StmtFunds', label: 'Statement of Funds', required: false, purpose: 'Daily cash balance (A2 peak)', critical: [['balance'], ['date']], recommended: [] },
  { section: 'SecuritiesInfo', label: 'Financial Instrument Information', required: false, purpose: 'Company names, ISIN, country', critical: [], recommended: ['description', 'isin', 'issuerCountryCode', 'subCategory'] },
  { section: 'CashReport', label: 'Cash Report', required: false, purpose: 'Opening and closing cash', critical: [], recommended: [] },
  { section: 'ChangeInDividendAccruals', label: 'Change in Dividend Accruals', required: false, purpose: 'Ex-dates for dividend matching', critical: [], recommended: [] },
  { section: 'CorporateActions', label: 'Corporate Actions', required: false, purpose: 'Splits and mergers', critical: [], recommended: [] },
];

/** Which Flex Query sections and fields were found across the uploaded files, and what each one unlocks. */
export function sectionChecklist(data: FlexData): SectionCheck[] {
  return SPEC.map((s) => {
    const present = data.sections.has(s.section);
    const fields = data.fields.get(s.section) ?? new Set<string>();
    const has = (k: string) => fields.has(k);
    const missingCritical = present ? s.critical.filter((alts) => !alts.some(has)).map((alts) => FIELD_LABEL[alts[0]] ?? alts[0]) : [];
    const missingRecommended = present ? s.recommended.filter((k) => !has(k)).map((k) => FIELD_LABEL[k] ?? k) : [];
    return { section: s.section, label: s.label, required: s.required, present, purpose: s.purpose, missingCritical, missingRecommended };
  });
}
