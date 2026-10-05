export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'ibkr-tax:theme';

export const THEME_OPTIONS: { value: ThemeChoice; label: string; icon: string }[] = [
  { value: 'system', label: 'System', icon: 'monitor' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
];

export function savedTheme(): ThemeChoice {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

/** "System" removes the override so the page follows the OS setting (prefers-color-scheme). */
export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = choice;
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    /* storage unavailable — the choice lasts for this page only */
  }
}
