// Generates FICTIONAL IBKR Activity Flex Query XML exports for the demo and tests:
//   public/samples/sample-cy2025.xml      (2025-01-01 → 2025-12-31, for Schedule FA)
//   public/samples/sample-fy2025-26.xml   (2025-04-01 → 2026-03-31, for CG / OS / FTC)
// Prices are a deterministic synthetic series; nothing here is real market or account data.
import { mkdir, writeFile } from 'node:fs/promises';

const ACCOUNT = 'U0000000';
const SEC = {
  AAPL: { conid: '265598', isin: 'US0378331005', desc: 'APPLE INC', sub: 'COMMON', base: 200, amp: 0.12, period: 37 },
  MSFT: { conid: '272093', isin: 'US5949181045', desc: 'MICROSOFT CORP', sub: 'COMMON', base: 450, amp: 0.1, period: 53 },
  NVDA: { conid: '4815747', isin: 'US67066G1040', desc: 'NVIDIA CORP', sub: 'COMMON', base: 140, amp: 0.2, period: 29 },
  VOO: { conid: '136155102', isin: 'US9229083632', desc: 'VANGUARD S&P 500 ETF', sub: 'ETF', base: 540, amp: 0.07, period: 61 },
};

const day = (s) => Date.parse(s) / 86400000;
const iso = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
const ymd = (s) => s.replaceAll('-', '');
const r2 = (x) => Math.round(x * 100) / 100;
function price(sym, date) {
  const s = SEC[sym];
  const t = day(date) - day('2025-01-01');
  return r2(s.base * (1 + s.amp * Math.sin(t / s.period) + 0.0004 * t));
}
function businessDays(from, to) {
  const out = [];
  for (let n = day(from); n <= day(to); n++) {
    const wd = new Date(n * 86400000).getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(iso(n));
  }
  return out;
}

// Pre-2025 lots carry fixed historical prices; 2025+ trades use the synthetic series.
const events = [
  { type: 'BUY', sym: 'AAPL', date: '2022-06-10', time: '101500', qty: 20, px: 140.1 },
  { type: 'BUY', sym: 'VOO', date: '2023-11-20', time: '113000', qty: 8, px: 401.5 },
  { type: 'BUY', sym: 'MSFT', date: '2024-09-16', time: '094500', qty: 6, px: 431.2 },
  { type: 'DEP', date: '2025-01-15', amount: 10000 },
  { type: 'BUY', sym: 'AAPL', date: '2025-02-03', time: '103000', qty: 10 },
  { type: 'BUY', sym: 'NVDA', date: '2025-03-10', time: '150000', qty: 25 },
  { type: 'BUY', sym: 'VOO', date: '2025-05-05', time: '100000', qty: 5 },
  { type: 'SELL', sym: 'AAPL', date: '2025-08-12', time: '140000', qty: 15 },
  { type: 'SELL', sym: 'MSFT', date: '2025-11-20', time: '110000', qty: 6 },
  { type: 'SELL', sym: 'NVDA', date: '2026-02-12', time: '120000', qty: 10 },
];
const dividends = [
  ['AAPL', '2025-02-13', '2025-02-10', 0.25], ['AAPL', '2025-05-15', '2025-05-12', 0.26], ['AAPL', '2025-08-14', '2025-08-11', 0.26],
  ['AAPL', '2025-11-13', '2025-11-10', 0.26], ['AAPL', '2026-02-12', '2026-02-09', 0.26],
  ['VOO', '2025-03-27', '2025-03-25', 1.81], ['VOO', '2025-06-30', '2025-06-27', 1.74], ['VOO', '2025-09-29', '2025-09-26', 1.74],
  ['VOO', '2025-12-23', '2025-12-22', 1.85], ['VOO', '2026-03-26', '2026-03-24', 1.82],
  ['MSFT', '2025-03-13', '2025-02-20', 0.83], ['MSFT', '2025-06-12', '2025-05-15', 0.83], ['MSFT', '2025-09-11', '2025-08-21', 0.83],
];
const interest = businessDays('2025-01-01', '2026-03-31')
  .filter((d) => d.slice(8) <= '07' && businessDays(d.slice(0, 8) + '01', d)[0] === d)
  .map((d, i) => [d, r2(3.1 + (i % 5) * 0.37)]);

