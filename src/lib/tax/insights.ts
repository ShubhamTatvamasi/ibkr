import Decimal from 'decimal.js';
import type { IsoDate } from '../dates';
import { daysBetween } from '../dates';
import type { Account, FlexData } from '../flex/model';
import type { Collector, Fx } from './common';
import { issuerCountry, type Country } from './countries';
import type { FaResult } from './fa';
import { heldAt, buildLedger } from './lots';
import { addDays, addMonths, inRange, type TaxYear } from './years';

/** Non-resident aliens get a $60,000 US estate-tax exemption on US-situs assets. */
export const US_ESTATE_EXEMPTION_USD = 60_000;
/** Black Money Act: no penalty for non-disclosure when non-immovable foreign assets total ≤ ₹20 lakh. */
export const FA_PENALTY_RELIEF_INR = 20_00_000;
/** India–US DTAA rate on portfolio dividends for individuals. */
const US_TREATY_DIVIDEND = new Decimal(0.25);

export interface Holding {
  symbol: string;
  description: string;
  country: Country;
  currency: string;
  acquired: IsoDate;
  qty: Decimal;
  costForeign: Decimal;
  valueForeign: Decimal;
  costInr?: Decimal;
  valueInr?: Decimal;
  gainInr?: Decimal;
  /** First date a sale would be long-term (held more than 24 months). */
  longTermFrom: IsoDate;
  daysToLongTerm: number;
}

export interface Insights {
  asOf?: IsoDate;
  holdings: Holding[];
  totals: { costInr: Decimal; valueInr: Decimal; gainInr: Decimal };
  turningLongTerm: Holding[];
  usSitusUsd: Decimal;
  estateExposed: boolean;
  faAggregateInr: Decimal;
  faBelowPenaltyThreshold: boolean;
  overWithheld: { symbol: string; dividendForeign: Decimal; taxForeign: Decimal; ratePct: Decimal }[];
  remittances: { depositsForeign: Decimal; withdrawalsForeign: Decimal; currency: string; count: number };
}

export function insights(data: FlexData, account: Account, ty: TaxYear, fa: FaResult, fx: Fx, log: Collector): Insights {
  // Latest holdings: anchor the ledger at the newest snapshot available.
  const latest = data.openLots
    .filter((l) => l.accountId === account.accountId)
    .map((l) => l.reportDate)
    .sort()
    .at(-1);
  const holdings: Holding[] = [];
  let usSitusUsd = new Decimal(0);
  if (latest) {
    const ledger = buildLedger(data, account.accountId, latest);
    for (const lot of ledger.lots) {
      const qty = heldAt(lot, latest);
      if (qty.lte(0)) continue;
      const inst = data.instruments.get(lot.conid);
      const country = issuerCountry(inst?.issuerCountryCode, inst?.isin);
      const mark = lot.snapshotMark ?? new Decimal(0);
      const costForeign = lot.unitCost.mul(qty);
      const valueForeign = mark.mul(qty);
      const cost = log.convert('Insights', () => fx.on(costForeign, lot.currency, lot.openDate));
      const value = log.convert('Insights', () => fx.on(valueForeign, lot.currency, latest));
      const longTermFrom = addDays(addMonths(lot.openDate, 24), 1);
      holdings.push({
        symbol: lot.symbol,
        description: inst?.description || lot.description,
        country,
        currency: lot.currency,
        acquired: lot.openDate,
        qty,
        costForeign,
        valueForeign,
        costInr: cost?.inr,
        valueInr: value?.inr,
        gainInr: cost && value ? value.inr.sub(cost.inr) : undefined,
        longTermFrom,
        daysToLongTerm: Math.max(0, daysBetween(latest, longTermFrom)),
      });
      if (country.iso === 'US' && lot.currency === 'USD') usSitusUsd = usSitusUsd.add(valueForeign);
    }
  }
  const sum = (xs: (Decimal | undefined)[]) => xs.reduce<Decimal>((s, x) => s.add(x ?? 0), new Decimal(0));

  // Dividend withholding above the treaty rate usually means a missing or expired W-8BEN.
  const fyCash = data.cash.filter((t) => t.accountId === account.accountId && inRange(t.date, ty.fyStart, ty.fyEnd));
  const bySymbol = new Map<string, { div: Decimal; tax: Decimal }>();
  for (const t of fyCash) {
    if (!t.symbol || (t.kind !== 'dividend' && t.kind !== 'withholding')) continue;
    if (issuerCountry(t.issuerCountryCode, t.isin).iso !== 'US') continue;
    const e = bySymbol.get(t.symbol) ?? { div: new Decimal(0), tax: new Decimal(0) };
    if (t.kind === 'dividend') e.div = e.div.add(t.amount);
    else e.tax = e.tax.sub(t.amount);
    bySymbol.set(t.symbol, e);
  }
  const overWithheld = [...bySymbol.entries()]
    .filter(([, e]) => e.div.gt(0) && e.tax.div(e.div).gt(US_TREATY_DIVIDEND.add(0.005)))
    .map(([symbol, e]) => ({ symbol, dividendForeign: e.div, taxForeign: e.tax, ratePct: e.tax.div(e.div).mul(100) }));

  const transfers = fyCash.filter((t) => t.kind === 'transfer');
  const remittances = {
    depositsForeign: sum(transfers.filter((t) => t.amount.gt(0)).map((t) => t.amount)),
    withdrawalsForeign: sum(transfers.filter((t) => t.amount.lt(0)).map((t) => t.amount.neg())),
    currency: account.baseCurrency,
    count: transfers.length,
  };

  // Aggregate value for the ₹20 lakh threshold: peak of holdings plus peak cash (conservative).
  const faAggregateInr = sum(fa.a3.map((r) => r.peak?.inr)).add(sum(fa.a2.map((a) => a.peak?.inr)));

  const turningLongTerm = holdings
    .filter((h) => h.daysToLongTerm > 0 && h.daysToLongTerm <= 120)
    .sort((a, b) => a.daysToLongTerm - b.daysToLongTerm);

  return {
    asOf: latest,
    holdings,
    totals: { costInr: sum(holdings.map((h) => h.costInr)), valueInr: sum(holdings.map((h) => h.valueInr)), gainInr: sum(holdings.map((h) => h.gainInr)) },
    turningLongTerm,
    usSitusUsd,
    estateExposed: usSitusUsd.gt(US_ESTATE_EXEMPTION_USD),
    faAggregateInr,
    faBelowPenaltyThreshold: faAggregateInr.lte(FA_PENALTY_RELIEF_INR),
    overWithheld,
    remittances,
  };
}


