import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { emptyFlexData } from '../flex/parse';
import type { ClosedLot, OpenLot } from '../flex/model';
import { fifoRematch } from './fifo';

const d = (n: number) => new Decimal(n);
const base = { accountId: 'U1', conid: '1', symbol: 'MSFT', currency: 'USD', assetCategory: 'STK' };
const openLot = (date: string, qty: number, unit: number, reportDate = '2025-12-31'): OpenLot => ({
  ...base, description: 'MICROSOFT', reportDate, openDateTime: `${date};10:00:00`, openDate: date, quantity: d(qty), costBasisMoney: d(qty * unit), markPrice: d(400),
});
const sale = (openDate: string, qty: number, unit: number, closeDate = '2025-05-01', price = 300): ClosedLot => ({
  ...base, openDateTime: `${openDate};10:00:00`, openDate, closeDate, quantity: d(qty), cost: d(qty * unit), proceeds: d(qty * price), commission: d(1), realizedPnl: d(qty * (price - unit) - 1), proceedsSource: 'execution', isShortCover: false,
});

describe('first-in, first-out re-matching', () => {
  it('moves a highest-cost sale to the oldest lot and fixes the open positions', () => {
    const data = emptyFlexData();
    // Bought 10 @100 (2023) and 10 @200 (2024); IBKR sold the 2024 lot on 1 May 2025.
    data.closedLots.push(sale('2024-01-10', 10, 200));
    data.openLots.push(openLot('2023-01-10', 10, 100));
    const r = fifoRematch(data, 'U1');
    expect(r.nonFifo).toEqual(['MSFT']);
    expect(r.rematched).toEqual(['MSFT']);
    const c = r.data.closedLots;
    expect(c).toHaveLength(1);
    expect(c[0].openDate).toBe('2023-01-10');
    expect(c[0].cost.toNumber()).toBe(1000);
    expect(c[0].proceeds.toNumber()).toBe(3000);
    const o = r.data.openLots;
    expect(o).toHaveLength(1);
    expect(o[0].openDate).toBe('2024-01-10');
    expect(o[0].costBasisMoney.toNumber()).toBe(2000);
  });

  it('splits one sale across lots and leaves FIFO matches alone', () => {
    const data = emptyFlexData();
    data.closedLots.push(sale('2023-01-10', 10, 100), sale('2024-01-10', 5, 200));
    data.openLots.push(openLot('2024-01-10', 5, 200));
    const r = fifoRematch(data, 'U1');
    expect(r.nonFifo).toEqual([]);
    expect(r.data).toBe(data);
  });

  it('skips holdings with a split or an incomplete history', () => {
    const data = emptyFlexData();
    data.closedLots.push(sale('2024-01-10', 10, 200));
    data.openLots.push(openLot('2023-01-10', 10, 100));
    data.corporateActions.push({ ...base, date: '2024-06-01', type: 'FS', description: 'MSFT SPLIT 2 FOR 1', quantity: d(10) });
    const r = fifoRematch(data, 'U1');
    expect(r.rematched).toEqual([]);
    expect(r.skipped[0].reason).toMatch(/split/);
  });

  it('recomputes an earlier snapshot too', () => {
    const data = emptyFlexData();
    data.closedLots.push(sale('2024-01-10', 4, 200, '2025-02-01'));
    data.openLots.push(openLot('2023-01-10', 10, 100, '2024-12-31'), openLot('2024-01-10', 10, 200, '2024-12-31'));
    data.openLots.push(openLot('2023-01-10', 10, 100), openLot('2024-01-10', 6, 200));
    const r = fifoRematch(data, 'U1');
    const at = (date: string) => r.data.openLots.filter((o) => o.reportDate === date).map((o) => [o.openDate, o.quantity.toNumber()]);
    expect(at('2024-12-31')).toEqual([['2023-01-10', 10], ['2024-01-10', 10]]);
    expect(at('2025-12-31')).toEqual([['2023-01-10', 6], ['2024-01-10', 10]]);
  });
});
