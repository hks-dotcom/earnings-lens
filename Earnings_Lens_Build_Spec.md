# Earnings Lens — Build Spec (v1.4)

*v1.1, 21 Sep 2026: updated after the step 3 checkpoint. Mock figures now come from the 10-Q; rules revised for segments, DPO, equity and caching.*
*v1.4, 22 Sep 2026: Z'' cap for profitable cash generators; negative free cash flow split into cash burn and heavy investment; filings placed by date; broader debt tags; famous-company fixtures; Summary wording rules completed. The redesign mock now shows Amazon.*
*v1.3, 21 Sep 2026: lens section redesigned as commentary (Summary without ratios, "What stands out", terms as the last item), runway added to the ladder, "retrenchment" renamed "spending cuts" on screen. The layout target is `Earnings_Lens_Lens_Redesign_Mock.html`; it supersedes the lens section of `Earnings_Lens_Mock.html`.*
*v1.2, 21 Sep 2026: step 5 visual review (units, period labels, negative bases, annual comparisons, formula-first metric explanations, image download) and the Claude layer narrowed to explaining flagged items from filed text.*

This is the build spec for Earnings Lens. The mock (`Earnings_Lens_Mock.html`) has three boards: How it works, the CoreThread lens and the NexCore lens. Its NVIDIA figures are the step 3 checkpoint values from the Q2 FY27 10-Q.


---

## What it is

A self-serve counterparty assessment. The user enters any US-listed ticker. The app pulls the company's filings from SEC EDGAR and runs fixed rules over them. It then shows the verdict and deal structure through two business lenses: CoreThread (engineering services) and NexCore (edge-AI SaaS). The readout is templated from the rules; Claude explains flagged items from the filed text and never computes a number. Product focus is not decided here; it goes to GTM. A "Copy brief" button produces paste-ready text, and "Download image" saves the board as a picture.

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
- **Deadline passed.** If the due-by date has passed with no filing, raise a red flag (see Risk).

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
- **Missing stays missing.** A value that isn't filed is shown as missing, never zero or an estimate. Any figure that depends on it is also missing (e.g. FCF without capex).
- **Provenance per cell.** Every cell carries its own tag, method (direct, YTD subtraction, annual minus Q1 to Q3, spliced, computed) and derived flag.
- **Company-extension tags are not read in v1.** Company facts exposes only standard taxonomies.

---

## Financial health (shared engine)

**Shown:** revenue, gross and operating margin, cash and liquidity, current ratio, debt and debt/equity, free cash flow, their DSO, their DPO, Altman Z'', red-flag filings in the last 12 months, and segment revenue where it is filed.

**Data rules:**

1. Lens rules read operating income, never net income. Net income can carry large non-operating gains.
2. FCF is read by level and cause, not by change alone. A fall driven by receivables growth in a strong quarter is not distress.
3. Segment revenue is used only where it is filed. Otherwise fall back to total revenue.
4. Altman Z'' uses the book-equity version: 6.56·X1 + 3.26·X2 + 6.72·X3 + 1.05·X4, on TTM EBIT. It needs no share price.
5. Equity is total equity including noncontrolling interest, everywhere it is used: debt/equity, Z'' X4 and the total-liabilities fallback.
6. Free cash flow = operating cash flow − capital expenditures, both as filed in XBRL. The capex tag used is recorded per cell (some companies' tag includes intangibles, some doesn't). It may differ from a company's own non-GAAP free cash flow.
7. DSO = ending receivables ÷ quarterly revenue × days in the quarter. DPO = ending payables ÷ quarterly cost of revenue × days in the quarter. Days come from the actual period-end dates, so 14-week quarters are handled without special cases.
8. DPO is labelled as what it measures: "Payables ≈ X days of cost of revenue", never "pays suppliers in X days". Payables can include amounts that aren't cost of revenue (e.g. capex), so the level isn't comparable across companies; the signal reads its own Y/Y trend.

**Plain-English explanations:** every Financial health metric has an "i" control next to its label. It opens on hover, tap or keyboard focus. It shows the formula first, then a plain-English explanation, with this exact text (the same for every ticker). The box is wide enough for the Z'' formula and never wider than 80% of the screen.

