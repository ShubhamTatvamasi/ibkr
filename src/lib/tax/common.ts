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
}

export const DEFAULT_SETTINGS: Settings = {
  cgFxMethod: 'split',
  faIncomeRate: 'txn',
  interestRate: 'fyEnd',
  marginalRatePct: 31.2,
};

export type Level = 'error' | 'warn' | 'info';
export interface Warning {
  level: Level;
  area: string;
  message: string;
}

export class Collector {
  readonly warnings: Warning[] = [];
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
