<script lang="ts">
  import Icon from '../ui/Icon.svelte';
  import ScheduleHead from '../ui/ScheduleHead.svelte';
  import FieldGroup from '../ui/FieldGroup.svelte';
  import PortalField from '../ui/PortalField.svelte';
  import EmptyState from '../ui/EmptyState.svelte';
  import { app } from '../state.svelte';
  import { QUARTER_LABELS } from '../../lib/tax/years';
  import { date, inr, money, num, raw } from '../../lib/ui/format';
  import type { CgTotals } from '../../lib/tax/cg';

  const r = $derived(app.report!);
  const cg = $derived(r.cg);
  const ty = $derived(r.year);
  let open = $state<Record<number, boolean>>({});
  const L = $derived(r.losses);
  const setOffApplied = $derived(L.cyla.length + L.bfla.length > 0);
  const ayLabel = (ay: number) => `AY ${ay}-${String((ay + 1) % 100).padStart(2, '0')}`;
  const pastYears = $derived(Array.from({ length: 8 }, (_, i) => ty.ayStart - 1 - i));

  function addLoss() {
    const used = new Set(app.settings.broughtForward.map((b) => b.ay));
    const ay = pastYears.find((y) => !used.has(y)) ?? pastYears[0];
    app.settings.broughtForward = [...app.settings.broughtForward, { ay, stcl: '', ltcl: '' }];
  }
  function setLoss(i: number, field: 'ay' | 'stcl' | 'ltcl', value: string) {
    app.settings.broughtForward = app.settings.broughtForward.map((b, j) => (j === i ? { ...b, [field]: field === 'ay' ? Number(value) : value.replace(/,/g, '') } : b));
  }
  function removeLoss(i: number) {
    app.settings.broughtForward = app.settings.broughtForward.filter((_, j) => j !== i);
  }

  const sections = $derived(
    [
      { key: 'a5', title: 'A5 · Short-term — from sale of assets other than at A1 or A2 or A3 or A4 above', sub: 'Held 24 months or less · taxed at your slab rate', t: cg.stcg, n: cg.rows.filter((x) => x.term === 'STCG').length },
      { key: 'b8', title: 'B8 · Long-term — from sale of assets where B1 to B7 above are not applicable', sub: `Held more than 24 months · 12.5% without indexation (${ty.law.ltcgSection})`, t: cg.ltcg, n: cg.rows.filter((x) => x.term === 'LTCG').length },
    ].filter((s) => s.n > 0),
  );
  const fields = (t: CgTotals) => [
    { k: 'aii', label: 'a(ii) Full value of consideration in respect of securities other than unquoted shares', v: t.saleInr, hint: 'Sum of sale values' },
    { k: 'bi', label: 'b(i) Cost of acquisition without indexation', v: t.costInr, hint: 'Purchase price plus buy commission' },
    { k: 'bii', label: 'b(ii) Cost of improvement without indexation', v: undefined, hint: 'Not applicable to shares' },
    { k: 'biii', label: 'b(iii) Expenditure wholly and exclusively in connection with transfer', v: t.expensesInr, hint: 'Sale commissions' },
    { k: 'c', label: 'c Balance', v: t.gainInr, hint: 'Portal computes this — check it matches' },
  ];
  const ids = $derived(sections.flatMap((s) => [...fields(s.t).filter((f) => f.v).map((f) => `cg:${s.key}:${f.k}`), ...QUARTER_LABELS.map((_, i) => `cg:${s.key}:q${i}`)]));
</script>

<ScheduleHead title="Schedule CG — Capital gains" path="ITR-2 › Schedule Capital Gains" period={`FY ${date(ty.fyStart)} – ${date(ty.fyEnd)}`} {ids}>
  <div class="callout">
    <Icon name="info" />
    <div>
      <b>US shares go under “other assets”, not listed equity.</b>
      <p>They aren't listed on an Indian exchange and no STT is paid, so they use A5 / B8 — never A2 or Schedule 112A — and there is no ₹1.25 lakh exemption. Don't use the DTAA-rate rows; residents claim treaty relief through Schedules FSI and TR.</p>
    </div>
  </div>
</ScheduleHead>

