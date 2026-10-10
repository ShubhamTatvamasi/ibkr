import type { IsoDate } from '../dates';
import { MissingRateError, type Conversion, type Fx } from './fx';

export interface Settings {
  /** Capital gains: 'split' converts sale and cost separately; 'gain' converts the foreign-currency gain once. */
  cgFxMethod: 'split' | 'gain';
  /** Schedule FA income/proceeds columns: rate on the transaction date, or on 31 December. */
  faIncomeRate: 'txn' | 'cyEnd';
  /** Broker interest: 31 March rate (Rule 115/206 "other income") or the month-end before each credit. */
  interestRate: 'fyEnd' | 'monthly';
  /** Your marginal rate incl. surcharge and cess, used for the FTC "tax payable in India" limit. */
  marginalRatePct: number;
  /** Residential status for the year: Schedule FA applies only to residents who are ordinarily resident. */
  residency: 'ROR' | 'RNOR' | 'NR';
  /** Foreign taxpayer identification number for Schedule FSI/TR and Form 67 (passport number if none was allotted). */
  tin: string;
  /** Corrections for lots IBKR has without a proper purchase date or cost (transfers in, RSUs), by lotKey. */
  lotOverrides: Record<string, LotOverride>;
  /** Capital losses from earlier years still available (Schedule CFL of last year's return). */
  broughtForward: BroughtForwardLoss[];
  /** Which purchase lot a sale comes from: first-in, first-out (Indian practice) or as IBKR matched it. */
  lotMatching: 'fifo' | 'ibkr';
  /** Inputs for the old vs new regime estimate (rupees, as typed). */
  regimeInputs: { salary: string; otherIncome: string; oldDeductions: string };
  /** Return filed (or to be filed) by the s.139(1) due date; a belated return can't carry this year's loss forward. */
  filedByDueDate: boolean;
}

export interface BroughtForwardLoss {
  /** Assessment year in which the loss arose, e.g. 2024 for AY 2024-25. */
  ay: number;
  stcl: string;
  ltcl: string;
}

export interface LotOverride {
  /** Original acquisition date (e.g. RSU vesting date), YYYY-MM-DD. */
  openDate?: string;
  /** Cost per share in the lot's currency, in the shares as held now. */
  unitCost?: string;
}

/** Identifies a purchase lot across files and years. */
export const lotKey = (accountId: string, conid: string, openDateTime: string) => `${accountId}|${conid}|${openDateTime}`;

export const DEFAULT_SETTINGS: Settings = {
  // Rule 115/206 specifies one date (last day of the month before the sale) for the whole gain.
  cgFxMethod: 'gain',
  // CBDT filing instructions convert Schedule FA income at the 31 December rate.
  faIncomeRate: 'cyEnd',
  interestRate: 'fyEnd',
  marginalRatePct: 31.2,
  residency: 'ROR',
  tin: '',
  lotOverrides: {},
  broughtForward: [],
  // CBDT Circulars 704/768 and case law apply first-in, first-out to fungible shares.
  lotMatching: 'fifo',
  regimeInputs: { salary: '', otherIncome: '', oldDeductions: '' },
  filedByDueDate: true,
};

export type Level = 'error' | 'warn' | 'info';
export interface Warning {
  level: Level;
  area: string;
  message: string;
}

export interface RateUse {
  currency: string;
  requestedDate: IsoDate;
  rateDate: IsoDate;
  rate: string;
  manual: boolean;
  usedFor: Set<string>;
}

export class Collector {
  readonly warnings: Warning[] = [];
  /** Every exchange rate applied, for the CA's audit appendix. */
  readonly rates = new Map<string, RateUse>();
  readonly missingRates = new Map<string, { currency: string; date: IsoDate }>();
  private readonly seen = new Set<string>();

  add(level: Level, area: string, message: string) {
    const key = `${level}|${area}|${message}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.warnings.push({ level, area, message });
  }

  /** Runs a conversion; on a missing rate records it and returns undefined. */
  convert(area: string, fn: () => Conversion): Conversion | undefined {
    try {
      const c = fn();
      if (c.currency !== 'INR') {
        const key = `${c.currency}|${c.requestedDate}`;
        const use = this.rates.get(key) ?? { currency: c.currency, requestedDate: c.requestedDate, rateDate: c.rateDate, rate: c.rate.toString(), manual: c.manual, usedFor: new Set<string>() };
        use.usedFor.add(area);
        this.rates.set(key, use);
      }
      if (c.staleDays > 7) {
        this.add('warn', area, `Used the ${c.currency} SBI rate of ${c.rateDate} for ${c.requestedDate} (${c.staleDays} days earlier — no card published in between).`);
      }
      return c;
    } catch (e) {
      if (e instanceof MissingRateError) {
        this.missingRates.set(`${e.currency}|${e.date}`, { currency: e.currency, date: e.date });
        this.add('error', area, e.message + ' — enter it manually under "Missing exchange rates".');
        return undefined;
      }
      throw e;
    }
  }
}

export type { Conversion, Fx };
