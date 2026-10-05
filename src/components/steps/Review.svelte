<script lang="ts">
  import Icon from '../ui/Icon.svelte';
  import { app } from '../state.svelte';
  import { BASE, date } from '../../lib/ui/format';
  import { entityFor } from '../../lib/assets';

  const r = $derived(app.report!);
  const errors = $derived(r.warnings.filter((w) => w.level === 'error' && !w.message.includes('enter it manually')));
  const warns = $derived(r.warnings.filter((w) => w.level === 'warn' && w.area !== 'Schedule FSI'));
  const infos = $derived(r.warnings.filter((w) => w.level === 'info'));
  const entities = $derived(
    [...new Map(r.fa.a3.map((row) => [row.lot.symbol, row])).values()].map((row) => ({
      symbol: row.lot.symbol,
      ibkr: row.entityName,
      ent: entityFor(row.lot.symbol, row.isin, row.entityName, app.entities),
    })),
  );
  const needsInput = $derived(app.needsInput);
  const blocking = $derived(app.mustFix);

  const CHOICES = [
    {
      key: 'cgFxMethod' as const,
      title: 'Capital gains: how to convert to rupees',
      options: [
        { v: 'split', l: 'Convert sale value and cost separately', d: 'Sale at the SBI rate for the month before the sale; cost at the rate for the month before purchase. Common practice; captures the rupee’s fall as part of the gain.' },
        { v: 'gain', l: 'Convert the dollar gain once', d: 'Gain worked out in dollars, converted at the SBI rate for the month before the sale. A literal reading of the conversion rule.' },
      ],
    },
    {
      key: 'faIncomeRate' as const,
      title: 'Schedule FA: rate for dividends and sale proceeds',
      options: [
        { v: 'txn', l: 'Rate on each transaction date', d: 'Each credit converted on the day it happened.' },
        { v: 'cyEnd', l: 'Rate on 31 December', d: 'All amounts converted at the closing date of the calendar year.' },
      ],
    },
    {
      key: 'interestRate' as const,
      title: 'Broker interest: conversion date',
      options: [
        { v: 'fyEnd', l: 'Rate on 31 March', d: 'The conversion rule for “other income”: the last day of the financial year.' },
        { v: 'monthly', l: 'Month-end before each credit', d: 'Treated like dividends. Many filers use this.' },
      ],
    },
  ];
</script>

<header class="page-head">
  <h1>Review before you file</h1>
  <p class="muted">Fix anything blocking, fill in what IBKR can't provide, and confirm the method choices.</p>
</header>

<div class="summary">
  <div class="sum {blocking ? 'danger' : 'success'}"><Icon name={blocking ? 'error' : 'check-circle'} /><b class="num">{blocking}</b><span>must fix</span></div>
  <div class="sum {needsInput ? 'warn' : 'success'}"><Icon name={needsInput ? 'building' : 'check-circle'} /><b class="num">{needsInput}</b><span>need your input</span></div>
  <div class="sum neutral"><Icon name="warn" /><b class="num">{warns.length}</b><span>to check</span></div>
  <div class="sum neutral"><Icon name="info" /><b class="num">{infos.length}</b><span>notes</span></div>
</div>

