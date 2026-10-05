import type { IsoDate } from '../dates';

export interface TaxYear {
  /** Assessment-year start, e.g. 2026 for AY 2026-27 (FY 2025-26). */
  ayStart: number;
  label: string;
  fyStart: IsoDate;
  fyEnd: IsoDate;
  /** Schedule FA reports the calendar year ending in the financial year. */
  cyStart: IsoDate;
  cyEnd: IsoDate;
  /** True from tax year 2026-27, when the Income-tax Act 2025 and Rules 2026 apply. */
  newAct: boolean;
  law: {
    act: string;
    conversionRule: string;
    ftcRule: string;
    ftcForm: string;
    ltcgSection: string;
  };
}

export const SUPPORTED_AY = [2027, 2026, 2025];

export function taxYear(ayStart: number): TaxYear {
  const fy = ayStart - 1;
  const newAct = fy >= 2026;
  const short = (y: number) => String(y % 100).padStart(2, '0');
  return {
    ayStart,
    label: newAct
      ? `Tax year ${fy}-${short(fy + 1)} (old AY ${ayStart}-${short(ayStart + 1)})`
      : `AY ${ayStart}-${short(ayStart + 1)} (FY ${fy}-${short(fy + 1)})`,
    fyStart: `${fy}-04-01`,
    fyEnd: `${fy + 1}-03-31`,
    cyStart: `${fy}-01-01`,
    cyEnd: `${fy}-12-31`,
    newAct,
    law: newAct
      ? { act: 'Income-tax Act 2025', conversionRule: 'Rule 206', ftcRule: 'Rule 76', ftcForm: 'Form 44', ltcgSection: 'section 197' }
      : { act: 'Income-tax Act 1961', conversionRule: 'Rule 115', ftcRule: 'Rule 128', ftcForm: 'Form 67', ltcgSection: 'section 112' },
  };
}

export const QUARTER_LABELS = ['Up to 15/6', '16/6 – 15/9', '16/9 – 15/12', '16/12 – 15/3', '16/3 – 31/3'];

/** Advance-tax (s.234C) bucket of a date inside the financial year starting `fyStart`. */
export function quarterIndex(date: IsoDate): number {
  const md = date.slice(5); // MM-DD
  if (md >= '04-01' && md <= '06-15') return 0;
  if (md >= '06-16' && md <= '09-15') return 1;
  if (md >= '09-16' && md <= '12-15') return 2;
  if (md >= '12-16' || md <= '03-15') return 3;
  return 4;
}

export function inRange(d: IsoDate, from: IsoDate, to: IsoDate): boolean {
  return d >= from && d <= to;
}

/** Same day `months` later, clamped to the month's end (e.g. 31 Jan + 1 month = 28/29 Feb). */
export function addMonths(d: IsoDate, months: number): IsoDate {
  const [y, m, day] = d.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

export function addDays(d: IsoDate, days: number): IsoDate {
  return new Date(Date.parse(d) + days * 86_400_000).toISOString().slice(0, 10);
}