// Replay into lots, cash and a ledger of funds lines.
const lots = []; // { sym, openDateTime, openDate, qty, unitCost }
const execs = [];
const funds = [];
let cash = 3000;
const fund = (date, code, desc, amount) => {
  cash = r2(cash + amount);
  funds.push({ date, code, desc, amount: r2(amount), balance: cash });
};
const timeline = [
  ...events.map((e) => ({ ...e, k: 0 })),
  ...dividends.map(([sym, date, ex, per]) => ({ type: 'DIV', sym, date, ex, per, k: 1 })),
  ...interest.map(([date, amount]) => ({ type: 'INT', date, amount, k: 2 })),
].sort((a, b) => a.date.localeCompare(b.date) || a.k - b.k);

const cashTx = [];
let txn = 1000;
let cashId = 900000;
const addCash = (c) => cashTx.push({ ...c, id: ++cashId });
for (const e of timeline) {
  const s = SEC[e.sym];
  if (e.type === 'DEP') {
    if (e.date >= '2025-01-01') fund(e.date, 'DEP', 'Electronic Fund Transfer', e.amount);
    addCash({ type: 'Deposits/Withdrawals', date: e.date, amount: e.amount, desc: 'CASH RECEIPTS / ELECTRONIC FUND TRANSFERS' });
  } else if (e.type === 'BUY') {
    const px = e.px ?? price(e.sym, e.date);
    const comm = 1;
    const odt = `${ymd(e.date)};${e.time}`;
    lots.push({ sym: e.sym, openDateTime: odt, openDate: e.date, qty: e.qty, unitCost: (e.qty * px + comm) / e.qty });
    const exec = { sym: e.sym, date: e.date, time: e.time, side: 'BUY', qty: e.qty, px, proceeds: -r2(e.qty * px), comm: -comm, oc: 'O', id: ++txn };
    execs.push({ exec, lots: [] });
    if (e.date >= '2025-01-01') fund(e.date, 'BUY', `Buy ${e.qty} ${s.desc}`, -(e.qty * px + comm));
  } else if (e.type === 'SELL') {
    const px = price(e.sym, e.date);
    const comm = 1;
    const exec = { sym: e.sym, date: e.date, time: e.time, side: 'SELL', qty: -e.qty, px, proceeds: r2(e.qty * px), comm: -comm, oc: 'C', id: ++txn };
    let left = e.qty;
    const cl = [];
    for (const lot of lots.filter((l) => l.sym === e.sym && l.qty > 0)) {
      if (!left) break;
      const q = Math.min(left, lot.qty);
      lot.qty -= q;
      left -= q;
      const cost = r2(q * lot.unitCost);
      const pnl = r2(q * px - (comm * q) / e.qty - cost);
      cl.push({ sym: e.sym, openDateTime: lot.openDateTime, qty: -q, cost: -cost, pnl, date: e.date, time: e.time, px });
    }
    execs.push({ exec, lots: cl });
    fund(e.date, 'SELL', `Sell ${e.qty} ${s.desc}`, e.qty * px - comm);
  } else if (e.type === 'DIV') {
    const heldEx = heldOnDate(e.sym, e.ex);
    if (!heldEx) continue;
    const gross = r2(heldEx * e.per);
    const tax = r2(gross * 0.25);
    const d = `${s.desc.split(' ')[0]}(${s.isin}) Cash Dividend USD ${e.per} per Share (Ordinary Dividend)`;
    addCash({ type: 'Dividends', sym: e.sym, date: e.date, amount: gross, desc: d });
    addCash({ type: 'Withholding Tax', sym: e.sym, date: e.date, amount: -tax, desc: `${s.desc.split(' ')[0]}(${s.isin}) Cash Dividend USD ${e.per} per Share - US Tax` });
    fund(e.date, 'DIV', d, gross);
    fund(e.date, 'FRTAX', `${e.sym} US Tax`, -tax);
  } else if (e.type === 'INT') {
    const month = new Date(Date.parse(e.date) - 10 * 86400000).toISOString().slice(0, 7);
    addCash({ type: 'Broker Interest Received', date: e.date, amount: e.amount, desc: `USD CREDIT INT FOR ${month}` });
    fund(e.date, 'CINT', `USD Credit Interest for ${month}`, e.amount);
  }
}
function heldOnDate(sym, date) {
  // Shares held at the end of the day before `date` (ex-date entitlement).
  let q = 0;
  for (const { exec } of execs) {
    if (exec.sym === sym && exec.date < date) q += exec.qty;
  }
  return q;
}

