# Earnings Lens — Build Spec (v1.4)

*Verdict rules S5, 25 Oct 2026 (Build B): the verdict, the financial health state, the seller conditions, the terms and protections, evidence, the potential application, the lens layout, the Why bullets and the Copy brief follow `Earnings_Lens_Verdict_Rules_S5.md` (the locked rules), and the page follows `Earnings_Lens_Verdict_S5_Mock.html` (mock V24). Sections below marked **Superseded by S5** point there; everything else (data pull, comparatives, presentation, caching, the Claude layer, scope) still holds.*
*v1.1, 21 Sep 2026: updated after the step 3 checkpoint. Mock figures now come from the 10-Q; rules revised for segments, DPO, equity and caching.*
*v1.4, 22 Sep 2026: Z'' cap for profitable cash generators; negative free cash flow split into cash burn and heavy investment; filings placed by date; broader debt tags; famous-company fixtures; Summary wording rules completed. The redesign mock now shows Amazon.*
*v1.3, 21 Sep 2026: lens section redesigned as commentary (Summary without ratios, "What stands out", terms as the last item), runway added to the ladder, "retrenchment" renamed "spending cuts" on screen. The layout target was `Earnings_Lens_Lens_Redesign_Mock.html`, superseding the lens section of `Earnings_Lens_Mock.html` (both since removed from the repo; the S5 mock replaces them).*
*v1.2, 21 Sep 2026: step 5 visual review (units, period labels, negative bases, annual comparisons, formula-first metric explanations, image download) and the Claude layer narrowed to explaining flagged items from filed text.*

This is the build spec for Earnings Lens. The page design is `Earnings_Lens_Verdict_S5_Mock.html` (mock V24, AMZN Q2 FY26). The older mocks (`Earnings_Lens_Mock.html`, `Earnings_Lens_Lens_Redesign_Mock.html`, `Earnings_Lens_Liquidity_Mock.html`, `Earnings_Lens_Statements_Mock.html`) were removed from the repo after S5; where V24 does not show something (company search, results banner, statement tabs, 5-quarter trend, Copy brief, Download image, Explained from the filings), this spec describes it.


---

## What it is

A self-serve counterparty assessment. The user enters any US-listed ticker. The app pulls the company's filings from SEC EDGAR and runs fixed rules over them. It then shows one shared financial-health read and a verdict with contract terms for each of two sellers: CoreThread (engineering services) and NexCore (edge-AI SaaS), per `Earnings_Lens_Verdict_Rules_S5.md`. Every word of the verdict is deterministic from the rules engine (`lib/verdict/`); Claude explains flagged items from the filed text and never computes a number or feeds the verdict. Product focus is not decided here; it goes to GTM. A "Copy brief" button produces paste-ready bullets, and "Download image" saves the page body as a picture.

**The rule for every input:** it is either computable from filings or a declared baseline. There are no user inputs beyond the ticker: this is a reporting tool. Anything that needs knowledge of the relationship stays off the screen. That includes potential contract size, repeat work, adoption potential, revenue durability, termination likelihood, and what the company is building internally.

---

## Stack and accounts

- **App:** Next.js on Vercel, in its own repo and its own Vercel project. Personal accounts only.
- **Data:** SEC EDGAR data APIs on data.sec.gov. Free and keyless.
  - Every request carries a User-Agent with a contact email.
  - Requests stay under 10 per second.
  - The email is personal and stored as a Vercel environment variable. It never goes in the repo.
- **AI:** the Claude API, called server-side only. The key is an environment variable.
- **Cache:**
  - EDGAR submissions and company facts are cached server-side on a short TTL, because they change when a company files.
  - Anything extracted from one filing (for example segment revenue from its XBRL instance) is keyed on that filing's accession number and kept permanently in a persistent store, because a filing never changes. Store the extracted result, never the raw instance XML.
  - Claude readouts are cached per filing, keyed on the latest filing accession number. A company's readout is regenerated only when it files something new.
  - There is a daily cap on Claude calls as a backstop.
  - In-memory caching does not persist or share across instances on Vercel. The readout cache, the daily-cap counter and the per-accession store therefore need a persistent store: a dedicated Neon Postgres project, shared with no other application.

