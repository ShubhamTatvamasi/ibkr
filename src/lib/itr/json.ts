import Decimal from 'decimal.js';
import type { Report } from '../tax/engine';
import { entityFor } from '../assets';
import { rupees, type EntityOverrides } from '../export/pack';

/**
 * Schedules FA (A2, A3), FSI and TR as objects in the official ITR-2 JSON schema
 * (incometax.gov.in → Downloads → ITR-2 AY 2026-27, ITR-2_2026_Main_V1.2.json). Field names,
 * order, codes and lengths follow that schema; amounts are whole rupees.
 */
export const ITR_JSON_AY = 2026;
export const ITR_SCHEMA_VERSION = 'ITR-2_2026_Main_V1.2';

export interface CustodialAccountJson {
  CountryName: string;
  CountryCodeExcludingIndia: string;
  FinancialInstName: string;
  FinancialInstAddress: string;
  ZipCode: string;
  AccountNumber: string;
  Status: 'OWNER';
  AccOpenDate: string;
  PeakBalanceDuringPeriod: number;
  ClosingBalance: number;
  GrossAmtPaidCredited: number;
  NatureOfAmount: 'I' | 'D' | 'S' | 'O' | 'N';
}

export interface EquityInterestJson {
  CountryName: string;
  CountryCodeExcludingIndia: string;
  NameOfEntity: string;
  AddressOfEntity: string;
  ZipCode: string;
  NatureOfEntity: string;
  InterestAcquiringDate: string;
  InitialValOfInvstmnt: number;
  PeakBalanceDuringPeriod: number;
  ClosingBalance: number;
  TotGrossAmtPaidCredited: number;
  TotGrossProceeds: number;
}

interface FsiIncome {
  IncFrmOutsideInd: number;
  TaxPaidOutsideInd: number;
  TaxPayableinInd: number;
  TaxReliefinInd: number;
  DTAAReliefUs90or90A?: string;
}

export interface ItrSchedules {
  ScheduleFA: { DtlsForeignCustodialAcc: CustodialAccountJson[]; DtlsForeignEquityDebtInterest: EquityInterestJson[] };
  ScheduleFSI?: {
    ScheduleFSIDtls: {
      CountryName: string;
      CountryCodeExcludingIndia: string;
      TaxIdentificationNo: string;
      IncFromSal: FsiIncome;
      IncFromHP: FsiIncome;
      IncCapGain: FsiIncome;
      IncOthSrc: FsiIncome;
      TotalCountryWise: Omit<FsiIncome, 'DTAAReliefUs90or90A'>;
    }[];
  };
  ScheduleTR1?: {
    ScheduleTR: {
      CountryName: string;
      CountryCodeExcludingIndia: string;
      TaxIdentificationNo: string;
      TaxPaidOutsideIndia: number;
      TaxReliefOutsideIndia: number;
      ReliefClaimedUsSection: '90' | '90A' | '91';
    }[];
    TotalTaxPaidOutsideIndia: number;
    TotalTaxReliefOutsideIndia: number;
    TaxReliefOutsideIndiaDTAA: number;
    TaxReliefOutsideIndiaNotDTAA: number;
    TaxPaidOutsideIndFlg: 'YES' | 'NO';
  };
}

export interface JsonIssue {
  schedule: 'FA A2' | 'FA A3' | 'FSI' | 'TR';
  message: string;
}

/**
 * Text as the e-filing utilities accept it: ASCII letters, digits, spaces and common punctuation,
 * trimmed to the schema's maximum length.
 */
export function cleanText(s: string, max: number): string {
  const ascii = s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‐-―]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[^\w\s=!@#$%^*(){}[\]|\\:;',.?/~`\-+<>&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return ascii.slice(0, max).trim();
}

const int = (d: Decimal | undefined) => rupees(d) ?? 0;
const nonNeg = (d: Decimal | undefined) => Math.max(0, int(d));

