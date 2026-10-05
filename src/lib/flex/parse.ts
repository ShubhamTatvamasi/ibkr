import Decimal from 'decimal.js';
import { XMLParser } from 'fast-xml-parser';
import type { IsoDate } from '../dates';
import type {
  Account,
  CashKind,
  CashTxn,
  ClosedLot,
  FlexData,
  Instrument,
  OpenLot,
} from './model';

type Attrs = Record<string, string>;
interface Node {
  tag: string;
  attrs: Attrs;
  children: Node[];
}

/** Asset classes whose trades feed capital gains and Schedule FA A3. ETFs are STK in IBKR. */
const EQUITY = new Set(['STK']);

export class FlexParseError extends Error {}

/** Converts IBKR date / date-time strings to YYYY-MM-DD. Supports yyyyMMdd, yyyy-MM-dd and MM/dd/yyyy prefixes. */
export function toIsoDate(raw: string | undefined): IsoDate | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  let m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  return undefined;
}

function dec(raw: string | undefined): Decimal {
  if (raw === undefined || raw.trim() === '' || raw === '--') return new Decimal(0);
  return new Decimal(raw.replace(/,/g, ''));
}

function toNodes(ordered: unknown[]): Node[] {
  const out: Node[] = [];
  for (const item of ordered as Record<string, unknown>[]) {
    const tag = Object.keys(item).find((k) => k !== ':@');
    if (!tag || tag === '#text' || tag === '?xml') continue;
    out.push({
      tag,
      attrs: (item[':@'] as Attrs) ?? {},
      children: toNodes((item[tag] as unknown[]) ?? []),
    });
  }
  return out;
}

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
});

function cashKind(type: string, description: string): CashKind {
  const t = type.toLowerCase();
  if (t.includes('withholding')) return 'withholding';
  if (t.includes('dividend')) return 'dividend'; // "Dividends", "Payment In Lieu Of Dividends"
  if (t.includes('interest') && t.includes('received')) return 'interest';
  if (/credit int/i.test(description) && t.includes('interest')) return 'interest';
  if (t.includes('deposit')) return 'transfer'; // "Deposits/Withdrawals"
  return 'other';
}

export function emptyFlexData(): FlexData {
  return {
    statements: [],
    accounts: [],
    instruments: new Map(),
    closedLots: [],
    openLots: [],
    cash: [],
    prices: [],
    funds: [],
    cashReports: [],
    corporateActions: [],
    dividendAccruals: [],
    unsupportedTrades: [],
    sections: new Set(),
    saleExecutions: 0,
    fields: new Map(),
  };
}

/**
 * Parses one Activity Flex Query XML export and merges it into `into`.
 * Rows already present (from an overlapping export) are skipped.
 */
export function parseFlexXml(xml: string, fileName: string, into: FlexData = emptyFlexData()): FlexData {
  let doc: Node[];
  try {
    doc = toNodes(parser.parse(xml));
  } catch (e) {
    throw new FlexParseError(`${fileName}: not valid XML (${(e as Error).message})`);
  }
  const root = doc.find((n) => n.tag === 'FlexQueryResponse');
  if (!root) {
    throw new FlexParseError(
      `${fileName}: not an IBKR Flex Query XML export (no <FlexQueryResponse>). Make sure the query format is XML.`,
    );
  }
  if (root.attrs.type && root.attrs.type !== 'AF') {
    throw new FlexParseError(`${fileName}: this is a "${root.attrs.type}" Flex Query; an Activity Flex Query is required.`);
  }
  const statements = root.children.find((n) => n.tag === 'FlexStatements')?.children ?? [];
  for (const st of statements.filter((n) => n.tag === 'FlexStatement')) {
    parseStatement(st, fileName, into);
  }
  resolveSymbolIds(into);
  return into;
}