---

## Data pull

- **Figures:** from XBRL company facts (10-Q and 10-K). Earnings-release exhibits are not the source of figures.
- **Filing list:** from EDGAR submissions. It supplies form types, 8-K item numbers, filing dates, the SIC industry code and the fiscal year end.
- **Segment revenue:** from the filing's own XBRL instance document (company facts strips dimensional facts). Never from rendered R-files.
- **Qualitative text for Claude:** filed text only, meaning the 8-K results release and the 10-Q/10-K management discussion. No earnings-call transcripts (not filed, usually licensed) and no news articles.
- **Scope:** US filers only.

### Company search

The ticker box accepts a ticker or a company name. It searches EDGAR's official ticker-to-company list (the same file the app already uses to find a company's SEC ID), so it needs no other service.

- As the user types, a short list shows matches as "Company name (TICKER)", up to 8.
- An exact ticker match always ranks first, so typing a known ticker behaves as before.
- Companies with more than one listed share class show every ticker.
- Works with keyboard (arrows, Enter, Escape) and touch.
- No match: "No US-listed company found." No fuzzy guessing beyond simple prefix and word matches.
- Choosing a result sets the ticker; the ticker is still the only input to the rules.

### Period and dates (header line)

- **"Financials for the quarter ended [date] ([fiscal quarter])"** uses the period end from the latest 10-Q or 10-K.
- **"Next 10-Q (or 10-K) due by [date]"** is the next quarter end plus the SEC deadline for the company's filer category, read from EDGAR submissions (`category`). Company facts does not expose the cover-page filer-category tag.
  - 10-Q deadline: 40 days for large accelerated and accelerated filers; 45 days otherwise.
  - 10-K deadline: 60, 75 or 90 days by category.
  - For 52/53-week fiscal years, the next quarter end is estimated, so the date is prefixed with "~".
  - Always "due by". Never "expected".
- **Results 8-K without a 10-Q yet.** If a results 8-K (Item 2.02) is newer than the latest 10-Q or 10-K, show: "New results announced [date]. Full figures arrive with the 10-Q."
- **Deadline passed.** Superseded by S5: the filing test is MISSED FILING with business-day deadlines and 12b-25 extensions (rules §4.1, §11 R1–R2), and the §14 D2 filing-status item in "What stands out" is the single filing-status authority; the old missed-deadline red flag is retired (rules §17.6).

### Comparatives

- **Each key-financials row:**
  - latest quarter
  - vs prior quarter: prior value and change
  - vs same quarter last year: year-ago value and change
  - a five-quarter trend line
- **The two comparisons are visually separated** as two labelled column groups, "vs prior quarter" and "vs same quarter last year", each with its own tint. Q/Q and Y/Y must never be ambiguous.
- **Five quarters** is the smallest window that includes the year-ago quarter.
- **Full fiscal years** sit behind an "Annual" toggle, not on the main view.
- **Q4 is derived** as the 10-K annual figure minus Q1 to Q3, because EDGAR files no standalone Q4. Handle this explicitly so the five-quarter view and TTM never double-count or skip a quarter.
- **Derived values** (from year-to-date or annual figures) are marked as derived.
- **Signals read Y/Y** (seasonality-proof). Q/Q is shown as context.
- **Margin rows:** the pts change is computed from the displayed one-decimal values, so the change always matches the numbers on screen.

### Presentation

