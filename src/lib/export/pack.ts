import Decimal from 'decimal.js';
import type { Conversion } from '../tax/fx';
import type { Report } from '../tax/engine';
import { QUARTER_LABELS } from '../tax/years';
import { toCsv, type Cell } from './csv';
import { entityFor } from '../assets';

export interface EntityOverride {
  /** Legal name, when IBKR's abbreviated description isn't it. */
  name?: string;
  address?: string;
  zip?: string;
}
export type EntityOverrides = Record<string, EntityOverride>; // by symbol

/** Whole rupees, half-up — the ITR wants integers. */
export const rupees = (d: Decimal | undefined): number | undefined => (d ? d.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber() : undefined);
const fx2 = (d: Decimal | undefined) => (d ? d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2) : '');
const qty = (d: Decimal) => d.toDecimalPlaces(6).toString();
const rate = (c: Conversion | undefined) => (c ? c.rate.toString() : '');
const rateDate = (c: Conversion | undefined) => (c ? (c.manual ? `${c.rateDate} (manual)` : c.rateDate) : 'MISSING');

export type PackCategory = 'schedule' | 'working' | 'reference';

export interface PackFile {
  name: string;
  title: string;
  description: string;
  usedFor: string[];
  category: PackCategory;
  rows: number;
  content: string;
  /** Parsed rows for previews (header first); absent for text files. */
  table?: Cell[][];
}

