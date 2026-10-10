<script lang="ts">
  import Icon from './Icon.svelte';
  import CopyButton from './CopyButton.svelte';
  import { app } from '../state.svelte';
  import { AIS_LINES, aisRemark, compareAis, type AisFigures, type AisLine } from '../../lib/tax/ais';
  import { date, money, persist, store } from '../../lib/ui/format';

  let { fig }: { fig: AisFigures } = $props();
  const key = $derived(`ais:${fig.accountId}:${fig.calendarYear}`);
  let entered = $state<Partial<Record<AisLine, string>>>({});
  $effect(() => {
    entered = store<Partial<Record<AisLine, string>>>(key, {});
  });

  function set(line: AisLine, value: string) {
    entered = { ...entered, [line]: value };
    persist(key, entered);
  }

  const rows = $derived(compareAis(fig, entered));
  const filled = $derived(rows.filter((r) => r.theirs));
  const mismatches = $derived(filled.filter((r) => !r.matches && !r.cashOnly));
  const remark = $derived(aisRemark(fig, rows, app.year.label.split(' (')[0]));
</script>

<section class="card ais">
  <div class="card-head">
    <div>
      <h3>Check against your AIS foreign-assets report</h3>
      <p>
        The tax department now shows what foreign institutions report about your accounts. Open AIS → Compliance Portal → Reports →
        Foreign Assets Information, pick calendar year {fig.calendarYear}, and type the figures for account {fig.accountId} here.
      </p>
    </div>
    {#if filled.length}
      <span class="badge {mismatches.length ? 'warn' : 'success'}">{mismatches.length ? `${mismatches.length} to explain` : 'All match'}</span>
    {/if}
  </div>

  <div class="table-wrap">
    <table class="data">
      <thead>
        <tr><th>Figure</th><th class="r">From your IBKR files</th><th>AIS shows ({fig.currency})</th><th class="r">Difference</th></tr>
      </thead>
      <tbody>
        {#each rows as r}
          {@const line = AIS_LINES.find((l) => l.key === r.key)!}
          <tr>
            <td><b>{line.label}</b><span class="sub">{line.hint}</span></td>
            <td class="r">
              {money(r.ours, fig.currency)}
              {#if r.key === 'balance'}<span class="sub">cash {money(fig.cash, fig.currency)} + holdings {money(fig.holdings, fig.currency)}</span>{/if}
            </td>
            <td class="in">
              <input
                type="text"
                inputmode="decimal"
                aria-label={`${line.label} shown in AIS, ${fig.currency}`}
                placeholder="—"
                value={entered[r.key] ?? ''}
                oninput={(e) => set(r.key, e.currentTarget.value)}
              />
            </td>
            <td class="r">
              {#if r.diff}
                {#if r.matches}
                  <span class="ok"><Icon name="check-circle" size={16} />Matches</span>
                {:else if r.cashOnly}
                  <span class="ok"><Icon name="check-circle" size={16} />Matches cash only</span>
                {:else}
                  <span class="off"><Icon name="warn" size={16} />{r.diff.gt(0) ? '+' : ''}{money(r.diff, fig.currency)}</span>
                {/if}
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  {#if fig.otherCurrencies.length}
    <p class="note">Amounts in {fig.otherCurrencies.join(', ')} are not included above; the AIS report lists them separately.</p>
  {/if}
  <p class="note">Calendar year {fig.calendarYear}, closing on {date(fig.closeDate)}. Gross amounts, before any US tax withheld.</p>

  {#if filled.length}
    <div class="callout {mismatches.length ? 'warn' : 'success'} next">
      <Icon name={mismatches.length ? 'warn' : 'check-circle'} />
      <div>
        {#if mismatches.length}
          <b>Explain each difference before you respond in AIS</b>
          <p>Use the hint under each figure. If your return already reports the correct amounts, pick the AIS feedback option that fits (such as partially correct) and paste the remark below. If something is missing from your return, revise it first.</p>
        {:else}
          <b>Your files agree with what the institution reported</b>
          <p>Make sure the same account appears in Schedule FA A2 and its holdings in A3. You can confirm the entry in AIS with the remark below.</p>
        {/if}
      </div>
    </div>
    <div class="prompt">
      <div class="prompt-head"><b>Remark for AIS feedback ({remark.length}/400)</b><CopyButton value={remark} label="Copy remark" /></div>
      <p>{remark}</p>
    </div>
  {/if}
</section>

<style>
  .ais { margin-bottom: 16px; }
  .ais .table-wrap { max-height: none; }
  td.in { width: 200px; }
  td.in input { height: 34px; text-align: right; font-variant-numeric: tabular-nums; }
  .ok, .off { display: inline-flex; align-items: center; gap: 6px; font-weight: 500; }
  .ok { color: var(--success-text); }
  .off { color: var(--warn-text); }
  .note { font-size: 13px; color: var(--text-2); margin-top: 10px; }
  .next { margin-top: 14px; grid-template-columns: 20px 1fr; }
  .prompt p { font-family: var(--font-sans); user-select: text; }
  @media (max-width: 640px) {
    td.in { width: 120px; }
  }
</style>
