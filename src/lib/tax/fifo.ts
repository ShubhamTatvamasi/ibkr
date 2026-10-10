import Decimal from 'decimal.js';
import type { IsoDate } from '../dates';
import type { ClosedLot, FlexData, OpenLot } from '../flex/model';

export interface FifoResult {
  data: FlexData;
  /** Holdings whose sales IBKR matched to lots other than the oldest. */
  nonFifo: string[];
  /** Of those, the ones re-matched first-in, first-out. */
  rematched: string[];
  /** Holdings left as IBKR matched them, and why. */
  skipped: { symbol: string; reason: string }[];
}

interface LotState {
  openDateTime: string;
  openDate: IsoDate;
  unitCost: Decimal;
  initial: Decimal;
  remaining: Decimal;
}

interface Sale {
  date: IsoDate;
  quantity: Decimal;
  proceeds: Decimal;
  commission: Decimal;
  derived: boolean;
  /** IBKR's allocation, lot → quantity. */
  ibkr: Map<string, Decimal>;
  template: ClosedLot;
}

/**
 * Re-matches each holding's sales to purchase lots first-in, first-out — the order Indian practice
 * follows for fungible shares (s.45(2A), CBDT Circulars 704 and 768) — when IBKR used another
 * method (specific lot, highest cost, …). Open positions are recomputed to match.
 */