- **Units:** the unit is in the section title ("Key financials · $ millions"), not only in a table corner. When the latest quarter's revenue is under $100M, figures show one decimal. Segment revenue uses the same unit as the table. The Copy brief carries the unit on every figure.
- **Period labels:** every column header shows its fiscal label and its period-end date (e.g. "Q4 FY26" over "Jun 30, 2026"). A company's Q4 is a different calendar quarter from another's, so a label alone is never enough.
- **Derived marks name the period and the method.** The footnote for † states which columns are derived and how, e.g. "Q4 FY26 (Apr–Jun 2026) = FY26 annual − Q1 to Q3" or "cash-flow quarters = year-to-date minus the prior year-to-date". Anything computed from a derived figure (a margin, FCF) is itself marked derived. Footnotes use plain labels ("operating cash flow − capital expenditures"), never XBRL tag names; tag names stay in each cell's provenance, shown on hover, not in text a reader has to parse. Any prose the app generates (footnotes, flagged-item details) follows the same negative-base rule as the table: no percentage of a negative or near-zero base; state the dollar amount.
- **Negative figures:** shown with a minus sign in red. Changes are never coloured: a falling cost is often good news.
- **Changes on a negative or zero base:** when either value is negative or zero, or the sign flips, the change is shown in dollars, not %. The sign means the figure went up or down (e.g. operating income −13 → −16 shows "−3"). Percentages are shown only when both values are positive.
- **Net income note:** the net income row always carries a note stating the gap to operating income, e.g. "Net income is $4.0B below operating income this quarter; lens rules read operating income." Why the gap exists is the Claude layer's job (see below), never hand-written.
- **Annual view:** the "Annual" toggle shows the same rows as the quarterly view, including margins, over three fiscal years with two comparisons: FY | vs prior FY | FY−1 | vs FY−2 | FY−2, tinted like the Y/Y group. Annual figures are as filed in the 10-K.

### Filing placement

- Each filing is placed by its own period end against the company's fiscal calendar (built from its 10-K period ends and EDGAR's fiscal year end), never by EDGAR's fy/fp tags, which some filers get wrong. The fiscal-year naming offset is learned per year-end month from the filer's own tags by majority vote.
- A filing listed by EDGAR but not yet published in company facts still counts for deadlines; the board shows the last published quarter and says so: "A 10-Q for the quarter ended [date] was filed [date]; EDGAR has not published its figures yet, so the board shows the quarter before it."
- A filing that genuinely can't be placed never triggers the missed-deadline check.

### Tag resolution and provenance

- **One tag per row.** Each line item uses one XBRL tag across all five quarters, chosen by a declared priority order.
- **Splicing only with proof.** A cell may come from a different tag only if the two tags report the same value (within $1M rounding) for at least one shared period in the filings. Those cells are marked as spliced.
- **Formula fallbacks are whole-row.** Gross profit (revenue − cost of revenue), SG&A (sum of filed components), long-term debt (noncurrent + current), total liabilities (assets − total equity) and similar are applied to the entire row, never to individual cells. The row uses whichever source, primary tag or formula, covers more of the five quarters (ties go to the primary tag). Switching to the formula needs a stricter proof than splicing: in every period where both the tag and the formula exist, they agree within $1M. (Splicing needs one agreeing period to show two tags are the same concept; a switch discards a source already known to be right, so a single mismatch blocks it.)
- **Missing stays missing.** A value that isn't filed is shown as "—" with "Not available" (rules §17.6), never zero or an estimate. Any figure that depends on it is also missing (e.g. FCF without capex).
- **Provenance per cell.** Every cell carries its own tag, method (direct, YTD subtraction, annual minus Q1 to Q3, spliced, computed) and derived flag.
- **Company-extension tags are not read in v1.** Company facts exposes only standard taxonomies.

---

## Financial health (shared engine)

**Superseded by S5 for what the section shows:** the four-state health bar, the summary bullets, the five area cards with their ⓘ, the liquidity strip and Other ratios follow rules §4.3, §10, §16, §17.2 and §17.5 and mock V24. Altman Z'', DSO, DPO, debt/equity and the current ratio are shown under Other ratios and never scored (rules §10). The data rules below still hold for the figures.

