<script lang="ts">
  import Icon from '../ui/Icon.svelte';
  import ScheduleHead from '../ui/ScheduleHead.svelte';
  import FieldGroup from '../ui/FieldGroup.svelte';
  import PortalField from '../ui/PortalField.svelte';
  import EmptyState from '../ui/EmptyState.svelte';
  import { app } from '../state.svelte';
  import { date, inr, raw } from '../../lib/ui/format';

  const r = $derived(app.report!);
  const ty = $derived(r.year);
  const rows = $derived(r.foreign.form67);
  const ids = $derived(rows.flatMap((_, i) => ['income', 'paid', 'rate', 'india', 'article', 'dtaa', 'credit'].map((k) => `f67:${i}:${k}`)));
</script>

<ScheduleHead
  title={ty.law.ftcForm}
  path={ty.newAct ? 'e-File › Income Tax Forms › File Income Tax Forms › Form 44' : 'e-File › Income Tax Forms › File Income Tax Forms › Forms as per Income Tax Act 1961 › Form 67'}
  period={`FY ${date(ty.fyStart)} – ${date(ty.fyEnd)}`}
  {ids}
>
  <div class="callout danger">
    <Icon name="error" />
    <div>
      <b>File this before the ITR.</b>
      <p>The foreign tax credit in Schedule TR is allowed only if {ty.law.ftcForm} is on record. Select the assessment year, click “Let's Get Started”, fill Part A, Part B, Verification and Attachments, then e-verify.{ty.newAct ? ' Form 44 must be verified by an accountant if foreign tax paid is ₹1 lakh or more.' : ''}</p>
    </div>
  </div>
</ScheduleHead>

{#if !rows.length}
  <EmptyState title={`No ${ty.law.ftcForm} needed`} text="No foreign tax was withheld in this financial year, so there is no credit to claim." />
{:else}
  <h2 class="part">Part A — income from outside India and tax credit claimed</h2>
  <p class="muted lead">Click “Add Details” once per row below. Name, PAN, address and assessment year are pre-filled from your profile.</p>
  {#each rows as f, i}
    <FieldGroup title={`Row ${i + 1} · ${f.country.name} · ${f.source}`} sub="Add Details">
      <PortalField id={`f67:${i}:country`} label="Name of the country / specified territory" display={f.country.name} text />
      <PortalField id={`f67:${i}:source`} label="Source of income" display={f.source} text />
      <PortalField id={`f67:${i}:income`} label="Income from outside India" display={inr(f.incomeInr)} copy={raw(f.incomeInr)} hint="Gross, before foreign tax" />
      <PortalField id={`f67:${i}:paid`} label="Tax paid outside India — Amount" display={inr(f.taxPaidInr)} copy={raw(f.taxPaidInr)} hint={`Each deduction at the SBI rate for the month before it (${ty.law.ftcRule})`} />
      <PortalField id={`f67:${i}:rate`} label="Tax paid outside India — Rate (%)" display={`${f.taxRatePct.toFixed(2)}%`} copy={f.taxRatePct.toFixed(2)} />
      <PortalField id={`f67:${i}:india`} label="Tax payable on such income under normal provisions in India" display={inr(f.indianTaxInr)} copy={raw(f.indianTaxInr)} hint={`At your marginal rate of ${r.settings.marginalRatePct}%`} />
      <PortalField id={`f67:${i}:115jb`} label="Tax payable on such income under section 115JB/JC" display="0" copy="0" tone="muted" />
      <PortalField id={`f67:${i}:article`} label="Article No. of DTAA" display={f.article} copy={f.article.replace('Article ', '')} />
      <PortalField id={`f67:${i}:dtaa`} label="Rate of tax as per DTAA (%)" display={f.dtaaRatePct !== undefined ? `${f.dtaaRatePct}%` : '—'} copy={f.dtaaRatePct !== undefined ? String(f.dtaaRatePct) : undefined} />
      <PortalField id={`f67:${i}:credit`} label="Credit claimed under section 90 — Amount" display={inr(f.creditInr)} copy={raw(f.creditInr)} hint="Lowest of tax paid, Indian tax and treaty rate" />
      <PortalField id={`f67:${i}:s91`} label="Credit claimed under section 91 — Amount" display="0" copy="0" tone="muted" hint="Not applicable where a tax treaty exists" />
    </FieldGroup>
  {/each}

  <div class="two">
    <FieldGroup title="Part B" sub="Two questions">
      <PortalField id="f67:b1" label="Refund of foreign tax claimed due to carry-back of losses?" display="No" text />
      <PortalField id="f67:b2" label="Credit claimed for foreign tax under dispute?" display="No" text />
    </FieldGroup>
    <FieldGroup title="Attachments" sub="One PDF or ZIP, under 5 MB">
      <div class="attach">
        <p>Proof of the tax withheld abroad. For IBKR: the annual Activity Statement (withholding tax section) and Form 1042-S, combined into one ZIP if more than one file. Keep the file name short, without special characters.</p>
      </div>
    </FieldGroup>
  </div>
{/if}

<style>
  .part { font-size: var(--fs-h3); margin: 8px 0 4px; }
  .lead { font-size: var(--fs-ui); margin-bottom: 14px; }
  .two { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
  .attach { padding: 14px 16px; font-size: var(--fs-ui); color: var(--text-2); }
</style>
