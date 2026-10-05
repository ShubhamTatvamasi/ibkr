// Builds public/data/ttbr/{CCY}.json from sahilgupta/sbi-fx-ratekeeper (MIT).
// Keeps only the SBI TT buying rate, one rate per date: the first card SBI published
// that day (later same-day revisions are ignored), skipping the 0.00 placeholder rows.
import { mkdir, writeFile } from 'node:fs/promises';

const SOURCE = 'https://github.com/sahilgupta/sbi-fx-ratekeeper';
const RAW = 'https://raw.githubusercontent.com/sahilgupta/sbi-fx-ratekeeper/main/csv_files';
const CURRENCIES = ['USD', 'EUR', 'GBP', 'SGD', 'HKD', 'JPY', 'CHF', 'CAD', 'AUD'];
const OUT_DIR = new URL('../public/data/ttbr/', import.meta.url);

function parse(csv) {
  const [header, ...lines] = csv.trim().split(/\r?\n/);
  const cols = header.split(',');
  const iDate = cols.indexOf('DATE');
  const iBuy = cols.indexOf('TT BUY');
  if (iDate < 0 || iBuy < 0) throw new Error(`unexpected header: ${header}`);

  const firstByDate = new Map();
  for (const line of lines) {
    const f = line.split(',');
    const stamp = f[iDate]; // "YYYY-MM-DD HH:MM"
    const date = stamp.slice(0, 10);
    const buy = f[iBuy]?.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !buy || Number(buy) <= 0) continue;
    const prev = firstByDate.get(date);
    if (!prev || stamp < prev.stamp) firstByDate.set(date, { stamp, buy });
  }
  const rates = {};
  for (const date of [...firstByDate.keys()].sort()) rates[date] = firstByDate.get(date).buy;
  return rates;
}

await mkdir(OUT_DIR, { recursive: true });
const index = {};
for (const ccy of CURRENCIES) {
  const res = await fetch(`${RAW}/SBI_REFERENCE_RATES_${ccy}.csv`);
  if (!res.ok) throw new Error(`${ccy}: HTTP ${res.status}`);
  const rates = parse(await res.text());
  const dates = Object.keys(rates);
  const file = { currency: ccy, source: SOURCE, from: dates[0], to: dates.at(-1), rates };
  await writeFile(new URL(`${ccy}.json`, OUT_DIR), JSON.stringify(file));
  index[ccy] = { from: file.from, to: file.to, count: dates.length };
  console.log(`${ccy}: ${dates.length} rates, ${file.from} → ${file.to}`);
}
await writeFile(
  new URL('index.json', OUT_DIR),
  JSON.stringify({ generatedAt: new Date().toISOString(), source: SOURCE, currencies: index }, null, 2),
);