const attrs = (o) => Object.entries(o).map(([k, v]) => `${k}="${String(v).replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"`).join(' ');

function statement(from, to) {
  const inR = (d) => d >= from && d <= to;
  const L = [];
  L.push(`<AccountInformation ${attrs({ accountId: ACCOUNT, acctAlias: '', currency: 'USD', name: 'Sample Investor', accountType: 'Individual', dateOpened: '20210315', dateFunded: '20210322', ibEntity: 'IBLLC-US', primaryEmail: '' })} />`);

  L.push('<SecuritiesInfo>');
  for (const [sym, s] of Object.entries(SEC)) {
    L.push(`<SecurityInfo ${attrs({ assetCategory: 'STK', subCategory: s.sub, symbol: sym, description: s.desc, conid: s.conid, isin: s.isin, listingExchange: sym === 'VOO' ? 'ARCA' : 'NASDAQ', issuerCountryCode: 'US', currency: 'USD' })} />`);
  }
  L.push('</SecuritiesInfo>');

  L.push('<Trades>');
  for (const { exec: e, lots: cl } of execs) {
    if (!inR(e.date)) continue;
    const s = SEC[e.sym];
    const base = { accountId: ACCOUNT, currency: 'USD', assetCategory: 'STK', symbol: e.sym, description: s.desc, conid: s.conid, isin: s.isin, issuerCountryCode: 'US' };
    L.push(`<Trade ${attrs({ ...base, tradeID: e.id, transactionID: e.id + 500000, dateTime: `${ymd(e.date)};${e.time}`, tradeDate: ymd(e.date), quantity: e.qty, tradePrice: e.px, tradeMoney: r2(e.qty * e.px), proceeds: e.proceeds, ibCommission: e.comm, ibCommissionCurrency: 'USD', buySell: e.side, openCloseIndicator: e.oc, levelOfDetail: 'EXECUTION', openDateTime: '', fifoPnlRealized: r2(cl.reduce((t, l) => t + l.pnl, 0)), cost: cl.length ? r2(cl.reduce((t, l) => t + l.cost, 0)) : r2(-e.proceeds - e.comm) })} />`);
    for (const l of cl) {
      L.push(`<Lot ${attrs({ ...base, dateTime: `${ymd(l.date)};${l.time}`, tradeDate: ymd(l.date), quantity: l.qty, tradePrice: l.px, cost: l.cost, fifoPnlRealized: l.pnl, buySell: 'SELL', openCloseIndicator: 'C', levelOfDetail: 'CLOSED_LOT', openDateTime: l.openDateTime })} />`);
    }
  }
  L.push('</Trades>');

  // Open positions (Lot level) at statement end.
  const replayLots = replayTo(to);
  L.push('<OpenPositions>');
  for (const l of replayLots) {
    const s = SEC[l.sym];
    const mark = price(l.sym, lastBusinessDay(to));
    L.push(`<OpenPosition ${attrs({ accountId: ACCOUNT, currency: 'USD', assetCategory: 'STK', symbol: l.sym, description: s.desc, conid: s.conid, isin: s.isin, issuerCountryCode: 'US', reportDate: ymd(to), position: l.qty, markPrice: mark, positionValue: r2(l.qty * mark), costBasisPrice: r2(l.unitCost), costBasisMoney: r2(l.qty * l.unitCost), openDateTime: l.openDateTime, levelOfDetail: 'LOT', side: 'Long' })} />`);
  }
  L.push('</OpenPositions>');

  L.push('<CashTransactions>');
  for (const c of cashTx.filter((c) => inR(c.date))) {
    const s = c.sym ? SEC[c.sym] : undefined;
    L.push(`<CashTransaction ${attrs({ accountId: ACCOUNT, currency: 'USD', assetCategory: s ? 'STK' : '', symbol: c.sym ?? '', description: c.desc, conid: s?.conid ?? '', isin: s?.isin ?? '', issuerCountryCode: s ? 'US' : '', dateTime: `${ymd(c.date)};202000`, settleDate: ymd(c.date), amount: c.amount, type: c.type, transactionID: c.id, levelOfDetail: 'DETAIL' })} />`);
  }
  L.push('</CashTransactions>');

  // Prior period positions: one row per held position per business day (synthetic closes).
  L.push('<PriorPeriodPositions>');
  for (const d of businessDays(from, to)) {
    const held = new Map();
    for (const l of replayTo(d)) held.set(l.sym, (held.get(l.sym) ?? 0) + l.qty);
    for (const [sym, q] of held) {
      if (!q) continue;
      const s = SEC[sym];
      L.push(`<PriorPeriodPosition ${attrs({ accountId: ACCOUNT, currency: 'USD', assetCategory: 'STK', symbol: sym, description: s.desc, conid: s.conid, isin: s.isin, date: ymd(d), price: price(sym, d), priorMtmPnl: 0 })} />`);
    }
  }
  L.push('</PriorPeriodPositions>');

  L.push('<StmtFunds>');
  for (const f of funds.filter((f) => inR(f.date))) {
    L.push(`<StatementOfFundsLine ${attrs({ accountId: ACCOUNT, currency: 'USD', levelOfDetail: 'Currency', date: ymd(f.date), reportDate: ymd(f.date), activityCode: f.code, activityDescription: f.desc, amount: f.amount, balance: f.balance })} />`);
  }
  L.push('</StmtFunds>');

  const before = funds.filter((f) => f.date < from).at(-1)?.balance ?? 3000;
  const end = funds.filter((f) => f.date <= to).at(-1)?.balance ?? before;
  L.push('<CashReport>');
  L.push(`<CashReportCurrency ${attrs({ accountId: ACCOUNT, currency: 'USD', levelOfDetail: 'Currency', fromDate: ymd(from), toDate: ymd(to), startingCash: before, endingCash: end })} />`);
  L.push('</CashReport>');

  L.push('<ChangeInDividendAccruals>');
  for (const [sym, pay, ex] of dividends.filter(([, pay]) => inR(pay))) {
    L.push(`<ChangeInDividendAccrual ${attrs({ accountId: ACCOUNT, currency: 'USD', assetCategory: 'STK', symbol: sym, conid: SEC[sym].conid, exDate: ymd(ex), payDate: ymd(pay), code: 'Po' })} />`);
  }
  L.push('</ChangeInDividendAccruals>');
  L.push('<CorporateActions />');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- FICTIONAL SAMPLE DATA generated by scripts/make-sample.mjs — not a real account. -->
<FlexQueryResponse queryName="india-tax-sample" type="AF">
<FlexStatements count="1">
<FlexStatement accountId="${ACCOUNT}" fromDate="${ymd(from)}" toDate="${ymd(to)}" period="Custom" whenGenerated="20260405;101010">
${L.join('\n')}
</FlexStatement>
</FlexStatements>
</FlexQueryResponse>
`;
}

function lastBusinessDay(d) {
  const days = businessDays(iso(day(d) - 6), d);
  return days.at(-1);
}

/** Lots open at end of `date`, replaying the event list from scratch. */
function replayTo(date) {
  const ls = [];
  for (const e of events) {
    if (e.date > date) break;
    if (e.type === 'BUY') {
      const px = e.px ?? price(e.sym, e.date);
      ls.push({ sym: e.sym, openDateTime: `${ymd(e.date)};${e.time}`, qty: e.qty, unitCost: (e.qty * px + 1) / e.qty });
    } else if (e.type === 'SELL') {
      let left = e.qty;
      for (const l of ls.filter((l) => l.sym === e.sym && l.qty > 0)) {
        const q = Math.min(left, l.qty);
        l.qty -= q;
        left -= q;
      }
    }
  }
  return ls.filter((l) => l.qty > 0);
}

const out = new URL('../public/samples/', import.meta.url);
await mkdir(out, { recursive: true });
await writeFile(new URL('sample-cy2025.xml', out), statement('2025-01-01', '2025-12-31'));
await writeFile(new URL('sample-fy2025-26.xml', out), statement('2025-04-01', '2026-03-31'));
console.log('wrote sample-cy2025.xml and sample-fy2025-26.xml');