- **Current ratio.** Formula: Current assets ÷ current liabilities. Explanation: What they'll turn into cash within a year, compared with what they have to pay within a year. 1x means just covered; above 1x means room to spare. Higher is safer.
- **Debt / equity.** Formula: Long-term debt (including the part due this year) ÷ total equity. Explanation: How much they've borrowed for every $1 of their own money (what owners put in plus profits kept). 0.15 means 15 cents borrowed per dollar owned. Lower means less reliance on lenders.
- **DSO.** Formula: Days sales outstanding = receivables at quarter end ÷ quarterly revenue × days in the quarter. Explanation: How many days of sales their customers still owe them. It shows how fast they collect, not how fast they'd pay us.
- **DPO.** Formula: Days payables outstanding = payables at quarter end ÷ quarterly cost of revenue × days in the quarter. Explanation: Their unpaid bills, measured in days of their cost of sales. If it rises year on year, they may be paying suppliers more slowly, and would likely do the same to us. Payables include bills that aren't for supplies, so compare a company with its own past, not with other companies.
- **Altman Z''.** Formula: 6.56 × (working capital ÷ total assets) + 3.26 × (retained earnings ÷ total assets) + 6.72 × (operating income, last 12 months ÷ total assets) + 1.05 × (total equity ÷ total liabilities). Explanation: A standard financial-strength score built from four questions: do they have short-term cash to spare; have they built up profits over the years; is the business earning from its assets right now; and how much of the company is owned outright versus owed to others. Above 2.6 is safe, below 1.1 signals distress, in between is a grey zone. It uses no share price. It flags the risk of financial distress; it doesn't judge whether the business is good.
- **Red flags, 12 mo.** Formula: Count of these filings in the last 12 months: going-concern warning, late-filing notice, bankruptcy, debt called early, auditor change, restatement, or a missed filing deadline. Explanation: Filings that often signal trouble with money or with the accounts. A restructuring shows under retrenchment, not here. Going concern isn't checked, because companies don't file it in a form the app can read.

Sub-labels under each metric wrap rather than overflow into the next tile.

**Tile details:** Debt / equity shows "—" with "debt not tagged in filings" when no debt tag (straight, convertible, notes payable, or debt including finance leases) is filed in the lookback; the wording describes the data, not the company; MISSING is reserved for a debt tag that exists but isn't filed for the quarter. The red-flags tile shows the count with "last 12 months"; going concern is not mentioned on the tile or in the verdict. It stays in the red-flags "i" text and the footer, so a zero is never read as a clean going-concern check.

**Segment revenue:**

- Axis priority: `us-gaap:StatementBusinessSegmentsAxis` (operating segments), then `srt:ProductOrServiceAxis`. The page labels which axis was used.
- All five quarters, with Q4 derived as annual minus Q1 to Q3 and marked derived, same as the main figures.
- Shown as filed facts on both lenses. No balancing "other" line is invented if segments don't sum to total revenue.
- Hidden when the company has a single reportable segment, or the only segment equals total revenue: one line that repeats revenue implies a breakdown that doesn't exist.
- Segments never feed a lens signal. Picking a "relevant" segment would be a product-fit guess.

**Red-flag filings (last 12 months):**

- a going-concern warning
- a late-filing notice (Form 12b-25: NT 10-Q or NT 10-K)
- 8-K Items 1.03 (bankruptcy), 2.04 (debt called early), 4.01 (auditor change) and 4.02 (restatement)
- a missed filing deadline

An 8-K Item 2.05 (restructuring) is not a red flag. Red flags question whether they can pay; a restructuring means spending is under review, which is the retrenchment signal (see Lenses). It drives retrenchment only, so it never forces "escalate before signing" on its own.

Red-flag rules:

- **Window:** the trailing 12 months from today's date, not from the reporting period. Results can change over time for the same quarter; that is intended.
- **Context shown with every flag:** the form, its date, and what followed. E.g. "NT 10-Q filed 18 May 2026; 10-Q filed 19 May 2026."
- **Extensions:** when an NT form was filed, the missed-deadline check adds the 12b-25 extension (5 calendar days for a 10-Q, 15 for a 10-K) before calling a deadline missed.
- **Going concern: not checked in v1.** Filers don't tag it: a company with going-concern language in its 10-K was checked and had no going-concern tag anywhere in its XBRL instance; the paragraph is untagged prose. Scanning prose is out of scope. The red-flags tile always shows "Going concern: not checked" and is never presented as clear.
- **Any red flag sets the ladder to Weak.** Flags are not tiered in v1. If escalation fatigue appears in use, tier later into severe (1.03, 2.04, 4.02) and watch (an NT cured within its extension).

