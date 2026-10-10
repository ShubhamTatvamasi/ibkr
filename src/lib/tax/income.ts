import type { IsoDate } from '../dates';
import Decimal from 'decimal.js';
import type { Account, CashTxn, FlexData } from '../flex/model';
import type { Collector, Conversion, Fx, Settings } from './common';
import { issuerCountry, reliefSection, treatyArticle, TREATY_CAP, type Country, type ReliefSection } from './countries';
import { inRange, quarterIndex, type TaxYear } from './years';

export interface IncomeRow {
  txn: CashTxn;
  description: string;
  country: Country;
  quarter: number;
  conv?: Conversion;
  /** Matching US/foreign withholding on the same payment, as a positive number. */
  withheldForeign: Decimal;
}

export interface TaxRow {
  txn: CashTxn;
  head: 'dividend' | 'interest';
  country: Country;
  conv?: Conversion;
}

export interface FtcCountry {
  country: Country;
  head: 'dividend' | 'interest';
  /** Section 90 (treaty) or 91 (no treaty with that country). */
  section: ReliefSection;
  /** DTAA article; empty under section 91. */
  article: string;
  incomeInr: Decimal;
  foreignTaxInr: Decimal;
  indianTaxInr: Decimal;
  treatyCapInr?: Decimal;
  reliefInr: Decimal;
}

/** Foreign tax refunded this year that was withheld (and credited) in an earlier year. */
export interface TaxRefund {
  txn: CashTxn;
  /** The original deduction, when it is in the uploaded files. */
  original?: CashTxn;
  /** Assessment year in which relief for the original tax was claimed, if known. */
  reliefAy?: number;
  conv?: Conversion;
}

export interface IncomeResult {
  dividends: IncomeRow[];
  interest: IncomeRow[];
  taxes: TaxRow[];
  refunds: TaxRefund[];
  dividendQuarters: Decimal[];
  dividendTotalInr: Decimal;
  interestTotalInr: Decimal;
  ftc: FtcCountry[];
}

function countryOf(data: FlexData, t: CashTxn): Country {
  const inst = t.conid ? data.instruments.get(t.conid) : undefined;
  return issuerCountry(t.issuerCountryCode ?? inst?.issuerCountryCode, t.isin ?? inst?.isin);
}

/** `asOf` is set while the financial year is still running (the 31 March rate doesn't exist yet). */
export function income(data: FlexData, account: Account, ty: TaxYear, settings: Settings, fx: Fx, log: Collector, asOf?: IsoDate): IncomeResult {
  const inFy = data.cash.filter((t) => t.accountId === account.accountId && inRange(t.date, ty.fyStart, ty.fyEnd));
  const res: IncomeResult = {
    dividends: [],
    interest: [],
    taxes: [],
    refunds: [],
    dividendQuarters: [0, 0, 0, 0, 0].map(() => new Decimal(0)),
    dividendTotalInr: new Decimal(0),
    interestTotalInr: new Decimal(0),
    ftc: [],
  };

  // A positive withholding row is a refund. Within the year it just nets off; a refund of tax
  // withheld in an earlier year doesn't reduce this year's credit — that year's relief is reduced
  // instead (Schedule TR item 4).
  const allTaxes = data.cash.filter((t) => t.accountId === account.accountId && t.kind === 'withholding');
  const earlierRefund = (t: CashTxn): CashTxn | true | undefined => {
    if (!t.amount.gt(0)) return undefined;
    const sameYear = inFy.some((w) => w.kind === 'withholding' && w.conid === t.conid && w.amount.eq(t.amount.neg()) && w.date <= t.date);
    if (sameYear) return undefined;
    const original = allTaxes.filter((w) => w.conid === t.conid && w.amount.eq(t.amount.neg()) && w.date < ty.fyStart).sort((a, b) => b.date.localeCompare(a.date))[0];
    if (original) return original;
    // No matching deduction in the files: earlier-year if nothing was paid on this holding earlier this year.
    const paidThisYear = inFy.some(
      (d) => d !== t && d.conid === t.conid && d.date <= t.date && ((d.kind === 'dividend' && d.amount.gt(0)) || (d.kind === 'withholding' && d.amount.lt(0))),
    );
    return paidThisYear ? undefined : true;
  };
  const taxes: CashTxn[] = [];
  for (const t of inFy.filter((x) => x.kind === 'withholding')) {
    const prior = earlierRefund(t);
    if (!prior) {
      taxes.push(t);
      continue;
    }
    const original = prior === true ? undefined : prior;
    const fyOf = (d: string) => (Number(d.slice(5, 7)) >= 4 ? Number(d.slice(0, 4)) : Number(d.slice(0, 4)) - 1);
    res.refunds.push({
      txn: t,
      original,
      reliefAy: original ? fyOf(original.date) + 1 : undefined,
      conv: log.convert('Foreign tax credit', () => fx.monthEndBefore(t.amount, t.currency, original?.date ?? t.date)),
    });
    log.add(
      'warn',
      'Foreign tax refunded',
      `${t.symbol ?? 'Foreign'} tax of ${t.currency} ${t.amount.toFixed(2)} refunded on ${t.date}${original ? ` was withheld on ${original.date}` : ' relates to an earlier year'}. It is left out of this year's credit; answer “Yes” in Schedule TR item 4, and the relief claimed for that year has to be reduced — tell your CA.`,
    );
  }
  const isInterestTax = (t: CashTxn) => !t.conid || /\bINT\b|INTEREST/i.test(t.description);

  for (const t of inFy) {
    if (t.kind === 'dividend') {
      const conv = log.convert('Dividends', () => fx.monthEndBefore(t.amount, t.currency, t.date));
      const withheld = taxes
        .filter((w) => w.conid === t.conid && w.date === t.date && !isInterestTax(w))
        .reduce((s, w) => s.sub(w.amount), new Decimal(0));
      const row: IncomeRow = {
        txn: t,
        description: t.description,
        country: countryOf(data, t),
        quarter: quarterIndex(t.date),
        conv,
        withheldForeign: withheld,
      };
      res.dividends.push(row);
      if (conv) {
        res.dividendTotalInr = res.dividendTotalInr.add(conv.inr);
        res.dividendQuarters[row.quarter] = res.dividendQuarters[row.quarter].add(conv.inr);
      }
    } else if (t.kind === 'interest') {
      const conv = log.convert('Interest', () =>
        settings.interestRate === 'fyEnd' ? fx.on(t.amount, t.currency, asOf ?? ty.fyEnd) : fx.monthEndBefore(t.amount, t.currency, t.date),
      );
      res.interest.push({ txn: t, description: t.description, country: countryOf(data, t), quarter: quarterIndex(t.date), conv, withheldForeign: new Decimal(0) });
      if (conv) res.interestTotalInr = res.interestTotalInr.add(conv.inr);
    }
  }

  // Foreign tax: each deduction at the TTBR of the month-end before the month it was deducted (Rule 128 / 76).
  for (const t of taxes) {
    const head = isInterestTax(t) ? 'interest' : 'dividend';
    const conv = log.convert('Foreign tax credit', () => fx.monthEndBefore(t.amount.neg(), t.currency, t.date));
    res.taxes.push({ txn: t, head, country: head === 'interest' ? issuerCountry('US') : countryOf(data, t), conv });
  }

  res.ftc = ftcGroups(res, settings, log);
  return res;
}

