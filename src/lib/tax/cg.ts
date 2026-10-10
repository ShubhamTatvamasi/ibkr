import Decimal from 'decimal.js';
import type { IsoDate } from '../dates';
import type { Account, ClosedLot, FlexData } from '../flex/model';
import type { Collector, Conversion, Fx, Settings } from './common';
import { addMonths, inRange, quarterIndex, type TaxYear } from './years';

/** Holding-period switch for unlisted/foreign shares (Finance (No. 2) Act 2024). */
const CUTOFF = '2024-07-23';

export interface CgRow {
  lot: ClosedLot;
  description: string;
  term: 'STCG' | 'LTCG';
  monthsRequired: number;
  rateNote: string;
  quarter: number;
  saleRate?: Conversion;
  costRate?: Conversion;
  saleInr?: Decimal;
  expensesInr?: Decimal;
  costInr?: Decimal;
  gainInr?: Decimal;
  gainForeign: Decimal;
  pnlMismatch: boolean;
}

export interface CgTotals {
  saleInr: Decimal;
  costInr: Decimal;
  expensesInr: Decimal;
  gainInr: Decimal;
  /** Net gain arising in each s.234C period (can be negative). */
  quarters: Decimal[];
  /** Table F values: never negative, summing to max(0, total); see nonNegativeAccrual. */
  tableF: Decimal[];
}

export interface CgResult {
  rows: CgRow[];
  stcg: CgTotals;
  ltcg: CgTotals;
}

const zeroTotals = (): CgTotals => ({
  saleInr: new Decimal(0),
  costInr: new Decimal(0),
  expensesInr: new Decimal(0),
  gainInr: new Decimal(0),
  quarters: [0, 0, 0, 0, 0].map(() => new Decimal(0)),
  tableF: [0, 0, 0, 0, 0].map(() => new Decimal(0)),
});

/**
 * Table F accrual. A gain counts in a period only if later losses in the year do not wipe it out:
 * the amount reported up to period i is max(0, the lowest cumulative net gain from i to year end).
 * Values are never negative and always sum to max(0, total), as the portal checks Table F against
 * Schedule BFLA (validation rules 169-172, 577-578).
 */
export function nonNegativeAccrual(quarters: Decimal[]): Decimal[] {
  const cum: Decimal[] = [];
  quarters.reduce((acc, q) => {
    const next = acc.add(q);
    cum.push(next);
    return next;
  }, new Decimal(0));
  const floor = new Array<Decimal>(cum.length);
  let min = new Decimal(Infinity);
  for (let i = cum.length - 1; i >= 0; i--) {
    min = Decimal.min(min, cum[i]);
    floor[i] = Decimal.max(min, 0);
  }
  return floor.map((f, i) => (i === 0 ? f : f.sub(floor[i - 1])));
}

export function capitalGains(data: FlexData, account: Account, ty: TaxYear, settings: Settings, fx: Fx, log: Collector): CgResult {
  const area = 'Capital gains';
  const result: CgResult = { rows: [], stcg: zeroTotals(), ltcg: zeroTotals() };

  for (const lot of data.closedLots) {
    if (lot.accountId !== account.accountId || !inRange(lot.closeDate, ty.fyStart, ty.fyEnd)) continue;
    if (lot.isShortCover) {
      log.add('warn', area, `${lot.symbol} short position covered on ${lot.closeDate} — short sales are not computed; add manually.`);
      continue;
    }
    if (lot.proceedsSource === 'derived') {
      log.add('info', area, `${lot.symbol} sale on ${lot.closeDate}: sale value derived from IBKR cost + realized P/L (no matching execution row).`);
    }
    const monthsRequired = lot.closeDate >= CUTOFF ? 24 : 36;
    const term = lot.closeDate > addMonths(lot.openDate, monthsRequired) ? 'LTCG' : 'STCG';
    const rateNote =
      term === 'STCG' ? 'Slab rate' : lot.closeDate >= CUTOFF ? `12.5% (${ty.law.ltcgSection}), no indexation` : '20% with indexation (pre-23 Jul 2024 sale)';
    if (term === 'LTCG' && lot.closeDate < CUTOFF) {
      log.add('warn', area, 'Long-term sale before 23 Jul 2024: indexation is not computed by this tool.');
    }

    const gainForeign = lot.proceeds.sub(lot.commission).sub(lot.cost);
    const row: CgRow = {
      lot,
      description: data.instruments.get(lot.conid)?.description || lot.symbol,
      term,
      monthsRequired,
      rateNote,
      quarter: quarterIndex(lot.closeDate),
      gainForeign,
      pnlMismatch: lot.proceedsSource === 'execution' && gainForeign.sub(lot.realizedPnl).abs().gt(0.05),
    };

    const sale = log.convert(area, () => fx.monthEndBefore(lot.proceeds, lot.currency, lot.closeDate));
    if (sale) {
      row.saleRate = sale;
      row.saleInr = sale.inr;
      row.expensesInr = lot.commission.mul(sale.rate);
      if (settings.cgFxMethod === 'split') {
        const cost = log.convert(area, () => fx.monthEndBefore(lot.cost, lot.currency, lot.openDate));
        if (cost) {
          row.costRate = cost;
          row.costInr = cost.inr;
        }
      } else {
        row.costRate = sale;
        row.costInr = lot.cost.mul(sale.rate);
      }
    }
    if (row.saleInr && row.costInr && row.expensesInr) {
      row.gainInr = row.saleInr.sub(row.expensesInr).sub(row.costInr);
      const t = term === 'STCG' ? result.stcg : result.ltcg;
      t.saleInr = t.saleInr.add(row.saleInr);
      t.costInr = t.costInr.add(row.costInr);
      t.expensesInr = t.expensesInr.add(row.expensesInr);
      t.gainInr = t.gainInr.add(row.gainInr);
      t.quarters[row.quarter] = t.quarters[row.quarter].add(row.gainInr);
    }
    result.rows.push(row);
  }
  if (result.rows.some((r) => r.pnlMismatch)) {
    log.add('info', area, 'Some sales differ from IBKR realized P/L by more than $0.05 (usually commission rounding). Review rows marked ≠.');
  }
  result.stcg.tableF = nonNegativeAccrual(result.stcg.quarters);
  result.ltcg.tableF = nonNegativeAccrual(result.ltcg.quarters);
  if (result.stcg.gainInr.lt(0) || result.ltcg.gainInr.lt(0)) {
    log.add('info', area, 'There is a net capital loss in one category. Table F shows gains after setting off losses within the same category; cross-category set-off (short-term loss against long-term gain) is done in Schedule CYLA/BFLA — check the final Table F against BFLA.');
  }
  result.rows.sort((a, b) => a.lot.closeDate.localeCompare(b.lot.closeDate) || a.lot.symbol.localeCompare(b.lot.symbol));
  return result;
}

export function saleDate(row: CgRow): IsoDate {
  return row.lot.closeDate;
}
