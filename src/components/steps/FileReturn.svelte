<script lang="ts">
  import Icon from '../ui/Icon.svelte';
  import { app, SCHEDULES } from '../state.svelte';
  import Form67 from '../schedules/Form67.svelte';
  import ScheduleCG from '../schedules/ScheduleCG.svelte';
  import ScheduleOS from '../schedules/ScheduleOS.svelte';
  import ScheduleFSI from '../schedules/ScheduleFSI.svelte';
  import ScheduleTR from '../schedules/ScheduleTR.svelte';
  import ScheduleFA2 from '../schedules/ScheduleFA2.svelte';
  import ScheduleFA3 from '../schedules/ScheduleFA3.svelte';

  const i = $derived(SCHEDULES.findIndex((s) => s.id === app.schedule));
  const prev = $derived(SCHEDULES[i - 1]);
  const next = $derived(SCHEDULES[i + 1]);
  const label = (id: string) => (id === 'form67' ? app.year.law.ftcForm : SCHEDULES.find((s) => s.id === id)!.short);
</script>

<nav class="chips" aria-label="Schedules">
  {#each SCHEDULES as s, n}
    <button class="chip" class:active={app.schedule === s.id} aria-current={app.schedule === s.id ? 'page' : undefined} onclick={() => app.go('file', s.id)}>
      <span class="n num">{n + 1}</span>{label(s.id)}
    </button>
  {/each}
</nav>

{#key app.schedule}
  <div class="page">
    {#if app.schedule === 'form67'}<Form67 />
    {:else if app.schedule === 'cg'}<ScheduleCG />
    {:else if app.schedule === 'os'}<ScheduleOS />
    {:else if app.schedule === 'fsi'}<ScheduleFSI />
    {:else if app.schedule === 'tr'}<ScheduleTR />
    {:else if app.schedule === 'fa-a2'}<ScheduleFA2 />
    {:else}<ScheduleFA3 />{/if}
  </div>
{/key}

<div class="pager">
  {#if prev}<button class="btn" onclick={() => app.go('file', prev.id)}><Icon name="arrow-left" size={18} />{label(prev.id)}</button>
  {:else}<button class="btn" onclick={() => app.go('review')}><Icon name="arrow-left" size={18} />Review issues</button>{/if}
  {#if next}<button class="btn primary" onclick={() => app.go('file', next.id)}>Next: {label(next.id)}<Icon name="arrow-right" size={18} /></button>
  {:else}<button class="btn primary" onclick={() => app.go('insights')}>Done — see insights<Icon name="arrow-right" size={18} /></button>{/if}
</div>

<style>
  .chips { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; margin: -4px 0 20px; scroll-snap-type: x proximity; scrollbar-width: thin; }
  .chip { flex: none; scroll-snap-align: start; display: inline-flex; align-items: center; gap: 8px; height: 34px; padding: 0 12px 0 6px; border-radius: var(--r-pill); border: 1px solid var(--border); background: var(--surface); font: 500 13px/1 var(--font-sans); color: var(--text-2); cursor: pointer; }
  .chip:hover { border-color: var(--border-strong); color: var(--text); }
  .chip.active { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
  .n { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--surface-sunken); color: var(--text-2); font-size: 11.5px; font-weight: 600; }
  .chip.active .n { background: color-mix(in srgb, var(--on-accent) 20%, transparent); color: var(--on-accent); }
  .page { animation: fade var(--dur-3) var(--ease-out); }
  @keyframes fade { from { opacity: 0; transform: translateY(4px); } }
  .pager { display: flex; justify-content: space-between; gap: 12px; margin-top: 28px; padding-top: 20px; border-top: 1px solid var(--border); }
</style>
