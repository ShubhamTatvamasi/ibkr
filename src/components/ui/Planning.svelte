<script lang="ts">
  import Icon from './Icon.svelte';
  import { app } from '../state.svelte';
  import { advanceTax, compareRegimes, harvestIdeas } from '../../lib/tax/planning';
  import { date, inr, num } from '../../lib/ui/format';

  const r = $derived(app.report!);
  const today = new Date().toISOString().slice(0, 10);
  const inProgress = $derived(r.periods.fy.inProgress);
  const harvest = $derived(harvestIdeas(r));
  const instalments = $derived(advanceTax(r, today));
  const yearTotal = $derived(instalments.at(-1)!.cumulativeInr);
  const n = (s: string) => Math.max(0, Number((s ?? '').replace(/,/g, '')) || 0);
  const inputs = $derived(app.settings.regimeInputs ?? { salary: '', otherIncome: '', oldDeductions: '' });
  const regimes = $derived(compareRegimes(r, { salary: n(inputs.salary), otherIncome: n(inputs.otherIncome), oldDeductions: n(inputs.oldDeductions) }));
  const better = $derived(regimes.new.total.lte(regimes.old.total) ? 'new' : 'old');
  const diff = $derived(regimes.new.total.sub(regimes.old.total).abs());
  const belated = $derived(today > `${r.year.ayStart}-07-31`);
  const fyEnd = $derived(r.year.fyEnd);

  function setInput(k: 'salary' | 'otherIncome' | 'oldDeductions', v: string) {
    app.settings.regimeInputs = { ...inputs, [k]: v.replace(/,/g, '') };
  }
</script>

<div class="table-caption"><div><h3>Plan ahead</h3><p>Estimates from your IBKR figures for {r.year.label.split(' (')[0]}. Information, not advice.</p></div></div>

