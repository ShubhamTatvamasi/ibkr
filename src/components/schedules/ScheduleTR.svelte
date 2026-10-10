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
  const tr = $derived(r.foreign.tr);
  const ids = $derived([...tr.flatMap((t) => [`tr:${t.country.iso}:c`, `tr:${t.country.iso}:d`]), 'tr:2']);
</script>

<ScheduleHead scope="income" title="Schedule TR — Summary of tax relief" path="ITR-2 › Schedule TR" period={`FY ${date(ty.fyStart)} – ${date(ty.fyEnd)}`} {ids}>
  <div class="callout">
    <Icon name="info" />
    <div>
      <b>Totals from Schedule FSI, per country.</b>
      <p>The relief here flows into Part B-TTI and must match {ty.law.ftcForm}. Claiming it makes {ty.law.ftcForm} mandatory.</p>
    </div>
  </div>
</ScheduleHead>

{#if !tr.length}
  <EmptyState title="No relief to claim" text="No foreign tax was paid, so Schedule TR stays empty." />
{:else}
  {#each tr as t}
    <FieldGroup title={`1 · ${t.country.name}`} sub="Summary of tax relief claimed">
      <PortalField id={`tr:${t.country.iso}:a`} label="(a) Country Code" display={`${t.country.itrCode} — ${t.country.name}`} copy={t.country.itrCode} />
      <PortalField id={`tr:${t.country.iso}:b`} label="(b) Taxpayer Identification Number" display={r.settings.tin || 'Not set'} copy={r.settings.tin || undefined} tone={r.settings.tin ? undefined : 'warn'} text />
      <PortalField id={`tr:${t.country.iso}:c`} label="(c) Total taxes paid outside India" display={inr(t.taxPaidInr)} copy={raw(t.taxPaidInr)} hint="Total of (c) in Schedule FSI" />
      <PortalField id={`tr:${t.country.iso}:d`} label="(d) Total tax relief available" display={inr(t.reliefInr)} copy={raw(t.reliefInr)} hint="Total of (e) in Schedule FSI" />
      <PortalField id={`tr:${t.country.iso}:e`} label="(e) Tax Relief Claimed under section" display={t.section} copy={t.section} hint={t.section === '90' ? 'Section 90 — India has a tax treaty with this country' : 'Section 91 — no tax treaty with this country'} />
    </FieldGroup>
  {/each}
  <FieldGroup title="Totals">
    <PortalField id="tr:2" label="2 · Total tax relief where DTAA is applicable (section 90/90A)" display={inr(r.foreign.totals.reliefDtaaInr)} copy={raw(r.foreign.totals.reliefDtaaInr)} tone={r.foreign.totals.reliefDtaaInr.isZero() ? 'muted' : undefined} />
    <PortalField id="tr:3" label="3 · Total tax relief where DTAA is not applicable (section 91)" display={inr(r.foreign.totals.reliefNonDtaaInr)} copy={raw(r.foreign.totals.reliefNonDtaaInr)} tone={r.foreign.totals.reliefNonDtaaInr.isZero() ? 'muted' : undefined} />
    <PortalField id="tr:4" label="4 · Tax paid abroad refunded by the foreign tax authority this year?" display="No" text hint="Yes only if the IRS refunded withholding you claimed earlier" />
  </FieldGroup>
{/if}
