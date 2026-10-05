<script lang="ts">
  import Icon from './Icon.svelte';

  let { label, value, sub, icon, tone, onclick }: { label: string; value: string; sub?: string; icon?: string; tone?: 'neg' | 'pos'; onclick?: () => void } = $props();
</script>

{#if onclick}
  <button class="tile link" {onclick}>
    <span class="t-label">{#if icon}<Icon name={icon} size={16} />{/if}{label}</span>
    <span class="t-value num" class:neg={tone === 'neg'}>{value}</span>
    {#if sub}<span class="t-sub">{sub}</span>{/if}
  </button>
{:else}
  <div class="tile">
    <span class="t-label">{#if icon}<Icon name={icon} size={16} />{/if}{label}</span>
    <span class="t-value num" class:neg={tone === 'neg'}>{value}</span>
    {#if sub}<span class="t-sub">{sub}</span>{/if}
  </div>
{/if}

<style>
  .tile { display: grid; align-content: start; gap: 4px; min-height: 108px; padding: 16px 18px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg); box-shadow: var(--sh-1); text-align: left; font: inherit; color: inherit; }
  .tile.link { cursor: pointer; transition: border-color var(--dur-1), box-shadow var(--dur-1); }
  .tile.link:hover { border-color: var(--accent-line); box-shadow: var(--sh-2); }
  .t-label { display: flex; align-items: center; gap: 6px; font-size: var(--fs-caption); font-weight: 500; color: var(--text-2); }
  .t-label :global(.icon) { color: var(--text-3); }
  .t-value { font-size: var(--fs-stat); font-weight: 600; line-height: 1.2; letter-spacing: -0.01em; overflow-wrap: anywhere; }
  .t-value.neg { color: var(--danger-text); }
  .t-sub { font-size: 13px; color: var(--text-3); }
</style>
