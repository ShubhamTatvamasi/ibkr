# IBKR India Tax — design

A static web app that turns Interactive Brokers Activity Flex Query exports into everything an
Indian resident needs to report foreign shares: Form 67 / Form 44, Schedules CG, OS, FSI, TR and FA.
Everything runs in the browser. There is no server.

Not tax advice. Where the law is open to interpretation the app exposes the choice as a setting
instead of deciding silently.

## Principles

1. **Show the source of every number.** Each value carries the exchange rate, the card date and the
   rule that picked it. The working tables expand to the full calculation.
2. **Copy exactly what the portal wants.** Values are displayed formatted (₹4,82,316) and copied raw
   (482316). Labels are the portal's own wording and numbering.
3. **Calm by default.** One accent colour; semantic colour only for status; never colour alone.
4. **Make privacy checkable.** No backend, no accounts, no analytics. A Content Security Policy limits
   network access to the site's own origin, so files cannot be sent anywhere.
5. **Accessible from the start.** AA contrast in both themes, visible focus, real tables, live-region
   announcements for copy actions, 44px touch targets.

## User journey

| Step | Purpose |
|---|---|
| **Upload statements** | Pick the return (deadline-aware: due / belated / revise), get the two IBKR runs with exact dates and "Configure with AI" prompts, drop XML files, see period coverage and which Flex sections were found, set residency, slab and foreign TIN. |
| **Review issues** | Must fix (missing exchange rates, missing sections), needs input (company addresses, TIN), method choices, checks and notes. |
| **File your return** | One page per screen in filing order: Form 67/44 → CG → OS → FSI → TR → FA A2 → FA A3. Portal path, period, "n of m values copied", fields with copy buttons, working tables. |
| **Insights** | Open lots with rupee gains, lots turning long-term, US estate-tax exposure vs $60,000, ₹20 lakh Schedule FA penalty threshold, withholding above the 25% treaty rate, money sent to IBKR. |
| **Downloads** | Filing pack: schedule files in portal column order, working papers, exchange-rate appendix, README; per-file preview and a ZIP. |

## Data sources

- **IBKR Activity Flex Query, XML.** The Flex Web Service does not allow browser (CORS) requests, so
  the user downloads the XML from Client Portal. One query, run for the calendar year (Schedule FA) and
  the financial year (everything else); each run is limited to 365 days. Sections: Account Information,
  Trades (Executions + Closed Lots), Open Positions (Lot), Cash Transactions (Detail), Prior Period
  Positions (daily prices → exact peaks), Statement of Funds (daily cash → A2 peak), Financial
  Instrument Information, Cash Report, Change in Dividend Accruals, Corporate Actions.
- **SBI TT buying rates.** SBI publishes only the current Forex Card Rates PDF
  (`sbi.bank.in/documents/16012/1400784/FOREX_CARD_RATES.pdf`). `scripts/update-sbi-rates.mjs`
  parses it (the first number after `CCY/INR` is TT BUY) and the deploy workflow commits each new date
  to `public/data/ttbr/{CCY}.json` twice a day. The first card seen for a date is kept. JPY, THB and KRW
  are quoted per 100 units. The archive runs from January 2020; earlier dates are entered manually.

## Tax rules implemented

**Law by year.** AY 2026-27 (FY 2025-26) falls under the Income-tax Act 1961: Rule 115, Rule 128,
Form 67, section 112. From tax year 2026-27 the Income-tax Act 2025 and Income-tax Rules 2026 apply:
Rule 206 (conversion), Rule 76 and Form 44 (foreign tax credit; accountant verification when foreign
tax is ₹1 lakh or more), section 197.

**Exchange-rate dates (SBI TT buying rate).**

| Figure | Date |
|---|---|
| Capital gains | last day of the month before the month of sale (cost: month before purchase, when converted separately) |
| Dividends | last day of the month before the month of payment |
| Broker interest | 31 March (setting: month-end before each credit) |
| Foreign tax withheld | last day of the month before the month of deduction |
| Schedule FA | acquisition date (initial), each day (peak), 31 December (closing); income/proceeds on the transaction date (setting: 31 December) |

