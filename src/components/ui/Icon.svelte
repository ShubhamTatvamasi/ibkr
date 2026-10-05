<script lang="ts">
  import { ICONS } from '../../lib/ui/icons';
  let { name, size = 20, label }: { name: string; size?: number; label?: string } = $props();
</script>

<svg
  class="icon"
  width={size}
  height={size}
  viewBox="0 0 20 20"
  fill="none"
  stroke="currentColor"
  stroke-width="1.5"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden={label ? undefined : 'true'}
  role={label ? 'img' : undefined}
  aria-label={label}
  focusable="false"
>
  {@html ICONS[name] ?? ''}
</svg>
