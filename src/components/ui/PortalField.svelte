<script lang="ts">
  import CopyButton from './CopyButton.svelte';
  import Icon from './Icon.svelte';
  import { app } from '../state.svelte';

  let {
    id,
    label,
    display,
    copy,
    hint,
    tone,
    text = false,
  }: {
    id: string;
    label: string;
    display: string;
    copy?: string;
    hint?: string;
    tone?: 'muted' | 'warn';
    text?: boolean;
  } = $props();
</script>

<div class="pf" class:warn={tone === 'warn'}>
  <div class="pf-label">
    <span class="lbl">{label}</span>
    {#if hint}<span class="hint">{hint}</span>{/if}
  </div>
  <div class="pf-value num" class:muted={tone === 'muted'} class:text>{display}</div>
  <div class="pf-act">
    {#if copy !== undefined}
      <CopyButton value={copy} {label} {id} />
      <span class="dot" class:on={app.copied[id]} title={app.copied[id] ? 'Copied this session' : ''}>
        {#if app.copied[id]}<Icon name="check" size={14} />{/if}
      </span>
    {/if}
  </div>
</div>

<style>
  .pf { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 8px 16px; align-items: center; min-height: 56px; padding: 10px 16px; border-bottom: 1px solid var(--border); }
  .pf:last-child { border-bottom: 0; }
  .pf.warn { box-shadow: inset 3px 0 0 var(--warn); }
  .pf-label { display: grid; gap: 2px; min-width: 0; }
  .lbl { font-size: var(--fs-ui); font-weight: 500; }
  .hint { font-size: var(--fs-caption); color: var(--text-3); }
  .pf-value { font-size: 15px; font-weight: 600; text-align: right; white-space: nowrap; }
  .pf-value.muted { color: var(--text-3); font-weight: 500; }
  .pf-value.text { font-size: var(--fs-ui); font-weight: 400; white-space: normal; text-align: left; max-width: 320px; }
  .pf-act { display: flex; align-items: center; gap: 6px; }
  .dot { width: 16px; height: 16px; display: grid; place-items: center; color: var(--success); }
  @media (max-width: 640px) {
    .pf { grid-template-columns: minmax(0, 1fr) auto; }
    .pf-label { grid-column: 1 / -1; }
    .pf-value { text-align: left; }
    .pf-value.text { max-width: none; }
  }
</style>
