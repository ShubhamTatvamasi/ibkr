<script lang="ts">
  import Icon from '../ui/Icon.svelte';
  import CopyButton from '../ui/CopyButton.svelte';
  import { app } from '../state.svelte';
  import { SUPPORTED_AY, taxYear } from '../../lib/tax/years';
  import { coverage } from '../../lib/tax/engine';
  import { BASE, date } from '../../lib/ui/format';
  import type { IsoDate } from '../../lib/dates';

  const today = new Date().toISOString().slice(0, 10);
  let dragging = $state(false);
  let input: HTMLInputElement;

  const PROMPT =
    'XML, all fields: Trades (Executions + Closed Lots), Open Positions (Lot), Cash Transactions, Prior Period Positions, Statement of Funds, Account Information, Financial Instrument Information';

  const RATES = [
    { v: 0, l: 'No tax (income below exemption)' },
    { v: 5.2, l: '5% slab + cess (5.2%)' },
    { v: 10.4, l: '10% slab + cess (10.4%)' },
    { v: 15.6, l: '15% slab + cess (15.6%)' },
    { v: 20.8, l: '20% slab + cess (20.8%)' },
    { v: 26, l: '25% slab + cess (26%)' },
    { v: 31.2, l: '30% slab + cess (31.2%)' },
    { v: 34.32, l: '30% + 10% surcharge (34.32%)' },
    { v: 35.88, l: '30% + 15% surcharge (35.88%)' },
  ];

  function deadline(ay: number): { text: string; tone: 'accent' | 'warn' | 'danger' | 'neutral' } {
    const due = `${ay}-07-31`;
    const belated = `${ay}-12-31`;
    const revised = `${ay + 1}-03-31`;
    if (today <= due) return { text: `Due ${date(due)}`, tone: 'accent' };
    if (today <= belated) return { text: `Belated filing until ${date(belated)}`, tone: 'warn' };
    if (today <= revised) return { text: `Revise until ${date(revised)}`, tone: 'warn' };
    return { text: 'Closed — updated return only', tone: 'neutral' };
  }

  const cov = $derived(app.data && app.accounts[0] ? coverage(app.data, app.accountId || app.accounts[0].accountId) : []);

  function segments(from: IsoDate, to: IsoDate) {
    const span = Date.parse(to) - Date.parse(from) + 86_400_000;
    return cov
      .filter((r) => r.to >= from && r.from <= to)
      .map((r) => {
        const a = r.from < from ? from : r.from;
        const b = r.to > to ? to : r.to;
        return { left: ((Date.parse(a) - Date.parse(from)) / span) * 100, width: ((Date.parse(b) - Date.parse(a) + 86_400_000) / span) * 100 };
      });
  }
  function covered(from: IsoDate, to: IsoDate) {
    return cov.some((r) => r.from <= from && r.to >= to);
  }

  const windows = $derived([
    { key: 'cy', title: 'Calendar-year file', purpose: 'Schedule FA (foreign assets)', from: app.year.cyStart, to: app.year.cyEnd },
    { key: 'fy', title: 'Financial-year file', purpose: 'Capital gains, dividends, foreign tax credit', from: app.year.fyStart, to: app.year.fyEnd },
  ]);
  const required = $derived(app.checklist.filter((c) => c.required));
  const optional = $derived(app.checklist.filter((c) => !c.required));
</script>

