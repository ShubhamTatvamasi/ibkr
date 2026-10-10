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
  const fsi = $derived(r.foreign.fsi);
  const ids = $derived(fsi.flatMap((c) => [`fsi:${c.country.iso}:code`, `fsi:${c.country.iso}:tin`, ...c.heads.flatMap((h) => ['b', 'c', 'd', 'e'].map((k) => `fsi:${c.country.iso}:${h.head}:${k}`))]));
</script>

<ScheduleHead scope="income" title="Schedule FSI — Income from outside India" path="ITR-2 › Schedule FSI › Add country" period={`FY ${date(ty.fyStart)} – ${date(ty.fyEnd)}`} {ids}>
  <div class="callout">
    <Icon name="info" />
    <div>
      <b>One block per country, one row per head of income.</b>
      <p>Income here must match what you reported in Schedules CG and OS. Relief (e) is the lower of tax paid abroad (c) and Indian tax on that income (d).</p>
    </div>
  </div>
</ScheduleHead>

{#if !fsi.length}
  <EmptyState title="No foreign income" text="Nothing to report in Schedule FSI for this year." />
{:else}
  {#each fsi as c}
    <FieldGroup title={`${c.country.name}`} sub="Country details">
      <PortalField id={`fsi:${c.country.iso}:code`} label="Country Code" display={`${c.country.itrCode} — ${c.country.name}`} copy={c.country.itrCode} hint="Pick from the portal's list" />
      <PortalField
        id={`fsi:${c.country.iso}:tin`}
        label="Taxpayer Identification Number"
        display={r.settings.tin || 'Not set'}
        copy={r.settings.tin || undefined}
        tone={r.settings.tin ? undefined : 'warn'}
        hint={r.settings.tin ? undefined : 'Add it in Review — passport number if no foreign TIN'}
        text
      />
    </FieldGroup>
    {#each c.heads as h}
      <FieldGroup title={`${c.country.name} · ${h.head === 'Capital Gains' ? 'iii Capital Gains' : 'iv Other Sources'}`} sub={h.head === 'Capital Gains' ? 'Net gains from Schedule CG; no US tax on gains for non-residents' : 'Dividends and interest from Schedule OS'}>
        <PortalField id={`fsi:${c.country.iso}:${h.head}:b`} label="(b) Income from outside India (included in Part B-TI)" display={inr(h.incomeInr)} copy={raw(h.incomeInr)} />
        <PortalField id={`fsi:${c.country.iso}:${h.head}:c`} label="(c) Tax paid outside India" display={inr(h.taxPaidInr)} copy={raw(h.taxPaidInr)} tone={h.taxPaidInr.isZero() ? 'muted' : undefined} />
        <PortalField id={`fsi:${c.country.iso}:${h.head}:d`} label="(d) Tax payable on such income under normal provisions in India" display={inr(h.indianTaxInr)} copy={raw(h.indianTaxInr)} hint={h.head === 'Capital Gains' ? 'Short-term at your slab rate, long-term at 12.5% + cess' : `At your marginal rate of ${r.settings.marginalRatePct}%`} />
        <PortalField id={`fsi:${c.country.iso}:${h.head}:e`} label="(e) Tax relief available in India — lower of (c) and (d)" display={inr(h.reliefInr)} copy={raw(h.reliefInr)} tone={h.reliefInr.isZero() ? 'muted' : undefined} />
        <PortalField id={`fsi:${c.country.iso}:${h.head}:f`} label="(f) Relevant article of DTAA if relief claimed u/s 90 or 90A" display={h.article || '—'} copy={h.article || undefined} text />
      </FieldGroup>
    {/each}
  {/each}
{/if}
