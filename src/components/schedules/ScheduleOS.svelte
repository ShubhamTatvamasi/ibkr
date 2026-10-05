<script lang="ts">
  import Icon from '../ui/Icon.svelte';
  import ScheduleHead from '../ui/ScheduleHead.svelte';
  import FieldGroup from '../ui/FieldGroup.svelte';
  import PortalField from '../ui/PortalField.svelte';
  import EmptyState from '../ui/EmptyState.svelte';
  import { app } from '../state.svelte';
  import { QUARTER_LABELS } from '../../lib/tax/years';
  import { date, inr, money, raw } from '../../lib/ui/format';

  const r = $derived(app.report!);
  const inc = $derived(r.income);
  const ty = $derived(r.year);
  const ids = $derived(['os:div', 'os:int', ...QUARTER_LABELS.map((_, i) => `os:q${i}`)]);
</script>

<ScheduleHead title="Schedule OS — Income from other sources" path="ITR-2 › Schedule Other Sources" period={`FY ${date(ty.fyStart)} – ${date(ty.fyEnd)}`} {ids}>
  <div class="callout">
    <Icon name="info" />
    <div>
      <b>Report dividends gross — before US tax was withheld.</b>
      <p>The tax withheld isn't a deduction; it comes back as a credit through Schedules FSI and TR. Don't use row 2 “chargeable at special rates as per DTAA” — residents are taxed at slab rates and claim relief instead.</p>
    </div>
  </div>
</ScheduleHead>

{#if !inc.dividends.length && !inc.interest.length}
  <EmptyState title="No foreign dividends or interest" text="Nothing to add to Schedule OS from this account for the year." />
{:else}
  <FieldGroup title="1 · Gross income chargeable to tax at normal applicable rates">
    <PortalField id="os:div" label="1a(i) Dividend income [other than (ii) and (iii)]" display={inr(inc.dividendTotalInr)} copy={raw(inc.dividendTotalInr)} hint={`${inc.dividends.length} payments · SBI rate for the month before each payment (${ty.law.conversionRule})`} />
    <PortalField id="os:int" label="1b(ix) Others including interest from Companies, NBFCs & HFCs" display={inr(inc.interestTotalInr)} copy={raw(inc.interestTotalInr)} hint={`${inc.interest.length} broker interest credits · ${r.settings.interestRate === 'fyEnd' ? `SBI rate on ${date(ty.fyEnd)}` : 'month-end rates'}`} />
  </FieldGroup>

  <FieldGroup title="10 · Information about accrual/receipt of income from other sources" sub="Row 3(a) Dividend income referred in Sl. No. 1a(i) — by payment date, used for s.234C interest">
    {#each QUARTER_LABELS as q, i}
      <PortalField id={`os:q${i}`} label={q} display={inr(inc.dividendQuarters[i])} copy={raw(inc.dividendQuarters[i])} tone={inc.dividendQuarters[i].isZero() ? 'muted' : undefined} />
    {/each}
  </FieldGroup>

  <div class="table-caption"><div><h3>Working — dividends</h3><p>Gross amount, tax withheld and the SBI rate applied to each payment.</p></div></div>
  <div class="table-wrap">
    <table class="data">
      <thead><tr><th>Paid</th><th>Symbol</th><th class="r">Gross</th><th class="r">Withheld</th><th class="r">SBI rate</th><th>Rate date</th><th class="r">Gross (₹)</th><th>Quarter</th></tr></thead>
      <tbody>
        {#each inc.dividends as d}
          <tr>
            <td>{date(d.txn.date)}</td>
            <td><span class="sym">{d.txn.symbol}</span><span class="sub">{d.country.name}</span></td>
            <td class="r">{money(d.txn.amount, d.txn.currency)}</td>
            <td class="r">{money(d.withheldForeign, d.txn.currency)}</td>
            <td class="r">{d.conv?.rate.toString() ?? '—'}</td>
            <td>{date(d.conv?.rateDate)}</td>
            <td class="r">{inr(d.conv?.inr)}</td>
            <td>{QUARTER_LABELS[d.quarter]}</td>
          </tr>
        {/each}
      </tbody>
      <tfoot><tr><td colspan="6">Total</td><td class="r">{inr(inc.dividendTotalInr)}</td><td></td></tr></tfoot>
    </table>
  </div>

  {#if inc.interest.length}
    <div class="table-caption"><div><h3>Working — broker interest</h3></div></div>
    <div class="table-wrap">
      <table class="data">
        <thead><tr><th>Credited</th><th>Description</th><th class="r">Amount</th><th class="r">SBI rate</th><th>Rate date</th><th class="r">Amount (₹)</th></tr></thead>
        <tbody>
          {#each inc.interest as d}
            <tr><td>{date(d.txn.date)}</td><td>{d.description}</td><td class="r">{money(d.txn.amount, d.txn.currency)}</td><td class="r">{d.conv?.rate.toString() ?? '—'}</td><td>{date(d.conv?.rateDate)}</td><td class="r">{inr(d.conv?.inr)}</td></tr>
          {/each}
        </tbody>
        <tfoot><tr><td colspan="5">Total</td><td class="r">{inr(inc.interestTotalInr)}</td></tr></tfoot>
      </table>
    </div>
  {/if}
{/if}