**Data rules:**

1. Lens rules read operating income, never net income. Net income can carry large non-operating gains.
2. FCF is read by level and cause, not by change alone. A fall driven by receivables growth in a strong quarter is not distress.
3. Segment revenue is used only where it is filed. Otherwise fall back to total revenue.
4. Altman Z'' uses the book-equity version: 6.56·X1 + 3.26·X2 + 6.72·X3 + 1.05·X4, on TTM EBIT. It needs no share price.
5. Equity is total equity including noncontrolling interest, everywhere it is used: debt/equity, Z'' X4 and the total-liabilities fallback.
6. Free cash flow = operating cash flow − capital expenditures, both as filed in XBRL. The capex tag used is recorded per cell (some companies' tag includes intangibles, some doesn't). It may differ from a company's own non-GAAP free cash flow.
7. DSO = ending receivables ÷ quarterly revenue × days in the quarter. DPO = ending payables ÷ quarterly cost of revenue × days in the quarter. Days come from the actual period-end dates, so 14-week quarters are handled without special cases.
8. DPO is labelled as what it measures: "Payables ≈ X days of cost of revenue", never "pays suppliers in X days". Payables can include amounts that aren't cost of revenue (e.g. capex), so the level isn't comparable across companies; the signal reads its own Y/Y trend.

**Explanations:** every health card and every ratio has an ⓘ: bullets under short headings (Formula / This quarter / Warning when; ratios: Formula / What it means / footer). It is non-modal and closes on any click outside it (rules §4.3, §16). Every number in it comes from the engine's computed result. Debt / equity reads "—" with "debt not tagged in filings" when no debt tag is filed in the lookback.

**Segment revenue:**

- Axis priority: `us-gaap:StatementBusinessSegmentsAxis` (operating segments), then `srt:ProductOrServiceAxis`. The page labels which axis was used.
- All five quarters, with Q4 derived as annual minus Q1 to Q3 and marked derived, same as the main figures.
- Shown as filed facts in their own section (mock V24): one bar split by revenue share, the key below it, and total revenue, only when the filed segment amounts sum to total revenue within $1M; otherwise the section is hidden (rules §10, §17.6). No segment is invented.
- Hidden when the company has a single reportable segment, or the only segment equals total revenue: one line that repeats revenue implies a breakdown that doesn't exist.
- Segments never feed a lens signal. Picking a "relevant" segment would be a product-fit guess.

**Red-flag filings (last 12 months):**

- a going-concern warning
- a late-filing notice (Form 12b-25: NT 10-Q or NT 10-K)
- 8-K Items 1.03 (bankruptcy), 2.04 (debt called early), 4.01 (auditor change) and 4.02 (restatement)
- a missed filing deadline (retired from "What stands out" in S5: the §14 D2 filing-status item replaces it, rules §17.6)

An 8-K Item 2.05 (restructuring) is not a red flag. Red flags are "What stands out" findings only and never score. In S5 a 2.05 is a CoreThread caution leg and part of NexCore's cutting-back test (rules §5); 8-K Items 1.03, 2.04 and 4.02 set the health state to Critical (rules §4.2).

Red-flag rules:

- **Window:** the trailing 12 months from today's date, not from the reporting period. Results can change over time for the same quarter; that is intended.
- **Context shown with every flag:** the form, its date, and what followed. E.g. "NT 10-Q filed 18 May 2026; 10-Q filed 19 May 2026."
- **Extensions:** when an NT form was filed, the missed-deadline check adds the 12b-25 extension (5 calendar days for a 10-Q, 15 for a 10-K) before calling a deadline missed.
- **Going concern: not checked in v1.** Filers don't tag it: a company with going-concern language in its 10-K was checked and had no going-concern tag anywhere in its XBRL instance; the paragraph is untagged prose. Scanning prose is out of scope, and nothing on the page presents going concern as clear.

---

## Lenses