export function itrSchedules(r: Report, entities: EntityOverrides = {}): { schedules: ItrSchedules; issues: JsonIssue[] } {
  const issues: JsonIssue[] = [];
  const { fa, foreign, settings } = r;

  const a2: CustodialAccountJson[] = [];
  for (const a of fa.a2) {
    if (!a.account.dateOpened) issues.push({ schedule: 'FA A2', message: `Account opening date for ${a.account.accountId} is missing (Account Information → Date Opened).` });
    if (!a.peak) issues.push({ schedule: 'FA A2', message: `Peak balance for ${a.account.accountId} could not be computed.` });
    const natures = a.credited.length ? a.credited : [{ code: 'N' as const, inr: new Decimal(0) }];
    for (const n of natures) {
      a2.push({
        CountryName: cleanText(a.country.name, 55),
        CountryCodeExcludingIndia: a.country.itrCode,
        FinancialInstName: cleanText(a.institution.name, 125),
        FinancialInstAddress: cleanText(a.institution.address, 200),
        ZipCode: cleanText(a.institution.zip, 8),
        AccountNumber: cleanText(a.account.accountId, 34),
        Status: 'OWNER',
        AccOpenDate: a.account.dateOpened ?? '',
        PeakBalanceDuringPeriod: int(a.peak?.inr),
        ClosingBalance: int(a.closing),
        GrossAmtPaidCredited: nonNeg(n.inr),
        NatureOfAmount: n.code,
      });
    }
  }

  const a3: EquityInterestJson[] = fa.a3.map((row) => {
    const e = entityFor(row.lot.symbol, row.isin, row.entityName, entities);
    if (!e.address.trim() || !e.zip.trim()) issues.push({ schedule: 'FA A3', message: `${row.lot.symbol}: company address or ZIP is missing — fill it in Review issues.` });
    if (!row.initial) issues.push({ schedule: 'FA A3', message: `${row.lot.symbol} bought ${row.acquired}: initial value is missing (exchange rate).` });
    if (!row.country.itrCode) issues.push({ schedule: 'FA A3', message: `${row.lot.symbol}: country code unknown.` });
    return {
      CountryName: cleanText(row.country.name, 55),
      CountryCodeExcludingIndia: row.country.itrCode,
      NameOfEntity: cleanText(e.name, 125),
      AddressOfEntity: cleanText(e.address, 200),
      ZipCode: cleanText(e.zip, 8),
      NatureOfEntity: cleanText(e.nature ?? row.natureOfEntity, 34),
      InterestAcquiringDate: row.acquired,
      InitialValOfInvstmnt: int(row.initial?.inr),
      PeakBalanceDuringPeriod: int(row.peak?.inr),
      ClosingBalance: int(row.closing?.inr),
      TotGrossAmtPaidCredited: int(row.dividends.inr),
      TotGrossProceeds: int(row.proceeds.inr),
    };
  });

  const schedules: ItrSchedules = { ScheduleFA: { DtlsForeignCustodialAcc: a2, DtlsForeignEquityDebtInterest: a3 } };

  if (foreign.fsi.length) {
    const tin = cleanText(settings.tin, 75);
    if (!tin) issues.push({ schedule: 'FSI', message: 'Taxpayer Identification Number is empty — enter it in Review issues.' });
    const zero: FsiIncome = { IncFrmOutsideInd: 0, TaxPaidOutsideInd: 0, TaxPayableinInd: 0, TaxReliefinInd: 0 };
    schedules.ScheduleFSI = {
      ScheduleFSIDtls: foreign.fsi.map((c) => {
        const head = (name: 'Capital Gains' | 'Other Sources'): FsiIncome => {
          const h = c.heads.find((x) => x.head === name);
          if (!h) return { ...zero };
          const out: FsiIncome = {
            IncFrmOutsideInd: nonNeg(h.incomeInr),
            TaxPaidOutsideInd: nonNeg(h.taxPaidInr),
            TaxPayableinInd: nonNeg(h.indianTaxInr),
            TaxReliefinInd: nonNeg(h.reliefInr),
          };
          const article = cleanText(h.article, 16);
          if (article && out.TaxReliefinInd > 0) out.DTAAReliefUs90or90A = article;
          return out;
        };
        const cgHead = head('Capital Gains');
        const osHead = head('Other Sources');
        return {
          CountryName: cleanText(c.country.name, 55),
          CountryCodeExcludingIndia: c.country.itrCode,
          TaxIdentificationNo: tin,
          IncFromSal: { ...zero },
          IncFromHP: { ...zero },
          IncCapGain: cgHead,
          IncOthSrc: osHead,
          TotalCountryWise: {
            IncFrmOutsideInd: cgHead.IncFrmOutsideInd + osHead.IncFrmOutsideInd,
            TaxPaidOutsideInd: cgHead.TaxPaidOutsideInd + osHead.TaxPaidOutsideInd,
            TaxPayableinInd: cgHead.TaxPayableinInd + osHead.TaxPayableinInd,
            TaxReliefinInd: cgHead.TaxReliefinInd + osHead.TaxReliefinInd,
          },
        };
      }),
    };
  }

  if (foreign.tr.length) {
    // TR must equal the FSI totals per country (validation rules 454-455), so derive it from FSI.
    const fsiRows = schedules.ScheduleFSI?.ScheduleFSIDtls ?? [];
    const rows = foreign.fsi.map((c, i) => ({
      CountryName: fsiRows[i].CountryName,
      CountryCodeExcludingIndia: fsiRows[i].CountryCodeExcludingIndia,
      TaxIdentificationNo: fsiRows[i].TaxIdentificationNo,
      TaxPaidOutsideIndia: fsiRows[i].TotalCountryWise.TaxPaidOutsideInd,
      TaxReliefOutsideIndia: fsiRows[i].TotalCountryWise.TaxReliefinInd,
      ReliefClaimedUsSection: (foreign.tr.find((t) => t.country.iso === c.country.iso)?.section ?? '90') as '90' | '90A' | '91',
    }));
    const total = (k: 'TaxPaidOutsideIndia' | 'TaxReliefOutsideIndia') => rows.reduce((s, x) => s + x[k], 0);
    const dtaa = rows.filter((x) => x.ReliefClaimedUsSection !== '91').reduce((s, x) => s + x.TaxReliefOutsideIndia, 0);
    schedules.ScheduleTR1 = {
      ScheduleTR: rows,
      TotalTaxPaidOutsideIndia: total('TaxPaidOutsideIndia'),
      TotalTaxReliefOutsideIndia: total('TaxReliefOutsideIndia'),
      TaxReliefOutsideIndiaDTAA: dtaa,
      TaxReliefOutsideIndiaNotDTAA: total('TaxReliefOutsideIndia') - dtaa,
      TaxPaidOutsideIndFlg: 'NO',
    };
  }

  const seen = new Set<string>();
  const unique = issues.filter((i) => !seen.has(i.schedule + i.message) && seen.add(i.schedule + i.message));
  return { schedules, issues: unique };
}

