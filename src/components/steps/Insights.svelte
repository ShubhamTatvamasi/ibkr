<script lang="ts">
  import Icon from '../ui/Icon.svelte';
  import StatTile from '../ui/StatTile.svelte';
  import Meter from '../ui/Meter.svelte';
  import AisCheck from '../ui/AisCheck.svelte';
  import { app } from '../state.svelte';
  import { date, inr, money, num } from '../../lib/ui/format';
  import { FA_PENALTY_RELIEF_INR, US_ESTATE_EXEMPTION_USD } from '../../lib/tax/insights';

  const r = $derived(app.report!);
  const ins = $derived(r.insights);
  const usd = (n: number) => `$${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n)}`;
  const gainPct = $derived(ins.totals.costInr.isZero() ? 0 : ins.totals.gainInr.div(ins.totals.costInr).mul(100).toNumber());
</script>

<header class="page-head">
  <h1>Insights</h1>
  <p class="muted">Beyond the return: what your holdings mean for next year. Based on positions as of {date(ins.asOf)}. Information, not advice.</p>
</header>

<section class="tiles">
  <StatTile icon="pie" label="Portfolio value" value={inr(ins.totals.valueInr)} sub={`${ins.holdings.length} open lots`} />
  <StatTile icon="trend" label="Unrealised gain" value={inr(ins.totals.gainInr)} sub={`${gainPct >= 0 ? '+' : ''}${gainPct.toFixed(1)}% on rupee cost`} tone={ins.totals.gainInr.lt(0) ? 'neg' : undefined} />
  <StatTile icon="clock" label="Turning long-term soon" value={String(ins.turningLongTerm.length)} sub="lots within 120 days" />
  <StatTile icon="globe" label="US-situs assets" value={usd(ins.usSitusUsd.toNumber())} sub="US stocks and US-domiciled ETFs" />
</section>

