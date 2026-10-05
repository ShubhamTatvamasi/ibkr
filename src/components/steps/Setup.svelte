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
    'Name IndiaTax, XML, all fields: Trades (Execution, Closed Lots), Open Positions (Lot), Cash Transactions, Prior Period Positions, Statement of Funds, Account Information, Financial Instrument Info';

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

  let dragKey = $state('');
  let pickSlot = $state('');
  let slotWarn = $state<Record<string, string>>({});

  /** Add files from a slot; warn on that slot if none of them overlaps its period. */
  async function addTo(slotKey: string, list: FileList | null) {
    if (!list?.length) return;
    const names = [...list].map((f) => f.name);
    await app.addFiles(list);
    const sl = slots.find((x) => x.key === slotKey);
    if (!sl) return;
    const hit = (app.data?.statements ?? []).some((st) => names.includes(st.fileName) && st.toDate >= sl.from && st.fromDate <= sl.to);
    slotWarn = {
      ...slotWarn,
      [slotKey]: hit ? '' : `${names.join(', ')} doesn't cover ${date(sl.from)} – ${date(sl.to)}. It was kept for the period it does cover — check the Custom Date Range you ran.`,
    };
  }
  const slots = $derived([
    { key: 'fa', title: 'Calendar-year file', purpose: 'Schedule FA (foreign assets)', from: app.year.cyStart, to: app.year.cyEnd, p: app.report?.periods.fa },
    { key: 'fy', title: 'Financial-year file', purpose: 'Capital gains, dividends, foreign tax credit', from: app.year.fyStart, to: app.year.fyEnd, p: app.report?.periods.fy },
  ]);
  type Slot = (typeof slots)[number];

  function filesFor(from: IsoDate, to: IsoDate) {
    return [...new Set((app.data?.statements ?? []).filter((s) => s.toDate >= from && s.fromDate <= to).map((s) => s.fileName))];
  }

  function slotState(sl: Slot): { tone: 'empty' | 'ok' | 'bad' | 'na' | 'prov'; label: string; icon: string; note: string } {
    if (!app.data)
      return {
        tone: 'empty',
        label: 'Needed',
        icon: 'calendar',
        note: sl.to >= today ? `Run the query with Custom Date Range from ${date(sl.from)} to the latest date IBKR allows — this period is still running.` : `Run the query with Custom Date Range ${date(sl.from)} → ${date(sl.to)}.`,
      };
    const p = sl.p;
    if (!p) return covered(sl.from, sl.to) ? { tone: 'ok', label: 'Covered', icon: 'check-circle', note: 'Your files cover this period.' } : { tone: 'bad', label: 'Gaps', icon: 'warn', note: 'Your files don\'t cover this whole period.' };
    if (p.notApplicable) return { tone: 'na', label: 'Not needed', icon: 'info', note: 'Your account was funded after this period ended — nothing to report for it.' };
    if (!p.covered) return { tone: 'bad', label: 'Gaps', icon: 'warn', note: `Run the query with Custom Date Range ${date(p.needFrom)} → ${date(p.needTo)} and add that file.` };
    const other = slots.find((x) => x.key !== sl.key)!;
    const mine = filesFor(sl.from, sl.to);
    const shared = mine.length > 0 && mine.every((f) => filesFor(other.from, other.to).includes(f)) && !other.p?.notApplicable;
    const sharedNote = shared
      ? ` The same file covers the ${other.title.toLowerCase()} too${p.needFrom > p.from ? ` — your account started on ${date(p.needFrom)}, so both periods need the same dates` : ''}. No second file is needed.`
      : '';
    if (p.inProgress) return { tone: 'prov', label: 'Provisional', icon: 'clock', note: `Still running: figures are as of ${date(p.needTo)}; export again after ${date(p.to)} for final numbers.${sharedNote}` };
    return { tone: 'ok', label: 'Covered', icon: 'check-circle', note: (p.needFrom > p.from ? `Covered from your account's start on ${date(p.needFrom)}.` : 'Your files cover this whole period.') + sharedNote };
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
      <button
        class="btn primary lg"
        onclick={() => {
          pickSlot = '';
          input.click();
        }}><Icon name="upload" />Upload Flex Query files</button
      >
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
    <a class="guide-cta" href={`${BASE}guide/`}>
      <span class="gc-icon"><Icon name="book" /></span>
      <span><b>New to Flex Queries? Follow the step-by-step guide</b><small>Name, the 9 sections to tick with Select All, settings, then the two custom-date runs — about 10 minutes, once.</small></span>
      <Icon name="arrow-right" />
    </a>
    <details class="ai">
      <summary><Icon name="sparkle" size={18} />Alternative: let IBKR's <b>Configure with AI</b> pick the sections</summary>
      <p class="muted">Performance &amp; Reports → Flex Queries → Configure with AI. Paste this one prompt and click Generate Flex Query — each prompt builds a whole new query, so don't send a second.</p>
      <div class="prompt">
        <div class="prompt-head"><b>Prompt · {PROMPT.length}/200</b><CopyButton value={PROMPT} label="prompt" /></div>
        <p>{PROMPT}</p>
      </div>
      <div class="callout warn">
        <Icon name="warn" />
        <div>
          <b>Then click Edit Manually: rename the query and press Select All in every section.</b>
          <p>Check <b>Query Name</b> is IndiaTax; if the AI chose a name with commas or “&amp;”, change it — IBKR rejects those. Select All adds <b>Open Date Time</b>, each lot's purchase date, which the AI leaves out. Also check: format XML, Trades with Closed Lots, Open Positions at Lot level.</p>
        </div>
      </div>
    </details>
  </section>

  <section class="card">
    <div class="card-head">
      <div>
        <h2><span class="num-step">3</span>Add your two files</h2>
        <p>One for each period. Drop a file on either slot — the tool reads its dates and fills whichever period it covers.</p>
      </div>
      {#if !app.data}<button class="link-btn" onclick={() => app.loadSample()}>Use sample data</button>{/if}
    </div>
    <input bind:this={input} type="file" accept=".xml,text/xml,application/xml" multiple hidden onchange={(e) => addTo(pickSlot, e.currentTarget.files)} />

    <div class="slots">
      {#each slots as sl}
        {@const st = slotState(sl)}
        {@const files = filesFor(sl.from, sl.to)}
        <div
          class="slot {st.tone}"
          class:dragging={dragKey === sl.key}
          role="group"
          aria-label={`${sl.title}: ${st.label}`}
          ondragover={(e) => {
            e.preventDefault();
            dragKey = sl.key;
          }}
          ondragleave={() => (dragKey = '')}
          ondrop={(e) => {
            e.preventDefault();
            dragKey = '';
            addTo(sl.key, e.dataTransfer?.files ?? null);
          }}
        >
          <div class="slot-head">
            <span class="slot-icon"><Icon name={st.icon} size={20} /></span>
            <div>
              <b>{sl.title}</b>
              <span class="faint">{sl.purpose}</span>
            </div>
            <span class="badge {st.tone === 'ok' ? 'success' : st.tone === 'bad' ? 'danger' : st.tone === 'na' ? '' : 'accent'}">{st.label}</span>
          </div>
          <div class="slot-dates num">
            {#if sl.p?.notApplicable}
              <span>Period</span><b>{date(sl.from)} → {date(sl.to)}</b>
            {:else}
              <span>Needs</span><b>{date(sl.p?.needFrom ?? sl.from)} → {sl.p ? date(sl.p.needTo) : sl.to >= today ? 'latest available date' : date(sl.to)}</b>
            {/if}
          </div>
          {#if app.data}
            <div class="cov-bar" aria-hidden="true">
              {#each segments(sl.from, sl.to) as g}<span style:left={`${g.left}%`} style:width={`${g.width}%`}></span>{/each}
            </div>
            <div class="cov-axis num faint"><span>{date(sl.from)}</span><span>{date(sl.to)}</span></div>
          {/if}
          <p class="slot-note">{st.note}</p>
          {#if files.length}
            <div class="slot-files">{#each files as f}<span class="chip"><Icon name="file-table" size={14} />{f}</span>{/each}</div>
          {/if}
          {#if slotWarn[sl.key]}<p class="slot-warn" role="alert"><Icon name="warn" size={16} /><span>{slotWarn[sl.key]}</span></p>{/if}
          <button
            class="btn sm slot-btn"
            class:primary={!app.data}
            onclick={() => {
              pickSlot = sl.key;
              input.click();
            }}
          ><Icon name="upload" size={16} />{files.length ? 'Add another file' : 'Choose file'}</button>
        </div>
      {/each}
    </div>

    {#if app.busy}<p class="muted status" role="status">Reading files…</p>{/if}

    {#if app.files.length}
      <h3 class="sub-h">Files</h3>
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
                  {#each st as s}<span class="badge">{s.accountId} · {date(s.fromDate)} → {date(s.toDate)}</span>{/each}
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
      <h3 class="sub-h">Sections found</h3>
      <div class="checks">
        {#each [...required, ...optional] as c}
          {@const bad = c.missingCritical.length > 0}
          <div class="check" class:missing={!c.present && !c.coveredBy} class:req={c.required} class:bad class:covered={c.coveredBy}>
            <span class="ck-icon" class:soft={c.present && !bad && c.missingRecommended.length > 0}><Icon name={bad ? 'error' : c.present || c.coveredBy ? (c.missingRecommended.length ? 'warn' : 'check-circle') : c.required ? 'error' : 'step-todo'} size={18} /></span>
            <div>
              <b>{c.label}</b>
              <span class="faint">{c.coveredBy ? `Not needed — ${c.coveredBy} covers it` : `${c.purpose}${!c.present && !c.required ? ' — optional, improves accuracy' : ''}`}</span>
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
        <small>Only needed if you have foreign income (dividends, interest or capital gains) — for Schedules FSI and TR. IBKR doesn't report it; without a US TIN, use your passport number.</small>
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
  .guide-cta { display: grid; grid-template-columns: 40px 1fr auto; gap: 12px; align-items: center; margin-top: 14px; padding: 12px 14px; border: 1px solid var(--accent-line); background: var(--accent-soft); border-radius: var(--r-md); color: var(--text); text-decoration: none; }
  .guide-cta:hover { border-color: var(--accent); }
  .guide-cta span:nth-child(2) { display: grid; gap: 2px; font-size: var(--fs-ui); }
  .guide-cta small { color: var(--text-2); font-size: 13px; }
  .gc-icon { display: grid; place-items: center; width: 40px; height: 40px; border-radius: var(--r-md); background: var(--surface); color: var(--accent); }
  .guide-cta > :global(.icon) { color: var(--accent); }
  .ai { margin-top: 14px; border: 1px solid var(--border); border-radius: var(--r-md); padding: 0 14px; }
  .ai summary { display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 12px 0; font-size: var(--fs-ui); list-style: none; }
  .ai summary::-webkit-details-marker { display: none; }
  .ai summary :global(.icon) { color: var(--accent); }
  .ai[open] { padding-bottom: 12px; }
  .ai .muted { font-size: 13px; }

  .slots { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
  .slot { display: grid; gap: 10px; align-content: start; padding: 16px; border: 1.5px dashed var(--border-strong); border-radius: var(--r-lg); background: var(--surface); transition: background var(--dur-1), border-color var(--dur-1); }
  .slot.dragging { border-style: solid; border-color: var(--accent); background: var(--accent-soft); }
  .slot.ok { border-style: solid; border-color: var(--success); }
  .slot.prov { border-style: solid; border-color: var(--accent-line); }
  .slot.bad { border-style: solid; border-color: var(--danger); background: var(--danger-soft); }
  .slot.na { border-style: solid; border-color: var(--border); background: var(--surface-sunken); }
  .slot-head { display: grid; grid-template-columns: 36px 1fr auto; gap: 10px; align-items: center; }
  .slot-head > div { display: grid; font-size: var(--fs-ui); }
  .slot-head .faint { font-size: var(--fs-caption); }
  .slot-icon { display: grid; place-items: center; width: 36px; height: 36px; border-radius: var(--r-md); background: var(--surface-sunken); color: var(--text-2); }
  .slot.ok .slot-icon { background: var(--success-soft); color: var(--success); }
  .slot.prov .slot-icon { background: var(--accent-soft); color: var(--accent); }
  .slot.bad .slot-icon { background: var(--surface); color: var(--danger); }
  .slot-dates { display: flex; gap: 8px; align-items: baseline; font-size: var(--fs-ui); }
  .slot-dates span { color: var(--text-3); font-size: var(--fs-caption); text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }
  .slot .cov-bar { background: var(--surface-sunken); }
  .slot.bad .cov-bar { background: var(--surface); }
  .cov-axis { display: flex; justify-content: space-between; font-size: 11px; margin-top: -6px; }
  .slot-note { font-size: 13px; color: var(--text-2); }
  .slot-files { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; padding: 2px 8px; border-radius: var(--r-pill); background: var(--surface-sunken); font-family: var(--font-mono); }
  .slot-btn { justify-self: start; }
  .slot-warn { display: flex; gap: 6px; align-items: flex-start; font-size: 13px; color: var(--danger-text); }
  .slot-warn :global(.icon) { flex: none; margin-top: 1px; }
  .one-file { display: flex; gap: 8px; align-items: flex-start; margin-top: 12px; font-size: 13px; color: var(--text-2); }
  .one-file :global(.icon) { color: var(--info); flex: none; margin-top: 2px; }
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
  .cov-text { font-size: 13px; color: var(--text-2); margin: -4px 0 12px; }
  .cov-row { display: grid; grid-template-columns: 220px 1fr auto; gap: 14px; align-items: center; }
  .cov-label { display: grid; font-size: 13px; }
  .cov-label .faint { font-size: var(--fs-caption); }
  .cov-bar { position: relative; height: 12px; border-radius: var(--r-pill); background: var(--danger-soft); overflow: hidden; }
  .cov-bar span { position: absolute; top: 0; bottom: 0; background: var(--success); }
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
  .check.covered .ck-icon { color: var(--text-3); }
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