**Superseded by S5.** The two sellers' conditions are rules §5: CoreThread reads engineering spend (R&D two quarters running, restructuring filings, operating deterioration); NexCore reads "cutting back across the business". Labels state facts, never "demand for us". The old opportunity and risk axes and the retrenchment readout are retired; spending cuts remain a "What stands out" finding.

---

## Lens section layout

**Superseded by S5:** rules §16 and mock V24. Top to bottom: sticky header (compact on phone: company name and lens switch only); the verdict card (kicker with evidence, verdict word with the four-step verdict bar, NexCore discovery band with potential application and likely route, Why bullets, Terms, Copy brief and Download image); Financial health; Operating segments; What stands out; Explained from the filings; Financials tabs; How the verdict works. No prose anywhere: bullets, labels and table cells only.

### What stands out

Short, rule-based observations about how the numbers relate and move, not their levels. An item appears only when its threshold fires; they inform and never score (rules §10). Each row (mock V24): the tag in its tone, one bold headline and the figures behind it on a mono line. Tone: amber for watch items, green for good news, slate for one-off items. Order: the filing-status item (rules §14 D2), red flags, cash burn or heavy investment, borrowing, acquisitions, returns, one-off, spending cuts, payables, costs, losses, margin. The verdict's terms are in the verdict card, not here.

| Item | Fires when | Tone |
|---|---|---|
| Red flag | any red flag; shows its context line | watch |
| Cash burn | operating cash flow negative in the latest quarter; states runway = cash ÷ the larger of this quarter's and the four-quarter average free-cash-flow burn. If capex isn't filed: "capital spending is not filed, so runway can't be stated" | watch |
| Filing status | the most recent required report is overdue, filed within an extension, extension open, or filed late (rules §14 D2); form, period, deadline, filing date | watch / info |
| Heavy investment | operating cash flow positive but free cash flow negative: "Capital spending above operating cash flow". Figures: capex and operating cash flow, latest and year-ago. No runway | watch |
| Spending cuts | the retrenchment signal fires; states the cause | watch |
| Payables | DPO rising beyond the band: "Payables days up" | watch |
| Costs | SG&A growth more than 10 points above revenue growth, Y/Y (watch); or more than 10 points below (good: "overhead growing slower than sales") | watch / good |
| Losses / profits | operating income moved more than 25% Y/Y (base: the year-ago absolute value); narrowing loss or rising profit is good, widening loss or falling profit is watch | good / watch |
| Margin | gross margin moved more than 2 points Y/Y | good / watch |


## Verdict matrix

**Superseded by S5:** rules §4 (health state from five areas: Critical, Fragile, Watch, Resilient), §6 (verdict matrix of state × seller condition: Pursue, Pursue with guardrails, Monitor, Limit exposure), §8 (evidence: Exception, Limited, Adequate) and §17.4 (three Why bullets per seller). The old opportunity × risk matrix, the Z''-driven ladder and the runway rung are retired.

---

## Deal structure

**Superseded by S5:** rules §7. Net 30 is the baseline; Net 45 only on request and only for Pursue; Net 60 never. Contract protections per verdict and seller (CoreThread: Milestone, T&M, Support; NexCore: Subscription, Usage, Onboarding) are rules §7.2 cell for cell, and NexCore's Fragile Monitor carries the §7.3 condition. No credit exposure or dollar limits: the app has no deal size.

---

## GTM handover

Finance answers whether we can do business and on what terms. Which use case to pursue, and which product to lead with, is a GTM question. Any company can put AI on the edge, so the page doesn't guess at it.

A "Copy brief" button, deterministic with no extra Claude call, produces paste-ready bullets for whoever needs them: GTM, the CEO, deal desk:

- company, period and seller
- the verdict and its evidence
- the health state
- the three Why bullets
- the terms line and each protections row (and the NexCore Fragile condition when it applies)
- for NexCore, the potential application and likely route when the industry code maps
- the source line

No figure the page does not show.

