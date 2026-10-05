<script lang="ts">
  import Decimal from 'decimal.js';
  import { emptyFlexData, parseFlexXml } from '../lib/flex/parse';
  import type { FlexData } from '../lib/flex/model';
  import { DEFAULT_SETTINGS, type Settings } from '../lib/tax/common';
  import { accountsIn, buildReport, currenciesIn, type Report } from '../lib/tax/engine';
  import { Fx, type RateOverrides } from '../lib/tax/fx';
  import { QUARTER_LABELS, SUPPORTED_AY, taxYear } from '../lib/tax/years';
  import { buildPack, itrSummary, zipPack, type EntityOverrides } from '../lib/export/pack';
  import { BASE, date, download, inr, money, num, persist, store } from '../lib/ui/format';

  interface Loaded {
    name: string;
    text: string;
  }

  let loaded = $state.raw<Loaded[]>([]);
  let data = $state.raw<FlexData | null>(null);
  let fx = $state.raw<Fx | null>(null);
  let errors = $state<string[]>([]);
  let busy = $state(false);
  let dragging = $state(false);
  let isSample = $state(false);

  let ay = $state(2026);
  let accountId = $state('');
  let settings = $state<Settings>(store('settings', DEFAULT_SETTINGS));
  let rateOverrides = $state<RateOverrides>({});
  let entities = $state<EntityOverrides>(store('entities', {}));
  let tab = $state('summary');

  $effect(() => persist('settings', $state.snapshot(settings)));
  $effect(() => persist('entities', $state.snapshot(entities)));

  const accounts = $derived(data ? accountsIn(data) : []);

  const result = $derived.by((): { report?: Report; error?: string } => {
    if (!data || !fx) return {};
    const account = accounts.find((a) => a.accountId === accountId) ?? accounts[0];
    if (!account) return { error: 'No account found in the uploaded files.' };
    try {
      const overrides = Object.fromEntries(Object.entries(rateOverrides).filter(([, v]) => v && Number(v) > 0));
      return { report: buildReport(data, account, ay, $state.snapshot(settings), fx.withOverrides(overrides)) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  });
  const report = $derived(result.report);
  const symbols = $derived(report ? [...new Set(report.fa.a3.map((r) => r.lot.symbol))].sort() : []);

  async function ingest(next: Loaded[]) {
    busy = true;
    errors = [];
    const firstLoad = !data;
    try {
      const merged = emptyFlexData();
      const ok: Loaded[] = [];
      for (const f of next) {
        try {
          parseFlexXml(f.text, f.name, merged);
          ok.push(f);
        } catch (e) {
          errors = [...errors, (e as Error).message];
        }
      }
      loaded = ok;
      if (!ok.length) {
        data = null;
        return;
      }
      fx = await Fx.load(currenciesIn(merged), BASE);
      data = merged;
      const latest = merged.statements.map((s) => s.toDate).sort().at(-1) ?? '';
      const fits = SUPPORTED_AY.find((y) => taxYear(y).cyEnd <= latest || taxYear(y).fyEnd <= latest);
      if (fits && firstLoad) ay = fits;
      const ids = accountsIn(merged).map((a) => a.accountId);
      if (!ids.includes(accountId)) accountId = ids[0] ?? '';
    } finally {
      busy = false;
    }
  }

  async function addFiles(list: FileList | null) {
    if (!list?.length) return;
    const incoming = await Promise.all([...list].map(async (f) => ({ name: f.name, text: await f.text() })));
    if (isSample) {
      isSample = false;
      loaded = [];
    }
    await ingest([...loaded.filter((l) => !incoming.some((i) => i.name === l.name)), ...incoming]);
  }

  async function loadSample() {
    const names = ['sample-cy2025.xml', 'sample-fy2025-26.xml'];
    const files = await Promise.all(names.map(async (name) => ({ name, text: await (await fetch(`${BASE}samples/${name}`)).text() })));
    isSample = true;
    ay = 2026;
    await ingest(files);
  }

  function clearAll() {
    loaded = [];
    data = null;
    errors = [];
    rateOverrides = {};
    isSample = false;
  }

  function removeFile(name: string) {
    const rest = loaded.filter((l) => l.name !== name);
    if (rest.length) ingest(rest);
    else clearAll();
  }

  async function downloadZip() {
    if (!report) return;
    const blob = await zipPack(buildPack(report, $state.snapshot(entities)));
    download(`ibkr-india-tax-${report.account.accountId}-AY${report.year.ayStart}.zip`, blob);
  }

  function downloadOne(name: string) {
    if (!report) return;
    const f = buildPack(report, $state.snapshot(entities)).find((x) => x.name === name);
    if (f) download(f.name, new Blob([f.content], { type: name.endsWith('.csv') ? 'text/csv' : 'text/plain' }));
  }

  function setEntity(symbol: string, field: 'address' | 'zip', value: string) {
    entities = { ...entities, [symbol]: { ...entities[symbol], [field]: value } };
  }

  const sum = (xs: (Decimal | undefined)[]) => xs.reduce<Decimal>((s, x) => s.add(x ?? 0), new Decimal(0));

  const TABS = [
    ['summary', 'Summary'],
    ['fa3', 'Schedule FA · A3'],
    ['fa2', 'Schedule FA · A2'],
    ['cg', 'Capital gains'],
    ['div', 'Dividends'],
    ['int', 'Interest'],
    ['ftc', 'Foreign tax credit'],
    ['files', 'Downloads'],
  ] as const;
</script>

<div class="app">
  <section class="panel upload" class:dragging>
    <div
      class="drop"
      role="region"
      aria-label="Upload IBKR Flex Query XML files"
      ondragover={(e) => {
        e.preventDefault();
        dragging = true;
      }}
      ondragleave={() => (dragging = false)}
      ondrop={(e) => {
        e.preventDefault();
        dragging = false;
        addFiles(e.dataTransfer?.files ?? null);
      }}
    >
      <div class="drop-text">
        <strong>Drop your IBKR Flex Query XML files here</strong>
        <span>One export for the calendar year (Schedule FA) and one for the financial year (CG, OS, FTC). Files never leave this browser.</span>
      </div>
      <div class="drop-actions">
        <label class="btn primary">
          Choose files
          <input type="file" accept=".xml,text/xml,application/xml" multiple hidden onchange={(e) => addFiles(e.currentTarget.files)} />
        </label>
        <button class="btn" onclick={loadSample} disabled={busy}>Try sample data</button>
        <a class="btn ghost" href={`${BASE}guide/`}>How to export from IBKR →</a>
      </div>
    </div>

    {#if errors.length}
      <ul class="errors">
        {#each errors as e}<li>{e}</li>{/each}
      </ul>
    {/if}

    {#if data}
      <div class="files">
        {#if isSample}<span class="chip sample">Fictional sample data</span>{/if}
        {#each data.statements as s}
          <span class="chip">
            {s.fileName} · {s.accountId} · {date(s.fromDate)} → {date(s.toDate)}
            {#if !isSample}<button class="x" aria-label={`Remove ${s.fileName}`} onclick={() => removeFile(s.fileName)}>×</button>{/if}
          </span>
        {/each}
        <button class="link" onclick={clearAll}>Clear all</button>
      </div>
    {/if}
  </section>

  {#if data}
    <section class="panel controls">
      <label>
        <span>Return</span>
        <select bind:value={ay}>
          {#each SUPPORTED_AY as y}<option value={y}>{taxYear(y).label}</option>{/each}
        </select>
      </label>
      {#if accounts.length > 1}
        <label>
          <span>Account</span>
          <select bind:value={accountId}>
            {#each accounts as a}<option value={a.accountId}>{a.accountId}{a.name ? ` · ${a.name}` : ''}</option>{/each}
          </select>
        </label>
      {/if}
      <label>
        <span>Capital gains conversion</span>
        <select bind:value={settings.cgFxMethod}>
          <option value="split">Sale & cost separately</option>
          <option value="gain">Gain at sale-month rate</option>
        </select>
      </label>
      <label>
        <span>FA income & proceeds rate</span>
        <select bind:value={settings.faIncomeRate}>
          <option value="txn">TTBR on transaction date</option>
          <option value="cyEnd">TTBR on 31 December</option>
        </select>
      </label>
      <label>
        <span>Broker interest rate</span>
        <select bind:value={settings.interestRate}>
          <option value="fyEnd">TTBR on 31 March</option>
          <option value="monthly">Month-end before each credit</option>
        </select>
      </label>
      <label>
        <span>Marginal tax rate %</span>
        <input type="number" min="0" max="45" step="0.1" bind:value={settings.marginalRatePct} />
      </label>
    </section>
  {/if}

  {#if result.error}
    <p class="panel errors">{result.error}</p>
  {/if}

  {#if report}
    {@const s = report.summary}
    <section class="cards">
      <div class="card"><span>Short-term gains</span><strong class:neg={s.stcg.lt(0)}>{inr(s.stcg)}</strong><small>slab rate · CG A5</small></div>
      <div class="card"><span>Long-term gains</span><strong class:neg={s.ltcg.lt(0)}>{inr(s.ltcg)}</strong><small>12.5% · CG B8</small></div>
      <div class="card"><span>Dividends (gross)</span><strong>{inr(s.dividends)}</strong><small>OS 1a(i)</small></div>
      <div class="card"><span>Broker interest</span><strong>{inr(s.interest)}</strong><small>OS 1b(ix)</small></div>
      <div class="card"><span>Foreign tax withheld</span><strong>{inr(s.foreignTax)}</strong><small>credit {inr(s.ftcRelief)} · {report.year.law.ftcForm}</small></div>
      <div class="card"><span>Schedule FA</span><strong>{s.a3Rows} lots</strong><small>closing {inr(s.faClosingTotal)}</small></div>
    </section>

    {#if report.missingRates.length}
      <section class="panel missing">
        <h3>Missing exchange rates</h3>
        <p>The SBI archive has no rate for these dates (it starts in January 2020). Enter the SBI TT buying rate from your bank's rate card to fill them.</p>
        <div class="rate-grid">
          {#each report.missingRates as m}
            <label>
              <span>{m.currency} on {date(m.date)}</span>
              <input
                type="number"
                step="0.01"
                placeholder="e.g. 71.25"
                value={rateOverrides[`${m.currency}|${m.date}`] ?? ''}
                onchange={(e) => (rateOverrides = { ...rateOverrides, [`${m.currency}|${m.date}`]: e.currentTarget.value })}
              />
            </label>
          {/each}
        </div>
      </section>
    {/if}

    {#if report.warnings.length}
      <details class="panel warnings" open={report.warnings.some((w) => w.level === 'error')}>
        <summary>
          {report.warnings.filter((w) => w.level === 'error').length} errors ·
          {report.warnings.filter((w) => w.level === 'warn').length} warnings ·
          {report.warnings.filter((w) => w.level === 'info').length} notes
        </summary>
        <ul>
          {#each report.warnings as w}
            <li class={w.level}><b>{w.area}</b> {w.message}</li>
          {/each}
        </ul>
      </details>
    {/if}

    <nav class="tabs" aria-label="Report sections">
      {#each TABS as [id, label]}
        <button class:active={tab === id} onclick={() => (tab = id)}>{label}</button>
      {/each}
    </nav>

    <section class="panel table-panel">
      {#if tab === 'summary'}
        <h3>Where each figure goes — {report.year.label}</h3>
        <p class="muted">
          {report.year.law.act}. Schedule FA: calendar year {report.year.cyStart.slice(0, 4)}. CG / OS / FSI / TR: {date(report.year.fyStart)} – {date(report.year.fyEnd)}.
        </p>
        <div class="scroll">
          <table>
            <thead><tr><th>Schedule</th><th>Item</th><th class="r">Value</th></tr></thead>
            <tbody>
              {#each itrSummary(report).slice(1) as [sch, item, value]}
                <tr>
                  <td><span class="tag">{sch}</span></td>
                  <td>{item}</td>
                  <td class="r mono">{typeof value === 'number' && !String(item).includes('rows') ? inr(value) : (value ?? '—')}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else if tab === 'fa3'}
        <h3>Table A3 — foreign equity holdings, one row per lot</h3>
        <p class="muted">Peak = highest of shares held × price × that day's SBI TTBR during {report.year.cyStart.slice(0, 4)}. Closing at 31 Dec price and TTBR.</p>
        <div class="scroll">
          <table>
            <thead>
              <tr>
                <th>Symbol</th><th>Acquired</th><th class="r">Qty start → end</th><th class="r">Initial value</th>
                <th class="r">Peak value</th><th>Peak date</th><th class="r">Closing</th><th class="r">Dividends</th><th class="r">Sale proceeds</th>
              </tr>
            </thead>
            <tbody>
              {#each report.fa.a3 as r}
                <tr>
                  <td><b>{r.lot.symbol}</b><div class="sub">{r.entityName} · {r.country.name} ({r.country.itrCode || '?'})</div></td>
                  <td>{date(r.acquired)}</td>
                  <td class="r mono">{num(r.qtyStart)} → {num(r.qtyEnd)}</td>
                  <td class="r mono">{inr(r.initial?.inr)}<div class="sub">{money(r.initial?.foreign, r.lot.currency)} @ {r.initial?.rate.toString() ?? '—'}</div></td>
                  <td class="r mono">{inr(r.peak?.inr)}<div class="sub">{r.peakQuality === 'daily' ? 'daily prices' : 'approximate'}</div></td>
                  <td>{date(r.peak?.date)}</td>
                  <td class="r mono">{inr(r.closing?.inr ?? 0)}</td>
                  <td class="r mono">{inr(r.dividends.inr)}</td>
                  <td class="r mono">{inr(r.proceeds.inr)}</td>
                </tr>
              {/each}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="3">Total</td>
                <td class="r mono">{inr(sum(report.fa.a3.map((r) => r.initial?.inr)))}</td>
                <td class="r mono">{inr(sum(report.fa.a3.map((r) => r.peak?.inr)))}</td>
                <td></td>
                <td class="r mono">{inr(sum(report.fa.a3.map((r) => r.closing?.inr)))}</td>
                <td class="r mono">{inr(sum(report.fa.a3.map((r) => r.dividends.inr)))}</td>
                <td class="r mono">{inr(sum(report.fa.a3.map((r) => r.proceeds.inr)))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <h4>Entity addresses</h4>
        <p class="muted">IBKR data has no company addresses. Fill them once; they are saved in this browser and used in the A3 upload file.</p>
        <div class="entity-grid">
          {#each symbols as sym}
            <span class="sym">{sym}</span>
            <input placeholder="Registered address" value={entities[sym]?.address ?? ''} onchange={(e) => setEntity(sym, 'address', e.currentTarget.value)} />
            <input class="zip" placeholder="ZIP" value={entities[sym]?.zip ?? ''} onchange={(e) => setEntity(sym, 'zip', e.currentTarget.value)} />
          {/each}
        </div>
      {:else if tab === 'fa2'}
        <h3>Table A2 — foreign custodial account</h3>
        <div class="scroll">
          <table>
            <thead>
              <tr><th>Institution</th><th>Account</th><th>Opened</th><th class="r">Peak balance</th><th>Peak date</th><th class="r">Closing</th><th>Gross amounts credited</th></tr>
            </thead>
            <tbody>
              {#each report.fa.a2 as a}
                <tr>
                  <td><b>{a.institution.name}</b><div class="sub">{a.institution.address} {a.institution.zip} · {a.country.name} ({a.country.itrCode})</div></td>
                  <td class="mono">{a.account.accountId}</td>
                  <td>{date(a.account.dateOpened)}</td>
                  <td class="r mono">{inr(a.peak?.inr)}<div class="sub">{a.cashQuality}</div></td>
                  <td>{date(a.peak?.date)}</td>
                  <td class="r mono">{inr(a.closing)}</td>
                  <td>
                    {#each a.credited as c}<div><span class="tag">{c.code}</span> {c.nature}: <span class="mono">{inr(c.inr)}</span></div>{/each}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <p class="muted">Peak and closing are the cash balance, rebuilt day by day from the Statement of Funds and converted at each day's TTBR. The portal file has one row per nature of amount.</p>
      {:else if tab === 'cg'}
        <h3>Capital gains — sales from {date(report.year.fyStart)} to {date(report.year.fyEnd)}</h3>
        <p class="muted">US shares are unlisted in India: long-term only if held more than 24 months. Rates: SBI TTBR on the last day of the month before the sale ({report.year.law.conversionRule}).</p>
        <div class="scroll">
          <table>
            <thead>
              <tr><th>Symbol</th><th>Acquired</th><th>Sold</th><th class="r">Qty</th><th>Term</th><th class="r">Sale value</th><th class="r">Expenses</th><th class="r">Cost</th><th class="r">Gain</th></tr>
            </thead>
            <tbody>
              {#each report.cg.rows as r}
                <tr>
                  <td><b>{r.lot.symbol}</b>{#if r.pnlMismatch}<span class="tag warn" title="Differs from IBKR realized P/L">≠</span>{/if}</td>
                  <td>{date(r.lot.openDate)}</td>
                  <td>{date(r.lot.closeDate)}</td>
                  <td class="r mono">{num(r.lot.quantity)}</td>
                  <td><span class="tag" class:lt={r.term === 'LTCG'}>{r.term}</span></td>
                  <td class="r mono">{inr(r.saleInr)}<div class="sub">{money(r.lot.proceeds, r.lot.currency)} @ {r.saleRate?.rate.toString() ?? '—'}</div></td>
                  <td class="r mono">{inr(r.expensesInr)}</td>
                  <td class="r mono">{inr(r.costInr)}<div class="sub">{money(r.lot.cost, r.lot.currency)} @ {r.costRate?.rate.toString() ?? '—'}</div></td>
                  <td class="r mono" class:neg={r.gainInr?.lt(0)}>{inr(r.gainInr)}<div class="sub">{money(r.gainForeign, r.lot.currency)}</div></td>
                </tr>
              {:else}
                <tr><td colspan="9" class="muted">No sales in this financial year.</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
        <h4>Quarterly breakup (Table F, s.234C)</h4>
        <div class="scroll">
          <table>
            <thead><tr><th></th>{#each QUARTER_LABELS as q}<th class="r">{q}</th>{/each}<th class="r">Total</th></tr></thead>
            <tbody>
              <tr><td>STCG</td>{#each report.cg.stcg.quarters as q}<td class="r mono">{inr(q)}</td>{/each}<td class="r mono"><b>{inr(report.cg.stcg.gainInr)}</b></td></tr>
              <tr><td>LTCG</td>{#each report.cg.ltcg.quarters as q}<td class="r mono">{inr(q)}</td>{/each}<td class="r mono"><b>{inr(report.cg.ltcg.gainInr)}</b></td></tr>
            </tbody>
          </table>
        </div>
      {:else if tab === 'div'}
        <h3>Dividends — gross, before US withholding</h3>
        <div class="scroll">
          <table>
            <thead><tr><th>Paid</th><th>Symbol</th><th>Country</th><th class="r">Gross</th><th class="r">Withheld</th><th class="r">TTBR (date)</th><th class="r">Gross INR</th><th>Quarter</th></tr></thead>
            <tbody>
              {#each report.income.dividends as d}
                <tr>
                  <td>{date(d.txn.date)}</td>
                  <td><b>{d.txn.symbol}</b></td>
                  <td>{d.country.name}</td>
                  <td class="r mono">{money(d.txn.amount, d.txn.currency)}</td>
                  <td class="r mono">{money(d.withheldForeign, d.txn.currency)}</td>
                  <td class="r mono">{d.conv?.rate.toString() ?? '—'}<div class="sub">{date(d.conv?.rateDate)}</div></td>
                  <td class="r mono">{inr(d.conv?.inr)}</td>
                  <td>{QUARTER_LABELS[d.quarter]}</td>
                </tr>
              {:else}
                <tr><td colspan="8" class="muted">No dividends in this financial year.</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
        <h4>Quarterly breakup (s.234C)</h4>
        <div class="scroll">
          <table>
            <thead><tr>{#each QUARTER_LABELS as q}<th class="r">{q}</th>{/each}<th class="r">Total</th></tr></thead>
            <tbody><tr>{#each report.income.dividendQuarters as q}<td class="r mono">{inr(q)}</td>{/each}<td class="r mono"><b>{inr(report.income.dividendTotalInr)}</b></td></tr></tbody>
          </table>
        </div>
      {:else if tab === 'int'}
        <h3>Broker interest</h3>
        <div class="scroll">
          <table>
            <thead><tr><th>Date</th><th>Description</th><th class="r">Amount</th><th class="r">TTBR (date)</th><th class="r">INR</th></tr></thead>
            <tbody>
              {#each report.income.interest as d}
                <tr>
                  <td>{date(d.txn.date)}</td>
                  <td>{d.description}</td>
                  <td class="r mono">{money(d.txn.amount, d.txn.currency)}</td>
                  <td class="r mono">{d.conv?.rate.toString() ?? '—'}<div class="sub">{date(d.conv?.rateDate)}</div></td>
                  <td class="r mono">{inr(d.conv?.inr)}</td>
                </tr>
              {:else}
                <tr><td colspan="5" class="muted">No broker interest in this financial year.</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else if tab === 'ftc'}
        <h3>Foreign tax credit — Schedules FSI & TR, {report.year.law.ftcForm}</h3>
        <p class="muted">
          Relief per country and income = lowest of tax paid abroad, Indian tax on that income at {settings.marginalRatePct}%, and the treaty rate. Each deduction converted at the TTBR on the last day of the month before it ({report.year.law.ftcRule}).
          File {report.year.law.ftcForm} before filing the return.
        </p>
        <div class="scroll">
          <table>
            <thead><tr><th>Country</th><th>Head</th><th>Article</th><th class="r">Income</th><th class="r">Tax paid abroad</th><th class="r">Indian tax</th><th class="r">Treaty cap</th><th class="r">Relief</th></tr></thead>
            <tbody>
              {#each report.income.ftc as g}
                <tr>
                  <td>{g.country.name} ({g.country.itrCode})</td>
                  <td>{g.head}</td>
                  <td>{g.article}</td>
                  <td class="r mono">{inr(g.incomeInr)}</td>
                  <td class="r mono">{inr(g.foreignTaxInr)}</td>
                  <td class="r mono">{inr(g.indianTaxInr)}</td>
                  <td class="r mono">{inr(g.treatyCapInr)}</td>
                  <td class="r mono"><b>{inr(g.reliefInr)}</b></td>
                </tr>
              {:else}
                <tr><td colspan="8" class="muted">No foreign tax withheld in this financial year.</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
        <h4>Each deduction</h4>
        <div class="scroll">
          <table>
            <thead><tr><th>Date</th><th>Description</th><th class="r">Tax</th><th class="r">TTBR (date)</th><th class="r">INR</th></tr></thead>
            <tbody>
              {#each report.income.taxes as t}
                <tr>
                  <td>{date(t.txn.date)}</td>
                  <td>{t.txn.description}</td>
                  <td class="r mono">{money(t.txn.amount.neg(), t.txn.currency)}</td>
                  <td class="r mono">{t.conv?.rate.toString() ?? '—'}<div class="sub">{date(t.conv?.rateDate)}</div></td>
                  <td class="r mono">{inr(t.conv?.inr)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else if tab === 'files'}
        <h3>Download the CA pack</h3>
        <p class="muted">CSV workings in foreign currency and INR with every rate and date, the e-filing bulk-upload files for Schedule FA A2/A3, and a readme. Generated in your browser.</p>
        <button class="btn primary big" onclick={downloadZip}>Download everything (.zip)</button>
        <ul class="file-list">
          {#each buildPack(report, entities) as f}
            <li><button class="link" onclick={() => downloadOne(f.name)}>{f.name}</button><span class="muted">{f.title}</span></li>
          {/each}
        </ul>
      {/if}
    </section>
  {:else if !data}
    <section class="panel intro">
      <h3>What you get</h3>
      <div class="intro-grid">
        <div><b>Schedule FA</b><p>Table A3 per lot with daily peak values, and Table A2 with the account's peak and closing cash — plus e-filing upload files.</p></div>
        <div><b>Capital gains</b><p>Every sale matched to the lot IBKR closed, 24-month rule, Rule 115 rates, quarterly Table F.</p></div>
        <div><b>Dividends & interest</b><p>Gross amounts at the right month-end SBI rate, with the s.234C quarterly breakup.</p></div>
        <div><b>Foreign tax credit</b><p>Per-country FSI and TR figures, treaty-capped relief, and the working behind Form 67 / Form 44.</p></div>
      </div>
    </section>
  {/if}
</div>