---

## Lenses

| | CoreThread (services) | NexCore (SaaS) |
|---|---|---|
| **Question** | Can we safely do business with them, and on what structure? | Can they become a durable, expanding customer? |
| **Opportunity** | Revenue growth, engineering spend (R&D) growth, R&D intensity | Revenue growth, technology investment (R&D intensity) |
| **Risk** | Z'', red-flag filings, payment behaviour (DPO Y/Y trend), retrenchment | Same inputs; retrenchment weighted higher |

**Labels state facts,** e.g. "Engineering spend +64.4% Y/Y". Never "demand for us".

**Retrenchment signal:** a restructuring filing (8-K Item 2.05), R&D falling Y/Y beyond the flat band, or SG&A falling Y/Y beyond the flat band. Readout: "spending under review; existing contracts may be revisited." It never makes an account-level claim.

---

## Lens section layout

Top to bottom: identity line; title and lens question; **verdict and matrix** (left) beside the **Summary** (right); **What stands out**; **Explained from the filings**; Copy brief and Download image; footer.

- The opportunity and risk signal cards are not shown. The signals are still computed and still drive the matrix, the ladder and "What stands out"; showing them separately repeated the key financials.
- There is no separate deal-structure table. Payment terms are the last "What stands out" item. Product focus is not shown on the page; the Copy brief carries "Use case and product: GTM's call".
- Credit exposure is not shown on the page. It stays in the Copy brief, where the deal desk uses it.
- "Retrenchment" is shown to readers as "spending cuts".

### What stands out

Short, rule-based observations about how the numbers relate and move, not their levels. An item appears only when its threshold fires. Each item: a tag, one bold headline, one plain sentence, and the figures behind it on a muted line. Tone: amber bar for watch items, green bar for good news, blue bar for terms. Order: red flags, cash burn or heavy investment, spending cuts, payables, costs, losses, margin, then terms (always last).

| Item | Fires when | Tone |
|---|---|---|
| Red flag | any red flag; shows its context line | watch |
| Cash burn | operating cash flow negative in the latest quarter; states runway = cash ÷ the larger of this quarter's and the four-quarter average free-cash-flow burn. If capex isn't filed: "capital spending is not filed, so runway can't be stated" | watch |
| Heavy investment | operating cash flow positive but free cash flow negative: "Investing more than it generates. Capital spending of $X this quarter against operating cash flow of $Y." Figures: capex and operating cash flow, latest and year-ago. No runway | watch |
| Spending cuts | the retrenchment signal fires; states the cause | watch |
| Payables | DPO rising beyond the band: "Payables stretching. Payables are up N% on last year, beyond the ±10% band." | watch |
| Costs | SG&A growth more than 10 points above revenue growth, Y/Y (watch); or more than 10 points below (good: "overhead growing slower than sales") | watch / good |
| Losses / profits | operating income moved more than 25% Y/Y (base: the year-ago absolute value); narrowing loss or rising profit is good, widening loss or falling profit is watch | good / watch |
| Margin | gross margin moved more than 2 points Y/Y | good / watch |
| Terms | always | terms |

The terms item shows the Net 30 / 45 / 60 marks, the terms sentence from the Summary, one lens-specific phrase (CoreThread: "T&M monthly; milestones acceptable." when Strong, "T&M monthly." otherwise; NexCore: "Billed annually in advance."), and the payables fact ("Payables ≈ 54 days of cost of revenue, down 13% on last year"). No credit exposure line.

## Verdict matrix

- **Axes:** Relationship Opportunity (up) × Counterparty Risk (right).
- **Quadrants:** Pursue, Pursue with guardrails, Monitor, Limit exposure.
- **Same matrix for both lenses;** the inputs differ.

**Opportunity axis:**

