import { emptyFlexData, parseFlexXml } from '../lib/flex/parse';
import type { FlexData } from '../lib/flex/model';
import { DEFAULT_SETTINGS, type Settings } from '../lib/tax/common';
import { accountsIn, buildCombinedReport, currenciesIn, sectionChecklist, type Report } from '../lib/tax/engine';
import { Fx, type RateOverrides } from '../lib/tax/fx';
import { defaultAy, taxYear } from '../lib/tax/years';
import type { EntityOverrides } from '../lib/export/pack';
import { BASE, persist, store } from '../lib/ui/format';
import { entityFor } from '../lib/assets';
import { applyYearEnd, parseYearEnd } from '../lib/export/yearend';

export interface LoadedFile {
  name: string;
  size: number;
  text: string;
  error?: string;
}

export const ALL_ACCOUNTS = '*';

export type StepId = 'setup' | 'review' | 'file' | 'insights' | 'downloads';
export type ScheduleId = 'form67' | 'cg' | 'os' | 'fsi' | 'tr' | 'fa-a2' | 'fa-a3';

export const SCHEDULES: { id: ScheduleId; label: string; short: string }[] = [
  { id: 'form67', label: 'Foreign tax credit form', short: 'Form 67' },
  { id: 'cg', label: 'Schedule CG', short: 'CG' },
  { id: 'os', label: 'Schedule OS', short: 'OS' },
  { id: 'fsi', label: 'Schedule FSI', short: 'FSI' },
  { id: 'tr', label: 'Schedule TR', short: 'TR' },
  { id: 'fa-a2', label: 'Schedule FA · A2', short: 'FA A2' },
  { id: 'fa-a3', label: 'Schedule FA · A3', short: 'FA A3' },
];

function parseHash(): { step: StepId; schedule: ScheduleId } {
  const [step, schedule] = (typeof location === 'undefined' ? '' : location.hash.slice(1)).split('/');
  const steps: StepId[] = ['setup', 'review', 'file', 'insights', 'downloads'];
  return {
    step: (steps.includes(step as StepId) ? step : 'setup') as StepId,
    schedule: (SCHEDULES.some((s) => s.id === schedule) ? schedule : 'form67') as ScheduleId,
  };
}

class AppState {
  files = $state.raw<LoadedFile[]>([]);
  data = $state.raw<FlexData | null>(null);
  fx = $state.raw<Fx | null>(null);
  busy = $state(false);
  /** Why the last upload could not be processed (e.g. exchange rates failed to load). */
  loadError = $state('');
  isSample = $state(false);

  /** The return whose filing window is open today, unless the user picks another. */
  ay = $state(defaultAy());
  /** One account's ID, or ALL_ACCOUNTS to combine every account into one return. */
  accountId = $state('');
  settings = $state<Settings>(store('settings', DEFAULT_SETTINGS));
  rateOverrides = $state<RateOverrides>({});
  entities = $state<EntityOverrides>(store('entities', {}));

  step = $state<StepId>(parseHash().step);
  schedule = $state<ScheduleId>(parseHash().schedule);
  /** Portal values copied this session, so the walkthrough can show progress. */
  copied = $state<Record<string, true>>({});
  downloaded = $state<Record<string, string>>({});

  accounts = $derived(this.data ? accountsIn(this.data) : []);
  checklist = $derived(this.data ? sectionChecklist(this.data) : []);
  year = $derived(taxYear(this.ay));

  result = $derived.by((): { report?: Report; error?: string } => {
    if (!this.data || !this.fx) return {};
    if (!this.accounts.length) return { error: 'No IBKR account found in the uploaded files.' };
    const one = this.accounts.find((a) => a.accountId === this.accountId);
    const accounts = one ? [one] : this.accounts;
    try {
      const overrides = Object.fromEntries(Object.entries(this.rateOverrides).filter(([, v]) => v && Number(v) > 0));
      return { report: buildCombinedReport(this.data, accounts, this.ay, $state.snapshot(this.settings), this.fx.withOverrides(overrides)) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  });
  report = $derived(this.result.report);

  /** Missing company addresses count as review items for Schedule FA A3. */
  missingAddresses = $derived(
    this.report
      ? [...new Set(this.report.fa.a3.filter((r) => entityFor(r.lot.symbol, r.isin, r.entityName, this.entities).source === 'missing').map((r) => r.lot.symbol))]
      : [],
  );
  /** Blocking problems: errors other than missing rates, plus each missing exchange rate. */
  mustFix = $derived(
    (this.report?.warnings.filter((w) => w.level === 'error' && !w.message.includes('enter it manually')).length ?? 0) + (this.report?.missingRates.length ?? 0),
  );
  /** Things only the user can supply: company addresses and the foreign TIN. */
  /** Schedules FSI/TR (and so the foreign TIN) only apply when there is foreign income. */
  needsTin = $derived(!!this.report?.foreign.fsi.length && !this.settings.tin.trim());
  needsInput = $derived(this.report ? this.missingAddresses.length + (this.needsTin ? 1 : 0) : 0);

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('hashchange', () => {
        const h = parseHash();
        this.step = h.step;
        this.schedule = h.schedule;
      });
    }
  }