<div class="plan">
  <section class="card">
    <div class="card-head">
      <div>
        <h3>Losses you could harvest</h3>
        <p>Selling a lot below its rupee cost {inProgress ? `before ${date(fyEnd)}` : 'in the next financial year'} creates a loss that reduces capital gains. India has no wash-sale rule, but buying straight back may be questioned.</p>
      </div>
    </div>
    {#if harvest.ideas.length}
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Lot</th><th class="r">Loss (₹)</th><th>Offsets</th><th class="r">Tax saved (₹)</th></tr></thead>
          <tbody>
            {#each harvest.ideas as i}
              <tr>
                <td><span class="sym">{i.holding.symbol}</span><span class="sub">{num(i.holding.qty)} shares · bought {date(i.holding.acquired)} · {i.term === 'LTCL' ? 'long-term' : 'short-term'}</span></td>
                <td class="r neg">{inr(i.lossInr)}</td>
                <td>{i.offsets.length ? i.offsets.map((o) => `${o.against === 'STCG' ? 'short' : 'long'}-term gain ${inr(o.amount)}`).join(' + ') : 'Nothing this year — carries forward'}</td>
                <td class="r">{inr(i.savingInr)}</td>
              </tr>
            {/each}
          </tbody>
          <tfoot><tr><td>Total</td><td class="r">{inr(harvest.totalLoss)}</td><td></td><td class="r">{inr(harvest.totalSaving)}</td></tr></tfoot>
        </table>
      </div>
      <p class="note">Against this year's IBKR gains after set-off, at your {r.settings.marginalRatePct}% marginal rate for short-term gains and 13% for long-term. The rupee loss on the day may differ: the sale is converted at the SBI rate for the month before the sale.</p>
    {:else}
      <p class="empty-line"><Icon name="check-circle" size={18} />No open lot is below its rupee cost.</p>
    {/if}
  </section>

  <section class="card">
    <div class="card-head">
      <div>
        <h3>Advance tax on this income</h3>
        <p>Tax on dividends and capital gains is due from the instalment after they arise; paying it then avoids interest under section 234C. Salary TDS doesn't cover foreign income.</p>
      </div>
    </div>
    {#if !inProgress}
      <p class="empty-line"><Icon name="info" size={18} />This year has ended. Pick the tax year in progress on the Upload step to see this year's instalments.</p>
    {:else if yearTotal.isZero()}
      <p class="empty-line"><Icon name="check-circle" size={18} />No tax on IBKR income so far this year.</p>
    {:else}
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Instalment</th><th class="r">Pay by then (₹)</th><th class="r">Tax on income so far (₹)</th></tr></thead>
          <tbody>
            {#each instalments as row}
              <tr class:past={row.past}><td>{date(row.date)}{#if row.past}<span class="sub">passed</span>{/if}</td><td class="r">{inr(row.dueInr)}</td><td class="r">{inr(row.cumulativeInr)}</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="note">Only needed if your total tax for the year after TDS is ₹10,000 or more. Figures cover income up to {date(r.periods.fy.needTo)}; later dividends and sales add to the remaining instalments. Interest at 1% a month applies to shortfalls (sections 234B and 234C).</p>
    {/if}
  </section>

  <section class="card regime">
    <div class="card-head">
      <div>
        <h3>Old or new tax regime?</h3>
        <p>Add your other income to compare. Your IBKR income is included: short-term gains, dividends and interest at slab rates, long-term gains at 12.5%.</p>
      </div>
    </div>
    <div class="inputs">
      <label class="field"><span>Salary (gross, ₹)</span><input inputmode="numeric" value={inputs.salary} onchange={(e) => setInput('salary', e.currentTarget.value)} /></label>
      <label class="field"><span>Other income at slab rates (₹)</span><input inputmode="numeric" value={inputs.otherIncome} onchange={(e) => setInput('otherIncome', e.currentTarget.value)} /></label>
      <label class="field"><span>Old-regime deductions (₹)</span><input inputmode="numeric" value={inputs.oldDeductions} onchange={(e) => setInput('oldDeductions', e.currentTarget.value)} /><small>80C, 80D, HRA, home-loan interest…</small></label>
    </div>
    <div class="cmp">
      {#each [regimes.new, regimes.old] as x}
        <div class="opt" class:best={x.regime === better}>
          <span class="o-h">{x.regime === 'new' ? 'New regime' : 'Old regime'}{#if x.regime === better}<span class="badge success">Lower</span>{/if}</span>
          <b class="num">{inr(x.total)}</b>
          <dl>
            <dt>Taxable at slab rates</dt><dd>{inr(x.taxableNormal)}</dd>
            <dt>Long-term gains at 12.5%</dt><dd>{inr(x.ltcg)}</dd>
            {#if !x.rebate.isZero()}<dt>Rebate (87A)</dt><dd>−{inr(x.rebate)}</dd>{/if}
            {#if !x.surcharge.isZero()}<dt>Surcharge</dt><dd>{inr(x.surcharge)}</dd>{/if}
            <dt>Cess 4%</dt><dd>{inr(x.cess)}</dd>
            {#if !x.credit.isZero()}<dt>Foreign tax credit</dt><dd>−{inr(x.credit)}</dd>{/if}
          </dl>
        </div>
      {/each}
    </div>
    <p class="note">
      {better === 'new' ? 'The new regime' : 'The old regime'} is lower by {inr(diff)}.
      {belated ? ' The original due date has passed: a belated return can only use the new regime.' : ' The choice is made when filing; salaried people can switch each year.'}
      Estimate for a resident below 60; surcharge marginal relief is not applied.
    </p>
  </section>
</div>

<style>
  .plan { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 16px; margin-bottom: 8px; }
  .plan .table-wrap { max-height: none; }
  .regime { grid-column: 1 / -1; }
  .note { font-size: 13px; color: var(--text-2); margin-top: 12px; }
  .neg { color: var(--danger-text); }
  .empty-line { display: flex; gap: 8px; align-items: center; font-size: var(--fs-ui); color: var(--text-2); }
  .empty-line :global(.icon) { color: var(--success); }
  tr.past td { color: var(--text-3); }
  .inputs { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 14px; }
  .cmp { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
  .opt { padding: 16px; border: 1px solid var(--border); border-radius: var(--r-lg); background: var(--surface-sunken); display: grid; gap: 6px; }
  .opt.best { border-color: var(--success); background: var(--success-soft); }
  .o-h { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--text-2); }
  .opt > b { font-size: 1.5rem; letter-spacing: -0.01em; }
  dl { display: grid; grid-template-columns: 1fr auto; gap: 2px 12px; margin: 4px 0 0; font-size: 13px; }
  dt { color: var(--text-2); }
  dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
  @media (max-width: 480px) { .plan { grid-template-columns: 1fr; } }
</style>
