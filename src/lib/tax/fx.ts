import Decimal from 'decimal.js';
import type { IsoDate } from '../dates';
import { lastDayOfPrecedingMonth } from '../dates';
import { TtbrTable, type TtbrFile } from '../fx/ttbr';

export interface Conversion {
  foreign: Decimal;
  currency: string;
  rate: Decimal;
  requestedDate: IsoDate;
  rateDate: IsoDate;
  staleDays: number;
  manual: boolean;
  inr: Decimal;
}

export class MissingRateError extends Error {
  constructor(
    readonly currency: string,
    readonly date: IsoDate,
    reason: string,
  ) {
    super(`No SBI TT buying rate for ${currency} on ${date}: ${reason}`);
  }
}

export type RateOverrides = Record<string, string>; // `${CCY}|${date}` → rate

export class Fx {
  constructor(
    private readonly tables: Map<string, TtbrTable>,
    private readonly overrides: RateOverrides = {},
  ) {}

  static async load(currencies: Iterable<string>, baseUrl: string, overrides: RateOverrides = {}): Promise<Fx> {
    const tables = new Map<string, TtbrTable>();
    await Promise.all(
      [...new Set(currencies)]
        .filter((c) => c && c !== 'INR')
        .map(async (ccy) => {
          const res = await fetch(`${baseUrl}data/ttbr/${ccy}.json`);
          if (res.ok) tables.set(ccy, new TtbrTable((await res.json()) as TtbrFile));
        }),
    );
    return new Fx(tables, overrides);
  }

  withOverrides(overrides: RateOverrides): Fx {
    return new Fx(this.tables, overrides);
  }

  /** Converts at the TTBR on `date` (or the latest earlier card). */
  on(amount: Decimal, currency: string, date: IsoDate): Conversion {
    if (currency === 'INR') {
      return { foreign: amount, currency, rate: new Decimal(1), requestedDate: date, rateDate: date, staleDays: 0, manual: false, inr: amount };
    }
    const manual = this.overrides[`${currency}|${date}`];
    if (manual) {
      const rate = new Decimal(manual);
      return { foreign: amount, currency, rate, requestedDate: date, rateDate: date, staleDays: 0, manual: true, inr: amount.mul(rate) };
    }
    const table = this.tables.get(currency);
    if (!table) throw new MissingRateError(currency, date, 'currency not in the SBI rate archive');
    try {
      const r = table.onOrBefore(date);
      return { foreign: amount, currency, rate: r.rate, requestedDate: date, rateDate: r.rateDate, staleDays: r.staleDays, manual: false, inr: amount.mul(r.rate) };
    } catch (e) {
      throw new MissingRateError(currency, date, (e as Error).message);
    }
  }

  /** Converts at the TTBR on the last day of the month before `eventDate`'s month (Rule 115/206, 128/76). */
  monthEndBefore(amount: Decimal, currency: string, eventDate: IsoDate): Conversion {
    return this.on(amount, currency, lastDayOfPrecedingMonth(eventDate));
  }
}
