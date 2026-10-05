<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { THEME_OPTIONS, applyTheme, savedTheme, type ThemeChoice } from '../../lib/ui/theme';

  let theme = $state<ThemeChoice>('system');
  onMount(() => (theme = savedTheme()));

  function choose(t: ThemeChoice) {
    theme = t;
    applyTheme(t);
  }
</script>

<div class="theme-switch" role="radiogroup" aria-label="Theme">
  {#each THEME_OPTIONS as o}
    <button role="radio" aria-checked={theme === o.value} class:on={theme === o.value} title={`${o.label} theme`} onclick={() => choose(o.value)}>
      <Icon name={o.icon} size={15} /><span>{o.label}</span>
    </button>
  {/each}
</div>
