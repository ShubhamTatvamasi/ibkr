import Decimal from 'decimal.js';
import type { IsoDate } from '../dates';
import type { ClosedLot, CorporateAction, FlexData, OpenLot } from '../flex/model';

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
  /** Cost per share in snapshot units (after any split up to the snapshot), including purchase commission. */
  unitCost: Decimal;
  /** Splits between purchase and snapshot: on `date` each share became `ratio` shares. */
  splits: { date: IsoDate; ratio: Decimal }[];
}

/** New shares per old share for a split, from IBKR's description ("SPLIT 4 FOR 1"). */
export function splitRatio(ca: CorporateAction): Decimal | undefined {
  if (!/^(FS|RS)$/.test(ca.type) && !/\bSPLIT\b/i.test(ca.description)) return undefined;
  const m = /SPLIT\s+(\d+(?:\.\d+)?)\s+FOR\s+(\d+(?:\.\d+)?)/i.exec(ca.description);
  if (!m) return undefined;
  const ratio = new Decimal(m[1]).div(m[2]);
  return ratio.gt(0) && !ratio.eq(1) ? ratio : undefined;
}

/** Product of split ratios after `t` (or on/after when `inclusive`): converts units at `t` into snapshot units. */
function splitFactor(lot: Lot, t: IsoDate, inclusive = false): Decimal {
  let f = new Decimal(1);
  for (const s of lot.splits) if (inclusive ? s.date >= t : s.date > t) f = f.mul(s.ratio);
  return f;
}

/** Cost per share in the units held on day `t`. */
export function unitCostAt(lot: Lot, t: IsoDate): Decimal {
  return lot.unitCost.mul(splitFactor(lot, t));
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
      // One order filled as several executions shares an open time: merge, weighting the cost.
      const qty = lot.snapshotQty.add(o.quantity);
      lot.unitCost = qty.isZero() ? lot.unitCost : lot.unitCost.mul(lot.snapshotQty).add(o.costBasisMoney).div(qty);
      lot.snapshotQty = qty;
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
      splits: [],
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
        splits: [],
      };
      lots.set(key, lot);
    }
    lot.closures.push(c);
  }

  // Splits up to the snapshot change the units: IBKR reports the snapshot after the split and each
  // sale in the units of its own day.
  const splits = data.corporateActions
    .filter((ca) => ca.accountId === accountId && (!snapshotDate || ca.date <= snapshotDate))
    .map((ca) => ({ conid: ca.conid, date: ca.date, ratio: splitRatio(ca) }))
    .filter((x): x is { conid: string; date: IsoDate; ratio: Decimal } => !!x.ratio);
  for (const lot of lots.values()) {
    lot.splits = splits.filter((x) => x.conid === lot.conid && x.date > lot.openDate).map(({ date, ratio }) => ({ date, ratio }));
    if (lot.splits.length && lot.snapshotQty.isZero()) {
      // Fully sold before the snapshot: the cost came from a closed lot, in the units of that sale.
      const c = lot.closures[0];
      lot.unitCost = lot.unitCost.div(splitFactor(lot, c.closeDate));
    }
  }
  return {
    lots: [...lots.values()].sort((a, b) => a.symbol.localeCompare(b.symbol) || a.openDateTime.localeCompare(b.openDateTime)),
    snapshotDate,
  };
}

/** Shares of `lot` held at the end of day `t`, in that day's units. */
export function heldAt(lot: Lot, t: IsoDate): Decimal {
  if (t < lot.openDate) return new Decimal(0);
  let q = lot.snapshotQty;
  for (const c of lot.closures) if (c.closeDate > t) q = q.add(c.quantity.mul(splitFactor(lot, c.closeDate)));
  return lot.splits.length ? q.div(splitFactor(lot, t)) : q;
}

/** Shares held at the start of day `t` (before any sale that day). */
export function heldAtStartOf(lot: Lot, t: IsoDate): Decimal {
  if (t <= lot.openDate) return new Decimal(0);
  let q = lot.snapshotQty;
  for (const c of lot.closures) if (c.closeDate >= t) q = q.add(c.quantity.mul(splitFactor(lot, c.closeDate)));
  return lot.splits.length ? q.div(splitFactor(lot, t, true)) : q;
}
