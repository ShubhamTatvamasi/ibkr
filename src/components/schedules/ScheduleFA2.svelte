<script lang="ts">
  import Icon from '../ui/Icon.svelte';
  import ScheduleHead from '../ui/ScheduleHead.svelte';
  import FieldGroup from '../ui/FieldGroup.svelte';
  import PortalField from '../ui/PortalField.svelte';
  import { app } from '../state.svelte';
  import { date, inr, portalDate, raw } from '../../lib/ui/format';
  import Decimal from 'decimal.js';

  const r = $derived(app.report!);
  const ty = $derived(r.year);
  const year = $derived(ty.cyStart.slice(0, 4));
  const entries = $derived(
    r.fa.a2.flatMap((a) => (a.credited.length ? a.credited : [{ nature: 'No Amount paid/credited' as const, code: 'N' as const, inr: new Decimal(0) }]).map((n) => ({ a, n }))),
  );
  const ids = $derived(entries.flatMap((_, i) => ['inst', 'addr', 'zip', 'acct', 'open', 'peak', 'close', 'amt'].map((k) => `fa2:${i}:${k}`)));
</script>

<ScheduleHead title="Schedule FA · Table A2 — Foreign custodial account" path="ITR-2 › Schedule FA › A2 › Add" period={`Calendar year ${year}`} {ids}>
  <div class="callout warn">
    <Icon name="calendar" />
    <div>
      <b>Schedule FA uses the calendar year {year}, not the financial year.</b>
      <p>{#if r.periods.fa.inProgress}<b>Provisional:</b> {year} isn't over, so balances are as of {date(r.fa.closeDate)}. {/if}Your IBKR account is a custodial account. Peak and closing are its cash balance in rupees; the shares themselves go in Table A3.{entries.length > 1 ? ` The portal takes one “nature of amount” per row, so add the account ${entries.length} times — once per nature below.` : ''}</p>
    </div>
  </div>
</ScheduleHead>

{#each entries as { a, n }, i}
  <FieldGroup title={`Row ${i + 1} · ${a.institution.name} · ${n.nature}`} sub={a.cashQuality === 'daily' ? 'Peak from the daily cash balance' : a.cashQuality === 'approximate' ? 'Peak approximated from opening and closing cash' : 'Cash data missing'}>
    <PortalField id={`fa2:${i}:country`} label="2 · Country Name and Code" display={`${a.country.itrCode} — ${a.country.name}`} text />
    <PortalField id={`fa2:${i}:inst`} label="3 · Name of financial institution" display={a.institution.name} copy={a.institution.name} text />
    <PortalField id={`fa2:${i}:addr`} label="4 · Address of financial institution" display={a.institution.address} copy={a.institution.address} text />
    <PortalField id={`fa2:${i}:zip`} label="5 · ZIP Code" display={a.institution.zip} copy={a.institution.zip} />
    <PortalField id={`fa2:${i}:acct`} label="6 · Account Number" display={a.account.accountId} copy={a.account.accountId} />
    <PortalField id={`fa2:${i}:status`} label="7 · Status" display="Owner" text />
    <PortalField id={`fa2:${i}:open`} label="8 · Account opening date" display={date(a.account.dateOpened)} copy={portalDate(a.account.dateOpened)} tone={a.account.dateOpened ? undefined : 'warn'} />
    <PortalField id={`fa2:${i}:peak`} label="9 · Peak Balance During the Period" display={inr(a.peak?.inr)} copy={raw(a.peak?.inr)} hint={a.peak ? `On ${date(a.peak.date)}` : undefined} />
    <PortalField id={`fa2:${i}:close`} label="10 · Closing balance" display={inr(a.closing)} copy={raw(a.closing)} hint={`Cash on ${date(r.fa.closeDate)}`} />
    <PortalField id={`fa2:${i}:nature`} label="11a · Nature of Amount" display={`${n.code} — ${n.nature}`} text />
    <PortalField id={`fa2:${i}:amt`} label="11b · Amount" display={inr(n.inr)} copy={raw(n.inr)} hint={r.settings.faIncomeRate === 'txn' ? 'Gross, each credit at its own date’s SBI rate' : 'Gross, at the 31 December SBI rate'} />
  </FieldGroup>
{/each}