A "Download image" button, also deterministic with no server or Claude call, saves the page body (verdict card through How the verdict works) as a PNG with a company and period line added for the picture, so the period and source travel with the verdict. ⓘ boxes and citations are closed in the image. Filename: `TICKER-Seller-Period-YYYY-MM-DD.png`, e.g. `AMZN-NexCore-Q2FY26-2026-10-25.png`.

---

## Declared values

- **S5 verdict thresholds:** every one lives in `lib/verdict/rulesConfig.ts` and is stated in rules §4–§8; "How the verdict works" reads them from there.
- **Z'' zones (published, shown under Other ratios only):** safe above 2.6, distress below 1.1.
- **Growth flat band:** ±2% (findings).
- **DPO band:** ±10% of the same quarter last year (payables finding).
- **FCF definition, DSO/DPO formulas and equity basis:** as in Financial health. The verdict's free cash flow is the Earnings Lens basis (operating cash flow − purchases of property and equipment, rules §2).
- **What stands out thresholds:** costs 10 points vs revenue growth; operating income 25% Y/Y; gross margin 2 points.
- **Claude daily cap:** 50 calls per day (a backstop behind per-filing caching and the Anthropic account spend limit).
- **Explanation triggers:** non-operating swing above 5% of revenue; tax charge more than 5% of revenue away from 21% of pre-tax income; opposite signs.

---

## Claude layer

The page is complete without Claude: the S5 engine decides the verdict, health, terms and evidence and words every bullet. Claude has one job the rules can't do: **explain why**, from the filed text, for items the rules flagged. It never feeds the verdict, the health state, the terms or evidence (rules §17.3).

**Summary:** superseded by S5. The templated Summary is retired; the verdict card's Why bullets (rules §17.4) and the health summary bullets (rules §17.5) replace it.

**What gets explained** (each is a trigger; nothing else is sent to Claude):

- **Non-operating swing:** pre-tax income differs from operating income by more than 5% of quarterly revenue (e.g. large investment gains or losses, interest, one-offs below operating income).
- **Unusual tax:** the income tax charge differs from the US federal statutory 21% of pre-tax income by more than 5% of quarterly revenue (e.g. a valuation-allowance charge, a large tax benefit).
- **Opposite signs:** net income and operating income have opposite signs (a backstop).