{#if !cg.rows.length}
  <EmptyState title="No sales this year" text="Nothing was sold in this financial year, so Schedule CG has no foreign entries." />
{:else}
  {#each sections as s}
    <FieldGroup title={s.title} sub={`${s.sub} · ${s.n} sold lot${s.n === 1 ? '' : 's'}`}>
      {#each fields(s.t) as f}
        <PortalField
          id={`cg:${s.key}:${f.k}`}
          label={f.label}
          display={f.v ? inr(f.v) : '0'}
          copy={f.v ? raw(f.v) : undefined}
          hint={f.hint}
          tone={f.v ? undefined : 'muted'}
        />
      {/each}
    </FieldGroup>
    <FieldGroup title={`Table F — ${s.key === 'a5' ? 'Short-term capital gains taxable at applicable rates' : 'Long-term capital gains taxable at the rate of 12.5%'}`} sub="Information about accrual/receipt of capital gain · by date of sale{setOffApplied ? ' · after setting off losses' : ''}">
      {#each QUARTER_LABELS as q, i}
        {@const v = (s.key === 'a5' ? r.losses.tableF.stcg : r.losses.tableF.ltcg)[i]}
        <PortalField id={`cg:${s.key}:q${i}`} label={q} display={inr(v)} copy={raw(v)} tone={v.isZero() ? 'muted' : undefined} />
      {/each}
    </FieldGroup>
  {/each}

  <div class="table-caption">
    <div>
      <h3>Working — every sold lot</h3>
      <p>Matched to the exact lot IBKR closed. Expand a row to see the rates and dates.</p>
    </div>
    <span class="badge">{r.settings.cgFxMethod === 'split' ? 'Sale and cost converted separately' : 'Gain converted at sale-month rate'}</span>
  </div>
  <div class="table-wrap">
    <table class="data">
      <thead>
        <tr><th></th><th>Symbol</th><th>Bought</th><th>Sold</th><th class="r">Qty</th><th>Term</th><th class="r">Sale value (₹)</th><th class="r">Cost (₹)</th><th class="r">Expenses (₹)</th><th class="r">Gain (₹)</th></tr>
      </thead>
      <tbody>
        {#each cg.rows as row, i}
          <tr>
            <td class="expander">
              <button class="btn ghost sm icon-only" aria-expanded={!!open[i]} aria-label={`Details for ${row.lot.symbol} sold ${row.lot.closeDate}`} onclick={() => (open = { ...open, [i]: !open[i] })}>
                <Icon name={open[i] ? 'chevron-down' : 'chevron-right'} size={16} />
              </button>
            </td>
            <td><span class="sym">{row.lot.symbol}</span>{#if row.pnlMismatch}<span class="badge warn" title="Differs from IBKR's realized P/L">check</span>{/if}<span class="sub">{row.description}</span></td>
            <td>{date(row.lot.openDate)}</td>
            <td>{date(row.lot.closeDate)}</td>
            <td class="r">{num(row.lot.quantity)}</td>
            <td><span class="badge {row.term === 'LTCG' ? 'accent' : ''}">{row.term === 'LTCG' ? 'Long' : 'Short'}</span></td>
            <td class="r">{inr(row.saleInr)}</td>
            <td class="r">{inr(row.costInr)}</td>
            <td class="r">{inr(row.expensesInr)}</td>
            <td class="r" class:neg={row.gainInr?.lt(0)}>{inr(row.gainInr)}</td>
          </tr>
          {#if open[i]}
            <tr class="detail">
              <td></td>
              <td colspan="9">
                <dl class="calc">
                  <dt>Sale</dt><dd>{money(row.lot.proceeds, row.lot.currency)} × SBI {row.saleRate?.rate.toString() ?? '—'} (card {date(row.saleRate?.rateDate)}, for month-end {date(row.saleRate?.requestedDate)}) = <b>{inr(row.saleInr)}</b></dd>
                  <dt>Cost</dt><dd>{money(row.lot.cost, row.lot.currency)} × SBI {row.costRate?.rate.toString() ?? '—'} (card {date(row.costRate?.rateDate)}) = <b>{inr(row.costInr)}</b></dd>
                  <dt>Expenses</dt><dd>{money(row.lot.commission, row.lot.currency)} commission × sale rate = <b>{inr(row.expensesInr)}</b></dd>
                  <dt>Holding</dt><dd>{date(row.lot.openDate)} → {date(row.lot.closeDate)}; long-term needs more than {row.monthsRequired} months · {row.rateNote}</dd>
                  <dt>IBKR P/L</dt><dd>{money(row.lot.realizedPnl, row.lot.currency)} (ours {money(row.gainForeign, row.lot.currency)})</dd>
                </dl>
              </td>
            </tr>
          {/if}
        {/each}
      </tbody>
      <tfoot>
        <tr>
          <td></td><td colspan="5">Total</td>
          <td class="r">{inr(cg.stcg.saleInr.add(cg.ltcg.saleInr))}</td>
          <td class="r">{inr(cg.stcg.costInr.add(cg.ltcg.costInr))}</td>
          <td class="r">{inr(cg.stcg.expensesInr.add(cg.ltcg.expensesInr))}</td>
          <td class="r">{inr(cg.stcg.gainInr.add(cg.ltcg.gainInr))}</td>
        </tr>
      </tfoot>
    </table>
  </div>
{/if}

<section class="losses card" aria-labelledby="losses-h">
  <div class="card-head">
    <div>
      <h3 id="losses-h">Losses — set-off and carry forward</h3>
      <p>Schedules CYLA, BFLA and CFL. A short-term loss can reduce any capital gain; a long-term loss only long-term gains. Unused losses carry forward for 8 years, only if the return of the year of loss was filed by the due date.</p>
    </div>
  </div>

  <div class="bf">
    <b class="bf-h">Losses brought forward from earlier years</b>
    <p class="faint">From Schedule CFL of last year's return (or load last year's year-end file on the Downloads page).</p>
    {#each app.settings.broughtForward as b, i}
      <div class="bf-row">
        <label class="field"><span>Year of loss</span>
          <select value={b.ay} onchange={(e) => setLoss(i, 'ay', e.currentTarget.value)}>
            {#each [...new Set([b.ay, ...pastYears])].sort((x, y) => y - x) as y}<option value={y}>{ayLabel(y)}</option>{/each}
          </select>
        </label>
        <label class="field"><span>Short-term loss (₹)</span><input inputmode="numeric" value={b.stcl} onchange={(e) => setLoss(i, 'stcl', e.currentTarget.value)} /></label>
        <label class="field"><span>Long-term loss (₹)</span><input inputmode="numeric" value={b.ltcl} onchange={(e) => setLoss(i, 'ltcl', e.currentTarget.value)} /></label>
        <button class="btn ghost sm icon-only" aria-label={`Remove ${ayLabel(b.ay)} loss`} onclick={() => removeLoss(i)}><Icon name="trash" size={16} /></button>
      </div>
    {/each}
    <button class="btn sm" onclick={addLoss}><Icon name="plus" size={16} />Add a year</button>
    <label class="check"><input type="checkbox" bind:checked={app.settings.filedByDueDate} /> This return is filed by the due date ({date(`${ty.ayStart}-07-31`)}) — or is a revision of one that was</label>
  </div>

  {#if setOffApplied || L.carryForward.length || L.expired.length || L.currentLossLapses}
    <div class="table-wrap">
      <table class="data">
        <thead><tr><th>Step</th><th class="r">Short-term (₹)</th><th class="r">Long-term (₹)</th></tr></thead>
        <tbody>
          <tr><td>Net gain from this year's sales</td><td class="r" class:neg={L.netStcg.lt(0)}>{inr(L.netStcg)}</td><td class="r" class:neg={L.netLtcg.lt(0)}>{inr(L.netLtcg)}</td></tr>
          {#each L.cyla as c}<tr><td>CYLA · this year's short-term loss set off</td><td class="r"></td><td class="r neg">−{inr(c.amount)}</td></tr>{/each}
          {#each L.bfla as b}<tr><td>BFLA · {b.kind === 'STCL' ? 'short' : 'long'}-term loss of {ayLabel(b.ay)}</td><td class="r neg">{b.against === 'STCG' ? `−${inr(b.amount)}` : ''}</td><td class="r neg">{b.against === 'LTCG' ? `−${inr(b.amount)}` : ''}</td></tr>{/each}
        </tbody>
        <tfoot><tr><td>Taxable after set-off</td><td class="r">{inr(L.taxableStcg)}</td><td class="r">{inr(L.taxableLtcg)}</td></tr></tfoot>
      </table>
    </div>
    {#if L.carryForward.length}
      <h4 class="cf-h">Schedule CFL — carried forward to next year</h4>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Year of loss</th><th class="r">Short-term (₹)</th><th class="r">Long-term (₹)</th><th>Usable until</th></tr></thead>
          <tbody>{#each L.carryForward as c}<tr><td>{ayLabel(c.ay)}</td><td class="r">{inr(c.stcl)}</td><td class="r">{inr(c.ltcl)}</td><td>{ayLabel(c.usableUntilAy)}</td></tr>{/each}</tbody>
        </table>
      </div>
    {/if}
    {#if L.currentLossLapses}<p class="note warn-t"><Icon name="warn" size={16} />This year's loss can't be carried forward because the return is belated (section 80). It still reduces this year's other capital gains.</p>{/if}
    {#if L.expired.length}<p class="note"><Icon name="info" size={16} />Dropped as older than 8 years: {L.expired.map((e) => ayLabel(e.ay)).join(', ')}.</p>{/if}
  {/if}
  <p class="note"><Icon name="info" size={16} />Covers your IBKR gains only. If you also have Indian capital gains or losses, the ITR utility combines them in CYLA and BFLA — use these figures as a check.</p>
</section>

<style>
  .calc { display: grid; grid-template-columns: 90px 1fr; gap: 4px 12px; margin: 0; }
  .calc dt { color: var(--text-3); }
  .calc dd { margin: 0; color: var(--text); }
  .sym + .badge { margin-left: 6px; }
  .losses { margin-top: 24px; display: grid; gap: 14px; }
  .losses .card-head { margin-bottom: 0; }
  .losses .table-wrap { max-height: none; }
  .bf { display: grid; gap: 10px; justify-items: start; }
  .bf-h { font-size: var(--fs-ui); }
  .bf > p { font-size: 13px; margin-top: -6px; }
  .bf-row { display: grid; grid-template-columns: 170px 1fr 1fr auto; gap: 10px; align-items: end; width: 100%; max-width: 640px; }
  .check { display: flex; gap: 8px; align-items: center; font-size: 13px; color: var(--text-2); }
  .check input { width: 16px; height: 16px; }
  .cf-h { font-size: var(--fs-ui); margin: 4px 0 -4px; }
  .note { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; color: var(--text-2); }
  .warn-t { color: var(--warn-text); }
  .neg { color: var(--danger-text); }
  @media (max-width: 560px) { .bf-row { grid-template-columns: 1fr 1fr; } }
</style>
