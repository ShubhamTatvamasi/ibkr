<script lang="ts">
  import Icon from './Icon.svelte';

  let { title, text, icon = 'check-circle', positive = true }: { title: string; text: string; icon?: string; positive?: boolean } = $props();
</script>

<div class="empty card">
  <span class="e-icon" class:positive><Icon name={icon} size={28} /></span>
  <b>{title}</b>
  <p class="muted">{text}</p>
</div>

<style>
  .empty { display: grid; justify-items: center; text-align: center; gap: 8px; padding: 40px 20px; }
  .e-icon { display: grid; place-items: center; width: 64px; height: 64px; border-radius: 50%; background: var(--surface-sunken); color: var(--text-3); margin-bottom: 6px; }
  .e-icon.positive { background: var(--success-soft); color: var(--success); }
  p { max-width: 420px; font-size: var(--fs-ui); }
</style>