Revenue is the denominator because it is always positive; operating income can be negative or near zero. Calibrated on the fixture companies: NVDA (investment gains, $7.8B) and a company with a $423M valuation-allowance tax charge on a $24M pre-tax loss are flagged; routine tax and interest at MSFT, WMT, UFPT and NAII are not.
- Spending cuts (retrenchment) are triggered.
- DPO is rising beyond the band.
- Any red flag. (An NT 10-Q or NT 10-K states the company's reason for filing late; quote it.)

**Sources:** filed text only: the results 8-K (Item 2.02) with all its exhibits, the latest 10-Q/10-K management discussion and notes, NT forms, and any 8-K behind a flag. Many companies furnish more than the press release with the results 8-K: CFO commentary, prepared remarks, or occasionally the call script or transcript itself. When filed, these are read like any other filed text. Transcripts that exist only from paid data providers are out: they aren't filed, and their licences usually forbid showing quotes. The call's live Q&A is therefore available only when the company files it.

**Output:** an "Explained from the filings" block directly below "What stands out" (rules §17.3), labelled as AI-assisted interpretation of filed text. Per flagged item: one or two sentences and a citation (form, filing date, section or note). If the filing doesn't explain it: "Not explained in the filing."

**Constraints:**

- Claude never restates the verdict, the terms or any computed number; the page already shows them.
- Claude may cite a figure only if it appears verbatim in the cited passage. The app checks every quoted figure and passage against the source text by string match; a sentence that fails the check is dropped, never shown.
- Readouts are cached per filing (accession number) in the persistent store, with a daily cap on Claude calls.

**Fallback:** if the cap is hit, the call fails, or Claude is disabled, the block reads "Explanations unavailable" and everything else renders normally.

## Done when

1. NVDA reproduces the mock's figures from the Q2 FY27 10-Q, and the snapshot diff for every fixture reports no changed cells.
   Both snapshot diffs are pinned to 2026-09-22 (`scripts/lib/snapshotAsOf.ts`), the date their baselines were written, because a filing that lands later would otherwise show up as a change; re-baselining means moving that date and rewriting both baselines together.
2. A company with a 52/53-week fiscal year shows a "~" due-by date.
3. A company that has just reported shows the "new results announced" line.
4. A retailer's seasonal Q/Q dip in SG&A does not trigger the spending-cuts finding, because signals read Y/Y.
5. The five-quarter view for a company whose fiscal year just ended shows a derived Q4, marked as derived.
6. Superseded by S5: the Copy brief carries each seller's verdict, Why bullets, terms and protections (rules §7, §17.4).
7. With the Claude call disabled, the page still renders complete; "Explained from the filings" shows its fallback.
8. No secret or email is present in the repo or its git history.
9. The deadline unit tests pass (every filer category × 10-Q/10-K × normal and 52/53-week years).
10. Superseded by S5: the 90 regression fixtures of rules §12 match exactly (`npm run test:verdict`), and the page model equals the engine and rules §7 on all 90 (`npm run test:verdict-page`).
11. Superseded by S5: an 8-K Item 2.05 in the last 12 months is a CoreThread caution (rules §5.1); FDX reads Pursue with guardrails for CoreThread and Pursue for NexCore.
12. Going concern is never presented as checked.
13. A negative or zero base never shows a % change; it shows the change in dollars.
14. Every column header shows its period-end date, and every † footnote names the period and method.
15. "Download image" saves the page body with the company and period visible, under the stated filename pattern.
16. With Claude enabled, every quoted figure or passage in "Explained from the filings" is found verbatim in its cited source; a deliberately altered quote is dropped by the check.
17. Typing a company name (e.g. "amazon") finds its ticker; typing an exact ticker ranks it first; a company with two share classes shows both.
18. AMZN (Q2 FY26) reads Resilient, Pursue for both sellers, with the Why bullets of rules §17.4 exactly (`npm run test:verdict-why`); its "What stands out" starts with heavy investment (capex above operating cash flow, no runway).
19. Superseded by S5: cash burn is rules §4.1 (SEVERE BURN, CAUTION BURN, PERSISTENT BURN RUNWAY UNKNOWN, INVESTMENT CASH PRESSURE); runway is the app's runway rule in months.
20. ZM shows Debt / equity as "—" with "debt not tagged in filings"; a company with only convertible debt shows its debt.
21. Superseded by S5: Altman Z'' is shown, never scored (rules §10). RIVN reads Fragile; SNAP reads Caution · Mixed for CoreThread.
22. Fixtures (regression, README and examples): NVDA, MSFT, WMT, AMZN, GOOGL, FDX, SNAP, RIVN, UBER, TGT, ZM, plus NAII and UFPT as small-filer test fixtures. Any US ticker works in the app; fixtures only fix what is re-checked on every run.

## Scope

**Later:**

- a scheduled earnings-day brief, run automatically when a tracked company reports
- going-concern detection (needs reading filed prose)
- earnings-call transcripts from investor-relations sites: no standard location or format (a scraper per company breaks "any ticker"), often third-party copyrighted, and inconsistent text defeats the verbatim quote check. Transcripts a company files with the SEC are already read.
- reading company-extension XBRL tags (e.g. a company that moves capex to its own tag)

**Out:**

- stock prices
- earnings-call transcripts
- revenue-band tier mapping
- product-fit recommendations (handed to GTM)
- limit of liability
- competitor and industry reads (GTM's job)
- user inputs beyond the ticker (e.g. our revenue from them)
- any database shared with another application
- build risk
- termination risk