{#if !blocking && !needsInput}
  <div class="callout success"><Icon name="check-circle" /><div><b>Ready to file.</b><p>Nothing blocking. Skim the checks below, then go to “File your return”.</p></div></div>
{/if}

{#if blocking}
  <section class="group">
    <h2 class="g-title danger"><Icon name="error" />Must fix</h2>
    <ul class="issues">
      {#each errors as w}
        <li class="issue danger"><div><span class="area">{w.area}</span><p>{w.message}</p></div></li>
      {/each}
      {#if r.missingRates.length}
        <li class="issue danger">
          <div>
            <span class="area">Exchange rates</span>
            <p>SBI rates are archived from January 2020. Enter the SBI TT buying rate for these dates from SBI's rate card (your bank or CA can provide it).</p>
            <div class="rate-grid">
              {#each r.missingRates as m}
                <label class="field">
                  <span>{m.currency} on {date(m.date)}</span>
                  <input
                    type="number"
                    inputmode="decimal"
                    step="0.01"
                    placeholder="INR per {m.currency}"
                    value={app.rateOverrides[`${m.currency}|${m.date}`] ?? ''}
                    onchange={(e) => (app.rateOverrides = { ...app.rateOverrides, [`${m.currency}|${m.date}`]: e.currentTarget.value })}
                  />
                </label>
              {/each}
            </div>
          </div>
        </li>
      {/if}
    </ul>
  </section>
{/if}

{#if needsInput}
  <section class="group">
    <h2 class="g-title warn"><Icon name="building" />Needs your input</h2>
    <ul class="issues">
      {#if app.needsTin}
        <li class="issue warn">
          <div>
            <span class="area">Schedules FSI and TR</span>
            <p>You have foreign income this year, so Schedules FSI and TR need a Taxpayer Identification Number for the foreign country. IBKR doesn't report one and Indian residents usually have no US TIN (your W-8BEN uses your PAN) — use your passport number.</p>
            <label class="field narrow"><span>Foreign TIN or passport number</span><input bind:value={app.settings.tin} autocomplete="off" /></label>
          </div>
        </li>
      {/if}
      {#if app.missingAddresses.length}
        <li class="issue warn">
          <div>
            <span class="area">Schedule FA · A3</span>
            <p>No address yet for {app.missingAddresses.join(', ')} — they aren't in the address book. Fill them in under <button class="link-btn" onclick={() => document.getElementById('companies')?.scrollIntoView({ behavior: 'smooth' })}>Companies and funds</button> below.</p>
          </div>
        </li>
      {/if}
    </ul>
  </section>
{/if}

<section class="group" id="companies">
  <h2 class="g-title" class:warn={app.missingAddresses.length}><Icon name="building" />Companies and funds</h2>
  <p class="muted g-sub">
    Schedule FA needs each holding's legal name, registered address and ZIP. Known assets are filled from the
    <a href={`${BASE}assets/`}>address book</a> of public issuer records; type in any field to override it. Saved in this browser.
  </p>
  <div class="addr card">
    <div class="addr-row head" aria-hidden="true"><span>Symbol</span><span>Legal name</span><span>Registered address</span><span>ZIP</span></div>
    {#each entities as e}
      <div class="addr-row">
        <div class="addr-name">
          <b>{e.symbol}</b>
          <span class="badge {e.ent.source === 'missing' ? 'danger' : e.ent.source === 'address book' ? 'success' : 'accent'}">
            {e.ent.source === 'missing' ? 'Missing' : e.ent.source === 'address book' ? 'Address book' : 'Your entry'}
          </span>
        </div>
        <input aria-label={`${e.symbol} legal name`} placeholder={e.ent.record?.name ?? e.ibkr} value={app.entities[e.symbol]?.name ?? ''} onchange={(ev) => app.setEntity(e.symbol, 'name', ev.currentTarget.value)} />
        <input aria-label={`${e.symbol} address`} placeholder={e.ent.record?.address ?? 'Registered address'} value={app.entities[e.symbol]?.address ?? ''} onchange={(ev) => app.setEntity(e.symbol, 'address', ev.currentTarget.value)} />
        <input aria-label={`${e.symbol} ZIP code`} class="zip" placeholder={e.ent.record?.zip ?? 'ZIP'} value={app.entities[e.symbol]?.zip ?? ''} onchange={(ev) => app.setEntity(e.symbol, 'zip', ev.currentTarget.value)} />
      </div>
    {/each}
  </div>
</section>

<section class="group">
  <h2 class="g-title"><Icon name="exchange" />Method choices</h2>
  <p class="muted g-sub">The law leaves room on these points. Pick one, note it for your CA, and use it consistently every year.</p>
  <div class="choices">
    {#each CHOICES as c}
      <fieldset class="choice card">
        <legend>{c.title}</legend>
        {#each c.options as o}
          <label class="opt" class:on={app.settings[c.key] === o.v}>
            <input type="radio" name={c.key} value={o.v} bind:group={app.settings[c.key]} />
            <span><b>{o.l}</b><small>{o.d}</small></span>
          </label>
        {/each}
      </fieldset>
    {/each}
  </div>
</section>

{#if warns.length}
  <section class="group">
    <h2 class="g-title warn"><Icon name="warn" />Should check</h2>
    <ul class="issues">
      {#each warns as w}<li class="issue warn"><div><span class="area">{w.area}</span><p>{w.message}</p></div></li>{/each}
    </ul>
  </section>
{/if}

{#if infos.length}
  <details class="group info-group">
    <summary class="g-title info"><Icon name="info" />For your information ({infos.length})</summary>
    <ul class="issues">
      {#each infos as w}<li class="issue info"><div><span class="area">{w.area}</span><p>{w.message}</p></div></li>{/each}
    </ul>
  </details>
{/if}

<style>
  .page-head { margin-bottom: 20px; }
  .page-head p { margin-top: 6px; }
  .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 20px; }
  .sum { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-radius: var(--r-lg); border: 1px solid var(--border); background: var(--surface); font-size: 13px; color: var(--text-2); }
  .sum b { font-size: 20px; color: var(--text); }
  .sum.danger :global(.icon) { color: var(--danger); }
  .sum.warn :global(.icon) { color: var(--warn); }
  .sum.success :global(.icon) { color: var(--success); }
  .sum.neutral :global(.icon) { color: var(--text-3); }
  .group { margin-top: 28px; }
  .g-title { display: flex; align-items: center; gap: 8px; font-size: var(--fs-h3); margin-bottom: 12px; }
  .g-title.danger :global(.icon) { color: var(--danger); }
  .g-title.warn :global(.icon) { color: var(--warn); }
  .g-sub a { color: var(--accent); }
  .g-title.info :global(.icon) { color: var(--info); }
  .g-sub { margin: -6px 0 12px; font-size: var(--fs-ui); }
  .info-group summary { cursor: pointer; list-style: none; }
  .issues { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
  .issue { display: flex; padding: 14px 16px; border: 1px solid var(--border); border-left: 3px solid var(--info); border-radius: var(--r-md); background: var(--surface); }
  .issue.danger { border-left-color: var(--danger); }
  .issue.warn { border-left-color: var(--warn); }
  .issue > div { display: grid; gap: 6px; flex: 1; min-width: 0; }
  .area { font-size: var(--fs-caption); font-weight: 600; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.04em; }
  .issue p { font-size: var(--fs-ui); color: var(--text); }
  .issue p a { color: var(--accent); }
  .rate-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; margin-top: 6px; }
  .narrow { max-width: 360px; margin-top: 6px; }
  .addr { display: grid; gap: 8px; }
  .addr-row { display: grid; grid-template-columns: 150px 1fr 1.4fr 100px; gap: 8px; align-items: center; }
  .addr-row.head { font-size: var(--fs-caption); color: var(--text-3); font-weight: 600; }
  .addr-name { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 13px; min-width: 0; }
  .addr-name .faint { font-size: var(--fs-caption); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
  .choice { margin: 0; display: grid; gap: 8px; padding: 16px; }
  .choice legend { float: left; width: 100%; font-weight: 600; font-size: var(--fs-ui); margin-bottom: 4px; }
  .opt { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--r-md); cursor: pointer; }
  .opt.on { border-color: var(--accent); background: var(--accent-soft); }
  .opt input { width: 16px; height: 16px; margin: 2px 0 0; accent-color: var(--accent); flex: none; }
  .opt span { display: grid; gap: 2px; font-size: 13px; }
  .opt small { color: var(--text-2); font-size: var(--fs-caption); line-height: 1.45; }
  @media (max-width: 640px) {
    .addr-row { grid-template-columns: 1fr 96px; }
    .addr-row.head { display: none; }
    .addr-name, .addr-row input:not(.zip) { grid-column: 1 / -1; }
  }
</style>