/** Relief per country and head: min(foreign tax, Indian tax on that income, treaty cap). */
export function ftcGroups(res: Pick<IncomeResult, 'dividends' | 'interest' | 'taxes'>, settings: Settings, log: Collector): FtcCountry[] {
  const out: FtcCountry[] = [];
  const groups = new Map<string, FtcCountry>();
  const group = (c: Country, head: 'dividend' | 'interest') => {
    const key = `${c.iso}|${head}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        country: c,
        head,
        section: reliefSection(c.iso),
        article: reliefSection(c.iso) === '91' ? '' : treatyArticle(c.iso, head),
        incomeInr: new Decimal(0),
        foreignTaxInr: new Decimal(0),
        indianTaxInr: new Decimal(0),
        reliefInr: new Decimal(0),
      };
      groups.set(key, g);
    }
    return g;
  };
  for (const r of res.dividends) if (r.conv) group(r.country, 'dividend').incomeInr = group(r.country, 'dividend').incomeInr.add(r.conv.inr);
  for (const r of res.interest) if (r.conv) group(r.country, 'interest').incomeInr = group(r.country, 'interest').incomeInr.add(r.conv.inr);
  for (const t of res.taxes) if (t.conv) group(t.country, t.head).foreignTaxInr = group(t.country, t.head).foreignTaxInr.add(t.conv.inr);

  const marginal = new Decimal(settings.marginalRatePct).div(100);
  for (const g of groups.values()) {
    if (g.foreignTaxInr.lte(0)) continue;
    g.indianTaxInr = g.incomeInr.mul(marginal);
    const capPct = TREATY_CAP[g.country.iso]?.[g.head];
    if (capPct !== undefined) g.treatyCapInr = g.incomeInr.mul(capPct).div(100);
    g.reliefInr = Decimal.min(g.foreignTaxInr, g.indianTaxInr, g.treatyCapInr ?? g.foreignTaxInr);
    if (g.treatyCapInr && g.foreignTaxInr.gt(g.treatyCapInr.mul(1.01))) {
      log.add(
        'warn',
        'Foreign tax credit',
        `${g.country.name} ${g.head} withholding exceeds the ${capPct}% treaty rate — the excess is not creditable in India. ${g.country.iso === 'US' ? 'Check that your W-8BEN is on file with IBKR (it lapses after three calendar years).' : 'The excess can usually be reclaimed from that country\'s tax authority with a certificate of Indian residence.'}`,
      );
    }
    out.push(g);
  }
  return out;
}
