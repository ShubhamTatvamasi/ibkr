import Decimal from 'decimal.js';
import type { IsoDate } from '../dates';
import type { Account, FlexData } from '../flex/model';
import { type Collector, type Conversion, type Fx, type Settings } from './common';
import { country, issuerCountry, type Country } from './countries';
import { buildLedger, heldAt, type Lot } from './lots';
import { addDays, inRange, type TaxYear } from './years';

export interface FaA3Row {
  lot: Lot;
  country: Country;
  entityName: string;
  natureOfEntity: string;
  isin?: string;
  acquired: IsoDate;
  qtyStart: Decimal;
  qtyEnd: Decimal;
  initial?: Conversion;
  peak?: { inr: Decimal; date: IsoDate; qty: Decimal; price: Decimal; rate: Decimal };
  peakQuality: 'daily' | 'approximate';
  closingPrice?: Decimal;
  closing?: Conversion;
  dividends: { foreign: Decimal; inr: Decimal };
  proceeds: { foreign: Decimal; inr: Decimal };
}

export interface FaA2Row {
  account: Account;
  institution: Institution;
  country: Country;
  peak?: { inr: Decimal; date: IsoDate };
  closing?: Decimal;
  cashQuality: 'daily' | 'approximate' | 'missing';
  credited: { nature: 'Dividend' | 'Interest' | 'Proceeds from sale'; code: 'D' | 'I' | 'S'; inr: Decimal }[];
}

export interface Institution {
  name: string;
  address: string;
  zip: string;
  countryIso: string;
}

const INSTITUTIONS: Record<string, Institution> = {
  'IBLLC-US': { name: 'Interactive Brokers LLC', address: 'One Pickwick Plaza, Greenwich, Connecticut', zip: '06830', countryIso: 'US' },
  'IB-UK': { name: 'Interactive Brokers (U.K.) Limited', address: '20 Fenchurch Street, Level 20, London', zip: 'EC3M3BY', countryIso: 'GB' },
  'IB-IE': { name: 'Interactive Brokers Ireland Limited', address: '10 Earlsfort Terrace, Dublin 2', zip: 'D02T380', countryIso: 'IE' },
};

export function institutionFor(account: Account): Institution {
  return INSTITUTIONS[account.ibEntity ?? ''] ?? INSTITUTIONS['IBLLC-US'];
}

export interface FaResult {
  a2: FaA2Row[];
  a3: FaA3Row[];
  snapshotDate?: IsoDate;
}

export function scheduleFA(data: FlexData, account: Account, ty: TaxYear, settings: Settings, fx: Fx, log: Collector): FaResult {
  const { cyStart, cyEnd } = ty;
  const area = 'Schedule FA';
  const ledger = buildLedger(data, account.accountId, cyEnd);
  if (!ledger.snapshotDate) {
    log.add('error', area, 'No Open Positions (Lot level) found — Schedule FA A3 cannot be built. Add the Open Positions section with Options = Lot.');
  } else if (ledger.snapshotDate < cyEnd) {
    log.add('error', area, `Latest open-positions snapshot is ${ledger.snapshotDate}, before 31 Dec. Upload an export that ends on or after ${cyEnd}.`);
  }

  const prices = pricesByConid(data, account.accountId);
  const hasDaily = data.sections.has('PriorPeriodPositions');
  if (!hasDaily) {
    log.add('warn', area, 'No Prior Period Positions section: peak values are estimated from trade, year-end and cost prices only. Add Prior Period Positions to the Flex Query for exact daily peaks.');
  }

  const incomeRate = (amount: Decimal, ccy: string, date: IsoDate) =>
    log.convert(area, () => fx.on(amount, ccy, settings.faIncomeRate === 'cyEnd' ? cyEnd : date));

  const a3: FaA3Row[] = [];
  for (const lot of ledger.lots) {
    if (lot.openDate > cyEnd) continue;
    const qtyStart = lot.openDate >= cyStart ? heldAt(lot, lot.openDate).add(soldOn(lot, lot.openDate)) : heldAt(lot, addDays(cyStart, -1));
    const soldInYear = lot.closures.filter((c) => inRange(c.closeDate, cyStart, cyEnd));
    if (qtyStart.isZero() && soldInYear.length === 0) continue;

    const inst = data.instruments.get(lot.conid);
    const ctry = issuerCountry(inst?.issuerCountryCode, inst?.isin);
    const qtyEnd = heldAt(lot, cyEnd);

    const initial = log.convert(area, () => fx.on(lot.unitCost.mul(qtyStart), lot.currency, lot.openDate));

    // Peak: max over days of qty held × price × that day's TTBR (the INR series, not the USD one).
    const series = prices.get(lot.conid) ?? [];
    const candidates: { date: IsoDate; price: Decimal }[] = series.filter((p) => inRange(p.date, cyStart, cyEnd));
    if (lot.openDate >= cyStart) candidates.push({ date: lot.openDate, price: lot.unitCost });
    for (const c of soldInYear) candidates.push({ date: c.closeDate, price: c.proceeds.div(c.quantity) });
    const closingPrice = priceAt(series, cyEnd) ?? (ledger.snapshotDate === cyEnd ? lot.snapshotMark : undefined);
    if (closingPrice) candidates.push({ date: cyEnd, price: closingPrice });
    if (lot.openDate < cyStart) {
      const opening = priceAt(series, addDays(cyStart, -1));
      if (opening) candidates.push({ date: cyStart, price: opening });
    }

    let peak: FaA3Row['peak'];
    for (const { date, price } of candidates) {
      // On a sale day the shares were held until the sale, so count the pre-sale quantity.
      const qty = heldAt(lot, date).add(soldOn(lot, date));
      if (qty.isZero()) continue;
      const conv = log.convert(area, () => fx.on(qty.mul(price), lot.currency, date));
      if (conv && (!peak || conv.inr.gt(peak.inr))) peak = { inr: conv.inr, date, qty, price, rate: conv.rate };
    }
    const daysInSeries = series.filter((p) => inRange(p.date, cyStart, cyEnd)).length;
    const peakQuality: FaA3Row['peakQuality'] = hasDaily && daysInSeries >= 20 ? 'daily' : 'approximate';

    let closing: Conversion | undefined;
    if (qtyEnd.gt(0)) {
      if (closingPrice) closing = log.convert(area, () => fx.on(qtyEnd.mul(closingPrice), lot.currency, cyEnd));
      else log.add('error', area, `${lot.symbol}: no price for 31 Dec — closing value missing.`);
    }

    let proceedsForeign = new Decimal(0);
    let proceedsInr = new Decimal(0);
    for (const c of soldInYear) {
      const conv = incomeRate(c.proceeds, c.currency, c.closeDate);
      proceedsForeign = proceedsForeign.add(c.proceeds);
      if (conv) proceedsInr = proceedsInr.add(conv.inr);
    }

    a3.push({
      lot,
      country: ctry,
      entityName: inst?.description || lot.description,
      natureOfEntity: inst?.subCategory?.toUpperCase().includes('ETF') ? 'ETF' : 'Company',
      isin: inst?.isin,
      acquired: lot.openDate,
      qtyStart,
      qtyEnd,
      initial,
      peak,
      peakQuality,
      closingPrice,
      closing,
      dividends: { foreign: new Decimal(0), inr: new Decimal(0) },
      proceeds: { foreign: proceedsForeign, inr: proceedsInr },
    });
  }

  allocateDividends(data, account, ty, a3, incomeRate, log);
  const a2 = [custodialAccount(data, account, ty, settings, fx, log, a3)];
  return { a2, a3, snapshotDate: ledger.snapshotDate };
}

