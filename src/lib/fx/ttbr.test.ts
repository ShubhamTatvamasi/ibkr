import { describe, expect, it } from 'vitest';
import { lastDayOfPrecedingMonth } from '../dates';
import { TtbrTable } from './ttbr';

const table = new TtbrTable({
  currency: 'USD',
  source: 'test',
  from: '2025-02-27',
  to: '2025-04-02',
  rates: {
    '2025-02-27': '86.90',
    '2025-02-28': '87.10',
    '2025-03-28': '85.30', // 31 Mar 2025 was a bank holiday: no card
    '2025-04-01': '85.20',
    '2025-04-02': '85.25',
  },
});

describe('lastDayOfPrecedingMonth', () => {
  it.each([
    ['2025-05-15', '2025-04-30'],
    ['2025-03-01', '2025-02-28'],
    ['2024-03-31', '2024-02-29'],
    ['2025-01-10', '2024-12-31'],
  ])('%s → %s', (d, want) => expect(lastDayOfPrecedingMonth(d)).toBe(want));
});

describe('TtbrTable', () => {
  it('uses the exact card when published', () => {
    const r = table.onOrBefore('2025-02-28');
    expect(r.rate.toString()).toBe('87.1');
    expect(r.staleDays).toBe(0);
  });

  it('falls back to the latest earlier card', () => {
    const r = table.onOrBefore('2025-03-31');
    expect(r.rateDate).toBe('2025-03-28');
    expect(r.staleDays).toBe(3);
  });

  it('applies the Rule 115 month-end anchor', () => {
    expect(table.monthEndBefore('2025-04-15').rateDate).toBe('2025-03-28');
    expect(table.monthEndBefore('2025-03-05').rateDate).toBe('2025-02-28');
  });

  it('refuses dates before the archive', () => {
    expect(() => table.onOrBefore('2025-01-01')).toThrow(/archive starts/);
  });

  it('refuses dates far past the archive end', () => {
    expect(() => table.onOrBefore('2025-06-01')).toThrow(/refresh/);
  });
});

describe('TtbrTable per-100 quotes', () => {
  it('returns INR per single unit', () => {
    const jpy = new TtbrTable({ currency: 'JPY', per: 100, source: 'test', from: '2025-01-01', to: '2025-01-01', rates: { '2025-01-01': '60.29' } });
    expect(jpy.onOrBefore('2025-01-01').rate.toString()).toBe('0.6029');
  });
});