- **High** when revenue is up Y/Y (beyond the ±2% band) and R&D is not down Y/Y. Otherwise low.
- If R&D isn't filed, revenue decides alone, and the card says "R&D not filed".
- R&D intensity is shown as context, never scored: intensity falls whenever revenue outgrows R&D, which is not a negative.
- NexCore only: retrenchment sets opportunity to low (a SaaS vendor loses seats now and the renewal later).

**Risk axis:**

- **High** when the ladder rung is Neutral or Weak, or retrenchment is present (both lenses). Low when the rung is Strong and there is no retrenchment.
- Dot position within the risk axis has three steps (Strong, Neutral, Weak), so companies on different rungs never overlap.

**Quadrants:** high opportunity + low risk = Pursue; high + high = Pursue with guardrails; low + low = Monitor; low + high = Limit exposure.

---

## Deal structure

| | CoreThread | NexCore |
|---|---|---|
| **Structure** | By exposure: weaker counterparty → T&M monthly; strong → Milestone acceptable. Scope decides within that. | Product focus: handover to GTM. Finance does not recommend a product. |
| **Payment terms** | Payment-terms ladder (below) | Payment-terms ladder (below) |
| **Credit exposure** | What they could owe us at any point. ≈ 2 months of billing at Net 30 and ≈ 2.5 at Net 45, assuming monthly billing in arrears. | The invoice window on the annual fee (annual billing in advance assumed); near zero once paid. |

### Payment-terms ladder

Baseline Net 30. Hard ceiling Net 45. Net 60 is never approved.

The ladder separates two questions. *Can they pay?* is answered by Z'' and red-flag filings; doubt there means escalation. *Will they pay on time?* is answered by DPO; a company stretching its suppliers is handled through terms, not escalation. The one exception is a grey-zone balance sheet combined with rising DPO, a classic early liquidity-stress pattern.

- **Strong** (Z'' safe, no red flags, DPO not rising beyond the band): Net 30 ✓ · Net 45 ✓ · Net 60 ✕
- **Neutral** (anything not strong or weak, including DPO rising beyond the band on a safe Z''): Net 30 ✓ · Net 45 ✕ · Net 60 ✕
- **Weak** (Z'' distress, any red flag, or Z'' grey and DPO rising beyond the band): Net 30 ✓ with "escalate before signing" · Net 45 ✕ · Net 60 ✕

DPO "rising beyond the band" means DPO up more than 10% on the same quarter last year.

**Runway (can they pay, from cash):** applies only to cash burn, meaning operating cash flow negative in the latest quarter. Runway = cash ÷ the larger of this quarter's and the four-quarter average free-cash-flow burn. Under 8 quarters caps the rung at Neutral; under 4 quarters sets it to Weak. Heavy investment (operating cash flow positive, free cash flow negative) has no runway and no ladder effect: a profitable company can slow its own capital spending. Operating cash flow zero or not filed: neither case.

**Z'' cap:** a Z'' score in the distress zone is treated as grey when trailing-twelve-month operating income and trailing-twelve-month free cash flow are both positive. Every grey rule then applies (grey + DPO rising → Weak; any red flag → Weak). If either figure is missing, no cap. The page says so: "Z'' is in distress, but the company is profitable and cash-generative, so it's treated as grey zone." Reason, in the footer: Z'' penalises accumulated deficits and buyback-driven negative equity; a profitable, cash-generating company isn't treated as distressed on Z'' alone.

**Negotiation note:** states the fact and our position, never a predicted ask. Template: "Payables ≈ [X] days of cost of revenue, [up/down] [Y]% Y/Y. Expect pressure for longer terms; our ceiling is Net [45 if Strong, 30 otherwise]."

**Removed from the card:** contract length, termination notice, deposit and billing.

**Credit exposure wording** (used in the Copy brief; not shown on the page since v1.3):

- CoreThread: "Up to about 2 months of our work unpaid at any time: we invoice each month's work at month end, and they have 30 days to pay." (At Net 45: "about 2½ months … 45 days to pay.")
- NexCore: "Up to [30/45] days of the annual fee, until the invoice is paid; nothing owed after that."

---

## GTM handover

Finance answers whether we can do business and on what terms. Which use case to pursue, and which product to lead with, is a GTM question. Any company can put AI on the edge, so the page doesn't guess at it.

A "Copy brief" button, deterministic with no extra Claude call, produces paste-ready text for whoever needs it: GTM, the CEO, deal desk:

