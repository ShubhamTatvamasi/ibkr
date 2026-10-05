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
    <FieldGroup title={`Table F — ${s.key === 'a5' ? 'Short-term capital gains taxable at applicable rates' : 'Long-term capital gains taxable at the rate of 12.5%'}`} sub="Information about accrual/receipt of capital gain · by date of sale">
      {#each QUARTER_LABELS as q, i}
        <PortalField id={`cg:${s.key}:q${i}`} label={q} display={inr(s.t.tableF[i])} copy={raw(s.t.tableF[i])} tone={s.t.tableF[i].isZero() ? 'muted' : undefined} />
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

<style>
  .calc { display: grid; grid-template-columns: 90px 1fr; gap: 4px 12px; margin: 0; }
  .calc dt { color: var(--text-3); }
  .calc dd { margin: 0; color: var(--text); }
  .sym + .badge { margin-left: 6px; }
</style>
