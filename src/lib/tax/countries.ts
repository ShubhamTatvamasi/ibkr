/**
 * ISO 3166 alpha-2 → name and the numeric code used by the ITR schema
 * (definition "CountryCodeExcludingIndia", ITR-2 AY 2026-27 schema V1.2).
 */
const COUNTRIES: Record<string, { name: string; itrCode: string }> = {
  US: { name: 'United States of America', itrCode: '2' },
  IE: { name: 'Ireland', itrCode: '353' },
  LU: { name: 'Luxembourg', itrCode: '352' },
  GB: { name: 'United Kingdom', itrCode: '44' },
  NL: { name: 'Netherlands', itrCode: '31' },
  CA: { name: 'Canada', itrCode: '1' },
  DE: { name: 'Germany', itrCode: '49' },
  CH: { name: 'Switzerland', itrCode: '41' },
  FR: { name: 'France', itrCode: '33' },
  JP: { name: 'Japan', itrCode: '81' },
  HK: { name: 'Hong Kong', itrCode: '852' },
  SG: { name: 'Singapore', itrCode: '65' },
  CN: { name: 'China', itrCode: '86' },
  AU: { name: 'Australia', itrCode: '61' },
  IL: { name: 'Israel', itrCode: '972' },
  TW: { name: 'Taiwan', itrCode: '886' },
  DK: { name: 'Denmark', itrCode: '45' },
  SE: { name: 'Sweden', itrCode: '46' },
  NO: { name: 'Norway', itrCode: '47' },
  FI: { name: 'Finland', itrCode: '358' },
  BE: { name: 'Belgium', itrCode: '32' },
  ES: { name: 'Spain', itrCode: '35' },
  BM: { name: 'Bermuda', itrCode: '1441' },
  KY: { name: 'Cayman Islands', itrCode: '1345' },
  JE: { name: 'Jersey', itrCode: '1534' },
  KR: { name: 'Korea (Republic of)', itrCode: '82' },
  BR: { name: 'Brazil', itrCode: '55' },
  MX: { name: 'Mexico', itrCode: '52' },
  UY: { name: 'Uruguay', itrCode: '598' },
  AR: { name: 'Argentina', itrCode: '54' },
  IT: { name: 'Italy', itrCode: '5' },
  VG: { name: 'Virgin Islands (British)', itrCode: '1284' },
  BS: { name: 'Bahamas', itrCode: '1242' },
  GG: { name: 'Guernsey', itrCode: '1481' },
  IM: { name: 'Isle of Man', itrCode: '1624' },
};

export interface Country {
  iso: string;
  name: string;
  /** Empty when not in our table — the user must fill it in. */
  itrCode: string;
}

export function country(iso: string | undefined): Country {
  const code = (iso ?? 'US').toUpperCase();
  const c = COUNTRIES[code];
  return c ? { iso: code, ...c } : { iso: code, name: code, itrCode: '' };
}

/** Best guess at the issuer's country: explicit code, else the ISIN prefix, else US. */
export function issuerCountry(explicit?: string, isin?: string): Country {
  if (explicit && /^[A-Z]{2}$/i.test(explicit)) return country(explicit);
  if (isin && /^[A-Z]{2}/i.test(isin)) return country(isin.slice(0, 2));
  return country('US');
}

/**
 * Jurisdictions with no comprehensive tax treaty with India (information-exchange agreements only):
 * relief for tax paid there is under section 91 (section 160 of the 2025 Act), not section 90.
 */
export const NO_DTAA = new Set(['KY', 'BM', 'VG', 'JE', 'GG', 'IM', 'BS']);


export type ReliefSection = '90' | '90A' | '91';

/** Taiwan's agreement is with the India-Taipei Association, notified under section 90A. */
const SECTION_90A = new Set(['TW']);

export const reliefSection = (iso: string): ReliefSection => (NO_DTAA.has(iso) ? '91' : SECTION_90A.has(iso) ? '90A' : '90');

/**
 * India's treaty caps on source-country withholding for a resident individual holding less than
 * 10% of the company (portfolio dividends) and for interest on non-bank loans, with the DTAA
 * articles. Lower rates in some treaties apply only to large corporate holdings or bank loans.
 * Plain treaty rates are used: MFN reductions apply in India only once separately notified.
 */
export const TREATY_CAP: Record<string, { dividend: number; interest: number; dividendArticle?: string; interestArticle?: string }> = {
  US: { dividend: 25, interest: 15 }, // Art. 10(2)(b), 11(2)(b)
  GB: { dividend: 10, interest: 15, dividendArticle: 'Article 11', interestArticle: 'Article 12' }, // 15% on dividends from untaxed property income
  IE: { dividend: 10, interest: 10 },
  NL: { dividend: 10, interest: 10 },
  LU: { dividend: 10, interest: 10 },
  CH: { dividend: 10, interest: 10 },
  DE: { dividend: 10, interest: 10 },
  FR: { dividend: 10, interest: 10, dividendArticle: 'Article 11', interestArticle: 'Article 12' }, // 15% once the 2026 protocol is notified
  CA: { dividend: 25, interest: 15 },
  JP: { dividend: 10, interest: 10 },
  SG: { dividend: 15, interest: 15 },
  HK: { dividend: 5, interest: 10 },
  AU: { dividend: 15, interest: 15 },
  CN: { dividend: 10, interest: 10 },
  TW: { dividend: 12.5, interest: 10 },
  KR: { dividend: 15, interest: 10 },
  SE: { dividend: 10, interest: 10 },
  DK: { dividend: 25, interest: 15 },
  NO: { dividend: 10, interest: 10 },
  FI: { dividend: 10, interest: 10 },
  BE: { dividend: 15, interest: 15 },
  ES: { dividend: 15, interest: 15 },
  IT: { dividend: 25, interest: 15 },
  IL: { dividend: 10, interest: 10 },
};

/** DTAA article for a head of income with a treaty country. */
export function treatyArticle(iso: string, head: 'dividend' | 'interest'): string {
  const t = TREATY_CAP[iso];
  return (head === 'dividend' ? t?.dividendArticle : t?.interestArticle) ?? (head === 'dividend' ? 'Article 10' : 'Article 11');
}
