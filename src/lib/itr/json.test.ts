import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import Ajv from 'ajv-draft-04';
import { parseFlexXml } from '../flex/parse';
import { TtbrTable } from '../fx/ttbr';
import { DEFAULT_SETTINGS } from '../tax/common';
import { accountsIn, buildReport } from '../tax/engine';
import { Fx } from '../tax/fx';
import { cleanText, itrSchedules, mergeScheduleFA } from './json';

const read = (p: string) => readFileSync(new URL(`../../../public/${p}`, import.meta.url), 'utf8');
const schema = JSON.parse(readFileSync(new URL('./schema/ITR-2_2026_Main_V1.2.json', import.meta.url), 'utf8'));

const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addSchema(schema, 'itr2');
const valid = (definition: string, value: unknown) => {
  const ok = ajv.validate({ $ref: `itr2#/definitions/${definition}` }, value);
  return ok ? [] : (ajv.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
};

function report() {
  const data = parseFlexXml(read('samples/sample-cy2025.xml'), 'cy.xml');
  parseFlexXml(read('samples/sample-fy2025-26.xml'), 'fy.xml', data);
  const fx = new Fx(new Map([['USD', new TtbrTable(JSON.parse(read('data/ttbr/USD.json')))]]));
  return buildReport(data, accountsIn(data)[0], 2026, { ...DEFAULT_SETTINGS, tin: 'Z1234567' }, fx, { today: '2026-10-10' });
}

const addresses = Object.fromEntries(
  ['AAPL', 'MSFT', 'NVDA', 'VOO'].map((s) => [s, { address: `1 ${s} Way, Example City, CA`, zip: '94000' }]),
);

describe('ITR-2 JSON schedules (official schema V1.2)', () => {
  const r = report();
  const { schedules, issues } = itrSchedules(r, addresses);

  it('builds Schedule FA that validates against the schema', () => {
    expect(schedules.ScheduleFA.DtlsForeignEquityDebtInterest.length).toBe(r.fa.a3.length);
    expect(schedules.ScheduleFA.DtlsForeignCustodialAcc.length).toBeGreaterThan(0);
    expect(valid('ScheduleFA', schedules.ScheduleFA)).toEqual([]);
    expect(schedules.ScheduleFA.DtlsForeignEquityDebtInterest.every((x) => x.CountryCodeExcludingIndia === '2')).toBe(true);
  });

  it('builds FSI and TR that validate and agree with each other', () => {
    expect(schedules.ScheduleFSI).toBeDefined();
    expect(valid('ScheduleFSI', schedules.ScheduleFSI)).toEqual([]);
    expect(valid('ScheduleTR1', schedules.ScheduleTR1)).toEqual([]);
    const fsiTax = schedules.ScheduleFSI!.ScheduleFSIDtls.reduce((s, c) => s + c.TotalCountryWise.TaxReliefinInd, 0);
    expect(schedules.ScheduleTR1!.TotalTaxReliefOutsideIndia).toBe(fsiTax);
  });

  it('reports nothing blocking once addresses and TIN are filled', () => {
    expect(issues.filter((i) => i.schedule === 'FA A3')).toEqual([]);
  });

  it('flags missing company addresses', () => {
    expect(itrSchedules(r, {}).issues.some((i) => i.schedule === 'FA A3' && i.message.includes('address'))).toBe(true);
  });

  it('merges Schedule FA into an ITR-2 JSON without touching the rest', () => {
    const doc = {
      ITR: {
        ITR2: {
          CreationInfo: { Digest: 'x'.repeat(44) },
          Form_ITR2: { FormName: 'ITR-2', AssessmentYear: '2026' },
          ScheduleFA: { DetailsForiegnBank: [{ keep: true }], DtlsForeignEquityDebtInterest: [{ old: true }] },
          PartB_TTI: { AssetOutIndiaFlag: 'NO', other: 1 },
          ScheduleOS: { untouched: true },
        },
      },
    };
    const { json, notes } = mergeScheduleFA(JSON.stringify(doc), schedules.ScheduleFA, 2026);
    const out = JSON.parse(json).ITR.ITR2;
    expect(out.ScheduleFA.DetailsForiegnBank).toEqual([{ keep: true }]);
    expect(out.ScheduleFA.DtlsForeignEquityDebtInterest).toEqual(schedules.ScheduleFA.DtlsForeignEquityDebtInterest);
    expect(out.PartB_TTI).toEqual({ AssetOutIndiaFlag: 'YES', other: 1 });
    expect(out.ScheduleOS).toEqual({ untouched: true });
    expect(out.CreationInfo.Digest).toBe('-');
    expect(notes.length).toBeGreaterThan(2);
  });

  it('refuses a return for another year or form', () => {
    expect(() => mergeScheduleFA('{"ITR":{"ITR2":{"Form_ITR2":{"AssessmentYear":"2025"}}}}', schedules.ScheduleFA, 2026)).toThrow(/2025-26/);
    expect(() => mergeScheduleFA('{"ITR":{"ITR1":{}}}', schedules.ScheduleFA, 2026)).toThrow(/ITR-2/);
    expect(() => mergeScheduleFA('nope', schedules.ScheduleFA, 2026)).toThrow(/JSON/);
  });
});

describe('cleanText', () => {
  it('keeps the characters the utilities accept and the maximum length', () => {
    expect(cleanText('Nestlé S.A. — “Avenue” 55', 200)).toBe('Nestle S.A. - Avenue 55');
    expect(cleanText('x'.repeat(50), 34)).toHaveLength(34);
  });
});
