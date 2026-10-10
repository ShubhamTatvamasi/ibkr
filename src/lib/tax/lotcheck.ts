import Decimal from 'decimal.js';
import type { IsoDate } from '../dates';
import type { Account, FlexData } from '../flex/model';
import { lotKey, type LotOverride } from './common';
import type { TaxYear } from './years';

/** A lot whose purchase date or cost IBKR may not know, for the user to confirm. */
export interface LotToCheck {
  key: string;
  accountId: string;
  conid: string;
  symbol: string;
  currency: string;
  openDateTime: string;
  /** As IBKR reports it (before any correction). */
  openDate: IsoDate;
  quantity: Decimal;
  unitCost: Decimal;
  reason: 'zero-cost' | 'transferred';
  override?: LotOverride;
}

const valid = (o?: LotOverride) => ({
  date: o?.openDate && /^\d{4}-\d{2}-\d{2}$/.test(o.openDate) ? o.openDate : undefined,
  cost: o?.unitCost && Number(o.unitCost) >= 0 && o.unitCost.trim() !== '' ? new Decimal(o.unitCost) : undefined,
});

/** Lots held or sold in the year with no cost, or opened on the day shares were transferred in. */
export function lotsToCheck(data: FlexData, account: Account, ty: TaxYear, overrides: Record<string, LotOverride>): LotToCheck[] {
  const out = new Map<string, LotToCheck>();
  const transfersIn = data.transfers.filter((t) => t.accountId === account.accountId && t.direction === 'IN');
  const consider = (conid: string, symbol: string, currency: string, openDateTime: string, openDate: IsoDate, quantity: Decimal, cost: Decimal) => {
    const key = lotKey(account.accountId, conid, openDateTime);
    const transferred = transfersIn.some((t) => t.conid === conid && t.date === openDate);
    const zero = cost.isZero() && !quantity.isZero();
    if (!transferred && !zero) return;
    const e = out.get(key);
    if (e) {
      e.quantity = e.quantity.add(quantity);
      return;
    }
    out.set(key, {
      key, accountId: account.accountId, conid, symbol, currency, openDateTime, openDate, quantity,
      unitCost: quantity.isZero() ? new Decimal(0) : cost.div(quantity),
      reason: zero ? 'zero-cost' : 'transferred',
      override: overrides[key],
    });
  };
  const latest = data.openLots.filter((l) => l.accountId === account.accountId).map((l) => l.reportDate).sort().at(-1);
  for (const o of data.openLots) if (o.accountId === account.accountId && o.reportDate === latest) consider(o.conid, o.symbol, o.currency, o.openDateTime, o.openDate, o.quantity, o.costBasisMoney);
  for (const c of data.closedLots) {
    if (c.accountId !== account.accountId || c.isShortCover || c.closeDate < ty.cyStart || c.closeDate > ty.fyEnd) continue;
    consider(c.conid, c.symbol, c.currency, c.openDateTime, c.openDate, c.quantity, c.cost);
  }
  return [...out.values()].sort((a, b) => a.symbol.localeCompare(b.symbol) || a.openDate.localeCompare(b.openDate));
}

/** A copy of the data with the user's purchase dates and costs applied to the matching lots. */
export function applyLotOverrides(data: FlexData, overrides: Record<string, LotOverride>): FlexData {
  const keys = Object.keys(overrides).filter((k) => valid(overrides[k]).date || valid(overrides[k]).cost);
  if (!keys.length) return data;
  const pick = (accountId: string, conid: string, openDateTime: string) => valid(overrides[lotKey(accountId, conid, openDateTime)]);
  return {
    ...data,
    openLots: data.openLots.map((o) => {
      const v = pick(o.accountId, o.conid, o.openDateTime);
      if (!v.date && !v.cost) return o;
      return { ...o, openDate: v.date ?? o.openDate, costBasisMoney: v.cost ? v.cost.mul(o.quantity) : o.costBasisMoney };
    }),
    closedLots: data.closedLots.map((c) => {
      const v = pick(c.accountId, c.conid, c.openDateTime);
      if (!v.date && !v.cost) return c;
      return { ...c, openDate: v.date ?? c.openDate, cost: v.cost ? v.cost.mul(c.quantity) : c.cost };
    }),
  };
}
