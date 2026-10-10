<script lang="ts">
  import Icon from './ui/Icon.svelte';
  import ThemeSwitch from './ui/ThemeSwitch.svelte';
  import { app, SCHEDULES, type StepId } from './state.svelte';
  import Setup from './steps/Setup.svelte';
  import Review from './steps/Review.svelte';
  import FileReturn from './steps/FileReturn.svelte';
  import Insights from './steps/Insights.svelte';
  import Downloads from './steps/Downloads.svelte';
  import { BASE } from '../lib/ui/format';
  import { BRAND_MARK } from '../lib/ui/brand';

  const STEPS: { id: StepId; label: string }[] = [
    { id: 'setup', label: 'Upload statements' },
    { id: 'review', label: 'Review issues' },
    { id: 'file', label: 'File your return' },
    { id: 'insights', label: 'Insights' },
    { id: 'downloads', label: 'Downloads' },
  ];

  let menuOpen = $state(false);
  $effect(() => app.saveSettings());

  const ready = $derived(!!app.report);
  const current = $derived<StepId>(ready ? app.step : 'setup');
  const index = $derived(STEPS.findIndex((s) => s.id === current));
  const reviewCount = $derived(app.mustFix + app.needsInput);

  function status(id: StepId): 'done' | 'current' | 'todo' | 'attention' | 'locked' {
    if (id === current) return 'current';
    if (id === 'setup') return ready ? 'done' : 'todo';
    if (!ready) return 'locked';
    if (id === 'review') return reviewCount > 0 ? 'attention' : 'done';
    return 'todo';
  }

  function nav(id: StepId) {
    if (id !== 'setup' && !ready) return;
    menuOpen = false;
    app.go(id);
  }

  const prev = $derived(index > 0 ? STEPS[index - 1] : undefined);
  const next = $derived(index < STEPS.length - 1 ? STEPS[index + 1] : undefined);
</script>