function soldOn(lot: Lot, date: IsoDate): Decimal {
  return lot.closures.filter((c) => c.closeDate === date).reduce((s, c) => s.add(c.quantity), new Decimal(0));
}

function pricesByConid(data: FlexData, accountId: string) {
  const m = new Map<string, { date: IsoDate; price: Decimal }[]>();
  for (const p of data.prices) {
    if (p.accountId !== accountId) continue;
    const list = m.get(p.conid) ?? [];
    list.push({ date: p.date, price: p.price });
    m.set(p.conid, list);
  }
  for (const list of m.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return m;
}

/** Latest price on or up to 7 days before `date`. */
function priceAt(series: { date: IsoDate; price: Decimal }[], date: IsoDate): Decimal | undefined {
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].date <= date) return series[i].date >= addDays(date, -7) ? series[i].price : undefined;
  }
  return undefined;
}

/** A dividend belongs only to the lots held on the day before the ex-date (pay date if unknown). */
function allocateDividends(
  data: FlexData,
  account: Account,
  ty: TaxYear,
  rows: FaA3Row[],
  convert: (a: Decimal, c: string, d: IsoDate) => Conversion | undefined,
  log: Collector,
) {
  const byConid = new Map<string, FaA3Row[]>();
  for (const r of rows) byConid.set(r.lot.conid, [...(byConid.get(r.lot.conid) ?? []), r]);

  for (const t of data.cash) {
    if (t.accountId !== account.accountId || t.kind !== 'dividend' || !t.conid) continue;
    if (!inRange(t.date, ty.cyStart, ty.cyEnd)) continue;
    const lots = byConid.get(t.conid);
    if (!lots) {
      log.add('warn', 'Schedule FA', `${t.symbol} dividend on ${t.date} has no matching lot in the year; it is counted in A2 only.`);
      continue;
    }
    const accrual = data.dividendAccruals.find((a) => a.conid === t.conid && a.payDate === t.date && a.exDate);
    let ref = accrual?.exDate ? addDays(accrual.exDate, -1) : t.date;
    let held = lots.map((r) => heldAt(r.lot, ref));
    let total = held.reduce((s, q) => s.add(q), new Decimal(0));
    for (let back = 1; total.isZero() && back <= 120; back++) {
      ref = addDays(t.date, -back);
      held = lots.map((r) => heldAt(r.lot, ref));
      total = held.reduce((s, q) => s.add(q), new Decimal(0));
    }
    if (total.isZero()) continue;
    const conv = convert(t.amount, t.currency, t.date);
    lots.forEach((r, i) => {
      if (held[i].isZero()) return;
      const share = held[i].div(total);
      r.dividends.foreign = r.dividends.foreign.add(t.amount.mul(share));
      if (conv) r.dividends.inr = r.dividends.inr.add(conv.inr.mul(share));
    });
  }
}

