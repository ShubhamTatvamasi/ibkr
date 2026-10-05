import Decimal from 'decimal.js';
import type { Conversion } from '../tax/fx';
import type { Report } from '../tax/engine';
import { QUARTER_LABELS } from '../tax/years';
import { toCsv, toPortalCsv, type Cell } from './csv';

export interface EntityOverride {
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

export interface PackFile {
  name: string;
  title: string;
  content: string;
}

export function buildPack(r: Report, entities: EntityOverrides = {}): PackFile[] {
  const files: PackFile[] = [];
  const { year: ty, fa, cg, income } = r;

  // ---- Schedule FA A3 (portal upload format) ----
  files.push({
    name: 'schedule_fa_A3_portal_upload.csv',
    title: 'Schedule FA — Table A3, e-filing bulk-upload layout',
    content: toPortalCsv(
      [
        'Country/Region name',
        'Country Name and Code',
        'Name of entity',
        'Address of entity',
        'ZIP Code',
        'Nature of entity',
        'Date of acquiring the interest',
        'Initial value of the investment',
        'Peak value of investment during the Period',
        'Closing balance',
        'Total gross amount paid/credited with respect to the holding during the period',
        'Total gross proceeds from sale or redemption of investment during the period',
      ],
      fa.a3.map((row, i) => [
        i + 1,
        row.country.itrCode,
        row.entityName,
        entities[row.lot.symbol]?.address,
        entities[row.lot.symbol]?.zip,
        row.natureOfEntity,
        row.acquired,
        rupees(row.initial?.inr) ?? '',
        rupees(row.peak?.inr) ?? '',
        rupees(row.closing?.inr) ?? 0,
        rupees(row.dividends.inr) ?? 0,
        rupees(row.proceeds.inr) ?? 0,
      ]),
    ),
  });

  files.push({
    name: 'schedule_fa_A3_workings.csv',
    title: 'Schedule FA — Table A3 workings (one row per lot, with every rate and date)',
    content: toCsv([
      [
        'Symbol', 'ISIN', 'Entity', 'Country', 'ITR country code', 'Currency', 'Acquired', 'Qty at start of CY', 'Qty at 31 Dec',
        'Initial value (foreign)', 'Initial TTBR', 'Initial TTBR date', 'Initial value (INR)',
        'Peak date', 'Peak qty', 'Peak price', 'Peak TTBR', 'Peak value (INR)', 'Peak method',
        '31 Dec price', 'Closing TTBR', 'Closing TTBR date', 'Closing value (INR)',
        'Dividends credited (foreign)', 'Dividends credited (INR)', 'Sale proceeds (foreign)', 'Sale proceeds (INR)',
      ],
      ...fa.a3.map((row): Cell[] => [
        row.lot.symbol, row.isin, row.entityName, row.country.name, row.country.itrCode, row.lot.currency, row.acquired, qty(row.qtyStart), qty(row.qtyEnd),
        fx2(row.initial?.foreign), rate(row.initial), rateDate(row.initial), rupees(row.initial?.inr),
        row.peak?.date, row.peak ? qty(row.peak.qty) : '', fx2(row.peak?.price), row.peak?.rate.toString(), rupees(row.peak?.inr), row.peakQuality,
        fx2(row.closingPrice), rate(row.closing), row.closing ? rateDate(row.closing) : '', rupees(row.closing?.inr) ?? 0,
        fx2(row.dividends.foreign), rupees(row.dividends.inr), fx2(row.proceeds.foreign), rupees(row.proceeds.inr),
      ]),
    ]),
  });

  // ---- Schedule FA A2 ----
  const a2rows: Cell[][] = [];
  for (const a of fa.a2) {
    const natures = a.credited.length ? a.credited : [{ nature: 'No amount paid/credited', code: 'N', inr: new Decimal(0) }];
    for (const n of natures) {
      a2rows.push([
        a2rows.length + 1, a.country.itrCode, a.institution.name, a.institution.address, a.institution.zip, a.account.accountId,
        'Owner', a.account.dateOpened ?? '', rupees(a.peak?.inr) ?? '', rupees(a.closing) ?? '', n.nature, rupees(n.inr) ?? 0,
      ]);
    }
  }
  files.push({
    name: 'schedule_fa_A2_portal_upload.csv',
    title: 'Schedule FA — Table A2 (custodial account), e-filing bulk-upload layout',
    content: toPortalCsv(
      ['Country/Region name', 'Country Name and Code', 'Name of financial institution', 'Address of financial institution', 'ZIP Code', 'Account Number', 'Status', 'Account opening date', 'Peak Balance During the Period', 'Closing balance', 'Nature of Amount', 'Amount'],
      a2rows,
    ),
  });

  // ---- Capital gains ----
  files.push({
    name: 'capital_gains_workings.csv',
    title: `Capital gains workings — per sold lot, ${ty.law.conversionRule} rates (method: ${r.settings.cgFxMethod === 'split' ? 'sale and cost converted separately' : 'foreign-currency gain converted at sale-month rate'})`,
    content: toCsv([
      [
        'Symbol', 'Description', 'Currency', 'Acquired', 'Sold', 'Quantity', 'Term', 'Holding needed (months)', 'Tax rate', 'Quarter (234C)',
        'Sale value (foreign)', 'Sale commission (foreign)', 'Cost incl. buy commission (foreign)', 'Gain (foreign)', 'IBKR realized P/L',
        'Sale TTBR', 'Sale TTBR date', 'Cost TTBR', 'Cost TTBR date',
        'Full value of consideration (INR)', 'Expenses on transfer (INR)', 'Cost of acquisition (INR)', 'Gain (INR)',
      ],
      ...cg.rows.map((row): Cell[] => [
        row.lot.symbol, row.description, row.lot.currency, row.lot.openDate, row.lot.closeDate, qty(row.lot.quantity), row.term, row.monthsRequired, row.rateNote, QUARTER_LABELS[row.quarter],
        fx2(row.lot.proceeds), fx2(row.lot.commission), fx2(row.lot.cost), fx2(row.gainForeign), fx2(row.lot.realizedPnl),
        rate(row.saleRate), rateDate(row.saleRate), rate(row.costRate), rateDate(row.costRate),
        rupees(row.saleInr), rupees(row.expensesInr), rupees(row.costInr), rupees(row.gainInr),
      ]),
    ]),
  });

  // ---- Dividends / interest ----
  files.push({
    name: 'dividend_workings.csv',
    title: `Dividends — gross, ${ty.law.conversionRule} (TTBR on last day of month before payment)`,
    content: toCsv([
      ['Pay date', 'Symbol', 'Description', 'Country', 'Currency', 'Gross (foreign)', 'Tax withheld (foreign)', 'TTBR', 'TTBR date', 'Gross (INR)', 'Quarter (234C)'],
      ...income.dividends.map((d): Cell[] => [
        d.txn.date, d.txn.symbol, d.description, d.country.name, d.txn.currency, fx2(d.txn.amount), fx2(d.withheldForeign), rate(d.conv), rateDate(d.conv), rupees(d.conv?.inr), QUARTER_LABELS[d.quarter],
      ]),
    ]),
  });
  files.push({
    name: 'interest_workings.csv',
    title: `Broker interest — ${r.settings.interestRate === 'fyEnd' ? `TTBR on ${ty.fyEnd} (other income, ${ty.law.conversionRule})` : 'TTBR on last day of month before credit'}`,
    content: toCsv([
      ['Date', 'Description', 'Currency', 'Amount (foreign)', 'TTBR', 'TTBR date', 'Amount (INR)'],
      ...income.interest.map((d): Cell[] => [d.txn.date, d.description, d.txn.currency, fx2(d.txn.amount), rate(d.conv), rateDate(d.conv), rupees(d.conv?.inr)]),
    ]),
  });

  // ---- Foreign tax credit ----
  files.push({
    name: 'foreign_tax_credit_workings.csv',
    title: `Foreign tax withheld — per deduction, ${ty.law.ftcRule} (TTBR on last day of month before deduction); evidence for ${ty.law.ftcForm}`,
    content: toCsv([
      ['Date', 'Symbol', 'Description', 'Country', 'Income head', 'Currency', 'Tax (foreign)', 'TTBR', 'TTBR date', 'Tax (INR)'],
      ...income.taxes.map((t): Cell[] => [t.txn.date, t.txn.symbol, t.txn.description, t.country.name, t.head, t.txn.currency, fx2(t.txn.amount.neg()), rate(t.conv), rateDate(t.conv), rupees(t.conv?.inr)]),
    ]),
  });
  files.push({
    name: 'schedule_fsi_tr_summary.csv',
    title: 'Schedule FSI / TR — per country and income head',
    content: toCsv([
      ['Country', 'ITR country code', 'Head', 'DTAA article', 'Income from outside India (INR)', 'Tax paid outside India (INR)', `Tax payable in India at ${r.settings.marginalRatePct}% (INR)`, 'Treaty cap (INR)', 'Tax relief available (INR)', 'Relief claimed u/s'],
      ...income.ftc.map((g): Cell[] => [g.country.name, g.country.itrCode, g.head === 'dividend' ? 'Other sources — dividend' : 'Other sources — interest', g.article, rupees(g.incomeInr), rupees(g.foreignTaxInr), rupees(g.indianTaxInr), rupees(g.treatyCapInr), rupees(g.reliefInr), '90']),
    ]),
  });

  files.push({ name: 'itr_summary.csv', title: 'Where each figure goes in the return', content: toCsv(itrSummary(r)) });
  files.push({ name: 'README.txt', title: 'How to read this pack', content: readme(r, files) });
  return files;
}

export function itrSummary(r: Report): Cell[][] {
  const { cg, income, fa, year: ty } = r;
  const rows: Cell[][] = [['Schedule', 'Item', 'Value (INR)']];
  rows.push(['CG', 'A5 STCG (other assets) — full value of consideration', rupees(cg.stcg.saleInr)]);
  rows.push(['CG', 'A5 STCG — cost of acquisition', rupees(cg.stcg.costInr)]);
  rows.push(['CG', 'A5 STCG — expenditure on transfer', rupees(cg.stcg.expensesInr)]);
  rows.push(['CG', 'A5 STCG — gain', rupees(cg.stcg.gainInr)]);
  rows.push(['CG', `B8 LTCG (assets not covered by B1–B7, 12.5% ${ty.law.ltcgSection}) — full value of consideration`, rupees(cg.ltcg.saleInr)]);
  rows.push(['CG', 'B8 LTCG — cost of acquisition (no indexation)', rupees(cg.ltcg.costInr)]);
  rows.push(['CG', 'B8 LTCG — expenditure on transfer', rupees(cg.ltcg.expensesInr)]);
  rows.push(['CG', 'B8 LTCG — gain', rupees(cg.ltcg.gainInr)]);
  QUARTER_LABELS.forEach((q, i) => rows.push(['CG Table F', `STCG at slab rate — ${q}`, rupees(cg.stcg.quarters[i])]));
  QUARTER_LABELS.forEach((q, i) => rows.push(['CG Table F', `LTCG at 12.5% — ${q}`, rupees(cg.ltcg.quarters[i])]));
  rows.push(['OS', '1a(i) Dividend income (gross, before foreign tax)', rupees(income.dividendTotalInr)]);
  QUARTER_LABELS.forEach((q, i) => rows.push(['OS', `Dividend quarterly breakup (234C) — ${q}`, rupees(income.dividendQuarters[i])]));
  rows.push(['OS', '1b(ix) Interest — others (broker interest)', rupees(income.interestTotalInr)]);
  for (const g of income.ftc) {
    rows.push(['FSI', `${g.country.name} (${g.country.itrCode}) — Other sources ${g.head}: income`, rupees(g.incomeInr)]);
    rows.push(['FSI', `${g.country.name} — tax paid outside India`, rupees(g.foreignTaxInr)]);
    rows.push(['FSI', `${g.country.name} — tax relief available (${g.article})`, rupees(g.reliefInr)]);
  }
  const relief = income.ftc.reduce((s, g) => s.add(g.reliefInr), new Decimal(0));
  const paid = income.ftc.reduce((s, g) => s.add(g.foreignTaxInr), new Decimal(0));
  rows.push(['TR', 'Total tax paid outside India', rupees(paid)]);
  rows.push(['TR', 'Total tax relief claimed u/s 90', rupees(relief)]);
  rows.push([ty.law.ftcForm, 'Foreign tax credit claimed (file before the return)', rupees(relief)]);
  rows.push(['FA', `Table A2 rows (calendar year ${ty.cyStart.slice(0, 4)})`, fa.a2.length]);
  rows.push(['FA', 'Table A3 rows (one per lot)', fa.a3.length]);
  return rows;
}

function readme(r: Report, files: PackFile[]): string {
  const ty = r.year;
  const lines = [
    `IBKR → India tax pack — ${ty.label}`,
    `Account ${r.account.accountId}. Generated ${new Date().toISOString().slice(0, 10)} in your browser; nothing was uploaded.`,
    '',
    `Law: ${ty.law.act}. Currency conversion at SBI TT buying rates (${ty.law.conversionRule}; foreign tax credit ${ty.law.ftcRule}).`,
    `Schedule FA covers calendar year ${ty.cyStart} to ${ty.cyEnd}. Schedules CG, OS, FSI and TR cover ${ty.fyStart} to ${ty.fyEnd}.`,
    '',
    'Settings used:',
    `  Capital gains conversion: ${r.settings.cgFxMethod === 'split' ? 'sale value and cost converted separately (month-end before sale / before purchase)' : 'foreign-currency gain converted at the month-end rate before the sale'}`,
    `  Schedule FA income and proceeds: ${r.settings.faIncomeRate === 'txn' ? 'TTBR on the transaction date' : 'TTBR on 31 December'}`,
    `  Broker interest: ${r.settings.interestRate === 'fyEnd' ? `TTBR on ${ty.fyEnd}` : 'TTBR at month-end before each credit'}`,
    `  Marginal tax rate for the FTC limit: ${r.settings.marginalRatePct}%`,
    '',
    'Files:',
    ...files.map((f) => `  ${f.name} — ${f.title}`),
    '  README.txt — this file',
    '',
    'Method notes:',
    '  Schedule FA A3 has one row per purchase lot. Peak value = highest of (shares held × that day\'s price × that day\'s TTBR) over the calendar year.',
    '  Dividends are attributed only to lots held on the day before the ex-date. Closing balance uses the 31 December price and TTBR.',
    '  US shares are not listed in India: long-term only if held more than 24 months, taxed at 12.5% without indexation; short-term at slab rates.',
    '  Dividends are reported gross (before US withholding); the withholding is claimed back through Schedules FSI/TR and ' + ty.law.ftcForm + '.',
    '  Portal upload CSVs follow the layout reported to work on the e-filing portal; download the portal template and compare before uploading.',
    '  Addresses and ZIP codes of companies are not in IBKR data; fill them in the tool before downloading or in the CSV.',
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