export function fifoRematch(data: FlexData, accountId: string): FifoResult {
  const result: FifoResult = { data, nonFifo: [], rematched: [], skipped: [] };
  const closed = data.closedLots.filter((c) => c.accountId === accountId);
  const conids = [...new Set(closed.map((c) => c.conid))];
  if (!conids.length) return result;

  const open = data.openLots.filter((o) => o.accountId === accountId);
  const snapshots = [...new Set(open.map((o) => o.reportDate))].sort();
  const latest = snapshots.at(-1);
  const replaceClosed = new Map<string, ClosedLot[]>();
  const replaceOpen = new Map<string, OpenLot[]>();

  for (const conid of conids) {
    const sales = closed.filter((c) => c.conid === conid);
    const symbol = sales[0].symbol;
    const latestRows = open.filter((o) => o.conid === conid && o.reportDate === latest);

    // Lots: what was held at the latest snapshot plus everything sold up to it.
    const lots = new Map<string, LotState>();
    const lot = (openDateTime: string, openDate: IsoDate, unitCost: Decimal) => {
      let l = lots.get(openDateTime);
      if (!l) {
        l = { openDateTime, openDate, unitCost, initial: new Decimal(0), remaining: new Decimal(0) };
        lots.set(openDateTime, l);
      }
      return l;
    };
    for (const o of latestRows) {
      const l = lot(o.openDateTime, o.openDate, o.quantity.isZero() ? new Decimal(0) : o.costBasisMoney.div(o.quantity));
      l.initial = l.initial.add(o.quantity);
    }
    for (const c of sales) {
      const l = lot(c.openDateTime, c.openDate, c.quantity.isZero() ? new Decimal(0) : c.cost.div(c.quantity));
      if (!latest || c.closeDate <= latest) l.initial = l.initial.add(c.quantity);
    }

    // Sale events: closed lots from one trade share the date and price per share.
    const events = new Map<string, Sale>();
    for (const c of sales) {
      const key = `${c.closeDate}|${c.proceeds.div(c.quantity).toDecimalPlaces(4).toString()}`;
      const e = events.get(key) ?? { date: c.closeDate, quantity: new Decimal(0), proceeds: new Decimal(0), commission: new Decimal(0), derived: false, ibkr: new Map(), template: c };
      e.quantity = e.quantity.add(c.quantity);
      e.proceeds = e.proceeds.add(c.proceeds);
      e.commission = e.commission.add(c.commission);
      e.derived ||= c.proceedsSource === 'derived';
      e.ibkr.set(c.openDateTime, (e.ibkr.get(c.openDateTime) ?? new Decimal(0)).add(c.quantity));
      events.set(key, e);
    }
    const ordered = [...events.values()].sort((a, b) => a.date.localeCompare(b.date));
    const fifoOrder = [...lots.values()].sort((a, b) => a.openDateTime.localeCompare(b.openDateTime));

    // First-in, first-out allocation.
    for (const l of fifoOrder) l.remaining = l.initial;
    const allocation: { sale: Sale; take: { lot: LotState; qty: Decimal }[] }[] = [];
    let complete = true;
    for (const sale of ordered) {
      let need = sale.quantity;
      const take: { lot: LotState; qty: Decimal }[] = [];
      for (const l of fifoOrder) {
        if (need.lte(0)) break;
        if (l.openDate > sale.date || l.remaining.lte(0)) continue;
        const q = Decimal.min(need, l.remaining);
        take.push({ lot: l, qty: q });
        l.remaining = l.remaining.sub(q);
        need = need.sub(q);
      }
      if (need.gt(1e-9)) complete = false;
      allocation.push({ sale, take });
    }

    const same = allocation.every(({ sale, take }) => {
      const fifo = new Map(take.map((t) => [t.lot.openDateTime, t.qty]));
      if (fifo.size !== sale.ibkr.size) return false;
      return [...sale.ibkr].every(([k, q]) => fifo.get(k)?.sub(q).abs().lte(1e-9));
    });
    if (same) continue;
    result.nonFifo.push(symbol);

    const actions = [...data.corporateActions, ...data.transfers].filter((x) => x.accountId === accountId && x.conid === conid);
    const reason = actions.length
      ? 'it had a split, corporate action or transfer'
      : sales.some((c) => c.isShortCover)
        ? 'it was sold short'
        : !complete
          ? 'the files don’t cover its full purchase history'
          : undefined;
    if (reason) {
      result.skipped.push({ symbol, reason });
      continue;
    }

    const newClosed: ClosedLot[] = [];
    for (const { sale, take } of allocation) {
      for (const { lot: l, qty } of take) {
        const share = qty.div(sale.quantity);
        const proceeds = sale.proceeds.mul(share);
        const commission = sale.commission.mul(share);
        const cost = l.unitCost.mul(qty);
        newClosed.push({
          ...sale.template,
          openDateTime: l.openDateTime,
          openDate: l.openDate,
          quantity: qty,
          cost,
          proceeds,
          commission,
          realizedPnl: proceeds.sub(commission).sub(cost),
          proceedsSource: sale.derived ? 'derived' : 'execution',
        });
      }
    }
    replaceClosed.set(conid, newClosed);

    // Open positions at every snapshot, from the same allocation.
    const rows: OpenLot[] = [];
    for (const date of snapshots) {
      const existing = open.filter((o) => o.conid === conid && o.reportDate === date);
      if (!existing.length) continue;
      const template = existing[0];
      for (const l of fifoOrder) {
        if (l.openDate > date) continue;
        const sold = allocation.filter((a) => a.sale.date <= date).reduce((s, a) => s.add(a.take.filter((t) => t.lot === l).reduce((x, t) => x.add(t.qty), new Decimal(0))), new Decimal(0));
        const qty = l.initial.sub(sold);
        if (qty.lte(1e-9)) continue;
        rows.push({ ...template, openDateTime: l.openDateTime, openDate: l.openDate, quantity: qty, costBasisMoney: l.unitCost.mul(qty) });
      }
    }
    replaceOpen.set(conid, rows);
    result.rematched.push(symbol);
  }

  if (!replaceClosed.size) return result;
  result.data = {
    ...data,
    closedLots: [...data.closedLots.filter((c) => !(c.accountId === accountId && replaceClosed.has(c.conid))), ...[...replaceClosed.values()].flat()],
    openLots: [...data.openLots.filter((o) => !(o.accountId === accountId && replaceOpen.has(o.conid))), ...[...replaceOpen.values()].flat()],
  };
  return result;
}
