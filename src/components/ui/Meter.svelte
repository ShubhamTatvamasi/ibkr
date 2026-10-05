<script lang="ts">
  let { value, max, label, valueText, maxText }: { value: number; max: number; label: string; valueText: string; maxText: string } = $props();
  const pct = $derived(max > 0 ? (value / max) * 100 : 0);
  const zone = $derived(value > max ? 'danger' : value >= 0.75 * max ? 'warn' : 'ok');
  const scale = $derived(Math.max(value, max) * 1.08);
</script>

<div class="meter">
  <div class="track" role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-valuetext={`${valueText} of ${maxText}`}>
    <span class="fill {zone}" style:width={`${(value / scale) * 100}%`}></span>
    <span class="tick" style:left={`${(max / scale) * 100}%`}></span>
  </div>
  <div class="legend">
    <span class="num"><b>{valueText}</b> · {pct.toFixed(0)}% of threshold</span>
    <span class="num faint">threshold {maxText}</span>
  </div>
</div>

<style>
  .track { position: relative; height: 10px; border-radius: var(--r-pill); background: var(--surface-sunken); overflow: visible; }
  .fill { position: absolute; inset: 0 auto 0 0; border-radius: var(--r-pill); background: var(--accent); }
  .fill.warn { background: var(--warn); }
  .fill.danger { background: var(--danger); }
  .tick { position: absolute; top: -4px; bottom: -4px; width: 2px; background: var(--text); border-radius: 1px; }
  .legend { display: flex; justify-content: space-between; gap: 12px; margin-top: 8px; font-size: 13px; color: var(--text-2); flex-wrap: wrap; }
</style>
