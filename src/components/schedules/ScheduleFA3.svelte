<script lang="ts">
  import Icon from '../ui/Icon.svelte';
  import ScheduleHead from '../ui/ScheduleHead.svelte';
  import FieldGroup from '../ui/FieldGroup.svelte';
  import PortalField from '../ui/PortalField.svelte';
  import EmptyState from '../ui/EmptyState.svelte';
  import { app } from '../state.svelte';
  import { date, inr, money, num, portalDate, raw } from '../../lib/ui/format';
  import Decimal from 'decimal.js';

  const r = $derived(app.report!);
  const rows = $derived(r.fa.a3);
  const year = $derived(r.year.cyStart.slice(0, 4));
  let at = $state(0);
  const row = $derived(rows[Math.min(at, rows.length - 1)]);
  const KEYS = ['name', 'addr', 'zip', 'acq', 'init', 'peak', 'close', 'gross', 'proc'];
  const ids = $derived(rows.flatMap((_, i) => KEYS.map((k) => `fa3:${i}:${k}`)));
  const doneRow = (i: number) => KEYS.every((k) => app.copied[`fa3:${i}:${k}`]);
  const sum = (f: (x: (typeof rows)[number]) => Decimal | undefined) => rows.reduce((s, x) => s.add(f(x) ?? 0), new Decimal(0));
  const ent = $derived(row ? app.entities[row.lot.symbol] : undefined);
</script>

<ScheduleHead title="Schedule FA · Table A3 — Foreign equity holdings" path="ITR-2 › Schedule FA › A3 › Add" period={`Calendar year ${year}`} {ids}>
  <div class="callout warn">
    <Icon name="calendar" />
    <div>
      <b>One row per purchase lot held at any time in {year} — including lots sold during the year.</b>
      <p>Sold lots show a closing balance of 0 and their sale proceeds in column 12. Peak value is the highest rupee value of that lot on any day of the year.</p>
    </div>
  </div>
</ScheduleHead>