  go(step: StepId, schedule?: ScheduleId) {
    this.step = step;
    if (schedule) this.schedule = schedule;
    const hash = step === 'file' ? `#file/${this.schedule}` : `#${step}`;
    if (location.hash !== hash) history.pushState(null, '', hash);
    window.scrollTo({ top: 0 });
  }

  saveSettings() {
    persist('settings', $state.snapshot(this.settings));
  }

  setEntity(symbol: string, field: 'name' | 'address' | 'zip', value: string) {
    this.entities = { ...this.entities, [symbol]: { ...this.entities[symbol], [field]: value } };
    persist('entities', $state.snapshot(this.entities));
  }

  async addFiles(list: FileList | File[] | null) {
    if (!list?.length) return;
    const incoming = await Promise.all([...list].map(async (f) => ({ name: f.name, size: f.size, text: await f.text() })));
    const keep = this.isSample ? [] : this.files.filter((f) => !incoming.some((i) => i.name === f.name));
    this.isSample = false;
    await this.ingest([...keep, ...incoming]);
  }

  /** Loads last year's year-end file: losses to bring forward, lot corrections, addresses, choices. */
  loadYearEnd(text: string): string[] {
    const f = parseYearEnd(text);
    const { settings, notes } = applyYearEnd($state.snapshot(this.settings) as Settings, f, this.ay);
    this.settings = settings;
    const restored = Object.keys(f.entities ?? {}).filter((k) => !this.entities[k]);
    if (restored.length) {
      this.entities = { ...f.entities, ...this.entities };
      persist('entities', $state.snapshot(this.entities));
      notes.push(`Restored ${restored.length} company address(es).`);
    }
    return notes;
  }

  retry() {
    if (this.files.length) this.ingest(this.files);
  }

  removeFile(name: string) {
    const rest = this.files.filter((f) => f.name !== name);
    if (rest.length) this.ingest(rest);
    else this.clear();
  }

  async loadSample() {
    const names = ['sample-cy2025.xml', 'sample-fy2025-26.xml'];
    const files = await Promise.all(
      names.map(async (name) => {
        const text = await (await fetch(`${BASE}samples/${name}`)).text();
        return { name, size: text.length, text };
      }),
    );
    this.isSample = true;
    this.ay = 2026;
    await this.ingest(files);
  }

  clear() {
    this.files = [];
    this.data = null;
    this.rateOverrides = {};
    this.copied = {};
    this.downloaded = {};
    this.isSample = false;
    this.loadError = '';
    this.go('setup');
  }

  private async ingest(next: LoadedFile[]) {
    this.busy = true;
    this.loadError = '';
    try {
      const merged = emptyFlexData();
      const files: LoadedFile[] = [];
      for (const f of next) {
        try {
          parseFlexXml(f.text, f.name, merged);
          files.push({ ...f, error: undefined });
        } catch (e) {
          files.push({ ...f, error: (e as Error).message });
        }
      }
      this.files = files;
      if (!merged.statements.length) {
        this.data = null;
        return;
      }
      this.fx = await Fx.load(currenciesIn(merged), BASE);
      this.data = merged;
      const ids = accountsIn(merged).map((a) => a.accountId);
      if (!ids.includes(this.accountId)) this.accountId = ids.length > 1 ? ALL_ACCOUNTS : (ids[0] ?? '');
    } catch (e) {
      this.loadError = (e as Error).message;
    } finally {
      this.busy = false;
    }
  }
}

export const app = new AppState();
