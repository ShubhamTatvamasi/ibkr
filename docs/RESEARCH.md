# R&D notes — IBKR → Indian tax reports

Researched 2026-10-05. Not tax advice; every rule below should be confirmed with a CA, and the
open questions (§6) are surfaced to users as explicit settings rather than silently decided.

## 1. Reference product: ethro.in (teardown)

- IBKR-only. Outputs six CSVs (USD + INR) plus a readme: `schedule_fa_A3_for_CA.csv`,
  `schedule_fa_a2_custodian_account.csv`, `capital_gains_workings_for_CA.csv`,
  `dividend_workings_for_CA.csv`, `interest_workings_for_CA.csv`, `ftc_workings_for_CA.csv`.
- Input: one Activity Flex Query (CSV), run twice — Jan–Dec for Schedule FA, Apr–Mar for CG/OS.
  Fallback: yearly Activity Statement CSVs (FIFO replay, no true lot data).
- Flex sections it requires:
  - Account Information: Account ID, Date Opened
  - Cash Report: Currency, Starting Cash, Ending Cash
  - Open Positions (**Lot** level): Currency, Symbol, Description, Issuer, Issuer Country Code,
    Report Date, Quantity, Mark Price, Position Value, Cost Basis Price, Cost Basis Money, Open Date Time
  - Trades (**Execution + Closed Lots**): Currency, Symbol, Description, Issuer, Issuer Country Code,
    Trade Date, Quantity, Trade Money, IB Commission, Buy/Sell, Proceeds, Cost Basis, Realized P/L, Open Date Time
  - Cash Transactions (**Detail**): Currency, Symbol, Description, Issuer, Issuer Country Code, Date/Time, Amount, Type
- Method: per-lot A3 rows; peak = max over trading days of qty × close × that day's SBI TTBR
  (max of the INR series); dividends attributed only to lots held on the date; split correction;
  daily cash replay for A2 peak; 24-month LTCG rule; quarterly dividend breakup for 234C.
- **Despite the "never stored" copy, processing is server-side**: the SPA POSTs files to
  `/api/ibkr/generate` and downloads `/api/ibkr/download/{id}.zip`. Only the two side tools run in-browser.
- Pricing ₹200 / account / FY (free at launch).

Our differentiator: **100 % in-browser** (static site, no backend), Flex **XML** input,
full FA + CG + OS + FSI/TR + Form 67 pack, every figure carrying its rate/date/source (audit trail).

## 2. Competitors / prior art