function custodialAccount(
  data: FlexData,
  account: Account,
  ty: TaxYear,
  settings: Settings,
  fx: Fx,
  log: Collector,
  a3: FaA3Row[],
): FaA2Row {
  const area = 'Schedule FA A2';
  const inst = institutionFor(account);
  const row: FaA2Row = { account, institution: inst, country: country(inst.countryIso), cashQuality: 'missing', credited: [] };
  if (!account.dateOpened) log.add('warn', area, 'Account opening date missing — add "Date Opened" in the Account Information section.');

  // Daily cash balance per currency from Statement of Funds (last balance of each day).
  const lines = data.funds.filter((f) => f.accountId === account.accountId);
  const useLevel = lines.some((f) => f.levelOfDetail === 'Currency') ? 'Currency' : lines[0]?.levelOfDetail;
  const perCcy = new Map<string, Map<IsoDate, Decimal>>();
  const opening = new Map<string, Decimal>();
  for (const f of lines.filter((f) => f.levelOfDetail === useLevel)) {
    const ccy = f.currency === 'BASE_SUMMARY' ? account.baseCurrency : f.currency;
    if (f.date < ty.cyStart) {
      opening.set(ccy, f.balance);
      continue;
    }
    if (f.date > ty.cyEnd) continue;
    const m = perCcy.get(ccy) ?? new Map<IsoDate, Decimal>();
    if (!m.size && !opening.has(ccy)) opening.set(ccy, f.balance.sub(f.amount));
    m.set(f.date, f.balance);
    perCcy.set(ccy, m);
  }

  if (perCcy.size > 0) {
    row.cashQuality = 'daily';
    const dates = [...new Set([ty.cyStart, ...[...perCcy.values()].flatMap((m) => [...m.keys()]), ty.cyEnd])].sort();
    const current = new Map(opening);
    for (const d of dates) {
      let total = new Decimal(0);
      for (const [ccy, m] of perCcy) {
        if (m.has(d)) current.set(ccy, m.get(d)!);
      }
      for (const [ccy, bal] of current) {
        const conv = log.convert(area, () => fx.on(bal, ccy, d));
        if (conv) total = total.add(conv.inr);
      }
      if (!row.peak || total.gt(row.peak.inr)) row.peak = { inr: total, date: d };
      if (d === ty.cyEnd) row.closing = total;
    }
  } else {
    const reports = data.cashReports.filter((c) => c.accountId === account.accountId && c.toDate === ty.cyEnd && c.levelOfDetail === 'Currency');
    if (reports.length) {
      row.cashQuality = 'approximate';
      let start = new Decimal(0);
      let end = new Decimal(0);
      for (const r of reports) {
        const s = log.convert(area, () => fx.on(r.startingCash, r.currency, r.fromDate));
        const e = log.convert(area, () => fx.on(r.endingCash, r.currency, ty.cyEnd));
        if (s) start = start.add(s.inr);
        if (e) end = end.add(e.inr);
      }
      row.closing = end;
      row.peak = start.gt(end) ? { inr: start, date: ty.cyStart } : { inr: end, date: ty.cyEnd };
      log.add('warn', area, 'Peak cash balance approximated from opening/closing cash only. Add the Statement of Funds section for the true daily peak.');
    } else {
      log.add('error', area, 'No cash data (Statement of Funds or Cash Report ending 31 Dec) — A2 peak and closing balances are missing.');
    }
  }
  if (row.peak && row.peak.inr.lt(0)) row.peak = { ...row.peak, inr: new Decimal(0) };
  if (row.closing?.lt(0)) row.closing = new Decimal(0);

  // Gross amounts credited to the account during the calendar year.
  const conv = (amount: Decimal, ccy: string, date: IsoDate) =>
    log.convert(area, () => fx.on(amount, ccy, settings.faIncomeRate === 'cyEnd' ? ty.cyEnd : date));
  const sum = (kind: 'dividend' | 'interest') =>
    data.cash
      .filter((t) => t.accountId === account.accountId && t.kind === kind && inRange(t.date, ty.cyStart, ty.cyEnd))
      .reduce((s, t) => s.add(conv(t.amount, t.currency, t.date)?.inr ?? 0), new Decimal(0));
  const div = sum('dividend');
  const int = sum('interest');
  const proceeds = a3.reduce((s, r) => s.add(r.proceeds.inr), new Decimal(0));
  if (div.gt(0)) row.credited.push({ nature: 'Dividend', code: 'D', inr: div });
  if (int.gt(0)) row.credited.push({ nature: 'Interest', code: 'I', inr: int });
  if (proceeds.gt(0)) row.credited.push({ nature: 'Proceeds from sale', code: 'S', inr: proceeds });
  return row;
}
