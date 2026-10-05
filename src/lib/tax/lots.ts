import Decimal from 'decimal.js';
import type { IsoDate } from '../dates';
import type { ClosedLot, FlexData, OpenLot } from '../flex/model';

/** One purchase lot followed through time: what is still open at the snapshot plus every known sale. */
export interface Lot {
  key: string;
  conid: string;
  symbol: string;
  description: string;
  currency: string;
  openDateTime: string;
  openDate: IsoDate;
  /** Quantity still open at `snapshotDate` (0 when fully sold by then). */
  snapshotQty: Decimal;
  snapshotMark?: Decimal;
  closures: ClosedLot[];
  /** Cost per share, including purchase commission. */
  unitCost: Decimal;
}

export interface LotLedger {
  lots: Lot[];
  /** Date of the open-positions snapshot the ledger is anchored to (undefined if none). */
  snapshotDate?: IsoDate;
}

/**
 * Builds lots anchored at the earliest open-positions snapshot on or after `anchor`
 * (falling back to the latest one before it). Quantity held on any date t ≤ snapshot is
 * snapshot quantity + every later sale up to the snapshot.
 */
export function buildLedger(data: FlexData, accountId: string, anchor: IsoDate): LotLedger {
  const open = data.openLots.filter((l) => l.accountId === accountId);
  const dates = [...new Set(open.map((l) => l.reportDate))].sort();
  const snapshotDate = dates.find((d) => d >= anchor) ?? dates.at(-1);
  const snapshot = open.filter((l) => l.reportDate === snapshotDate);

  const lots = new Map<string, Lot>();
  const keyOf = (conid: string, openDateTime: string) => `${conid}|${openDateTime}`;
  const instrument = (conid: string) => data.instruments.get(conid);

  for (const o of snapshot) addOpen(o);
  function addOpen(o: OpenLot) {
    const key = keyOf(o.conid, o.openDateTime);
    const lot = lots.get(key);
    if (lot) {
      lot.snapshotQty = lot.snapshotQty.add(o.quantity);
      return;
    }
    lots.set(key, {
      key,
      conid: o.conid,
      symbol: o.symbol,
      description: instrument(o.conid)?.description || o.description,
      currency: o.currency,
      openDateTime: o.openDateTime,
      openDate: o.openDate,
      snapshotQty: o.quantity,
      snapshotMark: o.markPrice,
      closures: [],
      unitCost: o.quantity.isZero() ? new Decimal(0) : o.costBasisMoney.div(o.quantity),
    });
  }

  for (const c of data.closedLots) {
    if (c.accountId !== accountId || c.isShortCover) continue;
    if (snapshotDate && c.closeDate > snapshotDate) continue;
    const key = keyOf(c.conid, c.openDateTime);
    let lot = lots.get(key);
    if (!lot) {
      lot = {
        key,
        conid: c.conid,
        symbol: c.symbol,
        description: instrument(c.conid)?.description || c.symbol,
        currency: c.currency,
        openDateTime: c.openDateTime,
        openDate: c.openDate,
        snapshotQty: new Decimal(0),
        closures: [],
        unitCost: c.quantity.isZero() ? new Decimal(0) : c.cost.div(c.quantity),
      };
      lots.set(key, lot);
    }
    lot.closures.push(c);
  }
  return {
    lots: [...lots.values()].sort((a, b) => a.symbol.localeCompare(b.symbol) || a.openDateTime.localeCompare(b.openDateTime)),
    snapshotDate,
  };
}

/** Shares of `lot` held at the end of day `t`. */
export function heldAt(lot: Lot, t: IsoDate): Decimal {
  if (t < lot.openDate) return new Decimal(0);
  let q = lot.snapshotQty;
  for (const c of lot.closures) if (c.closeDate > t) q = q.add(c.quantity);
  return q;
}

/** Shares held at the start of day `t` (before any sale that day). */
export function heldAtStartOf(lot: Lot, t: IsoDate): Decimal {
  if (t <= lot.openDate) return new Decimal(0);
  let q = lot.snapshotQty;
  for (const c of lot.closures) if (c.closeDate >= t) q = q.add(c.quantity);
  return q;
}