<div id="live-region" class="sr-only" role="status" aria-live="polite"></div>
<div class="shell">
  <aside class="sidebar" class:open={menuOpen} aria-label="Navigation">
    <div class="side-head">
      <a class="brand" href={BASE}>{@html BRAND_MARK}<span>IBKR India Tax</span></a>
      <button class="btn ghost sm icon-only close" aria-label="Close menu" onclick={() => (menuOpen = false)}><Icon name="x" /></button>
    </div>

    <nav aria-label="Steps">
      <p class="overline">Steps</p>
      <ol class="steps">
        {#each STEPS as s}
          {@const st = status(s.id)}
          <li>
            <button
              class="step {st}"
              aria-current={st === 'current' ? 'step' : undefined}
              disabled={st === 'locked'}
              title={st === 'locked' ? 'Upload your statements first' : undefined}
              onclick={() => nav(s.id)}
            >
              <span class="st-icon">
                {#if st === 'done'}<Icon name="check-circle" />{:else if st === 'attention'}<Icon name="warn" />{:else if st === 'current'}<Icon name="step-current" />{:else if st === 'locked'}<Icon name="lock" size={18} />{:else}<Icon name="step-todo" />{/if}
              </span>
              <span class="st-label">{s.label}</span>
              {#if s.id === 'review' && ready && reviewCount > 0}<span class="badge danger">{reviewCount}</span>{/if}
              <span class="sr-only">{st === 'done' ? '(completed)' : st === 'attention' ? '(needs attention)' : ''}</span>
            </button>
            {#if s.id === 'file' && ready}
              <ul class="sub">
                {#each SCHEDULES as sc}
                  <li>
                    <button
                      class:active={current === 'file' && app.schedule === sc.id}
                      onclick={() => {
                        menuOpen = false;
                        app.go('file', sc.id);
                      }}>{sc.id === 'form67' ? `${app.year.law.ftcForm} · foreign tax credit` : sc.label}</button
                    >
                  </li>
                {/each}
              </ul>
            {/if}
          </li>
        {/each}
      </ol>
    </nav>

    <div class="side-foot">
      <div class="privacy"><Icon name="shield" size={18} /><span>Processed in your browser. Nothing is uploaded or stored.</span></div>
      <div class="foot-links">
        <a href={`${BASE}guide/`}><Icon name="book" size={16} /> Flex Query guide</a>
        <a href={`${BASE}method/`}><Icon name="info" size={16} /> How it's calculated</a>
        <a href={`${BASE}assets/`}><Icon name="building" size={16} /> Address book</a>
      </div>
      <ThemeSwitch />
    </div>
  </aside>
  {#if menuOpen}<button class="scrim" aria-label="Close menu" onclick={() => (menuOpen = false)}></button>{/if}

  <div class="main">
    <header class="topbar">
      <button class="btn ghost icon-only menu-btn" aria-label="Open menu" onclick={() => (menuOpen = true)}><Icon name="menu" /></button>
      <div class="tb-title">
        <span class="faint">Step {index + 1} of {STEPS.length}</span>
        <b>{STEPS[index].label}</b>
      </div>
      <div class="tb-right">
        {#if ready}<span class="badge accent year"><Icon name="calendar" size={14} />{app.year.label}</span>{/if}
        {#if app.isSample}<span class="badge warn">Sample data</span>{/if}
        {#if app.data}<button class="btn ghost sm" onclick={() => app.clear()}><Icon name="refresh" size={16} /><span class="hide-sm">Start over</span></button>{/if}
      </div>
    </header>
    <div class="progress" aria-hidden="true"><span style:width={`${((index + 1) / STEPS.length) * 100}%`}></span></div>

    <main class="content">
      {#if current === 'setup'}
        <Setup />
      {:else if current === 'review'}
        <Review />
      {:else if current === 'file'}
        <FileReturn />
      {:else if current === 'insights'}
        <Insights />
      {:else}
        <Downloads />
      {/if}
    </main>

    {#if ready && current !== 'file'}
      <nav class="bottombar" aria-label="Step navigation">
        {#if prev}<button class="btn" onclick={() => nav(prev.id)}><Icon name="arrow-left" size={18} />{prev.label}</button>{:else}<span></span>{/if}
        {#if next}<button class="btn primary" onclick={() => nav(next.id)}>{next.label}<Icon name="arrow-right" size={18} /></button>{/if}
      </nav>
    {/if}
  </div>
</div>

<style>
  .shell { display: grid; grid-template-columns: var(--sidebar-w) minmax(0, 1fr); min-height: 100dvh; background: var(--bg); }
  .sidebar {
    position: sticky; top: 0; height: 100dvh; overflow-y: auto; z-index: 20;
    display: flex; flex-direction: column; gap: 24px;
    background: var(--chrome); border-right: 1px solid var(--chrome-border); padding: 18px 14px;
  }
  .side-head { display: flex; align-items: center; justify-content: space-between; padding: 0 6px; }
  .side-head :global(.brand) { color: var(--chrome-text); }
  .close { display: none; }
  .overline { font-size: var(--fs-overline); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; color: var(--chrome-text-3); padding: 0 10px; margin-bottom: 8px; }
  .steps, .sub { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
  .step {
    position: relative; display: flex; align-items: center; gap: 10px; width: 100%; min-height: 38px;
    padding: 0 10px; border: 0; border-radius: var(--r-md); background: none;
    font: 500 var(--fs-ui) / 1.3 var(--font-sans); color: var(--chrome-text-2); text-align: left; cursor: pointer;
  }
  .step:hover:not(:disabled) { background: var(--chrome-hover); color: var(--chrome-text); }
  .step.current { background: var(--chrome-current); color: var(--chrome-current-text); font-weight: 600; }
  .step.current::before { content: ''; position: absolute; left: 0; top: 8px; bottom: 8px; width: 3px; border-radius: 2px; background: var(--accent); }
  .step:disabled { color: var(--chrome-text-3); cursor: not-allowed; }
  .st-icon { display: grid; place-items: center; width: 20px; }
  .step.done .st-icon { color: var(--success); }
  .step.attention .st-icon { color: var(--warn); }
  .step.current .st-icon { color: var(--accent); }
  .st-label { flex: 1; }
  .sub { margin: 2px 0 6px 29px; border-left: 1px solid var(--chrome-border); padding-left: 8px; }
  .sub button { width: 100%; text-align: left; border: 0; background: none; padding: 6px 10px; border-radius: var(--r-sm); font: 400 13px/1.3 var(--font-sans); color: var(--chrome-text-2); cursor: pointer; }
  .sub button:hover { background: var(--chrome-hover); color: var(--chrome-text); }
  .sub button.active { color: var(--chrome-current-text); background: var(--chrome-current); font-weight: 500; }
  .side-foot { margin-top: auto; display: grid; gap: 12px; padding: 0 6px; }
  .privacy { display: flex; gap: 8px; align-items: flex-start; font-size: var(--fs-caption); color: var(--chrome-text-2); background: var(--chrome-2); padding: 10px; border-radius: var(--r-md); }
  .privacy :global(.icon) { color: var(--success); }
  .foot-links { display: grid; gap: 4px; }
  .foot-links a { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--chrome-text-2); text-decoration: none; padding: 4px; border-radius: var(--r-sm); }
  .foot-links a:hover { color: var(--chrome-text); background: var(--chrome-hover); }

  .main { min-width: 0; display: flex; flex-direction: column; }
  .topbar { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 12px; height: 56px; padding: 0 32px; background: color-mix(in srgb, var(--chrome) 86%, transparent); backdrop-filter: saturate(1.4) blur(10px); -webkit-backdrop-filter: saturate(1.4) blur(10px); border-bottom: 1px solid var(--chrome-border); }
  .topbar :global(.btn.ghost) { color: var(--chrome-text-2); }
  .topbar :global(.btn.ghost:hover) { background: var(--chrome-hover); color: var(--chrome-text); }
  .menu-btn { display: none; }
  .tb-title { display: flex; flex-direction: column; line-height: 1.25; font-size: var(--fs-ui); min-width: 0; color: var(--chrome-text); }
  .tb-title .faint { font-size: var(--fs-caption); color: var(--chrome-text-3); }
  .tb-right { margin-left: auto; display: flex; align-items: center; gap: 8px; }
  .progress { height: 3px; }
  .progress span { display: block; height: 100%; background: var(--accent); transition: width var(--dur-3) var(--ease-out); }
  .content { flex: 1; width: 100%; max-width: 1200px; padding: 32px 32px 56px; }
  .bottombar { position: sticky; bottom: 0; z-index: 10; display: flex; justify-content: space-between; gap: 12px; padding: 12px 32px calc(12px + env(safe-area-inset-bottom)); background: color-mix(in srgb, var(--bg) 92%, transparent); backdrop-filter: blur(8px); border-top: 1px solid var(--border); }
  .scrim { display: none; }

  @media (max-width: 1023px) {
    .shell { grid-template-columns: minmax(0, 1fr); background: none; }
    .sidebar { position: fixed; inset: 0 auto 0 0; width: min(320px, 86vw); transform: translateX(-100%); transition: transform var(--dur-3) var(--ease-out); box-shadow: var(--sh-3); visibility: hidden; }
    .sidebar.open { transform: none; visibility: visible; }
    .close, .menu-btn { display: inline-flex; }
    .scrim { display: block; position: fixed; inset: 0; z-index: 15; background: rgb(0 0 0 / 0.35); border: 0; }
    .topbar { padding: 0 12px; }
    .content { padding: 20px 16px 32px; }
    .bottombar { padding: 10px 16px calc(10px + env(safe-area-inset-bottom)); }
    .bottombar .btn { flex: 1; min-width: 0; }
  }
  @media (max-width: 640px) {
    .year, .hide-sm { display: none; }
  }
</style>
