import Decimal from 'decimal.js';
import type { IsoDate } from '../dates';
import type { Account, FlexData } from '../flex/model';
import type { FaResult } from './fa';
import { inRange, type TaxYear } from './years';

/**
 * Calendar-year figures in the shape the AIS "Foreign Assets Information" report shows them
 * (reported by the foreign institution under CRS/FATCA, in the account currency), so the user can
 * compare the two before answering a mismatch.
 */
export interface AisFigures {
  accountId: string;
  currency: string;
  calendarYear: string;
  closeDate: IsoDate;
  dividends: Decimal;
  interest: Decimal;
  grossProceeds: Decimal;
  cash: Decimal;
  holdings: Decimal;
  balance: Decimal;
  /** Currencies other than the account currency that were left out of the totals. */
  otherCurrencies: string[];
}

export type AisLine = 'dividends' | 'interest' | 'grossProceeds' | 'balance';

export const AIS_LINES: { key: AisLine; label: string; hint: string }[] = [
  {
    key: 'dividends',
    label: 'Dividends',
    hint: 'Gross, before US tax. An AIS figure about 25% lower is usually net of withholding. Payments in lieu of dividends may be counted elsewhere.',
  },
  { key: 'interest', label: 'Interest', hint: 'Interest IBKR paid on cash. Bond coupons, if any, are also reported as interest.' },
  {
    key: 'grossProceeds',
    label: 'Gross proceeds',
    hint: 'Sale value of shares and ETFs sold in the calendar year. Institutions may also include currency conversions, options or redemptions, which this tool does not count.',
  },
  {
    key: 'balance',
    label: 'Account balance',
    hint: 'Value of the account at 31 December: cash plus holdings at the closing price. Some institutions report cash only.',
  },
];

export function aisFigures(data: FlexData, account: Account, ty: TaxYear, fa: FaResult): AisFigures {
  const ccy = account.baseCurrency || 'USD';
  const other = new Set<string>();
  const { cyStart } = ty;
  const closeDate = fa.closeDate;
  const sum = (kind: 'dividend' | 'interest') =>
    data.cash
      .filter((t) => t.accountId === account.accountId && t.kind === kind && inRange(t.date, cyStart, closeDate))
      .reduce((s, t) => {
        if (t.currency !== ccy) {
          other.add(t.currency);
          return s;
        }
        return s.add(t.amount);
      }, new Decimal(0));

  const grossProceeds = data.closedLots
    .filter((l) => l.accountId === account.accountId && !l.isShortCover && inRange(l.closeDate, cyStart, closeDate))
    .reduce((s, l) => {
      if (l.currency !== ccy) {
        other.add(l.currency);
        return s;
      }
      return s.add(l.proceeds);
    }, new Decimal(0));

  const holdings = fa.a3.reduce((s, r) => {
    if (!r.closingPrice || r.qtyEnd.isZero()) return s;
    if (r.lot.currency !== ccy) {
      other.add(r.lot.currency);
      return s;
    }
    return s.add(r.qtyEnd.mul(r.closingPrice));
  }, new Decimal(0));

  const cash = closingCash(data, account, ccy, closeDate);
  return {
    accountId: account.accountId,
    currency: ccy,
    calendarYear: cyStart.slice(0, 4),
    closeDate,
    dividends: sum('dividend'),
    interest: sum('interest'),
    grossProceeds,
    cash,
    holdings,
    balance: cash.add(holdings),
    otherCurrencies: [...other].filter((c) => c !== ccy).sort(),
  };
}

/** Cash in the account currency at the close date: Statement of Funds, else the Cash Report. */
function closingCash(data: FlexData, account: Account, ccy: string, closeDate: IsoDate): Decimal {
  const lines = data.funds
    .filter((f) => f.accountId === account.accountId && f.date <= closeDate && (f.currency === ccy || f.currency === 'BASE_SUMMARY'))
    .sort((a, b) => a.date.localeCompare(b.date));
  const level = lines.some((f) => f.currency === 'BASE_SUMMARY') ? 'BASE_SUMMARY' : ccy;
  const last = lines.filter((f) => f.currency === level).at(-1);
  if (last) return last.balance;
  const report = data.cashReports.find((c) => c.accountId === account.accountId && c.toDate === closeDate && (c.currency === 'BASE_SUMMARY' || c.currency === ccy));
  return report?.endingCash ?? new Decimal(0);
}

export interface AisComparison {
  key: AisLine;
  ours: Decimal;
  theirs?: Decimal;
  diff?: Decimal;
  matches?: boolean;
  /** The balance matches cash alone: the institution left out holdings. */
  cashOnly?: boolean;
}

/** Within 1% or one unit of currency counts as a match (rounding, accrual timing). */
export function compareAis(fig: AisFigures, entered: Partial<Record<AisLine, string>>): AisComparison[] {
  return AIS_LINES.map(({ key }) => {
    const ours = fig[key];
    const raw = entered[key]?.replace(/,/g, '').trim();
    if (!raw || Number.isNaN(Number(raw))) return { key, ours };
    const theirs = new Decimal(raw);
    const diff = theirs.sub(ours);
    const near = (a: Decimal, b: Decimal) => a.sub(b).abs().lte(Decimal.max(b.abs().mul(0.01), 1));
    const matches = near(theirs, ours);
    const cashOnly = key === 'balance' && !matches && !fig.holdings.isZero() && near(theirs, fig.cash);
    return { key, ours, theirs, diff, matches, cashOnly };
  });
}

/** A remark for the AIS feedback form (the portal allows up to 400 characters). */
export function aisRemark(fig: AisFigures, rows: AisComparison[], returnLabel: string): string {
  const n = (d: Decimal) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(d.toNumber());
  const parts = rows.map((r) => `${AIS_LINES.find((l) => l.key === r.key)!.label.toLowerCase()} ${fig.currency} ${n(r.ours)}`);
  const text =
    `Per my IBKR statements for account ${fig.accountId}, CY ${fig.calendarYear}: ${parts.join(', ')} ` +
    `(balance = cash + holdings at 31 Dec). Reported in Schedule FA (A2, A3) and FSI of my ${returnLabel} return.`;
  return text.length <= 400 ? text : `${text.slice(0, 397)}...`;
}
