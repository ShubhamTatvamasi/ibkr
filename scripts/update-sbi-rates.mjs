// Adds today's SBI TT buying rates to public/data/ttbr/{CCY}.json.
//
// Source: SBI's published "Forex Card Rates" PDF. It only ever shows the current card, so the
// archive is built by running this daily (see .github/workflows/deploy.yml) and committing the result.
// A date that is already recorded is never overwritten: the first card seen for a day is kept.
//
//   node scripts/update-sbi-rates.mjs [path/to/card.pdf]   (defaults to downloading the live card)
import { readFile, writeFile } from 'node:fs/promises';
import { extractText, getDocumentProxy } from 'unpdf';

const CARD_URLS = [
  'https://sbi.bank.in/documents/16012/1400784/FOREX_CARD_RATES.pdf',
  'https://bank.sbi/documents/16012/1400784/FOREX_CARD_RATES.pdf',
];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'SGD', 'HKD', 'JPY', 'CHF', 'CAD', 'AUD'];
/** SBI quotes these per 100 units of foreign currency. */
const PER_100 = new Set(['JPY', 'THB', 'KRW']);
const SOURCE = 'State Bank of India — Forex Card Rates, TT buying rate';
const DIR = new URL('../public/data/ttbr/', import.meta.url);

async function loadCard() {
  const local = process.argv[2];
  if (local) return new Uint8Array(await readFile(local));
  for (const url of CARD_URLS) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (rate archive)' } });
      if (res.ok && res.headers.get('content-type')?.includes('pdf')) return new Uint8Array(await res.arrayBuffer());
      console.warn(`${url}: HTTP ${res.status}`);
    } catch (e) {
      console.warn(`${url}: ${e.message}`);
    }
  }
  throw new Error('could not download the SBI forex card');
}

export function parseCard(text) {
  const d = /Date\s+(\d{2})-(\d{2})-(\d{4})/.exec(text);
  const t = /Time\s+(\d{1,2}:\d{2}\s*[AP]M)/i.exec(text);
  if (!d) throw new Error('card date not found');
  const date = `${d[3]}-${d[2]}-${d[1]}`;
  const rates = {};
  for (const ccy of CURRENCIES) {
    // e.g. "UNITED STATES DOLLAR USD/INR 95.85 96.7 ..." — the first number is TT BUY.
    const m = new RegExp(`\\b${ccy}/INR\\s+([\\d.]+)`).exec(text);
    if (m && Number(m[1]) > 0) rates[ccy] = m[1];
  }
  return { date, time: t?.[1].replace(/\s+/g, ' ').toUpperCase(), rates };
}

async function readJson(name, fallback) {
  try {
    return JSON.parse(await readFile(new URL(name, DIR), 'utf8'));
  } catch {
    return fallback;
  }
}

const pdf = await getDocumentProxy(await loadCard());
const { text } = await extractText(pdf, { mergePages: true });
const card = parseCard(text);
console.log(`SBI card ${card.date} ${card.time ?? ''}`);

let changed = false;
const index = await readJson('index.json', { currencies: {} });
for (const ccy of CURRENCIES) {
  const file = await readJson(`${ccy}.json`, { currency: ccy, rates: {} });
  const next = {
    currency: ccy,
    per: PER_100.has(ccy) ? 100 : 1,
    source: SOURCE,
    from: '',
    to: '',
    rates: { ...file.rates },
  };
  const rate = card.rates[ccy];
  if (rate && !next.rates[card.date]) {
    next.rates[card.date] = rate;
    changed = true;
    console.log(`  ${ccy} ${rate}`);
  }
  const dates = Object.keys(next.rates).sort();
  next.rates = Object.fromEntries(dates.map((k) => [k, next.rates[k]]));
  next.from = dates[0];
  next.to = dates.at(-1);
  const out = JSON.stringify(next);
  if (out !== JSON.stringify(file)) {
    await writeFile(new URL(`${ccy}.json`, DIR), out);
    changed = true;
  }
  index.currencies[ccy] = { from: next.from, to: next.to, count: dates.length, per: next.per };
}
if (changed) {
  index.source = SOURCE;
  index.updatedAt = new Date().toISOString();
  delete index.generatedAt;
  await writeFile(new URL('index.json', DIR), JSON.stringify(index, null, 2) + '\n');
}
console.log(changed ? 'rates updated' : 'no new rates');