{#each r.ais as fig (fig.accountId)}<AisCheck {fig} />{/each}

<div class="grid">
  <section class="card">
    <div class="card-head"><div><h3>Lots about to turn long-term</h3><p>Held more than 24 months, gains are taxed at 12.5% instead of your slab rate.</p></div></div>
    {#if ins.turningLongTerm.length}
      <ul class="timeline">
        {#each ins.turningLongTerm as h}
          <li>
            <span class="tl-icon"><Icon name="clock" size={18} /></span>
            <div class="tl-main"><b>{h.symbol}</b><span class="faint">{num(h.qty)} shares · bought {date(h.acquired)}</span></div>
            <div class="tl-right"><span class="badge accent">in {h.daysToLongTerm} days</span><span class="faint num">{date(h.longTermFrom)}</span></div>
            <span class="num gain" class:neg={h.gainInr?.lt(0)}>{inr(h.gainInr)}</span>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="empty-line"><Icon name="check-circle" size={18} />No lot crosses the 24-month mark in the next 120 days.</p>
    {/if}
  </section>

  <section class="card">
    <div class="card-head"><div><h3>US estate tax exposure</h3><p>Non-US persons get only a $60,000 exemption on US-situs assets, and India has no estate-tax treaty with the US.</p></div></div>
    <Meter value={ins.usSitusUsd.toNumber()} max={US_ESTATE_EXEMPTION_USD} label="US-situs assets against the US$60,000 exemption" valueText={usd(ins.usSitusUsd.toNumber())} maxText={usd(US_ESTATE_EXEMPTION_USD)} />
    <p class="note">
      {#if ins.estateExposed}Above the exemption: your heirs may need to file a US estate tax return. Irish- or Luxembourg-domiciled ETFs are generally not US-situs — worth discussing with an adviser.{:else}Below the exemption at current values.{/if}
    </p>
  </section>

  <section class="card">
    <div class="card-head"><div><h3>Schedule FA penalty threshold</h3><p>No Black Money Act penalty if foreign assets other than immovable property total ₹20 lakh or less. Disclosure is still mandatory.</p></div></div>
    <Meter value={ins.faAggregateInr.toNumber()} max={FA_PENALTY_RELIEF_INR} label="Foreign assets against ₹20 lakh" valueText={inr(ins.faAggregateInr)} maxText={inr(FA_PENALTY_RELIEF_INR)} />
    <p class="note">Peak share value plus peak cash in calendar {r.year.cyStart.slice(0, 4)} — a conservative measure.</p>
  </section>

  <section class="card">
    <div class="card-head"><div><h3>Dividend withholding</h3><p>India's tax treaties cap tax on your dividends (25% in the US with a valid W-8BEN, 10–15% in most of Europe). Anything above the cap can't be credited in India.</p></div></div>
    {#if ins.overWithheld.length}
      <ul class="plain">
        {#each ins.overWithheld as o}
          <li><Icon name="warn" size={18} /><span><b>{o.symbol}</b> withheld at {o.ratePct.toFixed(1)}% on {money(o.dividendForeign)}, above the {o.capPct}% treaty rate — {o.country.iso === 'US' ? 'check your W-8BEN in IBKR (it lapses after three calendar years).' : `reclaim the excess from ${o.country.name}'s tax authority.`}</span></li>
        {/each}
      </ul>
    {:else}
      <p class="empty-line"><Icon name="check-circle" size={18} />All dividends were withheld at or below the treaty rate.</p>
    {/if}
  </section>

  <section class="card">
    <div class="card-head"><div><h3>Money sent to IBKR this year</h3><p>Deposits recorded in the financial year {r.year.fyStart.slice(0, 4)}-{r.year.fyEnd.slice(2, 4)}.</p></div></div>
    {#if ins.remittances.count}
      <div class="kv">
        <span>Deposits</span><b class="num">{money(ins.remittances.depositsForeign, ins.remittances.currency)}</b>
        <span>Withdrawals</span><b class="num">{money(ins.remittances.withdrawalsForeign, ins.remittances.currency)}</b>
      </div>
      <p class="note">Remittances under LRS above ₹10 lakh in a financial year attract tax collected at source by your bank. It is not a cost — claim it as a credit in your return (it shows in Form 26AS).</p>
    {:else}
      <p class="empty-line"><Icon name="info" size={18} />No deposits or withdrawals in this financial year.</p>
    {/if}
  </section>
</div>

<div class="table-caption"><div><h3>Open lots</h3><p>Rupee cost at the SBI rate on each purchase date; value at the latest price and rate.</p></div></div>
<div class="table-wrap">
  <table class="data">
    <thead><tr><th>Symbol</th><th>Acquired</th><th class="r">Qty</th><th class="r">Cost (₹)</th><th class="r">Value (₹)</th><th class="r">Gain (₹)</th><th>Long-term from</th></tr></thead>
    <tbody>
      {#each ins.holdings as h}
        <tr>
          <td><span class="sym">{h.symbol}</span><span class="sub">{h.description}</span></td>
          <td>{date(h.acquired)}</td>
          <td class="r">{num(h.qty)}</td>
          <td class="r">{inr(h.costInr)}</td>
          <td class="r">{inr(h.valueInr)}</td>
          <td class="r" class:neg={h.gainInr?.lt(0)}>{inr(h.gainInr)}</td>
          <td>{#if h.daysToLongTerm === 0}<span class="badge accent">Long-term</span>{:else}{date(h.longTermFrom)}{/if}</td>
        </tr>
      {/each}
    </tbody>
    <tfoot>
      <tr><td colspan="3">Total</td><td class="r">{inr(ins.totals.costInr)}</td><td class="r">{inr(ins.totals.valueInr)}</td><td class="r">{inr(ins.totals.gainInr)}</td><td></td></tr>
    </tfoot>
  </table>
</div>

<style>
  .page-head { margin-bottom: 20px; }
  .page-head p { margin-top: 6px; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 16px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 16px; }
  .note { font-size: 13px; color: var(--text-2); margin-top: 12px; }
  .timeline, .plain { list-style: none; padding: 0; margin: 0; display: grid; gap: 4px; }
  .timeline li { display: grid; grid-template-columns: 28px 1fr auto auto; gap: 12px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border); }
  .timeline li:last-child { border-bottom: 0; }
  .tl-icon { color: var(--accent); }
  .tl-main, .tl-right { display: grid; font-size: 13px; }
  .tl-right { justify-items: end; gap: 2px; }
  .gain { font-weight: 600; font-size: 13px; min-width: 80px; text-align: right; }
  .gain.neg { color: var(--danger-text); }
  .plain li { display: flex; gap: 8px; font-size: 13px; }
  .plain :global(.icon) { color: var(--warn); flex: none; }
  .empty-line { display: flex; gap: 8px; align-items: center; font-size: var(--fs-ui); color: var(--text-2); }
  .empty-line :global(.icon) { color: var(--success); }
  .kv { display: grid; grid-template-columns: auto 1fr; gap: 6px 16px; font-size: var(--fs-ui); }
  .kv b { text-align: right; }
  @media (max-width: 480px) {
    .grid { grid-template-columns: 1fr; }
    .timeline li { grid-template-columns: 24px 1fr auto; }
    .gain { grid-column: 2 / -1; text-align: left; }
  }
</style>