{#if !app.data}
  <section class="hero">
    <span class="badge accent"><Icon name="shield" size={14} />Private by design · runs offline in your browser</span>
    <h1>Your IBKR account, ready for the Indian tax return.</h1>
    <p class="lead">
      Schedule FA, capital gains, dividends and the foreign tax credit, worked out lot by lot with SBI TT buying rates and laid out
      field by field in the order the e-filing portal asks for them.
    </p>
    <div class="hero-actions">
      <button class="btn primary lg" onclick={() => input.click()}><Icon name="upload" />Upload Flex Query files</button>
      <button class="btn lg" onclick={() => app.loadSample()} disabled={app.busy}><Icon name="eye" />See it with sample data</button>
    </div>
    <ul class="trust">
      <li><Icon name="lock" size={16} />No account, no sign-up, no PAN</li>
      <li><Icon name="shield" size={16} />Files never leave this device</li>
      <li><Icon name="exchange" size={16} />SBI TT buying rate on every amount</li>
    </ul>
  </section>
{/if}

<div class="stack">
  <section class="card">
    <div class="card-head">
      <div>
        <h2><span class="num-step">1</span>Which return are you preparing?</h2>
        <p>Schedule FA covers the calendar year; everything else covers the financial year.</p>
      </div>
    </div>
    <div class="years" role="radiogroup" aria-label="Tax year">
      {#each SUPPORTED_AY as y}
        {@const t = taxYear(y)}
        {@const d = deadline(y)}
        <label class="year-card" class:selected={app.ay === y}>
          <input type="radio" name="ay" value={y} bind:group={app.ay} class="sr-only" />
          <span class="yc-top"><b>{t.newAct ? `Tax year ${y - 1}-${String(y % 100).padStart(2, '0')}` : `AY ${y}-${String((y + 1) % 100).padStart(2, '0')}`}</b>{#if app.ay === y}<Icon name="check-circle" size={18} />{/if}</span>
          <span class="yc-sub">FY {date(t.fyStart)} – {date(t.fyEnd)}</span>
          <span class="yc-sub">Schedule FA: calendar {t.cyStart.slice(0, 4)}</span>
          <span class="badge {d.tone === 'neutral' ? '' : d.tone}">{d.text}</span>
        </label>
      {/each}
    </div>
    {#if deadline(app.ay).tone === 'warn'}
      <div class="callout warn" style="margin-top:16px">
        <Icon name="warn" />
        <div>
          <b>The original due date has passed.</b>
          <p>A return filed now is belated (section 139(4)): a late fee applies, only the new tax regime is available, and this year's capital losses cannot be carried forward. If you already filed but left out foreign assets, a revised return is the usual fix — talk to your CA.</p>
        </div>
      </div>
    {/if}
  </section>

  <section class="card">
    <div class="card-head">
      <div>
        <h2><span class="num-step">2</span>Export two files from IBKR</h2>
        <p>One Activity Flex Query in XML, run for two date ranges. IBKR allows up to 365 days per run.</p>
      </div>
      <a class="btn sm" href={`${BASE}guide/`}><Icon name="book" size={16} />Full guide</a>
    </div>
    <div class="runs">
      {#each windows as w}
        <div class="run">
          <Icon name="calendar" />
          <div>
            <b>{w.title}</b>
            <span class="num">{date(w.from)} → {date(w.to)}</span>
            <small>{w.purpose}</small>
          </div>
        </div>
      {/each}
    </div>
    <details class="ai">
      <summary><Icon name="sparkle" size={18} />Quickest: use IBKR's <b>Configure with AI</b> to build the query</summary>
      <p class="muted">Performance &amp; Reports → Flex Queries → Configure with AI. Paste this one prompt and click Generate Flex Query — each prompt builds a whole new query, so don't send a second.</p>
      <div class="prompt">
        <div class="prompt-head"><b>Prompt · {PROMPT.length}/200</b><CopyButton value={PROMPT} label="prompt" /></div>
        <p>{PROMPT}</p>
      </div>
      <div class="callout warn">
        <Icon name="warn" />
        <div>
          <b>Then click Edit Manually and press Select All in every section.</b>
          <p>Required — the AI keeps a short default field list without <b>Open Date Time</b>, each lot's purchase date. Also check: format XML, Trades with Closed Lots, Open Positions at Lot level. Optionally add Change in Dividend Accruals and Corporate Actions. Before saving, rename the query to letters and numbers only (e.g. IndiaTax) — IBKR rejects commas and “&amp;”.</p>
        </div>
      </div>
    </details>
  </section>

  <section class="card">
    <div class="card-head">
      <div>
        <h2><span class="num-step">3</span>Add the XML files</h2>
        <p>Both at once is fine. Overlapping periods are merged without double counting.</p>
      </div>
      {#if !app.data}<button class="link-btn" onclick={() => app.loadSample()}>Use sample data</button>{/if}
    </div>

    <div
      class="drop"
      class:dragging
      role="button"
      tabindex="0"
      aria-label="Add IBKR Flex Query XML files"
      onclick={() => input.click()}
      onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), input.click())}
      ondragover={(e) => {
        e.preventDefault();
        dragging = true;
      }}
      ondragleave={() => (dragging = false)}
      ondrop={(e) => {
        e.preventDefault();
        dragging = false;
        app.addFiles(e.dataTransfer?.files ?? null);
      }}
    >
      <span class="drop-icon"><Icon name="upload" size={24} /></span>
      <b>{dragging ? 'Release to add' : 'Drop Flex Query XML files here'}</b>
      <span class="muted">or <span class="link-like">choose files</span> · .xml</span>
      <input bind:this={input} type="file" accept=".xml,text/xml,application/xml" multiple hidden onchange={(e) => app.addFiles(e.currentTarget.files)} />
    </div>

    {#if app.busy}<p class="muted status" role="status">Reading files…</p>{/if}

    {#if app.files.length}
      <ul class="files">
        {#each app.files as f}
          {@const st = app.data?.statements.filter((s) => s.fileName === f.name) ?? []}
          <li class:bad={f.error}>
            <span class="file-icon"><Icon name={f.error ? 'error' : 'file-table'} /></span>
            <div class="f-main">
              <span class="mono f-name">{f.name}</span>
              {#if f.error}
                <span class="f-err">{f.error}</span>
              {:else}
                <span class="f-meta">
                  {#each st as s}<span class="badge success"><Icon name="check" size={12} />{s.accountId} · {date(s.fromDate)} → {date(s.toDate)}</span>{/each}
                  <span class="faint">{(f.size / 1024).toFixed(0)} KB</span>
                </span>
              {/if}
            </div>
            {#if !app.isSample}<button class="btn ghost sm icon-only" aria-label={`Remove ${f.name}`} onclick={() => app.removeFile(f.name)}><Icon name="x" size={16} /></button>{/if}
          </li>
        {/each}
      </ul>
      {#if app.isSample}<p class="faint sample-note">Sample data is a fictional account. Add your own files to replace it.</p>{/if}
    {/if}

    {#if app.data}
      <h3 class="sub-h">Coverage</h3>
      <div class="coverage">
        {#each windows as w}
          {@const ok = covered(w.from, w.to)}
          <div class="cov-row">
            <div class="cov-label"><b>{w.title}</b><span class="faint">{w.purpose}</span></div>
            <div class="cov-bar" aria-label={`${w.title}: ${ok ? 'fully covered' : 'gaps'}`}>
              {#each segments(w.from, w.to) as s}<span style:left={`${s.left}%`} style:width={`${s.width}%`}></span>{/each}
            </div>
            <span class="badge {ok ? 'success' : 'danger'}"><Icon name={ok ? 'check' : 'warn'} size={12} />{ok ? 'Covered' : 'Gaps'}</span>
          </div>
        {/each}
        <div class="cov-axis num faint"><span>{date(app.year.cyStart)}</span><span>{date(app.year.fyEnd)}</span></div>
      </div>

      <h3 class="sub-h">Sections found</h3>
      <div class="checks">
        {#each [...required, ...optional] as c}
          {@const bad = c.missingCritical.length > 0}
          <div class="check" class:missing={!c.present} class:req={c.required} class:bad>
            <span class="ck-icon" class:soft={c.present && !bad && c.missingRecommended.length > 0}><Icon name={bad ? 'error' : c.present ? (c.missingRecommended.length ? 'warn' : 'check-circle') : c.required ? 'error' : 'step-todo'} size={18} /></span>
            <div>
              <b>{c.label}</b>
              <span class="faint">{c.purpose}{!c.present && !c.required ? ' — optional, improves accuracy' : ''}</span>
              {#if bad}<span class="miss crit">Missing: {c.missingCritical.join(', ')}</span>{/if}
              {#if c.missingRecommended.length}<span class="miss">Also not selected: {c.missingRecommended.join(', ')}</span>{/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <section class="card">
    <div class="card-head">
      <div>
        <h2><span class="num-step">4</span>About you</h2>
        <p>Used for Schedule FA applicability and the foreign tax credit limit. Saved in this browser only.</p>
      </div>
    </div>
    <div class="about">
      <fieldset class="field">
        <span>Residential status for the year</span>
        <div class="seg" role="radiogroup">
          {#each [['ROR', 'Resident (ROR)'], ['RNOR', 'RNOR'], ['NR', 'Non-resident']] as [v, l]}
            <label class:on={app.settings.residency === v}><input class="sr-only" type="radio" bind:group={app.settings.residency} value={v} />{l}</label>
          {/each}
        </div>
        <small>Schedule FA is required only for residents who are ordinarily resident.</small>
      </fieldset>
      <label class="field">
        <span>Your marginal tax rate</span>
        <select bind:value={app.settings.marginalRatePct}>
          {#each RATES as r}<option value={r.v}>{r.l}</option>{/each}
        </select>
        <small>Caps the foreign tax credit at the Indian tax on that income.</small>
      </label>
      <label class="field">
        <span>Foreign Taxpayer Identification Number</span>
        <input bind:value={app.settings.tin} placeholder="US TIN, or your passport number" autocomplete="off" />
        <small>Needed in Schedules FSI and TR. If no foreign TIN was issued, the passport number is accepted.</small>
      </label>
    </div>
  </section>

  {#if app.result.error}
    <div class="callout danger"><Icon name="error" /><div><b>Couldn't build the report</b><p>{app.result.error}</p></div></div>
  {/if}

  {#if app.report}
    <div class="continue">
      <button class="btn primary lg" onclick={() => app.go('review')}>Continue to review<Icon name="arrow-right" /></button>
    </div>
  {/if}
</div>

<style>
  .hero { padding: 8px 0 32px; max-width: 760px; }
  .hero h1 { font-size: var(--fs-display); line-height: 1.1; letter-spacing: -0.02em; margin: 16px 0 14px; }
  .lead { font-size: 1.0625rem; color: var(--text-2); max-width: 64ch; }
  .hero-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 24px; }
  .trust { list-style: none; padding: 0; margin: 20px 0 0; display: flex; flex-wrap: wrap; gap: 8px 20px; font-size: 13px; color: var(--text-2); }
  .trust li { display: flex; align-items: center; gap: 6px; }
  .trust :global(.icon) { color: var(--success); }

  .stack { display: grid; gap: 20px; }
  h2 { font-size: var(--fs-h3); display: flex; align-items: center; gap: 10px; }
  .num-step { display: inline-grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: var(--accent-soft); color: var(--accent-soft-text); font-size: 13px; font-weight: 600; flex: none; }

  .years { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
  .year-card { display: grid; gap: 4px; align-content: start; padding: 14px 16px; border: 1px solid var(--border); border-radius: var(--r-lg); cursor: pointer; background: var(--surface); transition: border-color var(--dur-1), background var(--dur-1); }
  .year-card:hover { border-color: var(--border-strong); }
  .year-card.selected { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); background: var(--accent-soft); }
  .year-card:has(input:focus-visible) { outline: 2px solid var(--focus); outline-offset: 2px; }
  .yc-top { display: flex; justify-content: space-between; align-items: center; color: var(--accent); }
  .yc-top b { color: var(--text); }
  .yc-sub { font-size: 13px; color: var(--text-2); }
  .year-card .badge { justify-self: start; margin-top: 6px; }

  .runs { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
  .run { display: flex; gap: 12px; padding: 14px 16px; background: var(--surface-sunken); border-radius: var(--r-md); }
  .run :global(.icon) { color: var(--accent); margin-top: 2px; }
  .run div { display: grid; gap: 2px; }
  .run span { font-size: var(--fs-ui); }
  .run small { color: var(--text-3); font-size: var(--fs-caption); }
  .ai { margin-top: 14px; border: 1px solid var(--border); border-radius: var(--r-md); padding: 0 14px; }
  .ai summary { display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 12px 0; font-size: var(--fs-ui); list-style: none; }
  .ai summary::-webkit-details-marker { display: none; }
  .ai summary :global(.icon) { color: var(--accent); }
  .ai[open] { padding-bottom: 12px; }
  .ai .muted { font-size: 13px; }

  .drop { display: grid; justify-items: center; gap: 6px; padding: 32px 16px; border: 1.5px dashed var(--border-strong); border-radius: var(--r-lg); text-align: center; cursor: pointer; transition: background var(--dur-1), border-color var(--dur-1); }
  .drop:hover { background: var(--surface-hover); }
  .drop.dragging { border-style: solid; border-color: var(--accent); background: var(--accent-soft); }
  .drop-icon { display: grid; place-items: center; width: 48px; height: 48px; border-radius: 50%; background: var(--accent-soft); color: var(--accent); margin-bottom: 4px; }
  .drop .muted { font-size: 13px; }
  .link-like { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
  .status { margin-top: 10px; font-size: 13px; }

  .files { list-style: none; padding: 0; margin: 14px 0 0; display: grid; gap: 8px; }
  .files li { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--r-md); }
  .files li.bad { border-color: var(--danger); background: var(--danger-soft); }
  .file-icon { display: grid; place-items: center; width: 36px; height: 36px; border-radius: var(--r-md); background: var(--surface-sunken); color: var(--text-2); flex: none; }
  .bad .file-icon { color: var(--danger); background: transparent; }
  .f-main { display: grid; gap: 4px; flex: 1; min-width: 0; }
  .f-name { font-size: 13px; overflow-wrap: anywhere; }
  .f-meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: var(--fs-caption); }
  .f-err { font-size: 13px; color: var(--danger-text); }
  .sample-note { font-size: 13px; margin-top: 8px; }

  .sub-h { font-size: var(--fs-ui); margin: 24px 0 10px; }
  .coverage { display: grid; gap: 10px; }
  .cov-row { display: grid; grid-template-columns: 220px 1fr auto; gap: 14px; align-items: center; }
  .cov-label { display: grid; font-size: 13px; }
  .cov-label .faint { font-size: var(--fs-caption); }
  .cov-bar { position: relative; height: 12px; border-radius: var(--r-pill); background: var(--danger-soft); overflow: hidden; }
  .cov-bar span { position: absolute; top: 0; bottom: 0; background: var(--success); }
  .cov-axis { display: none; }
  .checks { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 8px; }
  .check { display: flex; gap: 10px; padding: 10px 12px; border-radius: var(--r-md); background: var(--surface-sunken); }
  .check div { display: grid; font-size: 13px; }
  .check .faint { font-size: var(--fs-caption); }
  .ck-icon { color: var(--success); }
  .check.missing .ck-icon { color: var(--text-3); }
  .check.missing.req { background: var(--danger-soft); }
  .check.missing.req .ck-icon, .check.bad .ck-icon { color: var(--danger); }
  .check.bad { background: var(--danger-soft); }
  .ck-icon.soft { color: var(--warn); }
  .miss { font-size: var(--fs-caption); color: var(--text-2); margin-top: 2px; }
  .miss.crit { color: var(--danger-text); font-weight: 600; }

  .about { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px; }
  fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
  .seg { display: flex; background: var(--surface-sunken); border-radius: var(--r-md); padding: 3px; gap: 2px; }
  .seg label { flex: 1; text-align: center; padding: 7px 6px; border-radius: var(--r-sm); font-size: 13px; font-weight: 500; color: var(--text-2); cursor: pointer; white-space: nowrap; }
  .seg label.on { background: var(--surface); color: var(--text); box-shadow: var(--sh-1), 0 0 0 1px var(--border); }
  .seg label:has(input:focus-visible) { outline: 2px solid var(--focus); }
  .continue { display: flex; justify-content: flex-end; }

  @media (max-width: 640px) {
    .cov-row { grid-template-columns: 1fr auto; }
    .cov-bar { grid-column: 1 / -1; grid-row: 2; }
    .card-head { flex-wrap: wrap; }
  }
</style>
