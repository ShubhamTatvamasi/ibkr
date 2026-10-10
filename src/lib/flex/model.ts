import type Decimal from 'decimal.js';
import type { IsoDate } from '../dates';

/** Normalized view of one or more IBKR Activity Flex Query exports (XML). */

export interface StatementInfo {
  accountId: string;
  fromDate: IsoDate;
  toDate: IsoDate;
  fileName: string;
}

export interface Account {
  accountId: string;
  name: string;
  baseCurrency: string;
  dateOpened?: IsoDate;
  /** First funding date — statements start here, so earlier dates need no coverage. */
  dateFunded?: IsoDate;
  ibEntity?: string;
}

export interface Instrument {
  conid: string;
  symbol: string;
  description: string;
  isin?: string;
  assetCategory: string;
  subCategory?: string;
  issuerCountryCode?: string;
  currency?: string;
}

/** A sale (or other closing) of part of a lot, as reported by IBKR's CLOSED_LOT rows. */
export interface ClosedLot {
  accountId: string;
  conid: string;
  symbol: string;
  currency: string;
  assetCategory: string;
  /** Identifies the lot; matches OpenLot.openDateTime for the unsold remainder. */
  openDateTime: string;
  openDate: IsoDate;
  closeDate: IsoDate;
  quantity: Decimal;
  /** Cost basis of the closed quantity, in `currency`, including purchase commission. */
  cost: Decimal;
  /** Gross sale value of the closed quantity, in `currency`. */
  proceeds: Decimal;
  /** Sale commission allocated to this lot. */
  commission: Decimal;
  /** IBKR's realized P/L for this lot (used only as a cross-check). */
  realizedPnl: Decimal;
  /** 'execution' when proceeds were apportioned from the parent trade, 'derived' when inferred from cost + P/L. */
  proceedsSource: 'execution' | 'derived';
  /** True when the parent trade was a buy, i.e. a short position being covered. */
  isShortCover: boolean;
}

export interface OpenLot {
  accountId: string;
  conid: string;
  symbol: string;
  description: string;
  currency: string;
  assetCategory: string;
  reportDate: IsoDate;
  openDateTime: string;
  openDate: IsoDate;
  quantity: Decimal;
  costBasisMoney: Decimal;
  markPrice: Decimal;
}

export type CashKind = 'dividend' | 'interest' | 'withholding' | 'transfer' | 'other';

export interface CashTxn {
  accountId: string;
  type: string;
  kind: CashKind;
  conid?: string;
  symbol?: string;
  isin?: string;
  issuerCountryCode?: string;
  currency: string;
  date: IsoDate;
  amount: Decimal;
  description: string;
}

export interface PricePoint {
  accountId: string;
  conid: string;
  date: IsoDate;
  price: Decimal;
  currency: string;
}

export interface FundsLine {
  accountId: string;
  currency: string;
  levelOfDetail: string;
  date: IsoDate;
  amount: Decimal;
  balance: Decimal;
  activityCode: string;
}

export interface CashReportRow {
  accountId: string;
  currency: string;
  levelOfDetail: string;
  fromDate: IsoDate;
  toDate: IsoDate;
  startingCash: Decimal;
  endingCash: Decimal;
}

export interface CorporateAction {
  accountId: string;
  conid: string;
  symbol: string;
  date: IsoDate;
  /** IBKR code: FS forward split, RS reverse split, SO spin-off, TC merger, SD stock dividend, … */
  type: string;
  description: string;
  /** Shares added (+) or removed (−) by the action. */
  quantity: Decimal;
}

/** A position moved into or out of the account without a trade (ACATS, FOP, internal). */
export interface Transfer {
  accountId: string;
  conid: string;
  symbol: string;
  date: IsoDate;
  type: string;
  direction: 'IN' | 'OUT';
  quantity: Decimal;
  description: string;
}

export interface DividendAccrual {
  accountId: string;
  conid: string;
  exDate?: IsoDate;
  payDate?: IsoDate;
}

export interface FlexData {
  statements: StatementInfo[];
  accounts: Account[];
  instruments: Map<string, Instrument>;
  closedLots: ClosedLot[];
  openLots: OpenLot[];
  cash: CashTxn[];
  prices: PricePoint[];
  funds: FundsLine[];
  cashReports: CashReportRow[];
  corporateActions: CorporateAction[];
  transfers: Transfer[];
  dividendAccruals: DividendAccrual[];
  /** Trades in asset classes we don't compute (options, futures, forex…), for warnings. */
  unsupportedTrades: { symbol: string; assetCategory: string; date: IsoDate }[];
  sections: Set<string>;
  /** Stock/ETF sale executions seen, to detect a Trades section without Closed Lots. */
  saleExecutions: number;
  /** Attribute names seen per section, to tell the user which Flex fields are missing. */
  fields: Map<string, Set<string>>;
}