export function packPrefix(r: Report): string {
  const y = r.year.ayStart;
  return r.year.newAct ? `TY${y - 1}-${String(y % 100).padStart(2, '0')}` : `AY${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

export function buildPack(r: Report, entities: EntityOverrides = {}): PackFile[] {
  const { year: ty, fa, cg, income, foreign } = r;
  const pre = packPrefix(r);
  const files: PackFile[] = [];
  const add = (f: Omit<PackFile, 'rows' | 'content' | 'name'> & { name: string; table: Cell[][] }) =>
    files.push({ name: `${pre}_${f.name}`, title: f.title, description: f.description, usedFor: f.usedFor, category: f.category, rows: Math.max(0, f.table.length - 1), content: toCsv(f.table), table: f.table });

  // ---------- schedules, in the order they are filed ----------
  add({
    name: '01_form67.csv',
    title: `${ty.law.ftcForm} — foreign tax credit`,
    description: 'Part A rows: one per country and source of income on which tax was withheld abroad.',
    usedFor: [ty.law.ftcForm],
    category: 'schedule',
    table: [
      ['Sl. No.', 'Name of the country', 'Source of income', 'Income from outside India', 'Tax paid outside India - Amount', 'Tax paid outside India - Rate (%)', 'Tax payable on such income under normal provisions in India', 'Article No. of DTAA', 'Rate of tax as per DTAA (%)', 'Credit claimed u/s 90 - Amount', 'Credit claimed u/s 91 - Amount', 'Total foreign tax credit claimed'],
      ...foreign.form67.map((f, i): Cell[] => [i + 1, f.country.name, f.source, rupees(f.incomeInr), rupees(f.taxPaidInr), f.taxRatePct.toFixed(2), rupees(f.indianTaxInr), f.article, f.dtaaRatePct ?? '', rupees(f.creditInr), 0, rupees(f.creditInr)]),
    ],
  });

  const cgRow = (label: string, st: Decimal | number | undefined, lt: Decimal | number | undefined): Cell[] => [label, typeof st === 'number' ? st : rupees(st), typeof lt === 'number' ? lt : rupees(lt)];
  add({
    name: '02_schedule_cg.csv',
    title: 'Schedule CG — capital gains',
    description: 'Section A5 (short-term) and B8 (long-term) fields, and Table F quarterly accrual.',
    usedFor: ['Schedule CG'],
    category: 'schedule',
    table: [
      ['Field', 'A5 Short-term (other assets)', 'B8 Long-term (other assets)'],
      cgRow('a(ii) Full value of consideration', cg.stcg.saleInr, cg.ltcg.saleInr),
      cgRow('b(i) Cost of acquisition without indexation', cg.stcg.costInr, cg.ltcg.costInr),
      cgRow('b(ii) Cost of improvement without indexation', 0, 0),
      cgRow('b(iii) Expenditure wholly and exclusively in connection with transfer', cg.stcg.expensesInr, cg.ltcg.expensesInr),
      cgRow('b(iv) Total', cg.stcg.costInr.add(cg.stcg.expensesInr), cg.ltcg.costInr.add(cg.ltcg.expensesInr)),
      cgRow('c Balance', cg.stcg.gainInr, cg.ltcg.gainInr),
      ...QUARTER_LABELS.map((q, i) => cgRow(`Table F — ${q}`, cg.stcg.tableF[i], cg.ltcg.tableF[i])),
    ],
  });

  add({
    name: '03_schedule_os.csv',
    title: 'Schedule OS — dividends and interest',
    description: 'Gross dividends (1a(i)), broker interest (1b(ix)) and the dividend quarterly breakup.',
    usedFor: ['Schedule OS'],
    category: 'schedule',
    table: [
      ['Field', 'Value (INR)'],
      ['1a(i) Dividend income [other than (ii) and (iii)]', rupees(income.dividendTotalInr)],
      ['1b(ix) Others including interest from Companies, NBFCs & HFCs', rupees(income.interestTotalInr)],
      ...QUARTER_LABELS.map((q, i): Cell[] => [`Item 10, 3(a) Dividend — ${q}`, rupees(income.dividendQuarters[i])]),
    ],
  });

  add({
    name: '04_schedule_fsi.csv',
    title: 'Schedule FSI — income from outside India',
    description: 'Per country and head: income, tax paid abroad, Indian tax, relief and DTAA article.',
    usedFor: ['Schedule FSI'],
    category: 'schedule',
    table: [
      ['Country', 'Country code', 'Taxpayer Identification Number', 'Head of income', '(b) Income from outside India', '(c) Tax paid outside India', '(d) Tax payable on such income under normal provisions in India', '(e) Tax relief available in India', '(f) Relevant article of DTAA'],
      ...foreign.fsi.flatMap((c) =>
        c.heads.map((h): Cell[] => [c.country.name, c.country.itrCode, r.settings.tin, h.head, rupees(h.incomeInr), rupees(h.taxPaidInr), rupees(h.indianTaxInr), rupees(h.reliefInr), h.article]),
      ),
    ],
  });

  add({
    name: '05_schedule_tr.csv',
    title: 'Schedule TR — summary of tax relief',
    description: 'Per country totals from Schedule FSI, claimed under section 90.',
    usedFor: ['Schedule TR'],
    category: 'schedule',
    table: [
      ['(a) Country Code', 'Country', '(b) Taxpayer Identification Number', '(c) Total taxes paid outside India', '(d) Total tax relief available', '(e) Tax Relief Claimed under section'],
      ...foreign.tr.map((t): Cell[] => [t.country.itrCode, t.country.name, r.settings.tin, rupees(t.taxPaidInr), rupees(t.reliefInr), t.section]),
    ],
  });

  const a2: Cell[][] = [];
  for (const a of fa.a2) {
    const natures = a.credited.length ? a.credited : [{ nature: 'No Amount paid/credited', code: 'N', inr: new Decimal(0) }];
    for (const n of natures) {
      a2.push([a2.length + 1, `${a.country.itrCode} - ${a.country.name}`, a.institution.name, a.institution.address, a.institution.zip, a.account.accountId, 'Owner', a.account.dateOpened ?? '', rupees(a.peak?.inr), rupees(a.closing), `${n.code} - ${n.nature}`, rupees(n.inr) ?? 0]);
    }
  }
  add({
    name: '06_schedule_fa_A2.csv',
    title: 'Schedule FA — Table A2, custodial account',
    description: `Your IBKR account for calendar year ${ty.cyStart.slice(0, 4)}: peak and closing cash, and gross amounts credited (one row per nature).`,
    usedFor: ['Schedule FA'],
    category: 'schedule',
    table: [
      ['Sl.No.', 'Country Name and Code', 'Name of financial institution', 'Address of financial institution', 'ZIP Code', 'Account Number', 'Status', 'Account opening date', 'Peak Balance During the Period', 'Closing balance', 'Nature of Amount', 'Amount'],
      ...a2,
    ],
  });

  add({
    name: '07_schedule_fa_A3.csv',
    title: 'Schedule FA — Table A3, equity holdings',
    description: `One row per purchase lot held at any time in calendar year ${ty.cyStart.slice(0, 4)}, in the portal's column order.`,
    usedFor: ['Schedule FA'],
    category: 'schedule',
    table: [
      ['Sl.No.', 'Country Name and Code', 'Name of entity', 'Address of entity', 'ZIP Code', 'Nature of entity', 'Date of acquiring the interest', 'Initial value of the investment', 'Peak value of investment during the Period', 'Closing balance', 'Total gross amount paid/credited with respect to the holding during the period', 'Total gross proceeds from sale or redemption of investment during the period'],
      ...fa.a3.map((row, i): Cell[] => {
        const e = entityFor(row.lot.symbol, row.isin, row.entityName, entities);
        return [
        i + 1, `${row.country.itrCode} - ${row.country.name}`, e.name, e.address, e.zip, e.nature ?? row.natureOfEntity, row.acquired,
        rupees(row.initial?.inr), rupees(row.peak?.inr), rupees(row.closing?.inr) ?? 0, rupees(row.dividends.inr) ?? 0, rupees(row.proceeds.inr) ?? 0,
      ];
      }),
    ],
  });

  // ---------- working papers ----------
  add({
    name: 'working_capital_gains.csv',
    title: 'Capital gains — every sold lot',
    description: `Acquisition and sale dates, holding period, foreign amounts, SBI rates with dates, INR values (${r.settings.cgFxMethod === 'split' ? 'sale and cost converted separately' : 'gain converted at the sale-month rate'}).`,
    usedFor: ['Schedule CG', 'CA review'],
    category: 'working',
    table: [
      ['Symbol', 'Description', 'Currency', 'Acquired', 'Sold', 'Quantity', 'Term', 'Holding needed (months)', 'Tax rate', 'Quarter (234C)', 'Sale value (foreign)', 'Sale commission (foreign)', 'Cost incl. buy commission (foreign)', 'Gain (foreign)', 'IBKR realized P/L', 'Sale TTBR', 'Sale TTBR date', 'Cost TTBR', 'Cost TTBR date', 'Full value of consideration (INR)', 'Expenses on transfer (INR)', 'Cost of acquisition (INR)', 'Gain (INR)'],
      ...cg.rows.map((row): Cell[] => [
        row.lot.symbol, row.description, row.lot.currency, row.lot.openDate, row.lot.closeDate, qty(row.lot.quantity), row.term, row.monthsRequired, row.rateNote, QUARTER_LABELS[row.quarter],
        fx2(row.lot.proceeds), fx2(row.lot.commission), fx2(row.lot.cost), fx2(row.gainForeign), fx2(row.lot.realizedPnl),
        rate(row.saleRate), rateDate(row.saleRate), rate(row.costRate), rateDate(row.costRate),
        rupees(row.saleInr), rupees(row.expensesInr), rupees(row.costInr), rupees(row.gainInr),
      ]),
    ],
  });
  add({
    name: 'working_dividends.csv',
    title: 'Dividends — every payment',
    description: `Gross amount, tax withheld, SBI rate on the last day of the month before payment (${ty.law.conversionRule}).`,
    usedFor: ['Schedule OS', 'Schedule FSI'],
    category: 'working',
    table: [
      ['Pay date', 'Symbol', 'Description', 'Country', 'Currency', 'Gross (foreign)', 'Tax withheld (foreign)', 'TTBR', 'TTBR date', 'Gross (INR)', 'Quarter (234C)'],
      ...income.dividends.map((d): Cell[] => [d.txn.date, d.txn.symbol, d.description, d.country.name, d.txn.currency, fx2(d.txn.amount), fx2(d.withheldForeign), rate(d.conv), rateDate(d.conv), rupees(d.conv?.inr), QUARTER_LABELS[d.quarter]]),
    ],
  });
  add({
    name: 'working_interest.csv',
    title: 'Broker interest — every credit',
    description: r.settings.interestRate === 'fyEnd' ? `Converted at the SBI rate on ${ty.fyEnd}.` : 'Converted at the SBI rate on the last day of the month before each credit.',
    usedFor: ['Schedule OS'],
    category: 'working',
    table: [
      ['Date', 'Description', 'Currency', 'Amount (foreign)', 'TTBR', 'TTBR date', 'Amount (INR)'],
      ...income.interest.map((d): Cell[] => [d.txn.date, d.description, d.txn.currency, fx2(d.txn.amount), rate(d.conv), rateDate(d.conv), rupees(d.conv?.inr)]),
    ],
  });
  add({
    name: 'working_foreign_tax.csv',
    title: 'Foreign tax withheld — every deduction',
    description: `Each deduction at the SBI rate on the last day of the month before it (${ty.law.ftcRule}). Evidence for ${ty.law.ftcForm}.`,
    usedFor: [ty.law.ftcForm, 'Schedule FSI'],
    category: 'working',
    table: [
      ['Date', 'Symbol', 'Description', 'Country', 'Income head', 'Currency', 'Tax (foreign)', 'TTBR', 'TTBR date', 'Tax (INR)'],
      ...income.taxes.map((t): Cell[] => [t.txn.date, t.txn.symbol, t.txn.description, t.country.name, t.head, t.txn.currency, fx2(t.txn.amount.neg()), rate(t.conv), rateDate(t.conv), rupees(t.conv?.inr)]),
    ],
  });
  add({
    name: 'working_fa_A3.csv',
    title: 'Schedule FA — lot workings',
    description: 'Quantities, prices, rates and dates behind every A3 value, including the day each peak occurred.',
    usedFor: ['Schedule FA', 'CA review'],
    category: 'working',
    table: [
      ['Symbol', 'ISIN', 'Entity', 'Country', 'Currency', 'Acquired', 'Qty at start of CY', 'Qty at 31 Dec', 'Initial value (foreign)', 'Initial TTBR', 'Initial TTBR date', 'Initial value (INR)', 'Peak date', 'Peak qty', 'Peak price', 'Peak TTBR', 'Peak value (INR)', 'Peak method', '31 Dec price', 'Closing TTBR', 'Closing TTBR date', 'Closing value (INR)', 'Dividends credited (foreign)', 'Dividends credited (INR)', 'Sale proceeds (foreign)', 'Sale proceeds (INR)'],
      ...fa.a3.map((row): Cell[] => [
        row.lot.symbol, row.isin, row.entityName, row.country.name, row.lot.currency, row.acquired, qty(row.qtyStart), qty(row.qtyEnd),
        fx2(row.initial?.foreign), rate(row.initial), rateDate(row.initial), rupees(row.initial?.inr),
        row.peak?.date, row.peak ? qty(row.peak.qty) : '', fx2(row.peak?.price), row.peak?.rate.toString(), rupees(row.peak?.inr), row.peakQuality,
        fx2(row.closingPrice), rate(row.closing), row.closing ? rateDate(row.closing) : '', rupees(row.closing?.inr) ?? 0,
        fx2(row.dividends.foreign), rupees(row.dividends.inr), fx2(row.proceeds.foreign), rupees(row.proceeds.inr),
      ]),
    ],
  });

  // ---------- reference ----------
  add({
    name: 'exchange_rates_used.csv',
    title: 'Exchange-rate appendix',
    description: 'Every SBI TT buying rate applied: the date the rule asked for, the card date actually used, and where it was used.',
    usedFor: ['All schedules', 'CA review'],
    category: 'reference',
    table: [
      ['Currency', 'Date required', 'SBI card date used', 'TT buying rate (INR per unit)', 'Source', 'Used for'],
      ...r.rates.map((u): Cell[] => [u.currency, u.requestedDate, u.rateDate, u.rate, u.manual ? 'Entered manually' : 'SBI Forex Card Rates', [...u.usedFor].join('; ')]),
    ],
  });

  files.unshift({
    name: `${pre}_00_README.txt`,
    title: 'README — how to use this pack',
    description: 'What each file is, the settings and rules used, and every warning raised.',
    usedFor: ['Start here'],
    category: 'reference',
    rows: 0,
    content: readme(r, files),
  });
  return files;
}

