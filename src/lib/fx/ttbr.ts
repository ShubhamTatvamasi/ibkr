import Decimal from 'decimal.js';
import { assertIsoDate, daysBetween, lastDayOfPrecedingMonth, type IsoDate } from '../dates';

/** Shape of public/data/ttbr/{CCY}.json as written by scripts/update-sbi-rates.mjs. */
export interface TtbrFile {
  currency: string;
  /** SBI quotes some currencies (JPY, THB, KRW) per 100 units; rates in the file are as quoted. */
  per?: number;
  source: string;
  from: IsoDate;
  to: IsoDate;
  rates: Record<IsoDate, string>;
}

export interface RateLookup {
  currency: string;
  /** INR per 1 unit of `currency`. */
  rate: Decimal;
  /** The date the rule asked for. */
  requestedDate: IsoDate;
  /** The SBI card actually used (≤ requestedDate). */
  rateDate: IsoDate;
  /** Days between rateDate and requestedDate; > 0 means SBI published nothing on the requested date. */
  staleDays: number;
}

/** Above this, a fallback to an older card is surfaced to the user as a warning. */
export const STALE_WARNING_DAYS = 7;

export class TtbrTable {
  readonly currency: string;
  private readonly dates: IsoDate[];
  private readonly rates: Record<IsoDate, string>;
  private readonly per: number;

  constructor(file: TtbrFile) {
    this.currency = file.currency;
    this.per = file.per ?? 1;
    this.rates = file.rates;
    this.dates = Object.keys(file.rates).sort();
    if (this.dates.length === 0) throw new Error(`no TTBR data for ${file.currency}`);
  }

  get firstDate(): IsoDate {
    return this.dates[0];
  }

  get lastDate(): IsoDate {
    return this.dates[this.dates.length - 1];
  }

  /**
   * Rate published on `date`, or the latest one before it when SBI published nothing that day
   * (weekends, bank holidays, gaps in the archive).
   */
  onOrBefore(date: IsoDate): RateLookup {
    assertIsoDate(date);
    if (date < this.firstDate) {
      throw new Error(`no ${this.currency} TTBR on or before ${date} (archive starts ${this.firstDate})`);
    }
    if (date > this.lastDate && daysBetween(this.lastDate, date) > STALE_WARNING_DAYS) {
      throw new Error(`${this.currency} TTBR data ends ${this.lastDate}; refresh the rate archive`);
    }
    // Binary search for the last date ≤ requested.
    let lo = 0;
    let hi = this.dates.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.dates[mid] <= date) lo = mid;
      else hi = mid - 1;
    }
    const rateDate = this.dates[lo];
    return {
      currency: this.currency,
      rate: new Decimal(this.rates[rateDate]).div(this.per),
      requestedDate: date,
      rateDate,
      staleDays: daysBetween(rateDate, date),
    };
  }

  /** TTBR on the last day of the month preceding the month of `eventDate` (Rule 115 / 206, Rule 128 / 76). */
  monthEndBefore(eventDate: IsoDate): RateLookup {
    return this.onOrBefore(lastDayOfPrecedingMonth(eventDate));
  }
}
