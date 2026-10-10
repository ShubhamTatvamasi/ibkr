import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { emptyFlexData } from '../flex/parse';
import type { ClosedLot, OpenLot } from '../flex/model';
import { buildLedger, heldAt, heldAtStartOf, splitRatio, unitCostAt } from './lots';

const d = (n: number) => new Decimal(n);
const base = { accountId: 'U1', conid: '265598', symbol: 'AAPL', currency: 'USD', assetCategory: 'STK' };

function data() {
  const x = emptyFlexData();
  const open: OpenLot = { ...base, description: 'APPLE INC', reportDate: '2025-12-31', openDateTime: '2025-01-10;10:00:00', openDate: '2025-01-10', quantity: d(32), costBasisMoney: d(3200), markPrice: d(120) };
  x.openLots.push(open);
  const sale = (over: Partial<ClosedLot>): ClosedLot => ({
    ...base, openDateTime: '2025-01-10;10:00:00', openDate: '2025-01-10', closeDate: '2025-03-01', quantity: d(2), cost: d(800), proceeds: d(900), commission: d(1), realizedPnl: d(99), proceedsSource: 'execution', isShortCover: false, ...over,
  });
  x.closedLots.push(sale({}));
  // A second lot bought before the split and sold entirely after it.
  x.closedLots.push(sale({ openDateTime: '2025-01-05;10:00:00', openDate: '2025-01-05', closeDate: '2025-08-01', quantity: d(20), cost: d(2000), proceeds: d(2400), realizedPnl: d(399) }));
  x.corporateActions.push({ ...base, date: '2025-06-10', type: 'FS', description: 'AAPL(US0378331005) SPLIT 4 FOR 1 (AAPL, APPLE INC, US0378331005)', quantity: d(24) });
  return x;
}

describe('stock splits', () => {
  const ledger = buildLedger(data(), 'U1', '2025-12-31');
  const lot = ledger.lots.find((l) => l.openDate === '2025-01-10')!;
  const sold = ledger.lots.find((l) => l.openDate === '2025-01-05')!;

  it('reads the ratio from the description', () => {
    expect(splitRatio(data().corporateActions[0])!.toNumber()).toBe(4);
    expect(splitRatio({ ...data().corporateActions[0], type: 'RS', description: 'XYZ SPLIT 1 FOR 10' })!.toNumber()).toBe(0.1);
    expect(splitRatio({ ...data().corporateActions[0], type: 'SO', description: 'SPIN-OFF' })).toBeUndefined();
  });

  it('holds pre-split shares before the split date and post-split after', () => {
    expect(heldAt(lot, '2025-02-01').toNumber()).toBe(10);
    expect(heldAt(lot, '2025-04-01').toNumber()).toBe(8);
    expect(heldAt(lot, '2025-06-09').toNumber()).toBe(8);
    expect(heldAt(lot, '2025-06-10').toNumber()).toBe(32);
    expect(heldAtStartOf(lot, '2025-06-10').toNumber()).toBe(8);
    expect(heldAt(lot, '2025-12-31').toNumber()).toBe(32);
  });

  it('keeps the total cost, expressed per share of the day', () => {
    expect(unitCostAt(lot, '2025-02-01').toNumber()).toBe(400);
    expect(unitCostAt(lot, '2025-07-01').toNumber()).toBe(100);
  });

  it('handles a lot sold entirely after the split', () => {
    expect(heldAt(sold, '2025-02-01').toNumber()).toBe(5);
    expect(heldAt(sold, '2025-07-01').toNumber()).toBe(20);
    expect(heldAt(sold, '2025-08-01').toNumber()).toBe(0);
    expect(unitCostAt(sold, '2025-02-01').toNumber()).toBe(400);
  });
});
