import type { Report } from '../tax/engine';
import type { BroughtForwardLoss, LotOverride, Settings } from '../tax/common';
import type { EntityOverrides } from './pack';

/**
 * What carries from one year's return to the next, saved by the user and loaded next year:
 * unused capital losses (Schedule CFL), lot corrections, company addresses and method choices.
 */
export interface YearEndFile {
  app: 'ibkr-india-tax';
  kind: 'year-end';
  version: 1;
  /** Assessment year the file was made for; its losses carry into the next one. */
  ay: number;
  accounts: string[];
  saved: string;
  carryForward: BroughtForwardLoss[];
  lotOverrides: Record<string, LotOverride>;
  entities: EntityOverrides;
  choices: Pick<Settings, 'cgFxMethod' | 'faIncomeRate' | 'interestRate' | 'tin'>;
}

const rupees = (d: { toDecimalPlaces: (n: number) => { toString(): string } }) => d.toDecimalPlaces(0).toString();

export function buildYearEnd(r: Report, entities: EntityOverrides, saved = new Date().toISOString().slice(0, 10)): YearEndFile {
  return {
    app: 'ibkr-india-tax',
    kind: 'year-end',
    version: 1,
    ay: r.year.ayStart,
    accounts: r.accounts.map((a) => a.accountId),
    saved,
    carryForward: r.losses.carryForward.map((c) => ({ ay: c.ay, stcl: rupees(c.stcl), ltcl: rupees(c.ltcl) })),
    lotOverrides: r.settings.lotOverrides ?? {},
    entities,
    choices: { cgFxMethod: r.settings.cgFxMethod, faIncomeRate: r.settings.faIncomeRate, interestRate: r.settings.interestRate, tin: r.settings.tin },
  };
}

export function parseYearEnd(text: string): YearEndFile {
  let f: Partial<YearEndFile>;
  try {
    f = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  if (f?.app !== 'ibkr-india-tax' || f.kind !== 'year-end') throw new Error('This is not a year-end file saved by this tool.');
  if (f.version !== 1) throw new Error(`Unsupported year-end file version ${String(f.version)}.`);
  if (typeof f.ay !== 'number' || !Array.isArray(f.carryForward)) throw new Error('The year-end file is incomplete.');
  return f as YearEndFile;
}

/** Settings for the following year, from last year's file. Losses carry only into a later year. */
export function applyYearEnd(settings: Settings, f: YearEndFile, ayStart: number): { settings: Settings; notes: string[] } {
  const notes: string[] = [];
  const next: Settings = { ...settings, lotOverrides: { ...settings.lotOverrides, ...f.lotOverrides } };
  if (f.ay < ayStart) {
    const losses = f.carryForward.filter((c) => c.ay < ayStart);
    next.broughtForward = losses;
    notes.push(losses.length ? `Brought forward losses from ${losses.length} year(s).` : 'No losses to bring forward.');
  } else {
    notes.push(`The file is for AY ${f.ay}-${String((f.ay + 1) % 100).padStart(2, '0')} — its losses apply from the following year. Pick that year above and load the file again to bring them forward.`);
  }
  if (Object.keys(f.lotOverrides ?? {}).length) notes.push(`Restored ${Object.keys(f.lotOverrides).length} lot correction(s).`);
  if (f.choices) {
    next.cgFxMethod = f.choices.cgFxMethod ?? next.cgFxMethod;
    next.faIncomeRate = f.choices.faIncomeRate ?? next.faIncomeRate;
    next.interestRate = f.choices.interestRate ?? next.interestRate;
    if (f.choices.tin && !next.tin) next.tin = f.choices.tin;
    notes.push('Kept last year’s method choices, so the treatment stays consistent.');
  }
  return { settings: next, notes };
}