{#if !rows.length}
  <EmptyState title="No holdings in this calendar year" text="No shares were held at any time during the year." />
{:else}
  <div class="entry-nav">
    <button class="btn sm" disabled={at === 0} onclick={() => (at -= 1)}><Icon name="arrow-left" size={16} />Previous</button>
    <label class="jump">
      <span class="sr-only">Go to row</span>
      <select bind:value={at}>
        {#each rows as x, i}<option value={i}>Row {i + 1} of {rows.length} · {x.lot.symbol} · {date(x.acquired)}{doneRow(i) ? ' ✓' : ''}</option>{/each}
      </select>
    </label>
    <button class="btn sm" disabled={at >= rows.length - 1} onclick={() => (at += 1)}>Next<Icon name="arrow-right" size={16} /></button>
  </div>

  {#key at}
    <FieldGroup title={`Row ${at + 1} · ${row.lot.symbol} · ${row.entityName}`} sub={`${num(row.qtyStart)} shares at start → ${num(row.qtyEnd)} at 31 Dec · peak ${row.peakQuality === 'daily' ? 'from daily prices' : 'approximate'}`}>
      <PortalField id={`fa3:${at}:country`} label="2 · Country Name and Code" display={`${row.country.itrCode || '?'} — ${row.country.name}`} text />
      <PortalField id={`fa3:${at}:name`} label="3 · Name of entity" display={row.entityName} copy={row.entityName} text />
      <PortalField
        id={`fa3:${at}:addr`}
        label="4 · Address of entity"
        display={ent?.address || 'Missing — add in Review'}
        copy={ent?.address || undefined}
        tone={ent?.address ? undefined : 'warn'}
        text
      />
      <PortalField id={`fa3:${at}:zip`} label="5 · ZIP Code" display={ent?.zip || '—'} copy={ent?.zip || undefined} tone={ent?.zip ? undefined : 'warn'} />
      <PortalField id={`fa3:${at}:nature`} label="6 · Nature of entity" display={row.natureOfEntity} copy={row.natureOfEntity} text />
      <PortalField id={`fa3:${at}:acq`} label="7 · Date of acquiring the interest" display={date(row.acquired)} copy={portalDate(row.acquired)} />
      <PortalField id={`fa3:${at}:init`} label="8 · Initial value of the investment" display={inr(row.initial?.inr)} copy={raw(row.initial?.inr)} hint={row.initial ? `${money(row.initial.foreign, row.lot.currency)} × SBI ${row.initial.rate} (${date(row.initial.rateDate)})` : 'Rate missing'} />
      <PortalField id={`fa3:${at}:peak`} label="9 · Peak value of investment during the Period" display={inr(row.peak?.inr)} copy={raw(row.peak?.inr)} hint={row.peak ? `${num(row.peak.qty)} × ${money(row.peak.price, row.lot.currency)} × SBI ${row.peak.rate} on ${date(row.peak.date)}` : undefined} />
      <PortalField id={`fa3:${at}:close`} label="10 · Closing balance" display={inr(row.closing?.inr ?? 0)} copy={raw(row.closing?.inr ?? 0)} hint={row.closing ? `${num(row.qtyEnd)} × ${money(row.closingPrice, row.lot.currency)} × SBI ${row.closing.rate} on 31 Dec` : 'Fully sold during the year'} />
      <PortalField id={`fa3:${at}:gross`} label="11 · Total gross amount paid/credited with respect to the holding during the period" display={inr(row.dividends.inr)} copy={raw(row.dividends.inr)} hint="Dividends earned by this lot, gross" />
      <PortalField id={`fa3:${at}:proc`} label="12 · Total gross proceeds from sale or redemption of investment during the period" display={inr(row.proceeds.inr)} copy={raw(row.proceeds.inr)} />
    </FieldGroup>
  {/key}

  <div class="table-caption"><div><h3>All rows</h3><p>Click a row to open it above. ✓ marks rows whose values you've copied.</p></div></div>
  <div class="table-wrap">
    <table class="data">
      <thead><tr><th>#</th><th>Symbol</th><th>Acquired</th><th class="r">Initial (₹)</th><th class="r">Peak (₹)</th><th class="r">Closing (₹)</th><th class="r">Credited (₹)</th><th class="r">Proceeds (₹)</th></tr></thead>
      <tbody>
        {#each rows as x, i}
          <tr class="click" class:current={i === at} onclick={() => (at = i)}>
            <td class="num">{i + 1}{#if doneRow(i)}<span class="ok"> ✓</span>{/if}</td>
            <td><span class="sym">{x.lot.symbol}</span><span class="sub">{x.entityName}</span></td>
            <td>{date(x.acquired)}</td>
            <td class="r">{inr(x.initial?.inr)}</td>
            <td class="r">{inr(x.peak?.inr)}</td>
            <td class="r">{inr(x.closing?.inr ?? 0)}</td>
            <td class="r">{inr(x.dividends.inr)}</td>
            <td class="r">{inr(x.proceeds.inr)}</td>
          </tr>
        {/each}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="3">Total</td>
          <td class="r">{inr(sum((x) => x.initial?.inr))}</td>
          <td class="r">{inr(sum((x) => x.peak?.inr))}</td>
          <td class="r">{inr(sum((x) => x.closing?.inr))}</td>
          <td class="r">{inr(sum((x) => x.dividends.inr))}</td>
          <td class="r">{inr(sum((x) => x.proceeds.inr))}</td>
        </tr>
      </tfoot>
    </table>
  </div>
{/if}

<style>
  .entry-nav { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; }
  .jump { flex: 1; max-width: 420px; }
  .jump select { height: 32px; font-size: 13px; }
  tr.click { cursor: pointer; }
  tr.current td { background: var(--accent-soft) !important; }
  .ok { color: var(--success); }
</style>
