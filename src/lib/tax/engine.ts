import Decimal from 'decimal.js';
import { daysBetween, formatDate, type IsoDate } from '../dates';
import type { Account, FlexData } from '../flex/model';
import { capitalGains, nonNegativeAccrual, type CgResult, type CgTotals } from './cg';
import { Collector, type Settings, type Warning } from './common';
import { scheduleFA, type FaResult } from './fa';
import type { Fx } from './fx';
import { ftcGroups, income, type IncomeResult } from './income';
import { FA_PENALTY_RELIEF_INR, insights, US_ESTATE_EXEMPTION_USD, type Insights } from './insights';
import { foreignIncome, type ForeignResult } from './foreign';
import { aisFigures, type AisFigures } from './ais';
import type { RateUse } from './common';
import { addDays, taxYear, type TaxYear } from './years';
import { splitRatio } from './lots';
import { applyLotOverrides, lotsToCheck, type LotToCheck } from './lotcheck';

export interface Report {
  year: TaxYear;
  /** The first account; `accounts` lists every account combined in this report. */
  account: Account;
  accounts: Account[];
  /** "U1234567" or "U1234567 + U7654321". */
  accountLabel: string;
  settings: Settings;
  fa: FaResult;
  cg: CgResult;
  income: IncomeResult;
  insights: Insights;
  foreign: ForeignResult;
  /** Calendar-year figures as the AIS foreign-assets report shows them. */
  ais: AisFigures[];
  /** Lots without a cost, or dated on a transfer in, for the user to correct. */
  lotsToCheck: LotToCheck[];
  rates: RateUse[];
  warnings: Warning[];
  missingRates: { currency: string; date: IsoDate }[];
  coverage: { from: IsoDate; to: IsoDate }[];
  /** What each schedule group actually needs, after the account's start and today's date. */
  periods: { fa: Period; fy: Period };
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

export interface Period {
  /** The legal window, e.g. 1 Jan – 31 Dec. */
  from: IsoDate;
  to: IsoDate;
  /** The part that data must cover: from the account's first funding, up to the latest data while the year runs. */
  needFrom: IsoDate;
  needTo: IsoDate;
  /** The year hasn't ended yet: figures are provisional as of `needTo`. */
  inProgress: boolean;
  /** The account didn't exist during this window: nothing to report. */
  notApplicable: boolean;
  covered: boolean;
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

/** Required data range for a window, given when the account started and how far the year has run. */
export function period(cov: { from: IsoDate; to: IsoDate }[], account: Account, from: IsoDate, to: IsoDate, today: IsoDate): Period {
  const start = account.dateFunded ?? account.dateOpened ?? cov[0]?.from;
  const dataEnd = cov.at(-1)?.to;
  const inProgress = to >= today;
  const needFrom = start && start > from ? start : from;
  const needTo = inProgress && dataEnd && dataEnd < to ? dataEnd : to;
  const notApplicable = !!start && start > to;
  return { from, to, needFrom, needTo, inProgress, notApplicable, covered: notApplicable || covers(cov, needFrom, needTo) };
}

export function buildReport(raw: FlexData, account: Account, ayStart: number, settings: Settings, fx: Fx, opts: { today?: IsoDate; combined?: boolean } = {}): Report {
  const ty = taxYear(ayStart);
  const data = applyLotOverrides(raw, settings.lotOverrides ?? {});
  const toCheck = lotsToCheck(raw, account, ty, settings.lotOverrides ?? {});
  const log = new Collector();
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const cov = coverage(data, account.accountId);
  const covered = cov.length ? cov.map((r) => (r.from === r.to ? `only ${formatDate(r.from)}` : `${formatDate(r.from)} – ${formatDate(r.to)}`)).join(', ') : 'no dates';
  const periods = {
    fa: period(cov, account, ty.cyStart, ty.cyEnd, today),
    fy: period(cov, account, ty.fyStart, ty.fyEnd, today),
  };
  const started = account.dateFunded ?? account.dateOpened;

  for (const [p, what] of [
    [periods.fa, 'Schedule FA'],
    [periods.fy, 'Capital gains, dividends and the foreign tax credit'],
  ] as const) {
    if (p.notApplicable) {
      log.add('info', 'Coverage', `${what}: the account was funded on ${formatDate(started!)}, after ${formatDate(p.to)} — nothing from this account to report for ${ty.label}.`);
    } else if (!p.covered) {
      log.add('error', 'Coverage', `${what} needs ${formatDate(p.needFrom)} – ${formatDate(p.needTo)}, but your files cover ${covered}. In IBKR, run the query with a Custom Date Range of those dates and add that file.`);
    } else if (p.inProgress) {
      log.add('info', 'Coverage', `${what}: the period runs to ${formatDate(p.to)}, so figures are provisional as of ${formatDate(p.needTo)}. Export again after it ends for the final numbers.`);
    }
  }
  if (cov.length && (periods.fa.inProgress || periods.fy.inProgress) && daysBetween(cov.at(-1)!.to, today) > 10) {
    log.add('info', 'Coverage', `Your latest file ends ${formatDate(cov.at(-1)!.to)}. For up-to-date figures, run the query again up to the previous business day.`);
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
  const others = accountsIn(data).filter((a) => a.accountId !== account.accountId);
  if (others.length && !opts.combined) {
    log.add(
      'warn',
      'Accounts',
      `These figures are for ${account.accountId} only. The files also contain ${others.map((a) => a.accountId).join(', ')} — switch account in Upload statements and report it too (amounts add up; one FA A2 row per account).`,
    );
  }
  corporateActionNotes(data, account, ty, log);

  const fa = scheduleFA(data, account, ty, settings, fx, log, periods.fa.inProgress ? periods.fa.needTo : undefined);
  const cg = capitalGains(data, account, ty, settings, fx, log);
  const inc = income(data, account, ty, settings, fx, log, periods.fy.inProgress ? periods.fy.needTo : undefined);
  const ins = insights(data, account, ty, fa, fx, log);
  const foreign = foreignIncome(data, cg, inc, settings);
  if (ty.newAct && foreign.totals.taxPaidInr.gte(100_000)) {
    log.add('warn', ty.law.ftcForm, `Foreign tax paid is ₹1 lakh or more, so ${ty.law.ftcForm} must be verified by an accountant (Rule 76(16)).`);
  }
  if (settings.residency !== 'ROR') {
    log.add('info', 'Schedule FA', `Schedule FA applies only to residents who are ordinarily resident; as ${settings.residency === 'RNOR' ? 'RNOR' : 'a non-resident'} you do not fill it. The FA figures are shown for reference.`);
  }
  if (foreign.fsi.length && !settings.tin.trim()) {
    log.add('warn', 'Schedule FSI', 'Taxpayer Identification Number is empty. Use your US TIN if you have one, otherwise your passport number (as the official guide allows).');
  }

  const missingCost = toCheck.filter((l) => l.reason === 'zero-cost' && !l.override?.unitCost);
  if (missingCost.length) {
    log.add('error', 'Cost basis', `IBKR has no cost for ${[...new Set(missingCost.map((l) => l.symbol))].join(', ')} (usually shares transferred in). Without it the whole sale value counts as gain and the initial value in Schedule FA is zero — enter the cost under “Lots to check”.`);
  }

  const order = { error: 0, warn: 1, info: 2 };
  return {
    year: ty,
    account,
    accounts: [account],
    accountLabel: account.accountId,
    settings,
    fa,
    cg,
    income: inc,
    insights: ins,
    foreign,
    ais: [aisFigures(data, account, ty, fa)],
    lotsToCheck: toCheck,
    rates: [...log.rates.values()].sort((a, b) => a.currency.localeCompare(b.currency) || a.requestedDate.localeCompare(b.requestedDate)),
    warnings: [...log.warnings].sort((a, b) => order[a.level] - order[b.level]),
    missingRates: [...log.missingRates.values()].sort((a, b) => a.date.localeCompare(b.date)),
    coverage: cov,
    periods,
    summary: summarise(cg, inc, foreign, fa),
  };
}

const CA_NOTES: Record<string, string> = {
  SO: 'Spin-off: the new shares need a cost (usually the issuer\'s allocation on Form 8937) and keep the parent\'s purchase date. Indian law has no specific rule for foreign spin-offs — agree the treatment with your CA.',
  TC: 'Merger: a share-for-share exchange of a foreign company is generally a transfer for Indian tax (no exemption unless the acquirer is Indian). Cash received is a sale. Check with your CA.',
  TI: 'Tender: shares tendered for cash are a sale for capital gains.',
  SD: 'Stock dividend: the new shares are like bonus shares — cost nil and held from the allotment date.',
  DW: 'Delisted as worthless: claim the loss only when the shares are actually transferred or extinguished.',
  CD: 'Cash dividend paid through a corporate action: check it appears under dividends.',
  BM: 'Bond maturity: not computed by this tool.',
  TM: 'Treasury bill maturity: not computed by this tool.',
};

function corporateActionNotes(data: FlexData, account: Account, ty: TaxYear, log: Collector) {
  const area = 'Corporate actions';
  for (const ca of data.corporateActions.filter((c) => c.accountId === account.accountId && c.date >= ty.cyStart && c.date <= ty.fyEnd)) {
    const ratio = splitRatio(ca);
    if (ratio) {
      const r = ratio.gte(1) ? `${ratio.toString()}-for-1` : `1-for-${new Decimal(1).div(ratio).toDecimalPlaces(4).toString()}`;
      log.add('info', area, `${ca.symbol}: ${r} split on ${formatDate(ca.date)} applied — quantities before that date are in pre-split shares, and the purchase date and total cost carry over.`);
      if (ca.type === 'RS') log.add('warn', area, `${ca.symbol}: after a reverse split IBKR may issue a new contract ID. If the shares show up as a new lot dated ${formatDate(ca.date)}, correct its purchase date and cost in Review issues.`);
    } else if (/^(FS|RS)$/.test(ca.type)) {
      log.add('warn', area, `${ca.symbol} split on ${formatDate(ca.date)}, but the ratio could not be read from “${ca.description}”. Check the quantities and peak values for this holding.`);
    } else {
      log.add('warn', area, `${ca.symbol} on ${formatDate(ca.date)}: ${ca.description}. ${CA_NOTES[ca.type] ?? 'Check the affected lots\' quantities, cost and peak values.'}`);
    }
  }
  if (!data.sections.has('CorporateActions')) {
    // Without the section a split shows up only as a price jump in the daily prices.
    const series = new Map<string, { date: IsoDate; price: Decimal }[]>();
    for (const p of data.prices) if (p.accountId === account.accountId && p.date >= ty.cyStart && p.date <= ty.fyEnd) series.set(p.conid, [...(series.get(p.conid) ?? []), p]);
    for (const [conid, list] of series) {
      list.sort((a, b) => a.date.localeCompare(b.date));
      for (let i = 1; i < list.length; i++) {
        const r = list[i].price.div(list[i - 1].price);
        if (r.lte(0.55) || r.gte(1.9)) {
          const sym = data.instruments.get(conid)?.symbol ?? conid;
          log.add('warn', area, `${sym}'s price moved from ${list[i - 1].price.toFixed(2)} to ${list[i].price.toFixed(2)} on ${formatDate(list[i].date)} — possibly a split. Add the “Corporate Actions” section to your Flex Query so it can be applied.`);
          break;
        }
      }
    }
  }
  for (const t of data.transfers.filter((x) => x.accountId === account.accountId && x.date >= ty.cyStart && x.date <= ty.fyEnd)) {
    if (t.direction === 'OUT') {
      log.add('warn', 'Transfers', `${t.quantity.toString()} ${t.symbol} transferred out on ${formatDate(t.date)}. They were held until then, so they still belong in Schedule FA A3 for calendar ${t.date.slice(0, 4)} — add them from the receiving broker's records. A transfer between your own accounts is not a sale.`);
    } else {
      log.add('info', 'Transfers', `${t.quantity.toString()} ${t.symbol} transferred in on ${formatDate(t.date)}. Check the purchase date and cost of those lots in Review issues — for RSUs the cost is the market value taxed as salary on vesting (Form 16).`);
    }
  }
}

function summarise(cg: CgResult, inc: IncomeResult, foreign: ForeignResult, fa: FaResult): Report['summary'] {
  const sum = (xs: (Decimal | undefined)[]) => xs.reduce<Decimal>((s, x) => s.add(x ?? 0), new Decimal(0));
  return {
    stcg: cg.stcg.gainInr,
    ltcg: cg.ltcg.gainInr,
    dividends: inc.dividendTotalInr,
    interest: inc.interestTotalInr,
    foreignTax: sum(inc.taxes.map((t) => t.conv?.inr)),
    ftcRelief: foreign.totals.reliefInr,
    faPeakTotal: sum(fa.a3.map((r) => r.peak?.inr)),
    faClosingTotal: sum(fa.a3.map((r) => r.closing?.inr)),
    a3Rows: fa.a3.length,
  };
}

/**
 * One return for several IBKR accounts: each account is computed on its own, then capital gains,
 * income and Schedule FA rows are pooled. Table F, the foreign tax credit (per country and head)
 * and Schedules FSI/TR are recomputed on the pooled figures; Schedule FA keeps one A2 entry per account.
 */
export function buildCombinedReport(data: FlexData, accounts: Account[], ayStart: number, settings: Settings, fx: Fx, opts: { today?: IsoDate } = {}): Report {
  if (accounts.length === 1) return buildReport(data, accounts[0], ayStart, settings, fx, opts);
  const parts = accounts.map((a) => buildReport(data, a, ayStart, settings, fx, { ...opts, combined: true }));
  const first = parts[0];
  const ty = first.year;
  const zero = () => new Decimal(0);
  const add = (xs: Decimal[]) => xs.reduce((s, x) => s.add(x), zero());
  const addArrays = (xs: Decimal[][]) => xs[0].map((_, i) => add(xs.map((x) => x[i])));

  const totals = (pick: (r: Report) => CgTotals): CgTotals => {
    const ts = parts.map(pick);
    const quarters = addArrays(ts.map((t) => t.quarters));
    return {
      saleInr: add(ts.map((t) => t.saleInr)),
      costInr: add(ts.map((t) => t.costInr)),
      expensesInr: add(ts.map((t) => t.expensesInr)),
      gainInr: add(ts.map((t) => t.gainInr)),
      quarters,
      tableF: nonNegativeAccrual(quarters),
    };
  };
  const cg: CgResult = {
    rows: parts.flatMap((p) => p.cg.rows).sort((a, b) => a.lot.closeDate.localeCompare(b.lot.closeDate) || a.lot.symbol.localeCompare(b.lot.symbol)),
    stcg: totals((r) => r.cg.stcg),
    ltcg: totals((r) => r.cg.ltcg),
  };

  const log = new Collector();
  const byDate = <T extends { txn: { date: IsoDate } }>(a: T, b: T) => a.txn.date.localeCompare(b.txn.date);
  const pooled = {
    dividends: parts.flatMap((p) => p.income.dividends).sort(byDate),
    interest: parts.flatMap((p) => p.income.interest).sort(byDate),
    taxes: parts.flatMap((p) => p.income.taxes).sort(byDate),
  };
  const inc: IncomeResult = {
    ...pooled,
    dividendQuarters: addArrays(parts.map((p) => p.income.dividendQuarters)),
    dividendTotalInr: add(parts.map((p) => p.income.dividendTotalInr)),
    interestTotalInr: add(parts.map((p) => p.income.interestTotalInr)),
    ftc: ftcGroups(pooled, settings, log),
  };
  const foreign = foreignIncome(data, cg, inc, settings);

  const fa: FaResult = {
    a2: parts.flatMap((p) => p.fa.a2),
    a3: parts.flatMap((p) => p.fa.a3),
    snapshotDate: parts.map((p) => p.fa.snapshotDate).filter(Boolean).sort()[0],
    closeDate: first.fa.closeDate,
  };

  const ins = parts.map((p) => p.insights);
  const holdings = ins.flatMap((i) => i.holdings);
  const sumOpt = (xs: (Decimal | undefined)[]) => xs.reduce<Decimal>((s, x) => s.add(x ?? 0), zero());
  const usSitusUsd = add(ins.map((i) => i.usSitusUsd));
  // Each account's peak may fall on a different day; their sum is an upper bound for the combined peak.
  const faAggregateInr = add(ins.map((i) => i.faAggregateInr));
  const insights: Insights = {
    asOf: ins.map((i) => i.asOf).filter(Boolean).sort().at(-1),
    holdings,
    totals: { costInr: sumOpt(holdings.map((h) => h.costInr)), valueInr: sumOpt(holdings.map((h) => h.valueInr)), gainInr: sumOpt(holdings.map((h) => h.gainInr)) },
    turningLongTerm: ins.flatMap((i) => i.turningLongTerm).sort((a, b) => a.daysToLongTerm - b.daysToLongTerm),
    usSitusUsd,
    estateExposed: usSitusUsd.gt(US_ESTATE_EXEMPTION_USD),
    faAggregateInr,
    faAggregateDate: undefined,
    faBelowPenaltyThreshold: faAggregateInr.lte(FA_PENALTY_RELIEF_INR),
    overWithheld: ins.flatMap((i) => i.overWithheld),
    remittances: {
      depositsForeign: add(ins.map((i) => i.remittances.depositsForeign)),
      withdrawalsForeign: add(ins.map((i) => i.remittances.withdrawalsForeign)),
      currency: first.insights.remittances.currency,
      count: ins.reduce((s, i) => s + i.remittances.count, 0),
    },
  };

  // Warnings: shared ones once; ones that only some accounts raise are labelled with the account.
  const seen = new Map<string, { w: Warning; ids: string[] }>();
  parts.forEach((p) =>
    [...p.warnings, ...log.warnings].forEach((w) => {
      const key = `${w.level}|${w.area}|${w.message}`;
      const e = seen.get(key) ?? { w, ids: [] };
      if (!e.ids.includes(p.account.accountId)) e.ids.push(p.account.accountId);
      seen.set(key, e);
    }),
  );
  const order = { error: 0, warn: 1, info: 2 };
  const warnings = [...seen.values()]
    .map(({ w, ids }) => (ids.length === parts.length ? w : { ...w, area: `${w.area} · ${ids.join(', ')}` }))
    .sort((a, b) => order[a.level] - order[b.level]);
  if (insights.faAggregateInr.gt(0)) {
    warnings.push({ level: 'info', area: 'Insights', message: 'With several accounts, the ₹20 lakh test adds up each account\'s own peak — an upper bound, as the peaks may fall on different days.' });
  }

  const rates = new Map<string, RateUse>();
  for (const p of parts) for (const r of p.rates) {
    const key = `${r.currency}|${r.requestedDate}`;
    const e = rates.get(key);
    rates.set(key, e ? { ...e, usedFor: new Set([...e.usedFor, ...r.usedFor]) } : r);
  }
  const missing = new Map(parts.flatMap((p) => p.missingRates).map((m) => [`${m.currency}|${m.date}`, m]));
  const earliest = (k: 'fa' | 'fy') => parts.map((p) => p.periods[k]).sort((a, b) => a.needFrom.localeCompare(b.needFrom))[0];

  return {
    year: ty,
    account: first.account,
    accounts,
    accountLabel: accounts.map((a) => a.accountId).join(' + '),
    settings,
    fa,
    cg,
    income: inc,
    insights,
    foreign,
    ais: parts.flatMap((p) => p.ais),
    lotsToCheck: parts.flatMap((p) => p.lotsToCheck),
    rates: [...rates.values()].sort((a, b) => a.currency.localeCompare(b.currency) || a.requestedDate.localeCompare(b.requestedDate)),
    warnings,
    missingRates: [...missing.values()].sort((a, b) => a.date.localeCompare(b.date)),
    coverage: first.coverage,
    periods: {
      fa: { ...earliest('fa'), inProgress: parts.some((p) => p.periods.fa.inProgress), covered: parts.every((p) => p.periods.fa.covered) },
      fy: { ...earliest('fy'), inProgress: parts.some((p) => p.periods.fy.inProgress), covered: parts.every((p) => p.periods.fy.covered) },
    },
    summary: summarise(cg, inc, foreign, fa),
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
  /** Absent, but another section that was exported already provides this data. */
  coveredBy?: string;
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

const SPEC: { section: string; label: string; required: boolean; purpose: string; critical: string[][]; recommended: string[]; fallbackFor?: string }[] = [
  { section: 'Trades', label: 'Trades (with Closed Lots)', required: true, purpose: 'Capital gains, lot history', critical: [['openDateTime'], ['cost'], ['proceeds'], ['quantity'], ['tradeDate', 'dateTime'], ['currency']], recommended: ['conid', 'ibCommission', 'fifoPnlRealized', 'levelOfDetail', 'tradeID', 'isin', 'description'] },
  { section: 'OpenPositions', label: 'Open Positions (Lot level)', required: true, purpose: 'Schedule FA holdings', critical: [['openDateTime'], ['position', 'quantity'], ['markPrice'], ['costBasisMoney'], ['currency']], recommended: ['conid', 'reportDate', 'levelOfDetail', 'description', 'isin'] },
  { section: 'CashTransactions', label: 'Cash Transactions', required: true, purpose: 'Dividends, interest, US tax withheld', critical: [['type'], ['amount'], ['dateTime'], ['currency'], ['symbol']], recommended: ['conid', 'description', 'transactionID', 'issuerCountryCode', 'isin'] },
  { section: 'AccountInformation', label: 'Account Information', required: false, purpose: 'Account number and opening date', critical: [['dateOpened']], recommended: [] },
  { section: 'PriorPeriodPositions', label: 'Prior Period Positions', required: false, purpose: 'Exact daily peak values', critical: [['date'], ['price']], recommended: ['conid'] },
  { section: 'StmtFunds', label: 'Statement of Funds', required: false, purpose: 'Daily cash balance (A2 peak)', critical: [['balance'], ['date']], recommended: [] },
  { section: 'SecuritiesInfo', label: 'Financial Instrument Information', required: false, purpose: 'Company names, ISIN, country', critical: [], recommended: ['description', 'isin', 'issuerCountryCode', 'subCategory'] },
  { section: 'CashReport', label: 'Cash Report', required: false, purpose: 'Opening and closing cash', critical: [], recommended: [], fallbackFor: 'StmtFunds' },
  { section: 'ChangeInDividendAccruals', label: 'Change in Dividend Accruals', required: false, purpose: 'Ex-dates for dividend matching', critical: [], recommended: [] },
  { section: 'CorporateActions', label: 'Corporate Actions', required: false, purpose: 'Splits and mergers', critical: [], recommended: [] },
  { section: 'Transfers', label: 'Transfers', required: false, purpose: 'Shares moved in or out of the account', critical: [], recommended: [] },
];

/** Which Flex Query sections and fields were found across the uploaded files, and what each one unlocks. */
export function sectionChecklist(data: FlexData): SectionCheck[] {
  return SPEC.map((s) => {
    const present = data.sections.has(s.section);
    const fields = data.fields.get(s.section) ?? new Set<string>();
    const has = (k: string) => fields.has(k);
    const missingCritical = present ? s.critical.filter((alts) => !alts.some(has)).map((alts) => FIELD_LABEL[alts[0]] ?? alts[0]) : [];
    const missingRecommended = present ? s.recommended.filter((k) => !has(k)).map((k) => FIELD_LABEL[k] ?? k) : [];
    const coveredBy = !present && s.fallbackFor && data.sections.has(s.fallbackFor) ? SPEC.find((x) => x.section === s.fallbackFor)?.label : undefined;
    return { section: s.section, label: s.label, required: s.required, present, purpose: s.purpose, missingCritical, missingRecommended, coveredBy };
  });
}