function parseStatement(st: Node, fileName: string, d: FlexData) {
  const accountId = st.attrs.accountId ?? '';
  const fromDate = toIsoDate(st.attrs.fromDate);
  const toDate = toIsoDate(st.attrs.toDate);
  if (!fromDate || !toDate) throw new FlexParseError(`${fileName}: statement has no from/to date`);
  d.statements.push({ accountId, fromDate, toDate, fileName });

  const keys = seenKeys.get(d) ?? new Set<string>();
  seenKeys.set(d, keys);
  const once = (key: string) => (keys.has(key) ? false : (keys.add(key), true));

  for (const section of st.children) {
    // A selected section with nothing in the period is still exported as an empty element.
    d.sections.add(section.tag);
    const seen = d.fields.get(section.tag) ?? new Set<string>();
    for (const k of Object.keys(section.attrs)) if (section.tag === 'AccountInformation') seen.add(k);
    for (const row of section.children) {
      for (const k of Object.keys(row.attrs)) seen.add(k);
      // Queries built without the Conid field: key instruments by symbol until resolved.
      if (!row.attrs.conid && row.attrs.symbol) row.attrs.conid = `${SYMBOL_KEY}${row.attrs.symbol}|${row.attrs.currency ?? ''}`;
    }
    d.fields.set(section.tag, seen);
    switch (section.tag) {
      case 'AccountInformation':
        addAccount(d, section.attrs);
        break;
      case 'SecuritiesInfo':
        for (const n of section.children) addInstrument(d, n.attrs);
        break;
      case 'Trades':
        parseTrades(section.children, accountId, d, once);
        break;
      case 'OpenPositions':
        for (const { attrs: a } of section.children) {
          // Lot rows carry an open date; without the Level of Detail field that is the only tell.
          if (a.levelOfDetail ? a.levelOfDetail !== 'LOT' : !a.openDateTime) continue;
          if (!EQUITY.has(a.assetCategory)) continue;
          const reportDate = toIsoDate(a.reportDate) ?? toDate;
          const openDate = toIsoDate(a.openDateTime);
          if (!openDate) continue;
          if (!once(`op|${a.accountId}|${reportDate}|${a.conid}|${a.openDateTime}|${a.position}|${a.costBasisMoney}`)) continue;
          addInstrument(d, a);
          const lot: OpenLot = {
            accountId: a.accountId ?? accountId,
            conid: a.conid,
            symbol: a.symbol,
            description: a.description ?? a.symbol,
            currency: a.currency,
            assetCategory: a.assetCategory,
            reportDate,
            openDateTime: a.openDateTime,
            openDate,
            quantity: dec(a.position ?? a.quantity),
            costBasisMoney: dec(a.costBasisMoney),
            markPrice: dec(a.markPrice),
          };
          d.openLots.push(lot);
        }
        break;
      case 'CashTransactions':
        for (const { attrs: a } of section.children) {
          if (a.levelOfDetail && a.levelOfDetail !== 'DETAIL') continue;
          const date = toIsoDate(a.dateTime) ?? toIsoDate(a.settleDate) ?? toIsoDate(a.reportDate);
          if (!date) continue;
          const key = a.transactionID
            ? `ct|${a.transactionID}`
            : `ct|${a.accountId}|${a.type}|${a.dateTime}|${a.conid}|${a.amount}|${a.description}`;
          if (!once(key)) continue;
          const txn: CashTxn = {
            accountId: a.accountId ?? accountId,
            type: a.type ?? '',
            kind: cashKind(a.type ?? '', a.description ?? ''),
            conid: a.conid || undefined,
            symbol: a.symbol || undefined,
            isin: a.isin || undefined,
            issuerCountryCode: a.issuerCountryCode || undefined,
            currency: a.currency,
            date,
            amount: dec(a.amount),
            description: a.description ?? '',
          };
          d.cash.push(txn);
        }
        break;
      case 'PriorPeriodPositions':
        for (const { attrs: a } of section.children) {
          if (!EQUITY.has(a.assetCategory)) continue;
          const date = toIsoDate(a.date);
          if (!date || !a.price) continue;
          if (!once(`pp|${a.accountId}|${a.conid}|${date}`)) continue;
          d.prices.push({ accountId: a.accountId ?? accountId, conid: a.conid, date, price: dec(a.price), currency: a.currency });
        }
        break;
      case 'StmtFunds':
        for (const { attrs: a } of section.children) {
          const date = toIsoDate(a.date) ?? toIsoDate(a.reportDate);
          if (!date) continue;
          const key = `sf|${a.accountId}|${a.currency}|${a.levelOfDetail}|${date}|${a.activityCode}|${a.amount}|${a.balance}|${a.tradeID ?? ''}|${a.transactionID ?? ''}`;
          if (!once(key)) continue;
          d.funds.push({
            accountId: a.accountId ?? accountId,
            currency: a.currency,
            levelOfDetail: a.levelOfDetail ?? '',
            date,
            amount: dec(a.amount),
            balance: dec(a.balance),
            activityCode: a.activityCode ?? '',
          });
        }
        break;
      case 'CashReport':
        for (const { attrs: a } of section.children) {
          d.cashReports.push({
            accountId: a.accountId ?? accountId,
            currency: a.currency,
            levelOfDetail: a.levelOfDetail ?? '',
            fromDate: toIsoDate(a.fromDate) ?? fromDate,
            toDate: toIsoDate(a.toDate) ?? toDate,
            startingCash: dec(a.startingCash),
            endingCash: dec(a.endingCash),
          });
        }
        break;
      case 'CorporateActions':
        for (const { attrs: a } of section.children) {
          const date = toIsoDate(a.dateTime) ?? toIsoDate(a.reportDate);
          if (!date || !once(`ca|${a.transactionID ?? `${a.conid}|${a.dateTime}|${a.type}|${a.quantity}`}`)) continue;
          d.corporateActions.push({
            accountId: a.accountId ?? accountId,
            conid: a.conid,
            symbol: a.symbol,
            date,
            type: a.type ?? '',
            description: a.description ?? '',
          });
        }
        break;
      case 'ChangeInDividendAccruals':
        for (const { attrs: a } of section.children) {
          d.dividendAccruals.push({
            accountId: a.accountId ?? accountId,
            conid: a.conid,
            exDate: toIsoDate(a.exDate),
            payDate: toIsoDate(a.payDate),
          });
        }
        break;
    }
  }
}