- company, period and lens
- the verdict and the signals behind it
- the terms envelope finance will accept (payment terms and credit exposure, with the billing assumption behind the exposure: monthly in arrears for CoreThread, annual in advance for NexCore)
- the filed figures behind each point
- the source line

A "Download image" button, also deterministic with no server or Claude call, saves the whole lens board (header through footer) as a PNG, so the period, source line and declared values always travel with the verdict. Tooltips are closed in the image. Filename: `TICKER-Lens-Period-YYYY-MM-DD.png`, e.g. `AMZN-NexCore-Q2FY26-2026-09-22.png`.

---

## Declared values

- **Z'' zones (published):** safe above 2.6, distress below 1.1.
- **Growth flat band:** ±2%.
- **DPO band:** ±10% of the same quarter last year.
- **FCF definition, DSO/DPO formulas and equity basis:** as in Financial health.
- **Payment terms:** baseline Net 30, ceiling Net 45.
- **Runway (cash burn only):** under 8 quarters caps the rung at Neutral; under 4 quarters sets Weak.
- **Z'' cap:** distress treated as grey when TTM operating income and TTM free cash flow are both positive.
- **"Fast" in the Summary:** operating income moved more than 50% Y/Y.
- **What stands out thresholds:** costs 10 points vs revenue growth; operating income 25% Y/Y; gross margin 2 points.
- **Claude daily cap:** 50 calls per day (a backstop behind per-filing caching and the Anthropic account spend limit).
- **Explanation triggers:** non-operating swing above 5% of revenue; tax charge more than 5% of revenue away from 21% of pre-tax income; opposite signs.

All declared values are visible in the page footer.

---

## Claude layer

The page is complete without Claude: the rules decide the verdict and terms, and the Summary is templated from the rules' output. Claude has one job the rules can't do: **explain why**, from the filed text, for items the rules flagged.

**Summary (templated, no Claude):** headed "Summary", beside the verdict. It is commentary, not a readout: it says what the numbers mean, and leaves the numbers to the table, the health panel and "What stands out". No ratio values (no Z'', no percentages); a duration in words is allowed ("more than three years of runway"). Built deterministically from the rules' output, in this order:

1. The verdict.
2. The balance sheet in words, from the zone used (after the Z'' cap): "strong" (safe), "in the grey zone", "distressed". Never "cash-rich": the score is not a cash measure.
3. The trajectory: losses shrinking or growing, profits growing or falling (operating income, year on year). "Fast" only above 50%.
4a. The cash position: for cash burn, runway in years or quarters; for heavy investment, "investment is currently running ahead of cash from operations". Otherwise nothing.
4b. When the unusual-tax or non-operating-swing trigger fires: "A one-off tax charge hit net income this quarter; see the explanation below." (or "A one-off non-operating item moved net income this quarter; …"). No figures.
4c. The single most important watch item from "What stands out" not already said above, if any ("The one thing to watch is …").
5. What it means for the relationship: growth and R&D investment pointing to an expanding customer, or spending cuts pointing to a shrinking one.
6. The terms sentence: Strong → "Offer Net 30; go to Net 45 only if pushed." Neutral or Weak → "Offer Net 30 and hold it; expect pressure for longer terms." Weak adds "Escalate before signing."

Example (AMZN): "Pursue with guardrails. The balance sheet is strong and profits are growing, but investment is currently running ahead of cash from operations. A one-off non-operating item moved net income this quarter; see the explanation below. The one thing to watch is payables stretching. Growth points to an expanding customer; R&D is not filed. Offer Net 30 and hold it; expect pressure for longer terms."

Sentences are written as sentences: a subject and verb each, joined with "and" or "but", never a noun phrase spliced to a clause.


**What gets explained** (each is a trigger; nothing else is sent to Claude):

- **Non-operating swing:** pre-tax income differs from operating income by more than 5% of quarterly revenue (e.g. large investment gains or losses, interest, one-offs below operating income).
- **Unusual tax:** the income tax charge differs from the US federal statutory 21% of pre-tax income by more than 5% of quarterly revenue (e.g. a valuation-allowance charge, a large tax benefit).
- **Opposite signs:** net income and operating income have opposite signs (a backstop).

