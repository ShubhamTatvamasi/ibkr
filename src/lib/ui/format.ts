import type Decimal from 'decimal.js';

const inrFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const fxFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function inr(d: Decimal | number | undefined | null): string {
  if (d === undefined || d === null) return '—';
  const n = typeof d === 'number' ? d : d.toNumber();
  return `₹${inrFmt.format(Math.round(n))}`;
}

export function money(d: Decimal | undefined | null, ccy = 'USD'): string {
  if (d === undefined || d === null) return '—';
  const sym = ccy === 'USD' ? '$' : ccy === 'EUR' ? '€' : ccy === 'GBP' ? '£' : `${ccy} `;
  const n = d.toNumber();
  return `${n < 0 ? '−' : ''}${sym}${fxFmt.format(Math.abs(n))}`;
}

export function num(d: Decimal | undefined | null): string {
  if (d === undefined || d === null) return '—';
  return d.toDecimalPlaces(4).toString();
}

export function date(d: string | undefined): string {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1];
  return `${Number(day)} ${mon} ${y}`;
}

export function store<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`ibkr-tax:${key}`);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

export function persist(key: string, value: unknown) {
  try {
    localStorage.setItem(`ibkr-tax:${key}`, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode) — settings just won't persist */
  }
}

export function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const BASE = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