function readme(r: Report, files: PackFile[]): string {
  const ty = r.year;
  const lines = [
    `IBKR → India tax pack — ${ty.label}`,
    `Account ${r.account.accountId}. Generated ${new Date().toISOString().slice(0, 10)} in the browser; no data left the device.`,
    '',
    `Law: ${ty.law.act}. Conversions at SBI TT buying rates (${ty.law.conversionRule}; foreign tax credit ${ty.law.ftcRule}).`,
    `Schedule FA covers calendar year ${ty.cyStart} to ${ty.cyEnd}. Schedules CG, OS, FSI and TR cover ${ty.fyStart} to ${ty.fyEnd}.`,
    '',
    'Order of filing:',
    `  1. ${ty.law.ftcForm} (foreign tax credit) — file before the return.`,
    '  2. ITR-2: Schedule CG, OS, FSI, TR, FA, then answer "Yes" to the foreign-assets question in Part B-TTI.',
    '',
    'Settings used:',
    `  Residential status: ${r.settings.residency}`,
    `  Capital gains conversion: ${r.settings.cgFxMethod === 'split' ? 'sale value and cost converted separately (month-end before sale / before purchase)' : 'foreign-currency gain converted at the month-end rate before the sale'}`,
    `  Schedule FA income and proceeds: ${r.settings.faIncomeRate === 'txn' ? 'SBI rate on the transaction date' : 'SBI rate on 31 December'}`,
    `  Broker interest: ${r.settings.interestRate === 'fyEnd' ? `SBI rate on ${ty.fyEnd}` : 'SBI rate at month-end before each credit'}`,
    `  Marginal tax rate (for the foreign tax credit limit): ${r.settings.marginalRatePct}%`,
    '',
    'Files:',
    '  00_README.txt — this file',
    ...files.map((f) => `  ${f.name.replace(/^[^_]+_/, '')} — ${f.title}. ${f.description}`),
    '',
    'Method notes:',
    "  Schedule FA A3 has one row per purchase lot. Peak value = highest of (shares held x that day's price x that day's SBI rate) during the calendar year.",
    '  Dividends are attributed only to lots held on the day before the ex-date. Closing balance uses the 31 December price and rate.',
    '  US shares are not listed in India: long-term only if held more than 24 months, taxed at 12.5% without indexation; short-term at slab rates.',
    `  Dividends are reported gross (before US withholding); the withholding is claimed through Schedules FSI/TR and ${ty.law.ftcForm}.`,
    '  Table F values are net gains per period with losses absorbed by later gains, never negative. Re-check against Schedule BFLA.',
    '  Schedule FA has no official bulk upload; enter rows on the portal (or the offline utility) using the A2/A3 files, which follow the portal column order.',
    '  Company names and addresses come from your own entries, then the tool\'s address book of public issuer records; IBKR data has neither.',
    '',
    'Warnings raised:',
    ...(r.warnings.length ? r.warnings.map((w) => `  [${w.level.toUpperCase()}] ${w.area}: ${w.message}`) : ['  none']),
    '',
    'This is a calculation aid, not tax advice. Review every figure with your Chartered Accountant before filing.',
  ];
  return lines.join('\r\n') + '\r\n';
}

export async function zipPack(files: PackFile[]): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.content);
  return zip.generateAsync({ type: 'blob' });
}

export function byteSize(s: string): number {
  return new TextEncoder().encode(s).length;
}
