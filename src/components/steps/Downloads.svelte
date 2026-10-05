<script lang="ts">
  import Icon from '../ui/Icon.svelte';
  import { app } from '../state.svelte';
  import { buildPack, byteSize, packPrefix, zipPack, type PackCategory, type PackFile } from '../../lib/export/pack';
  import { download } from '../../lib/ui/format';

  const r = $derived(app.report!);
  const files = $derived(buildPack(r, app.entities));
  const total = $derived(files.reduce((s, f) => s + byteSize(f.content), 0));
  let filter = $state<'all' | PackCategory>('all');
  let preview = $state<PackFile | null>(null);
  let dialog: HTMLDialogElement | undefined = $state();
  let zipping = $state(false);
  let checks = $state<Record<number, boolean>>({});

  const GROUPS: { id: PackCategory; title: string; sub: string }[] = [
    { id: 'schedule', title: 'Schedules', sub: 'One file per screen of the return, in filing order and in the portal’s column order.' },
    { id: 'working', title: 'Working papers', sub: 'Every lot, payment and deduction behind the totals — what your CA will check.' },
    { id: 'reference', title: 'Reference', sub: 'The README and the appendix of every exchange rate used.' },
  ];
  const count = (c: PackCategory) => files.filter((f) => f.category === c).length;
  const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`);
  const fmt = (name: string) => (name.endsWith('.csv') ? 'CSV' : 'TXT');
  const short = (name: string) => name.replace(/^[^_]+_/, '');

  async function downloadAll() {
    zipping = true;
    try {
      const blob = await zipPack(files);
      download(`${packPrefix(r)}_ibkr_india_tax_${r.account.accountId}.zip`, blob);
      app.downloaded = { ...app.downloaded, __zip: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) };
    } finally {
      zipping = false;
    }
  }

  function downloadOne(f: PackFile) {
    download(f.name, new Blob([f.content], { type: f.name.endsWith('.csv') ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8' }));
    app.downloaded = { ...app.downloaded, [f.name]: 'yes' };
  }

  function open(f: PackFile) {
    preview = f;
    dialog?.showModal();
  }

  const CHECKS = $derived([
    `${r.year.law.ftcForm} filed and acknowledged before the return`,
    'Schedule CG: US shares under A5 / B8, not listed equity or 112A',
    'Schedule OS dividends are gross; FSI income matches CG and OS',
    `Schedule FA covers calendar year ${r.year.cyStart.slice(0, 4)} — including lots sold during the year`,
    'Foreign-assets question in Part B-TTI answered “Yes”',
    'Tax collected at source on remittances claimed (from Form 26AS)',
  ]);
</script>

<header class="page-head">
  <h1>Downloads</h1>
  <p class="muted"><Icon name="shield" size={16} />Generated in this browser tab. Nothing was uploaded.</p>
</header>

<section class="hero-pack">
  <span class="hp-icon"><Icon name="archive" size={28} /></span>
  <div class="hp-main">
    <h2>Your filing pack — {r.year.label}</h2>
    <p class="num">{files.length} files · {kb(total)} · account {r.account.accountId}</p>
    <ul class="inside">
      <li><Icon name="check" size={14} />{count('schedule')} schedule files</li>
      <li><Icon name="check" size={14} />{count('working')} working papers</li>
      <li><Icon name="check" size={14} />Exchange-rate appendix</li>
      <li><Icon name="check" size={14} />README</li>
    </ul>
  </div>
  <div class="hp-act">
    <button class="btn primary lg" onclick={downloadAll} disabled={zipping} aria-busy={zipping}>
      <Icon name="download" />{zipping ? 'Building ZIP…' : 'Download ZIP'}
    </button>
    {#if app.downloaded.__zip}<span class="badge success"><Icon name="check" size={12} />Downloaded {app.downloaded.__zip}</span>{/if}
  </div>
</section>

<div class="seg filters" role="tablist" aria-label="Filter files">
  {#each [['all', 'All', files.length], ['schedule', 'Schedules', count('schedule')], ['working', 'Working papers', count('working')], ['reference', 'Reference', count('reference')]] as [id, label, n]}
    <button role="tab" aria-selected={filter === id} class:on={filter === id} onclick={() => (filter = id as typeof filter)}>{label} <span class="num faint">{n}</span></button>
  {/each}
</div>

{#each GROUPS.filter((g) => filter === 'all' || filter === g.id) as g}
  <section class="group">
    <div class="g-head"><h3>{g.title}</h3><p class="muted">{g.sub}</p></div>
    <ul class="docs">
      {#each files.filter((f) => f.category === g.id) as f}
        <li class="doc">
          <span class="d-icon"><Icon name={f.name.endsWith('.csv') ? 'file-table' : 'file-text'} size={22} /></span>
          <div class="d-main">
            <span class="d-name mono">{short(f.name)}</span>
            <span class="d-title">{f.title}</span>
            <span class="d-desc">{f.description}</span>
            <span class="d-tags">
              {#each f.usedFor as u}<span class="badge">{u}</span>{/each}
            </span>
          </div>
          <div class="d-meta">
            <span class="badge format">{fmt(f.name)}</span>
            <span class="num faint">{kb(byteSize(f.content))}{f.table ? ` · ${f.rows} row${f.rows === 1 ? '' : 's'}` : ''}</span>
          </div>
          <div class="d-act">
            <button class="btn sm" onclick={() => open(f)}><Icon name="eye" size={16} />Preview</button>
            <button class="btn sm" class:success-state={app.downloaded[f.name]} onclick={() => downloadOne(f)}>
              <Icon name={app.downloaded[f.name] ? 'check' : 'download'} size={16} />{app.downloaded[f.name] ? 'Saved' : 'Download'}
            </button>
          </div>
        </li>
      {/each}
    </ul>
  </section>
{/each}

<section class="card checklist">
  <div class="card-head"><div><h3>Before you submit</h3><p>Tick these off as you go. Not saved.</p></div></div>
  {#each CHECKS as c, i}
    <label class="ck" class:on={checks[i]}><input type="checkbox" bind:checked={checks[i]} /><span>{c}</span></label>
  {/each}
</section>

<div class="danger-zone">
  <div><b>Finished?</b><p class="muted">Clear everything from this tab. Settings and addresses stay in this browser until you clear site data.</p></div>
  <button class="btn danger" onclick={() => app.clear()}><Icon name="trash" size={18} />Clear data</button>
</div>

<dialog bind:this={dialog} class="preview" onclose={() => (preview = null)}>
  {#if preview}
    <header class="pv-head">
      <div><span class="mono">{short(preview.name)}</span><p class="faint">{preview.title}</p></div>
      <button class="btn ghost sm icon-only" aria-label="Close preview" onclick={() => dialog?.close()}><Icon name="x" /></button>
    </header>
    <div class="pv-body">
      {#if preview.table}
        {#if preview.rows === 0}
          <p class="muted pv-empty">No rows — nothing to report in this file for the year.</p>
        {:else}
          <div class="table-wrap">
            <table class="data">
              <thead><tr>{#each preview.table[0] as h}<th>{h}</th>{/each}</tr></thead>
              <tbody>
                {#each preview.table.slice(1, 51) as row}
                  <tr>{#each row as c}<td class:r={typeof c === 'number'}>{c ?? ''}</td>{/each}</tr>
                {/each}
              </tbody>
            </table>
          </div>
          {#if preview.rows > 50}<p class="faint pv-more">Showing 50 of {preview.rows} rows.</p>{/if}
        {/if}
      {:else}
        <pre>{preview.content}</pre>
      {/if}
    </div>
    <footer class="pv-foot">
      <button class="btn" onclick={() => dialog?.close()}>Close</button>
      <button class="btn primary" onclick={() => preview && downloadOne(preview)}><Icon name="download" size={18} />Download</button>
    </footer>
  {/if}
</dialog>

<style>
  .page-head { margin-bottom: 20px; }
  .page-head p { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
  .page-head :global(.icon) { color: var(--success); }

  .hero-pack { display: grid; grid-template-columns: auto 1fr auto; gap: 20px; align-items: center; padding: 24px; border-radius: var(--r-xl); background: var(--accent-soft); border: 1px solid var(--accent-line); }
  .hp-icon { display: grid; place-items: center; width: 56px; height: 56px; border-radius: var(--r-lg); background: var(--surface); color: var(--accent); box-shadow: var(--sh-1); }
  .hp-main h2 { font-size: var(--fs-h3); }
  .hp-main > p { font-size: 13px; color: var(--text-2); margin-top: 2px; }
  .inside { list-style: none; padding: 0; margin: 10px 0 0; display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 13px; color: var(--text-2); }
  .inside li { display: flex; align-items: center; gap: 4px; }
  .inside :global(.icon) { color: var(--success); }
  .hp-act { display: grid; justify-items: end; gap: 8px; }

  .filters { display: inline-flex; margin: 24px 0 4px; }
  .seg { background: var(--surface-sunken); border-radius: var(--r-md); padding: 3px; gap: 2px; max-width: 100%; overflow-x: auto; }
  .seg button { border: 0; background: none; padding: 7px 12px; border-radius: var(--r-sm); font: 500 13px/1 var(--font-sans); color: var(--text-2); cursor: pointer; white-space: nowrap; }
  .seg button.on { background: var(--surface); color: var(--text); box-shadow: var(--sh-1), 0 0 0 1px var(--border); }

  .group { margin-top: 20px; }
  .g-head { margin-bottom: 10px; }
  .g-head p { font-size: 13px; margin-top: 2px; }
  .docs { list-style: none; padding: 0; margin: 0; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg); box-shadow: var(--sh-1); overflow: hidden; }
  .doc { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto auto; gap: 16px; align-items: center; padding: 14px 16px; border-bottom: 1px solid var(--border); }
  .doc:last-child { border-bottom: 0; }
  .d-icon { display: grid; place-items: center; width: 44px; height: 44px; border-radius: var(--r-md); background: var(--surface-sunken); color: var(--text-2); }
  .d-main { display: grid; gap: 2px; min-width: 0; }
  .d-name { font-size: 12.5px; color: var(--text-3); overflow-wrap: anywhere; }
  .d-title { font-weight: 600; font-size: var(--fs-ui); }
  .d-desc { font-size: 13px; color: var(--text-2); }
  .d-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
  .d-meta { display: grid; justify-items: end; gap: 4px; font-size: var(--fs-caption); white-space: nowrap; }
  .d-act { display: flex; gap: 6px; }

  .checklist { margin-top: 28px; }
  .ck { display: flex; gap: 10px; align-items: flex-start; padding: 10px 0; border-bottom: 1px solid var(--border); font-size: var(--fs-ui); cursor: pointer; }
  .ck:last-child { border-bottom: 0; }
  .ck input { width: 18px; height: 18px; margin: 1px 0 0; accent-color: var(--accent); flex: none; }
  .ck.on span { color: var(--text-2); }

  .danger-zone { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-top: 20px; padding: 16px 20px; border: 1px solid var(--border); border-radius: var(--r-lg); }
  .danger-zone p { font-size: 13px; }

  .preview { width: min(1000px, calc(100vw - 32px)); max-height: calc(100dvh - 48px); padding: 0; border: 1px solid var(--border); border-radius: var(--r-xl); background: var(--surface); color: var(--text); box-shadow: var(--sh-3); }
  .preview[open] { display: flex; flex-direction: column; }
  .preview::backdrop { background: rgb(0 0 0 / 0.45); }
  .pv-head { display: flex; justify-content: space-between; gap: 12px; padding: 14px 18px; border-bottom: 1px solid var(--border); }
  .pv-head p { font-size: 13px; }
  .pv-body { padding: 16px 18px; overflow: auto; flex: 1; }
  .pv-body .table-wrap { max-height: none; }
  .pv-body td { white-space: nowrap; }
  .pv-body pre { margin: 0; font: 12.5px/1.6 var(--font-mono); white-space: pre-wrap; color: var(--text-2); }
  .pv-empty, .pv-more { font-size: 13px; margin-top: 10px; }
  .pv-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 18px; border-top: 1px solid var(--border); }

  @media (max-width: 760px) {
    .hero-pack { grid-template-columns: 1fr; }
    .hp-act { justify-items: stretch; }
    .doc { grid-template-columns: 40px minmax(0, 1fr); }
    .d-meta { grid-column: 2; justify-items: start; grid-auto-flow: column; justify-content: start; gap: 8px; }
    .d-act { grid-column: 1 / -1; }
    .d-act .btn { flex: 1; }
    .danger-zone { flex-direction: column; align-items: stretch; }
  }
</style>