Revenue is the denominator because it is always positive; operating income can be negative or near zero. Calibrated on the fixture companies: NVDA (investment gains, $7.8B) and a company with a $423M valuation-allowance tax charge on a $24M pre-tax loss are flagged; routine tax and interest at MSFT, WMT, UFPT and NAII are not.
- Retrenchment is triggered.
- DPO is rising beyond the band.
- Any red flag. (An NT 10-Q or NT 10-K states the company's reason for filing late; quote it.)

**Sources:** filed text only: the results 8-K (Item 2.02) with all its exhibits, the latest 10-Q/10-K management discussion and notes, NT forms, and any 8-K behind a flag. Many companies furnish more than the press release with the results 8-K: CFO commentary, prepared remarks, or occasionally the call script or transcript itself. When filed, these are read like any other filed text. Transcripts that exist only from paid data providers are out: they aren't filed, and their licences usually forbid showing quotes. The call's live Q&A is therefore available only when the company files it.

**Output:** an "Explained from the filings" block under the Summary. Per flagged item: one or two sentences and a citation (form, filing date, section or note). If the filing doesn't explain it: "Not explained in the filing."

**Constraints:**

- Claude never restates the verdict, the terms or any computed number; the page already shows them.
- Claude may cite a figure only if it appears verbatim in the cited passage. The app checks every quoted figure and passage against the source text by string match; a sentence that fails the check is dropped, never shown.
- Readouts are cached per filing (accession number) in the persistent store, with a daily cap on Claude calls.

**Fallback:** if the cap is hit, the call fails, or Claude is disabled, the block reads "Explanations unavailable" and everything else renders normally.

## Done when

1. NVDA reproduces the mock's figures from the Q2 FY27 10-Q, and the snapshot diff for every fixture reports no changed cells.
2. A company with a 52/53-week fiscal year shows a "~" due-by date.
3. A company that has just reported shows the "new results announced" line.
4. A retailer's seasonal Q/Q dip in SG&A does not trigger retrenchment, because signals read Y/Y.
5. The five-quarter view for a company whose fiscal year just ended shows a derived Q4, marked as derived.
6. The same ticker produces different credit exposure for CoreThread and NexCore in the Copy brief.
7. With the Claude call disabled, the page still renders complete, using templated readouts.
8. No secret or email is present in the repo or its git history.
9. The deadline unit tests pass (every filer category × 10-Q/10-K × normal and 52/53-week years).
10. As of 21 Sep 2026, the ladder produces: NVDA Strong; MSFT Neutral (DPO +24% Y/Y); WMT Neutral (Z'' grey); UFPT Neutral (DPO +27% Y/Y); NAII Weak (NT 10-Q filed 18 May 2026). Red flags age out of the 12-month window, so later runs may differ; any change is reported with its cause.
11. A company with an 8-K Item 2.05 (restructuring) in the last 12 months shows retrenchment, lands on high risk in both lenses, and on low opportunity in the NexCore lens.
12. Going concern appears in the red-flags "i" text and the footer, and nowhere on the tile or verdict.
13. A negative or zero base never shows a % change; it shows the change in dollars.
14. Every column header shows its period-end date, and every † footnote names the period and method.
15. "Download image" saves the whole board with the period, source line and declared values visible, under the stated filename pattern.
16. With Claude enabled, every quoted figure or passage in "Explained from the filings" is found verbatim in its cited source; a deliberately altered quote is dropped by the check.
17. Typing a company name (e.g. "amazon") finds its ticker; typing an exact ticker ranks it first; a company with two share classes shows both.
18. AMZN (Q2 FY26) shows these "What stands out" items, in this order: heavy investment (capex above operating cash flow, no runway), payables, costs, profits, terms. Its Summary contains no ratio values and never says "runway".
19. A company burning cash (operating cash flow negative) with under 8 quarters of runway is capped at Neutral; under 4 quarters is Weak (unit-tested; RIVN shows a live 4-quarter runway on the four-quarter average). Heavy investment never changes the rung.
20. ZM shows Debt / equity as "—" with "debt not tagged in filings"; a company with only convertible debt shows its debt.
21. UBER's Z'' scores in distress but is treated as grey (profitable and cash-generative), so its rung is Neutral; SNAP and RIVN, loss-making, stay Weak.
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
