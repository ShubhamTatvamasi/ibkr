<script lang="ts">
  import Icon from './Icon.svelte';
  import { app } from '../state.svelte';

  let { value, label, id, compact = false }: { value: string; label: string; id?: string; compact?: boolean } = $props();
  let done = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const t = document.createElement('textarea');
      t.value = value;
      document.body.append(t);
      t.select();
      document.execCommand('copy');
      t.remove();
    }
    done = true;
    if (id) app.copied = { ...app.copied, [id]: true };
    announce(`Copied ${value}`);
    clearTimeout(timer);
    timer = setTimeout(() => (done = false), 1600);
  }

  function announce(msg: string) {
    const live = document.getElementById('live-region');
    if (live) live.textContent = msg;
  }
</script>

<button class="btn sm copy" class:icon-only={compact} class:success-state={done} onclick={copy} aria-label={`Copy ${label}: ${value}`} title={`Copies ${value}`}>
  <Icon name={done ? 'check' : 'copy'} size={16} />
  {#if !compact}<span>{done ? 'Copied' : 'Copy'}</span>{/if}
</button>

<style>
  .copy { min-width: 84px; }
  .copy.icon-only { min-width: 0; }
</style>
