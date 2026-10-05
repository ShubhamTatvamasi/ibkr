<script lang="ts">
  import type { Snippet } from 'svelte';

  let { title, sub, children, aside }: { title: string; sub?: string; children: Snippet; aside?: Snippet } = $props();
</script>

<section class="fg">
  <div class="fg-head">
    <div><h3>{title}</h3>{#if sub}<p>{sub}</p>{/if}</div>
    {#if aside}{@render aside()}{/if}
  </div>
  <div class="fg-body">{@render children()}</div>
</section>

<style>
  .fg { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg); box-shadow: var(--sh-1); overflow: hidden; margin-bottom: 16px; }
  .fg-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding: 14px 16px; border-bottom: 1px solid var(--border); background: var(--surface-sunken); }
  .fg-head h3 { font-size: var(--fs-ui); font-weight: 600; }
  .fg-head p { font-size: var(--fs-caption); color: var(--text-2); margin-top: 2px; }
</style>
