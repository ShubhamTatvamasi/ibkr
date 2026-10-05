<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import { app } from '../state.svelte';

  let { title, path, period, ids = [], children }: { title: string; path: string; period: string; ids?: string[]; children?: Snippet } = $props();
  const done = $derived(ids.filter((id) => app.copied[id]).length);
</script>

<header class="sh">
  <div class="sh-top">
    <div>
      <h1>{title}</h1>
      <p class="path"><Icon name="chevron-right" size={14} />{path}</p>
    </div>
    <span class="badge accent"><Icon name="calendar" size={14} />{period}</span>
  </div>
  {#if ids.length}
    <div class="sh-progress">
      <div class="bar"><span style:width={`${(done / ids.length) * 100}%`}></span></div>
      <span class="num faint">{done} of {ids.length} values copied</span>
    </div>
  {/if}
  {#if children}<div class="sh-note">{@render children()}</div>{/if}
</header>

<style>
  .sh { margin-bottom: 20px; display: grid; gap: 14px; }
  .sh-top { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; align-items: flex-start; }
  .path { display: flex; align-items: center; gap: 4px; margin-top: 6px; font-size: 13px; color: var(--text-2); }
  .path :global(.icon) { color: var(--text-3); }
  .sh-progress { display: flex; align-items: center; gap: 12px; font-size: var(--fs-caption); }
  .bar { flex: 1; max-width: 280px; height: 6px; border-radius: var(--r-pill); background: var(--surface-sunken); overflow: hidden; }
  .bar span { display: block; height: 100%; background: var(--success); transition: width var(--dur-3) var(--ease-out); }
  .sh-note { display: grid; gap: 10px; }
</style>
