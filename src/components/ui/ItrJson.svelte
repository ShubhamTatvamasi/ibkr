<script lang="ts">
  import Icon from './Icon.svelte';
  import { app } from '../state.svelte';
  import { ITR_JSON_AY, ITR_SCHEMA_VERSION, itrSchedules, mergeScheduleFA, schedulesFile } from '../../lib/itr/json';
  import { packPrefix } from '../../lib/export/pack';
  import { download } from '../../lib/ui/format';

  const r = $derived(app.report!);
  const supported = $derived(r.year.ayStart === ITR_JSON_AY);
  const built = $derived(itrSchedules(r, app.entities));
  const faIssues = $derived(built.issues.filter((i) => i.schedule.startsWith('FA')));
  const hasFa = $derived(built.schedules.ScheduleFA.DtlsForeignEquityDebtInterest.length + built.schedules.ScheduleFA.DtlsForeignCustodialAcc.length > 0);

  let input: HTMLInputElement | undefined = $state();
  let mergeError = $state('');
  let mergeNotes = $state<string[]>([]);

  function downloadSchedules() {
    const text = schedulesFile(r, built.schedules, new Date().toISOString().slice(0, 10));
    download(`${packPrefix(r)}_itr2_schedules.json`, new Blob([text], { type: 'application/json' }));
  }

  async function merge(file: File | undefined) {
    mergeError = '';
    mergeNotes = [];
    if (!file) return;
    try {
      const { json, notes } = mergeScheduleFA(await file.text(), built.schedules.ScheduleFA, r.year.ayStart);
      download(file.name.replace(/\.json$/i, '') + '_with_schedule_FA.json', new Blob([json], { type: 'application/json' }));
      mergeNotes = notes;
    } catch (e) {
      mergeError = (e as Error).message;
    } finally {
      if (input) input.value = '';
    }
  }
</script>

<section class="card itr">
  <div class="card-head">
    <div>
      <h3>ITR-2 JSON <span class="badge info">Experimental</span></h3>
      <p>The same figures in the official ITR-2 JSON format ({ITR_SCHEMA_VERSION}). Typing Schedule FA row by row is the slowest part of the return; this can do it for you.</p>
    </div>
  </div>

  {#if !supported}
    <p class="muted">
      {r.year.newAct
        ? `The ITR forms and JSON schema for ${r.year.label.split(' (')[0]} have not been published yet. This will be available once they are.`
        : `JSON is generated for AY 2026-27 only. For ${r.year.label.split(' (')[0]}, enter the values from “File your return”.`}
    </p>
  {:else}
    {#if built.issues.length}
      <div class="callout warn">
        <Icon name="warn" />
        <div>
          <b>Fill these in first</b>
          <ul class="issues">{#each built.issues as i}<li><span class="badge">{i.schedule}</span>{i.message}</li>{/each}</ul>
        </div>
      </div>
    {/if}

    <div class="opts">
      <div class="opt">
        <span class="o-icon"><Icon name="file-text" size={22} /></span>
        <div>
          <b>Schedules on their own</b>
          <p>Schedule FA (A2, A3), FSI and TR objects, checked against the official schema. Useful for your CA's software or to compare with what you typed. The portal itself only accepts a complete return.</p>
          <button class="btn sm" onclick={downloadSchedules}><Icon name="download" size={16} />Download JSON</button>
        </div>
      </div>

      <div class="opt">
        <span class="o-icon"><Icon name="upload" size={22} /></span>
        <div>
          <b>Add Schedule FA to your ITR-2 JSON</b>
          <ol>
            <li>Prepare the rest of your return in the official ITR-2 offline utility and generate its JSON.</li>
            <li>Choose that file here. Tables A2 and A3 are replaced with these rows; nothing else changes.</li>
            <li>On the portal: e-File → File Income Tax Return → AY 2026-27 → Offline → upload the new file, and check Schedule FA in the preview before you submit.</li>
          </ol>
          <input bind:this={input} type="file" accept=".json,application/json" hidden onchange={(e) => merge(e.currentTarget.files?.[0])} />
          <button class="btn sm" disabled={!hasFa || faIssues.length > 0} onclick={() => input?.click()}><Icon name="upload" size={16} />Choose ITR-2 JSON</button>
          {#if !hasFa}<small class="faint">No Schedule FA rows for this year.</small>{:else if faIssues.length}<small class="faint">Fill in the Schedule FA items above first.</small>{/if}
        </div>
      </div>
    </div>

    {#if mergeError}
      <div class="callout danger" role="alert"><Icon name="error" /><div><b>Couldn't add Schedule FA</b><p>{mergeError}</p></div></div>
    {/if}
    {#if mergeNotes.length}
      <div class="callout success" role="status">
        <Icon name="check-circle" />
        <div>
          <b>Downloaded the updated return</b>
          <ul class="issues">{#each mergeNotes as n}<li>{n}</li>{/each}</ul>
          <p>If the portal rejects the file, enter Schedule FA from “File your return” instead — your original JSON is unchanged.</p>
        </div>
      </div>
    {/if}
  {/if}
</section>

<style>
  .itr { margin: 16px 0 24px; display: grid; gap: 14px; }
  .itr .card-head { margin-bottom: 0; }
  h3 { display: flex; align-items: center; gap: 8px; }
  .opts { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; }
  .opt { display: grid; grid-template-columns: 32px 1fr; gap: 12px; padding: 16px; border: 1px solid var(--border); border-radius: var(--r-lg); background: var(--surface-sunken); }
  .opt b { display: block; font-size: var(--fs-ui); }
  .opt p, .opt ol { font-size: 13px; color: var(--text-2); margin: 4px 0 12px; }
  .opt ol { padding-left: 18px; display: grid; gap: 4px; }
  .opt small { display: block; margin-top: 6px; }
  .o-icon { color: var(--accent); }
  .issues { margin: 6px 0 0; padding: 0; list-style: none; display: grid; gap: 4px; font-size: 13px; }
  .issues li { display: flex; gap: 8px; align-items: baseline; }
  .callout { grid-template-columns: 20px 1fr; }
</style>