| Product | Notes |
|---|---|
| itrfa.in | Multi-broker, A2/A3/D/F, CG, Form 67, portal CSV. ₹399. Server-side. |
| getschedulefa.com | ₹499, server-side, ~4h turnaround. |
| FinDrishti | PDF + AI extraction, ₹349. |
| Moneydoot | Free FA calculator, in-browser, manual entry. |
| [manojVivek/itr-schedule-fa-from-ibkr](https://github.com/manojVivek/itr-schedule-fa-from-ibkr) | **MIT, TS, closest OSS.** Activity CSV → FA only; Yahoo prices via Vercel proxy. Great methodology doc + fixtures. |
| [akagr/finance-tools `itr-foreign`](https://github.com/akagr/finance-tools) | Go, MIT. Flex XML → FA/FSI/TR/Form 67, audit trail, exact/approximate peak modes. |
| [VlKAS/open-tax-ledger](https://github.com/VlKAS/open-tax-ledger) | Static GH Pages app, **AGPL** — ideas only, don't copy code. |
| [csingley/ibflex](https://github.com/csingley/ibflex) | Python, MIT. Canonical Flex XML schema + enums → port to TS types. |
| [bagdeabhishek/prepare-india-tax-return](https://github.com/bagdeabhishek/prepare-india-tax-return) | Portal A2/A3 CSV quirks. |

No maintained JS Flex parser or tax-lot library exists on npm — we write both.

## 3. Data sources

### IBKR
- **Flex Web Service has no CORS** (verified) → primary path is "download XML in Client Portal, drop it
  into the app". Optional later: self-deployable Cloudflare Worker proxy, or a local CLI.
- Flex run limit 365 days; history available for 4 previous calendar years + YTD. Lots older than
  that still appear in Open Positions (Lot) with `openDateTime`.
- Use **XML** (attributes, multi-account safe). CSV Flex mixes headers/trailers and is fragile.
- Recommended sections (our query, superset of ethro's): Account Information, Trades (Executions +
  Closed Lots), Open Positions (Lot), Cash Transactions (Detail), Corporate Actions, Transfers,
  Financial Instrument Information, Cash Report, Statement of Funds (running cash balance → A2 peak),
  **Prior Period Positions** (daily `date`/`price` per held position → peak value with no external
  price API — *verify daily coverage on a real export*), Change in Dividend Accruals (ex-date).
- Activity Statement CSV: column 1 section, column 2 `Header|Data|SubTotal|Total|Notes`; headers can
  re-appear mid-section; skip Total/SubTotal rows.

### SBI TT buying rate
- [sahilgupta/sbi-fx-ratekeeper](https://github.com/sahilgupta/sbi-fx-ratekeeper) (MIT, daily auto-commits,
  31 currencies, from Jan 2020). `raw.githubusercontent.com` serves `access-control-allow-origin: *`.
- Quirks: duplicate rows per date (rate revisions), `TT BUY = 0.00` rows (2020–22 Saturdays),
  missing working days and month-ends → fall back to the latest earlier published rate.
- Pre-2020 rates are absent → RBI/FBIL reference rate with a visible warning, or manual entry.
- We vendor it at build time into `public/data/ttbr/{CCY}.json` (nightly rebuild).

### Daily prices (only if Prior Period Positions is insufficient)
- Browser-CORS-friendly with a user-supplied key: Twelve Data (800/day), Polygon, FMP, Alpha Vantage (small).
- Yahoo / Stooq / Tiingo / EODHD: no CORS or now bot-walled; redistribution of their data is a ToS risk.
- Order: IBKR prior-period prices → user API key → manual price CSV. Each peak tagged *exact* / *approximate*.

## 4. Tax rules the engine implements

**Which law:** AY 2026-27 (FY 2025-26) is under the Income-tax Act 1961. From tax year 2026-27 (old
"AY 2027-28") the **Income-tax Act 2025** + **Income-tax Rules 2026** apply: Rule 115 → **Rule 206**,
Rule 128 → **Rule 76**, Form 67 → **Form 44**, s.112 → **s.197**, s.139 → **s.263**. Labels must be year-aware.

### Exchange-rate rules (SBI TTBR)
| Item | Date of rate |
|---|---|
| Capital gains | last day of month **preceding** month of transfer (R.115 / R.206 Sl.6) |
| Dividends | last day of month preceding month declared/distributed/paid (R.115 / R.206 Sl.5) |
| Broker interest (other OS) | last day of the previous year, 31 Mar (R.115 / R.206 Sl.3) — *many use monthly; setting* |
| Foreign tax credit | last day of month preceding month tax deducted (R.128(1)(b) / R.76(7)(b)) |
| Schedule FA | TTBR "as on the relevant date": acquisition date (initial), peak date (peak), 31 Dec (closing) |

### Schedule FA (calendar year; residents ordinarily resident only)
- **A2 custodial account** (the IBKR account): country (USA = code 2), institution name/address/ZIP,
  account no., status, opening date, peak balance, closing balance, nature of amount
  (I/D/S/O/N) + gross amount paid/credited. One nature per row.
- **A3 equity & debt interest**: country, entity name/address/ZIP, nature of entity, date of acquiring,
  initial value, peak value, closing balance, total gross amount paid/credited, total gross sale proceeds.
  Whole rupees. **One row per lot.** Lots sold during the year still appear (closing 0).
- Portal CSV upload (A2/A3): exactly 12 columns, numeric country code, `YYYY-MM-DD`, integers, no commas
  in values, ASCII; upload replaces existing rows (third-party findings — re-test each season).
- Penalty: Black Money Act s.43 ₹10 lakh; no penalty/prosecution if aggregate non-immovable foreign
  assets ≤ ₹20 lakh (from 1 Oct 2024). FAST-DS 2026 window to 31 Dec 2026.

### Schedule CG
- Foreign shares are not listed in India → **LTCG if held > 24 months**, taxed **12.5 % without
  indexation** (s.112 / s.197); STCG at slab. No s.112A exemption, no Schedule 112A.
- ITR-2: STCG → A5 "other assets"; LTCG → B8 "assets where B1–B7 not applicable".
- Quarterly accrual table (234C) by **trade date**: ≤15/6, 16/6–15/9, 16/9–15/12, 16/12–15/3, 16/3–31/3.
- Loss set-off: STCL vs STCG/LTCG; LTCL vs LTCG only; carry forward 8 yrs if filed on time.

### Schedule OS
- Dividends **gross** (before US withholding) in 1a(i), slab rate; quarterly breakup for 234C.
- Residents claim treaty relief only via FSI/TR, never `DividendDTAA`.
- Broker interest → 1b(ix) "Others", no quarterly breakup.

### Foreign tax credit
- Per country, per head: relief = min(foreign tax, Indian tax on that income); capped at treaty
  rate (India–US Art. 10: **25 %** for individuals; W-8BEN → IBKR withholds 25 %, else 30 %).
- **Schedule FSI** per country: income from outside India, tax paid outside, tax payable in India,
  relief = min, DTAA article. **Schedule TR**: totals per country, s.90.
- **Form 67** (AY 2026-27) due by 31 Mar 2027; **Form 44** (tax year 2026-27) due 31 Mar 2028 and
  must be **CA-verified if foreign tax ≥ ₹1 lakh**. Evidence: IBKR 1042-S, activity statement.

### Other
- Schedule AL only if total income > ₹1 crore (AY 2026-27).
- US estate tax: non-resident aliens get only a $60k exemption on US-situs assets (US stocks/ETFs),
  18–40 %, no India–US estate treaty; Irish/Lux UCITS ETFs generally not US-situs.

## 5. Architecture

```
Astro 7 static site (base /ibkr) on GitHub Pages, deployed by GitHub Actions
├─ src/pages/*            docs, Flex Query setup guide, articles (plain Astro)
├─ src/components/App     one Svelte 5 island: upload → settings → review → download
└─ src/lib/               framework-free TypeScript engine (unit-tested with Vitest)
   ├─ parsers/            flexXml (fast-xml-parser), activityCsv (PapaParse + section state machine)
   │                      → one normalized model
   ├─ fx/                 TTBR lookup: on-date, month-end-of-preceding-month, previous-day fallback
   ├─ lots/               lot ledger: IBKR CLOSED_LOT rows as truth, FIFO cross-check, splits/mergers/transfers
   ├─ reports/            FA A2/A3, CG (+quarters), OS (+quarters), FSI/TR/Form 67
   └─ export/             portal CSVs, CA workings CSVs, readme, ZIP (JSZip)
public/data/ttbr/{CCY}.json   built from sbi-fx-ratekeeper at deploy time (nightly)
```

Principles: money in `decimal.js`, round to whole ₹ only at output; every figure carries
`{value, rate, rateDate, source}`; heavy work in a Web Worker; nothing leaves the browser
(CSP `connect-src 'self'` + opted-in price APIs only); optional IndexedDB persistence with a wipe button.

## 6. Open questions → user-facing settings

1. CG FX method: (a) gain in USD × TTBR(month-end before sale) — statutory reading; (b) sale and cost
   converted separately (common practice). Default (b)? — **decide with CA**; ship both.
2. Schedule FA income/proceeds columns: 31 Dec rate vs transaction-date rate.
3. Peak value: daily close (exact) vs month-end (approximate).
4. Broker interest: 31 Mar rate vs monthly.
5. TTBR when SBI published twice in a day: first (morning) card — documented.
6. Tax year 2026-27 (AY 2027-28) ITR forms not yet notified — re-check FA layout when released.
7. Bond ETFs and s.50AA — flag, don't decide.

## 7. Roadmap

1. ✅ Scaffold Astro + GitHub Pages workflow
2. TTBR data pipeline + lookup library
3. Flex XML parser → normalized model (fixtures from synthetic exports)
4. Lot ledger + Schedule FA A3/A2 (needs a real export to confirm Prior Period Positions coverage)
5. CG, OS, FTC (FSI/TR/Form 67) + quarterly breakups
6. Exports (portal CSV, CA workings, readme, ZIP) + UI wizard
7. Flex Query setup guide page with screenshots; Activity Statement CSV fallback
8. Optional: price-API key support, Worker proxy for Flex Web Service, PWA/offline