/** The schedules on their own, for a CA's software or a manual check, with provenance. */
export function schedulesFile(r: Report, schedules: ItrSchedules, generated: string): string {
  return JSON.stringify(
    {
      _about: {
        schema: ITR_SCHEMA_VERSION,
        return: r.year.label,
        account: r.accountLabel,
        generated,
        note: 'Schedule objects in the official ITR-2 JSON format. Not a complete return: the portal accepts only a full ITR JSON.',
      },
      ...schedules,
    },
    null,
    2,
  );
}

export interface MergeResult {
  json: string;
  notes: string[];
}

/**
 * Puts Schedule FA tables A2 and A3 into an ITR-2 JSON the user generated with the official
 * utility. Only FA is merged: it is a disclosure with no totals elsewhere in the return, while FSI
 * and TR must agree with Part B-TTI, which only the utility computes.
 */
export function mergeScheduleFA(text: string, fa: ItrSchedules['ScheduleFA'], ayStart: number): MergeResult {
  let doc: { ITR?: { ITR2?: Record<string, any> } };
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  const itr2 = doc?.ITR?.ITR2;
  if (!itr2) throw new Error('This is not an ITR-2 JSON (no ITR → ITR2 section). Generate the JSON from the ITR-2 utility first.');
  const ay = itr2.Form_ITR2?.AssessmentYear;
  if (ay && String(ay) !== String(ayStart)) {
    throw new Error(`This return is for assessment year ${ay}-${String((Number(ay) + 1) % 100).padStart(2, '0')}, but the figures here are for ${ayStart}-${String((ayStart + 1) % 100).padStart(2, '0')}.`);
  }

  const notes: string[] = [];
  const existing = itr2.ScheduleFA ?? {};
  const before = (existing.DtlsForeignCustodialAcc?.length ?? 0) + (existing.DtlsForeignEquityDebtInterest?.length ?? 0);
  if (before) notes.push(`Replaced ${before} existing row(s) in Tables A2 and A3.`);
  const kept = Object.keys(existing).filter((k) => k !== 'DtlsForeignCustodialAcc' && k !== 'DtlsForeignEquityDebtInterest' && existing[k]?.length);
  if (kept.length) notes.push(`Kept your other Schedule FA tables: ${kept.join(', ')}.`);
  itr2.ScheduleFA = { ...existing, DtlsForeignCustodialAcc: fa.DtlsForeignCustodialAcc, DtlsForeignEquityDebtInterest: fa.DtlsForeignEquityDebtInterest };
  notes.push(`Added ${fa.DtlsForeignCustodialAcc.length} A2 row(s) and ${fa.DtlsForeignEquityDebtInterest.length} A3 row(s).`);

  if (itr2.PartB_TTI && itr2.PartB_TTI.AssetOutIndiaFlag !== 'YES') {
    itr2.PartB_TTI.AssetOutIndiaFlag = 'YES';
    notes.push('Set Part B-TTI "Do you have any asset outside India?" to Yes.');
  }
  if (itr2.CreationInfo?.Digest && itr2.CreationInfo.Digest !== '-') {
    // The utility's digest covers the original content; it no longer matches after the edit.
    itr2.CreationInfo.Digest = '-';
    notes.push('Cleared the utility digest, which no longer matches the edited content.');
  }
  return { json: JSON.stringify(doc), notes };
}
