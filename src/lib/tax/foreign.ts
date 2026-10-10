import Decimal from 'decimal.js';
import type { FlexData } from '../flex/model';
import type { CgResult } from './cg';
import type { Settings } from './common';
import { issuerCountry, reliefSection, TREATY_CAP, type Country, type ReliefSection } from './countries';
import type { IncomeResult } from './income';

/** LTCG on foreign shares: 12.5% plus 4% cess (surcharge ignored), for the "tax payable in India" column. */
const LTCG_EFFECTIVE = new Decimal(0.13);

export interface Form67Row {
  country: Country;
  source: 'Dividend' | 'Interest income';
  incomeInr: Decimal;
  taxPaidInr: Decimal;
  taxRatePct: Decimal;
  indianTaxInr: Decimal;
  article: string;
  dtaaRatePct?: number;
  creditInr: Decimal;
  section: ReliefSection;
}

export interface FsiHead {
  head: 'Capital Gains' | 'Other Sources';
  incomeInr: Decimal;
  taxPaidInr: Decimal;
  indianTaxInr: Decimal;
  reliefInr: Decimal;
  article: string;
}

export interface FsiCountry {
  country: Country;
  heads: FsiHead[];
  total: Omit<FsiHead, 'head' | 'article'>;
}

export interface ForeignResult {
  form67: Form67Row[];
  fsi: FsiCountry[];
  tr: { country: Country; taxPaidInr: Decimal; reliefInr: Decimal; section: ReliefSection }[];
  totals: { taxPaidInr: Decimal; reliefInr: Decimal; reliefDtaaInr: Decimal; reliefNonDtaaInr: Decimal };
}

export function foreignIncome(data: FlexData, cg: CgResult, inc: IncomeResult, settings: Settings): ForeignResult {
  const marginal = new Decimal(settings.marginalRatePct).div(100);
  const zero = () => new Decimal(0);

  const form67: Form67Row[] = inc.ftc
    .filter((g) => g.foreignTaxInr.gt(0))
    .map((g) => ({
      country: g.country,
      source: g.head === 'dividend' ? 'Dividend' : 'Interest income',
      incomeInr: g.incomeInr,
      taxPaidInr: g.foreignTaxInr,
      taxRatePct: g.incomeInr.isZero() ? zero() : g.foreignTaxInr.div(g.incomeInr).mul(100),
      indianTaxInr: g.indianTaxInr,
      article: g.article,
      dtaaRatePct: TREATY_CAP[g.country.iso]?.[g.head],
      creditInr: g.reliefInr,
      section: g.section,
    }));

  // Capital gains by issuer country (no foreign tax on them for non-resident aliens in the US).
  const cgByCountry = new Map<string, { country: Country; st: Decimal; lt: Decimal }>();
  for (const r of cg.rows) {
    if (!r.gainInr) continue;
    const inst = data.instruments.get(r.lot.conid);
    const c = issuerCountry(inst?.issuerCountryCode, inst?.isin);
    const e = cgByCountry.get(c.iso) ?? { country: c, st: zero(), lt: zero() };
    if (r.term === 'STCG') e.st = e.st.add(r.gainInr);
    else e.lt = e.lt.add(r.gainInr);
    cgByCountry.set(c.iso, e);
  }

  const countries = new Map<string, Country>();
  for (const g of inc.ftc) countries.set(g.country.iso, g.country);
  for (const d of inc.dividends) countries.set(d.country.iso, d.country);
  for (const d of inc.interest) countries.set(d.country.iso, d.country);
  for (const e of cgByCountry.values()) countries.set(e.country.iso, e.country);

  const fsi: FsiCountry[] = [];
  for (const country of countries.values()) {
    const heads: FsiHead[] = [];
    const cgE = cgByCountry.get(country.iso);
    if (cgE) {
      const income = Decimal.max(cgE.st.add(cgE.lt), 0);
      if (income.gt(0)) {
        const indianTax = Decimal.max(cgE.st, 0).mul(marginal).add(Decimal.max(cgE.lt, 0).mul(LTCG_EFFECTIVE));
        heads.push({ head: 'Capital Gains', incomeInr: income, taxPaidInr: zero(), indianTaxInr: indianTax, reliefInr: zero(), article: '' });
      }
    }
    const div = inc.dividends.filter((d) => d.country.iso === country.iso).reduce((s, d) => s.add(d.conv?.inr ?? 0), zero());
    const int = inc.interest.filter((d) => d.country.iso === country.iso).reduce((s, d) => s.add(d.conv?.inr ?? 0), zero());
    const groups = inc.ftc.filter((g) => g.country.iso === country.iso);
    if (div.add(int).gt(0)) {
      const taxPaid = groups.reduce((s, g) => s.add(g.foreignTaxInr), zero());
      heads.push({
        head: 'Other Sources',
        incomeInr: div.add(int),
        taxPaidInr: taxPaid,
        indianTaxInr: div.add(int).mul(marginal),
        reliefInr: groups.reduce((s, g) => s.add(g.reliefInr), zero()),
        article: groups.map((g) => g.article).filter((a, i, all) => all.indexOf(a) === i).join(', '),
      });
    }
    if (!heads.length) continue;
    const sum = (k: 'incomeInr' | 'taxPaidInr' | 'indianTaxInr' | 'reliefInr') => heads.reduce((s, h) => s.add(h[k]), zero());
    fsi.push({ country, heads, total: { incomeInr: sum('incomeInr'), taxPaidInr: sum('taxPaidInr'), indianTaxInr: sum('indianTaxInr'), reliefInr: sum('reliefInr') } });
  }

  const tr = fsi.filter((c) => c.total.taxPaidInr.gt(0)).map((c) => ({ country: c.country, taxPaidInr: c.total.taxPaidInr, reliefInr: c.total.reliefInr, section: reliefSection(c.country.iso) }));
  const relief = (pick: (t: (typeof tr)[number]) => boolean) => tr.filter(pick).reduce((s, t) => s.add(t.reliefInr), zero());
  return {
    form67,
    fsi,
    tr,
    totals: {
      taxPaidInr: tr.reduce((s, t) => s.add(t.taxPaidInr), zero()),
      reliefInr: relief(() => true),
      reliefDtaaInr: relief((t) => t.section !== '91'),
      reliefNonDtaaInr: relief((t) => t.section === '91'),
    },
  };
}