const seenKeys = new WeakMap<FlexData, Set<string>>();

/** Prefix of a placeholder instrument id used when a section has no Conid field. */
export const SYMBOL_KEY = 'sym:';

/** Replace symbol placeholders with real conids wherever another section supplied the mapping. */
function resolveSymbolIds(d: FlexData) {
  const real = new Map<string, string>();
  for (const i of d.instruments.values()) {
    if (!i.conid.startsWith(SYMBOL_KEY) && i.symbol) real.set(`${SYMBOL_KEY}${i.symbol}|${i.currency ?? ''}`, i.conid);
  }
  if (!real.size) return;
  const fix = (id: string | undefined) => (id && real.get(id)) || id;
  for (const r of d.openLots) r.conid = fix(r.conid)!;
  for (const r of d.closedLots) r.conid = fix(r.conid)!;
  for (const r of d.prices) r.conid = fix(r.conid)!;
  for (const r of d.cash) r.conid = fix(r.conid);
  for (const r of d.corporateActions) r.conid = fix(r.conid)!;
  for (const r of d.dividendAccruals) r.conid = fix(r.conid)!;
  for (const [id, inst] of [...d.instruments]) {
    const to = real.get(id);
    if (to) {
      d.instruments.delete(id);
      const target = d.instruments.get(to);
      if (target) d.instruments.set(to, { ...inst, ...target, description: target.description || inst.description });
    }
  }
}

function addAccount(d: FlexData, a: Attrs) {
  if (!a.accountId || d.accounts.some((x) => x.accountId === a.accountId)) return;
  const acct: Account = {
    accountId: a.accountId,
    name: a.name ?? '',
    baseCurrency: a.currency ?? 'USD',
    dateOpened: toIsoDate(a.dateOpened),
    dateFunded: toIsoDate(a.dateFunded),
    ibEntity: a.ibEntity || undefined,
  };
  d.accounts.push(acct);
}