If SBI published nothing on a date, the latest earlier card is used; gaps over 7 days are flagged.

**Schedule FA** (calendar year; residents who are ordinarily resident). A2: the IBKR account, cash
peak and closing from the daily balance, gross amounts credited — one row per nature of amount. A3:
one row per purchase lot held at any time in the year, including lots sold (closing 0). Peak = max over
days of shares held × price × that day's rate. Dividends credited only to lots held on the day before the
ex-date. There is no official bulk upload for A2/A3; the files follow the portal column order. Black
Money Act: ₹10 lakh penalty for non-disclosure, no penalty or prosecution if non-immovable foreign
assets total ₹20 lakh or less (disclosure still required).

**Schedule CG.** US shares are not listed on a recognised Indian exchange: long-term only if held more
than 24 months (36 months for sales before 23 Jul 2024), 12.5% without indexation; short-term at slab
rates; no section 112A exemption. STCG in A5, LTCG in B8 (a(ii) full value of consideration, b(i) cost
without indexation, b(iii) transfer expenses). Table F by sale date, never negative, losses absorbed by
later gains in the same category.

**Schedule OS.** Dividends gross in 1a(i) with the item 10 quarterly breakup; broker interest in 1b(ix).
Residents do not use the DTAA-rate rows.

**Foreign tax credit.** Per country and income: relief = lowest of tax paid abroad, Indian tax on that
income, and the treaty rate (India–US: 25% dividends, Article 10; 15% interest, Article 11).
Form 67 Part A rows only where tax was paid. Schedule FSI per country: capital gains head (no foreign
tax) and other sources; TIN or passport number. Schedule TR: per-country totals under section 90.

## Address book

`src/data/assets.json` holds legal names, issuers and registered addresses of securities, keyed by ISIN,
taken only from issuer documents (prospectus, annual report, shareholder notices) with the source links
stored per entry. The tool fills Schedule FA A3 from it; the user's own entries override it. The
`/assets/` page lists it with search and copy buttons. Entries are added as holdings come up.

## Architecture

```
src/lib/flex        XML parser (fast-xml-parser, document order links Closed Lots to their trade),
                    multi-file merge with de-duplication → normalized model
src/lib/fx          SBI rate table: on-or-before lookup, month-end-before anchor, per-100 quotes
src/lib/tax         lot ledger, Schedule FA, capital gains, income, foreign (Form 67/FSI/TR),
                    insights, engine (coverage, warnings, rate audit)
src/lib/export      CSV and the filing pack (JSZip)
src/components      Svelte 5 app: state (hash routing), shell, steps, schedule pages, UI primitives
src/pages           app (full screen), Flex Query guide, method
public/data/ttbr    SBI TT buying rates archive
public/samples      fictional Flex exports for the demo and tests
```

Money is `decimal.js` throughout and rounded to whole rupees only for display and export.

## Open questions

1. Capital gains conversion: sale and cost separately vs the gain converted once (setting).
2. Schedule FA income and proceeds: transaction-date vs 31 December rate (setting).
3. Broker interest: 31 March vs monthly rates (setting).
4. A2 with several natures of amount: one row per nature (no official guidance).
5. Form 44 portal implementation for tax year 2026-27.
6. Bond ETFs and section 50AA.

## Roadmap

- Validated against a real export (Oct 2026): Prior Period Positions give one row per trading day, priced at that day's close; IBKR splits one order into several same-timestamp lots (merged with weighted cost); statements start at first funding; years in progress are reported as provisional.
- Stock splits, mergers and transfers-in: adjust lots automatically instead of flagging.
- Activity Statement CSV as a fallback input.
- RSU / transferred lots without cost: manual cost-at-vest entry.
- Earlier calendar years for Schedule FA (fixing past returns).
- Advance-tax estimate and tax-loss candidates before 31 March.
- Offline-installable app; Web Worker for very large files.
