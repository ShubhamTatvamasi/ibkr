import type { IsoDate } from '../dates';
import Decimal from 'decimal.js';
import type { Account, CashTxn, FlexData } from '../flex/model';
import type { Collector, Conversion, Fx, Settings } from './common';
import { issuerCountry, reliefSection, TREATY_CAP, type Country } from './countries';
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
  section: '90' | '91';
  /** DTAA article; empty under section 91. */
  article: string;
  incomeInr: Decimal;
  foreignTaxInr: Decimal;
  indianTaxInr: Decimal;
  treatyCapInr?: Decimal;
  reliefInr: Decimal;
}

export interface IncomeResult {
  dividends: IncomeRow[];
  interest: IncomeRow[];
  taxes: TaxRow[];
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
    dividendQuarters: [0, 0, 0, 0, 0].map(() => new Decimal(0)),
    dividendTotalInr: new Decimal(0),
    interestTotalInr: new Decimal(0),
    ftc: [],
  };

  const taxes = inFy.filter((t) => t.kind === 'withholding');
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
        article: reliefSection(c.iso) === '91' ? '' : head === 'dividend' ? 'Article 10' : 'Article 11',
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
        `${g.country.name} ${g.head} withholding exceeds the ${capPct}% treaty rate — the excess is not creditable in India (check that your W-8BEN is on file with IBKR).`,
      );
    }
    out.push(g);
  }
  return out;
}