function addInstrument(d: FlexData, a: Attrs) {
  if (!a.conid) return;
  const prev = d.instruments.get(a.conid);
  const next: Instrument = {
    conid: a.conid,
    symbol: a.symbol ?? prev?.symbol ?? '',
    description: a.description || prev?.description || a.symbol || '',
    isin: a.isin || prev?.isin,
    assetCategory: a.assetCategory ?? prev?.assetCategory ?? '',
    subCategory: a.subCategory || prev?.subCategory,
    issuerCountryCode: a.issuerCountryCode || prev?.issuerCountryCode,
    currency: a.currency || prev?.currency,
  };
  d.instruments.set(a.conid, next);
}

/** Trade rows are followed by the CLOSED_LOT rows they closed; document order links them. */
function parseTrades(rows: Node[], accountId: string, d: FlexData, once: (k: string) => boolean) {
  let parent: Attrs | undefined;
  for (const { tag, attrs: a } of rows) {
    const level = a.levelOfDetail ?? (tag === 'Lot' ? 'CLOSED_LOT' : '');
    if (level === 'EXECUTION' || (tag === 'Trade' && level !== 'CLOSED_LOT')) {
      parent = a;
      addInstrument(d, a);
      if (EQUITY.has(a.assetCategory) && a.buySell?.startsWith('SELL') && once(`se|${a.tradeID ?? `${a.conid}|${a.dateTime}|${a.quantity}`}`)) d.saleExecutions++;
      if (!EQUITY.has(a.assetCategory) && a.assetCategory !== 'CASH') {
        const date = toIsoDate(a.tradeDate) ?? toIsoDate(a.dateTime);
        if (date && once(`ut|${a.tradeID ?? a.transactionID ?? `${a.conid}|${a.dateTime}|${a.quantity}`}`)) {
          d.unsupportedTrades.push({ symbol: a.symbol, assetCategory: a.assetCategory, date });
        }
      }
      continue;
    }
    if (level !== 'CLOSED_LOT' || !EQUITY.has(a.assetCategory)) continue;

    const closeDate = toIsoDate(a.tradeDate) ?? toIsoDate(a.dateTime);
    const openDate = toIsoDate(a.openDateTime);
    if (!closeDate || !openDate) continue;
    const quantity = dec(a.quantity).abs();
    const cost = dec(a.cost).abs();
    const realizedPnl = dec(a.fifoPnlRealized);

    const sameTrade =
      parent &&
      parent.conid === a.conid &&
      (toIsoDate(parent.tradeDate) ?? toIsoDate(parent.dateTime)) === closeDate &&
      !dec(parent.quantity).isZero();
    let proceeds: Decimal;
    let commission: Decimal;
    let proceedsSource: ClosedLot['proceedsSource'];
    if (sameTrade && parent) {
      const share = quantity.div(dec(parent.quantity).abs());
      proceeds = dec(parent.proceeds).abs().mul(share);
      commission = dec(parent.ibCommission).abs().mul(share);
      proceedsSource = 'execution';
    } else {
      proceeds = cost.add(realizedPnl);
      commission = new Decimal(0);
      proceedsSource = 'derived';
    }
    const key = `cl|${a.accountId}|${sameTrade ? (parent?.tradeID ?? parent?.transactionID) : a.dateTime}|${a.conid}|${a.openDateTime}|${a.quantity}|${a.cost}`;
    if (!once(key)) continue;
    d.closedLots.push({
      accountId: a.accountId ?? accountId,
      conid: a.conid,
      symbol: a.symbol,
      currency: a.currency,
      assetCategory: a.assetCategory,
      openDateTime: a.openDateTime,
      openDate,
      closeDate,
      quantity,
      cost,
      proceeds,
      commission,
      realizedPnl,
      proceedsSource,
      isShortCover: (sameTrade && parent?.buySell?.startsWith('BUY')) ?? false,
    });
  }
}
