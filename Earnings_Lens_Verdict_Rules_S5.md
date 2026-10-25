# Earnings Lens — Verdict Rules S5 (Locked)

**Status:** LOCKED · rule design approved and closed by the owner and the independent review on Oct 24, 2026 (Pacific). CONFIRM items D1–D3 closed Oct 25, 2026. This document is the single authoritative rules source for the build.
**Supersedes:** the S0 rules live today (opportunity × risk matrix, Altman Z'' and payables days as deciders) and the S1–S4 simulation variants.
**Mock:** Earnings Lens Verdict v2 Mock, Version 13 (AMZN Q2 FY26), approved.
**Evidence base:** report-only simulations verdict-v2 (S0–S3), verdict-s4 (S4-A/S4-B) and verdict-s5-borrowing (S5 differential test: guard PASS on 90 records; 12/12 synthetic fixtures PASS).
**Not part of this lock:** the showcase-ticker swap (Section 15). It is a proposal, evaluated separately, and does not reopen the engine.

Every item in this document is **LOCKED**. Section 14 records how the three gaps found while writing it (D1–D3) were closed.

---

## 1. What the verdict is, and what it is not

- The verdict answers one question per seller: **is it financially reasonable to do business with this company on these terms?** It is not a judgement of product fit, demand or deal size.
- Two fictional sellers, one shared health read:
  - **CoreThread** (Services lens): embedded engineering and software development services. Contract types: Milestone (product development), T&M (sustenance), Support (for products CoreThread built, or as subject-matter expert). No fixed engagement length for any type.
  - **NexCore** (SaaS lens): edge AI software. Contract components: Subscription, Usage, Onboarding.
- Three layers:
  1. **Financial health** (shared, identical for both entities): five areas → one state.
  2. **Seller condition** (per seller): does anything in the filings change the seller's exposure?
  3. **Verdict + terms** (per seller): a matrix of state × seller condition, then contract protections that follow from the verdict and the seller's contract exposure.
- Four verdicts, strictest first: **Limit exposure > Monitor > Pursue with guardrails > Pursue**.
- A favourable verdict means financially reasonable on these terms. It is not proof the company needs what the seller sells; that is Sales/GTM's job.
- Fragile is not a prediction of bankruptcy. It means financial conditions that warrant restrictive exposure management.

## 2. Inputs and definitions

All money in whole USD as filed. All periods are fiscal quarters from SEC EDGAR XBRL filings. Nothing is estimated; a missing value stays missing.

| Term | Definition |
|---|---|
| Latest quarter (q0) | The most recent fiscal quarter in a filed 10-Q or 10-K that the app has incorporated |
| Revenue Y/Y (q0, q1) | Quarterly revenue vs the same quarter one year earlier, in %, for q0 and the quarter before it (q1) |
| Operating margin change (q0) | Operating margin (operating income ÷ revenue) in q0 minus the same quarter a year earlier, in percentage points |
| 12-month operating cash flow (OCF now) | Sum of net cash from operating activities for q0–q3 |
| OCF a year ago | Sum of the same measure for q4–q7 (the 12 months ending one year before q0) |
| Free cash flow (Earnings Lens basis) | Operating cash flow − purchases of property and equipment; 12-month sums for "now" and "a year ago" as above. May differ from the company's own figure |
| 12-month revenue | Sum of revenue for q0–q3 |
| Liquidity | Cash and cash equivalents + short-term marketable securities (restricted cash only as set in Section 11) |
| Total debt | Short- and long-term borrowings on the balance sheet, same scope as liquidity (Section 11) |
| Net debt (now / a year ago) | Total debt − liquidity, at the q0 balance-sheet date and the date one year earlier. Negative = net cash |
| Net debt increase | Net debt now − net debt a year ago |
| Current ratio | Current assets ÷ current liabilities at q0 |
| Runway | The app's existing runway rule (lib/rules/runway.ts), in quarters × 3 = months; computed only when the latest quarter's operating cash flow is negative; otherwise unknown |
| R&D Y/Y (q0, q1) | Quarterly R&D vs the same quarter a year earlier, in %, from the tag chosen under Section 11 R6 |
| Restructuring filing | An 8-K with Item 2.05 filed in the 12 months before the assessment date |
| Critical filing | An 8-K with Item 1.03 (bankruptcy), 2.04 (triggering event that accelerates an obligation) or 4.02 (non-reliance on previously issued financial statements) filed in the 12 months before the assessment date |
| Assessment date | Today for a live read; the vantage date for an as-of (historical) read. No information filed after it may be used |

## 3. Three-valued logic and missing data (LOCKED)

Every test returns **true**, **false** or **not measurable** (null).

- **AND:** false if any part is false; otherwise not measurable if any part is not measurable; otherwise true. *A clearly false condition wins over missing data.*
- **OR:** true if any part is true; otherwise not measurable if any part is not measurable; otherwise false.
- A comparison against a missing input is not measurable, never passed.
- Examples (approved): if operating cash flow is clearly above 2% of revenue, LOW-CASH DEBT is false even if net debt is missing. If operating cash flow is at or below 2% but net debt is missing, LOW-CASH DEBT is not measurable, not passed.
- A not-measurable flag does not count toward the state. It is listed and lowers evidence to Limited (Section 8).
- Missing is never zero (Section 11 D).

## 4. Layer 1 — Financial health (shared)

### 4.1 Flags (exact operators)

| Area | Flag | Fires when (all comparisons strict as written) |
|---|---|---|
| Cash generation | SEVERE BURN | OCF now < 0 AND OCF a year ago < 0 AND runway < 12 months |
| Cash generation | CAUTION BURN | OCF now < 0 AND OCF a year ago < 0 AND runway ≥ 12 AND runway < 24 months |
| Cash generation | PERSISTENT BURN, RUNWAY UNKNOWN | OCF now < 0 AND OCF a year ago < 0 AND runway unknown |
| Cash generation | INVESTMENT CASH PRESSURE | FCF now < 0 AND FCF a year ago < 0 AND (OCF now < OCF a year ago OR net debt now > net debt a year ago) |
| Near-term liquidity | WEAK LIQUIDITY | current ratio < 0.8 AND OCF now < 0 |
| Operating performance | OPERATING DETERIORATION | revenue Y/Y (q0) ≤ −15% AND operating margin change (q0) ≤ −3 points |
| Funding and leverage | LEVERAGE | OCF now > 2% × 12-month revenue AND net debt now > 0 AND net debt now ÷ OCF now > 4 |
| Funding and leverage | LOW-CASH DEBT | OCF now ≤ 2% × 12-month revenue (includes zero and negative) AND net debt now > 10% × 12-month revenue |
| Funding and leverage | FUNDING SUBSTITUTION | net debt increase > 10% × \|OCF now\| AND OCF now < OCF a year ago AND (OCF now ≤ 0 OR net debt now ÷ OCF now > 2) |
| Filing status | MISSED FILING | a required 10-Q or 10-K is past its deadline (extended deadline if a valid 12b-25 was filed), counted in business days, and no report has been filed (Section 11 R1–R2) |

Notes:
- LEVERAGE and LOW-CASH DEBT are complementary: LEVERAGE is measured only when OCF now is above 2% of revenue; LOW-CASH DEBT only when it is at or below.
- FUNDING SUBSTITUTION materiality uses the **absolute** size of OCF now (S5 change). With OCF now of −$500M: an increase of $1M or $25M does not trigger, $50M does not trigger (not *more than* $50M), $75M triggers. For OCF now ≥ 0 this is identical to S4.
- FUNDING SUBSTITUTION ratio leg: when OCF now > 0, net debt now ÷ OCF now > 2; when OCF now ≤ 0, the leg is true.
- Leverage limit is 4× (S4-B). 3× was tested (S4-A) and rejected.

### 4.2 States (LOCKED)

Evaluated top to bottom; the first match wins.

| State | Rule |
|---|---|
| **Critical** | Any Critical filing (8-K 1.03, 2.04 or 4.02) in the 12 months before the assessment date. Label 4.02 as a reporting-reliability problem, not necessarily insolvency |
| **Fragile** | SEVERE BURN, OR flags in two or more different areas |
| **Watch** | Flags in exactly one area (any number of flags within that area) |
| **Resilient** | No flags |

Escalation counts areas, not flags: LEVERAGE + FUNDING SUBSTITUTION is still one area (Watch).

### 4.3 Display (as in mock V13)
- State scale shown as a severity track: Resilient · Watch · Fragile · Critical, current state highlighted. Subtitle: "Same for both entities · No warning thresholds triggered" (or the triggered areas).
- Five area cards: Cash flow from operations · Near-term liquidity · Operating performance · Funding and leverage · Filing status. Each shows its own scale (Clear · Warning; Cash adds Severe; Filing status adds Critical), one headline figure and two bullets.
- Each card's ⓘ shows Formula, This quarter (with the actual inputs) and Warning when. Every number in an ⓘ comes from the same computed result the verdict used; no separate front-end calculation. The ⓘ closes on a click outside it.

## 5. Layer 2 — Seller condition

### 5.1 CoreThread (Services)

Why: a customer's R&D is what ties to outsourced engineering; a new product can mean CoreThread is needed, and cuts mean tighter scopes and pricing pressure.

| Item | Rule |
|---|---|
| EXPANDING | R&D Y/Y (q0) ≥ +5% AND R&D Y/Y (q1) ≥ +5% |
| R&D CAUTION | R&D Y/Y (q0) ≤ −5% AND R&D Y/Y (q1) ≤ −5% |
| CAUTION | R&D CAUTION OR a restructuring filing (8-K 2.05, 12 months) OR OPERATING DETERIORATION |
| MIXED | CAUTION is true AND EXPANDING is true (because of a 2.05 or OPERATING DETERIORATION). Represented as direction CAUTION with a mixed-evidence indicator = true and its reasons (expanding R&D plus the restructuring or operating-deterioration leg); verdict behaviour identical to CAUTION. Shown as "Caution · Mixed". Never a separate category in the matrix |
| UNKNOWN | R&D not filed quarterly (not filed, annual only, or not in the window), or R&D direction not measurable, and no CAUTION leg fired |
| FLAT | Otherwise |

- When R&D is unknown and another CAUTION leg fires, the direction is CAUTION (the R&D leg is noted as unknown).
- R&D unknown makes CoreThread evidence Limited (Section 8). It never counts as caution.
- What the mock shows: "Engineering spend (R&D)" with Expanding / Flat / Caution / Not separately disclosed.

### 5.2 NexCore (SaaS)

| Item | Rule |
|---|---|
| CAUTION ("cutting back across the business") | OPERATING DETERIORATION AND (a restructuring filing in 12 months OR any cash-generation flag: SEVERE BURN, CAUTION BURN, PERSISTENT BURN RUNWAY UNKNOWN, INVESTMENT CASH PRESSURE) |
| Otherwise | No caution |

- NexCore caution fired 0 times on today's 41. Record as conservative and largely untested, not as proven informative. Do not lower it to manufacture differentiation.
- Device or industry fit never moves a NexCore verdict (ruled: no automatic Monitor for software companies).

## 6. Verdict matrix (LOCKED)

| Health state | Seller condition | CoreThread | NexCore |
|---|---|---|---|
| Critical | any | Limit exposure | Limit exposure |
| Fragile | any | Limit exposure | Monitor (conditional, Section 7.3) |
| Watch | caution | Monitor | Pursue with guardrails |
| Watch | no caution | Pursue with guardrails | Pursue with guardrails |
| Resilient | caution | Pursue with guardrails | Pursue with guardrails |
| Resilient | no caution | Pursue | Pursue |

- The asymmetry (CoreThread stricter in eight S4 cases, NexCore never stricter) is an observed property of these rules, not a permanent rule that NexCore must be less restrictive.
- Two different verdicts are never forced. Pursue/Pursue is correct for a strong counterparty.

## 7. Contract protections and payment terms (LOCKED)

### 7.1 Payment terms (all verdicts)
- **Net 30** is the baseline.
- **Net 45** is available on request only when the verdict is Pursue (Resilient with no seller caution). It is a controlled exception, never shown as pre-approved. Display: "Net 30 ✓ · Net 45 on request · Net 60 ✕".
- For any other verdict, Net 45 is not offered: extending payment time is the wrong response to financial pressure. Display: "Net 30 ✓ · Net 45 ✕ · Net 60 ✕".
- **Net 60** is never recommended (historical Net 60 contracts are precedent, not policy).
- No dollar credit limits: the app has no deal size, scope or contract length as input.

### 7.2 Protections by verdict (LOCKED, D3)
Approved in full for all four verdicts. Protections are **additive**: they strengthen the standard billing mechanics in the Pursue row, never silently replace them. The Pursue rows are the wording approved in the mock.

**CoreThread**

| Verdict | Milestone | T&M | Support |
|---|---|---|---|
| Pursue | Bill at each accepted milestone · written acceptance criteria and review period | Billed monthly in arrears · timesheets approved monthly | Billed in advance · defined scope and service period |
| Pursue with guardrails | Smaller milestones with more frequent acceptance gates · explicit approval deadlines · tighter change orders · cap on unbilled work | Cap on work delivered while invoices are outstanding · no long unfunded staffing commitments | Billed in advance · defined scope and service period |
| Monitor | Short funded discovery phase or small prepaid milestone only · evidence of project authorization before expansion | No large dedicated team · no substantial unrecoverable effort | Billed in advance · defined scope and service period |
| Limit exposure | No new material unsecured work · funds or effective security before material delivery · exceptions escalated to finance | Same | Same |

**NexCore**

| Verdict | Subscription | Usage | Onboarding |
|---|---|---|---|
| Pursue | Monthly, quarterly or annual in advance · service starts on the agreed date | Metered and billed monthly · usage alerts enabled | Fee invoiced at signing |
| Pursue with guardrails | Shorter prepaid service periods · cash received before material service activation | Usage alerts or prepaid usage credits | Paid onboarding |
| Monitor | Small funded pilot or tightly scoped commitment · collected before activation · no assumed expansion or usage ramp · budget owner and deployment commitment confirmed | Prepaid usage only | Paid before work starts |
| Limit exposure | No material service before collection or acceptable security · exceptions need explicit approval | Uncovered usage restricted | Uncovered onboarding cost restricted |

- An advance invoice on Net 30 is not prepaid cash; an unpaid advance invoice is not security.
- Billing frequency and commitment length are separate decisions (a 12-month commitment can be invoiced quarterly).
- Pursue rows stay light: do not overload a Pursue with restrictions.

### 7.3 NexCore Fragile = Monitor (non-negotiable condition, LOCKED)
NexCore's Monitor for a Fragile company holds **only if** the contract eliminates material uncovered exposure: collected before activation, prepaid usage and paid onboarding. If those cannot be met, the deal is treated as Limit exposure. The page states this condition on every NexCore Fragile verdict.

## 8. Evidence confidence (LOCKED)

Shown quietly under the verdict; a separate statement, never another risk score.

| Level | When (first match) |
|---|---|
| **Exception** | A 4.02 Critical filing · MISSED FILING true · stale period (a newer periodic filing exists that has not been incorporated) |
| **Limited** | Any flag or seller test not measurable · CoreThread: R&D unknown · finance-arm debt not separable · restricted cash not separated |
| **Adequate** | Otherwise |

- Stale period (reviewer ruling): keep the last computed classification, label the filing period actually assessed ("Assessed on Q2 FY26 filing"), add a review qualification, and do not present it as a fully current assessment. Never auto-downgrade to Monitor because of staleness.

## 9. Potential application (NexCore only; never part of the verdict)

- Positive-only commercial discovery for Sales/GTM, shown directly under the NexCore verdict with "Commercial discovery · not part of the verdict" and its source.
- Never appears in "What decided it", never changes a verdict, never labels a company "no devices".
- Industry-code mapping (from S4), with the likely route (approved Oct 25, 2026):

| SIC range | Line | Likely route |
|---|---|---|
| 3670–3679 | Chip/platform integration | Partner |
| 3400–3999 (other) | Devices and equipment | Device builder |
| 4000–4799, 5200–5999 | Retail and logistics operations | Site operator |
| 4800–4999 | Network and energy infrastructure | Site operator |
| 0100–0999 | Agriculture operations | Site operator |
| None of these | Not established from filed information | — |

- When no range matches, nothing is shown: no application line and no route line.
- The route is displayed as a three-step bar (Partner · Device builder · Site operator) with the likely one marked and no descriptions, captioned "Rough guide from the industry code". Meaning (for reference, not displayed): Partner = chip or platform vendor that bundles models for its own customers; Device builder = ships models inside the products it sells; Site operator = runs models at its own sites. It is a rough guess at the company type, shown as such; it is GTM information only and never affects a verdict, the terms or evidence.
- Wording comes from the industry-code mapping only; no refinement from filed income-statement lines (D1). Display: "Potential application: Retail and logistics operations" over "Industry-based · SIC 5961 · Commercial discovery, not part of the verdict".

## 10. Shown, not scored (LOCKED)

- Altman Z'', DSO, DPO, debt/equity: shown under "Other ratios", each ⓘ ending "Not used in the verdict."
- Current ratio: shown under Other ratios; its ⓘ ends "Used only in the near-term liquidity check, when 12-month operating cash flow is negative."
- No "Reference only" labels on the page. No benchmarks applied across business models.
- What stands out: filing-backed findings, unchanged in role; they inform and never score.
- Operating segments: their own section, one bar split by revenue share, reconciling to total revenue; never used in the verdict.

## 11. Data-integrity rules (LOCKED; each is a build acceptance test)

| # | Rule |
|---|---|
| R1 Filing calendar | The next expected filing is projected from periods actually filed (52/53-week aware). Not measurable when: a 10-KT/10-QT was filed in the last two years; the last two 10-K period ends are not 357–371 days apart; the latest 10-K end is more than 7 days from the stated fiscal-year end; the last two period ends are not 80–100 days apart; projections disagree on form or by more than 7 days; or an 8-K (2.02, 5.03, 7.01, 8.01) after the latest period announces a fiscal-year change (sentence-level match, the Item 5.03 caption excluded). FedEx must read "not measurable" |
| R2 Deadlines | Deadlines by filer category, counted with business-day roll-forward (weekends and SEC holidays). A valid 12b-25 extends a 10-Q by 5 and a 10-K by 15 calendar days, from the rolled deadline. Filed within the extension → informational. Extension still open → shown as outstanding, not a flag. Deadline passed with no report → MISSED FILING. Xerox FY2025 10-K must read within its extension (deadline Sunday Mar 1, 2026 → Mon Mar 2; extension to Tue Mar 17; filed Mar 17). Filed after the extended deadline: see Section 14 D2 |
| R3 Finance arms (Ford, GM) | Cash and debt on the same scope (both ex-finance, or both consolidated). If operating-company cash and debt cannot be extracted consistently, net debt is shown as unavailable and evidence is Limited ("finance-arm debt not separable") |
| R4 Restricted cash | Three cases, as simulated in S4: (1) restricted cash disclosed as a separate fact at the same date (filing instance first, then company facts; tags in order RestrictedCashAndCashEquivalentsCurrent, RestrictedCashCurrent, RestrictedCashAndCashEquivalentsAtCarryingValue, RestrictedCashAndCashEquivalents, RestrictedCash) → subtract it (HPQ); (2) a cash line with no restricted component in its element → use as filed; (3) a face line whose element includes restricted cash with no separate fact → use the face value, label the liquidity figure "includes restricted cash not separately disclosed" so it is never shown as confirmed unrestricted liquidity, and set evidence Limited ("restricted cash not separated") (SBUX, LULU, MMM) |
| R5 Stale quarters | Quarterly operating cash flow is rebuilt from year-to-date values in the latest filing's XBRL instance, with fiscal-period and reconciliation checks. EDGAR frames alone are not sufficient (KO, F, PYPL, AAL) |
| R6 R&D tags | Precedence: ResearchAndDevelopmentExpense, then …ExcludingAcquiredInProcessCost, then …SoftwareExcludingAcquiredInProcessCost. The first tag with at least one quarterly value in the 12-quarter window is used for every quarter, never summed |
| D Missing debt | No debt line is not zero debt. Zero only when no debt concept appears anywhere in the filing; otherwise net debt is not measurable |
| M Marketable securities | Short-term marketable securities count in liquidity (e.g. NVDA) |
| H Historical reads | As-of reads use only filings on or before the vantage date (EchoStar's Critical must come only from pre-vantage filings) |

## 12. Regression fixtures (LOCKED)

Verdict codes: P = Pursue · PwG = Pursue with guardrails · M = Monitor · L = Limit exposure. Evidence shown CoreThread / NexCore. n/m = not measurable.

**How the fixtures are used**
1. **Engine tests (exact match required):** feed the frozen inputs (verdict-s5-borrowing out/s5.json, which carries the S4 inputs) to the built rules engine; state, fired flags, CoreThread direction, both verdicts and both evidence levels must match the tables below exactly.
2. **Pipeline tests (explained differences):** run the built input pipeline as of the same dates. Any input difference from the frozen inputs must be listed and explained. Expected differences: KO, F, PYPL, AAL (R5 removes "stale period"), F and GM (R3 scope), XRX (R2 business days). Every resulting verdict change is reported, never silently accepted.

### 12.1 Distress cases (8, fixed tests; all must be Fragile or Critical)

| Case (vantage) | State | Flags | CoreThread direction | CT | NC | Evidence |
|---|---|---|---|---|---|---|
| GETYQ (2026-08-10) | Fragile | WEAK LIQUIDITY, FUNDING SUBSTITUTION, LOW-CASH DEBT | UNKNOWN (R&D not filed) | L | M | Limited / Adequate |
| GNLN (2026-08-14) | Fragile | PERSISTENT BURN RUNWAY UNKNOWN, OPERATING DETERIORATION · n/m: SEVERE BURN, CAUTION BURN, INVESTMENT CASH PRESSURE | CAUTION (operating deterioration) | L | M | Limited / Limited |
| LESLQ (2026-08-12) | Fragile | INVESTMENT CASH PRESSURE, LOW-CASH DEBT | CAUTION (8-K 2.05 2025-12-02) | L | M | Limited / Adequate |
| TWINLAB (2025-10-16) | Fragile | OPERATING DETERIORATION, LEVERAGE, MISSED FILING | CAUTION (operating deterioration) | L | M | Exception / Exception |
| BTAIQ (2026-08-13) | Fragile | SEVERE BURN, INVESTMENT CASH PRESSURE, WEAK LIQUIDITY, LOW-CASH DEBT | CAUTION (R&D −69.1% / −35.1%) | L | M | Adequate / Adequate |
| ECHO (2026-05-11) | Critical | INVESTMENT CASH PRESSURE, WEAK LIQUIDITY, FUNDING SUBSTITUTION, LOW-CASH DEBT | CAUTION (R&D −11.1% / −11.8%) | L | L | Limited / Limited |
| SGMOQ (2026-05-14) | Fragile | SEVERE BURN, INVESTMENT CASH PRESSURE, WEAK LIQUIDITY, OPERATING DETERIORATION | CAUTION (operating deterioration) | L | M | Adequate / Adequate |
| SNBRQ (2026-05-12) | Fragile | SEVERE BURN, INVESTMENT CASH PRESSURE, WEAK LIQUIDITY, OPERATING DETERIORATION, LOW-CASH DEBT | CAUTION (R&D −50.9% / −40.9%, operating deterioration) | L | M | Adequate / Adequate |

Leslie's is detected only because of LOW-CASH DEBT (Watch under S4-B; 12-month OCF $10.6M vs a 2% bar of $23.6M; net debt $737.5M vs a 10% bar of $118.0M).

### 12.2 Boeing, year back (fixed test)
BA as of 2025-07-29: **Fragile** · PERSISTENT BURN RUNWAY UNKNOWN, INVESTMENT CASH PRESSURE, LOW-CASH DEBT (n/m: SEVERE BURN, CAUTION BURN) · direction FLAT · CT L · NC M · Limited / Limited.
Inputs: 12-month OCF −$6,184M; 12-month revenue $75,327M; net debt $30,356M (10% bar $7,533M); net debt fell $14,950M in the year.
Reading (reviewer ruling): defensible. Persistent negative cash generation with material debt is financial pressure even with a liquidity cushion. The assessment must acknowledge Boeing's liquidity and its improving financing position (net debt down sharply after an equity raise) and must not imply imminent failure.

### 12.3 Today's 41 (regression fixtures)
Distribution: Health 33 Resilient · 7 Watch · 1 Fragile · 0 Critical. CoreThread 26 P · 14 PwG · 0 M · 1 L. NexCore 33 P · 7 PwG · 1 M · 0 L.

| Ticker | State | Flags | CoreThread direction | CT | NC | Evidence |
|---|---|---|---|---|---|---|
| NVDA | Resilient | — | EXPANDING | P | P | Adequate / Adequate |
| MSFT | Resilient | — | EXPANDING | P | P | Adequate / Adequate |
| WMT | Resilient | — | UNKNOWN (R&D not filed) | P | P | Limited / Adequate |
| UFPT | Resilient | — | UNKNOWN (R&D annual only) | P | P | Limited / Adequate |
| NAII | Watch | FUNDING SUBSTITUTION | UNKNOWN (R&D annual only) | PwG | PwG | Limited / Adequate |
| AMZN | Resilient | — | UNKNOWN (R&D not filed) | P | P | Limited / Adequate |
| GOOGL | Resilient | — | EXPANDING | P | P | Adequate / Adequate |
| FDX | Resilient | — · n/m: MISSED FILING (fiscal-year change) | CAUTION (8-K 2.05 2026-01-29) | PwG | P | Limited / Limited |
| SNAP | Resilient | — | CAUTION · MIXED (R&D +22.3% / +12.8%; 8-K 2.05 2026-04-15) | PwG | P | Adequate / Adequate |
| RIVN | Fragile | INVESTMENT CASH PRESSURE, FUNDING SUBSTITUTION | EXPANDING | L | M | Adequate / Adequate |
| UBER | Resilient | — | EXPANDING | P | P | Limited / Limited |
| TGT | Resilient | — | UNKNOWN (R&D not filed) | P | P | Limited / Adequate |
| ZM | Resilient | — | EXPANDING | P | P | Adequate / Adequate |
| INTC | Resilient | — | CAUTION (R&D −8.6% / −7.3%) | PwG | P | Adequate / Adequate |
| PFE | Watch | FUNDING SUBSTITUTION | EXPANDING | PwG | PwG | Adequate / Adequate |
| VZ | Watch | LEVERAGE · n/m: INVESTMENT CASH PRESSURE | UNKNOWN (R&D not filed) | PwG | PwG | Limited / Limited |
| T | Watch | FUNDING SUBSTITUTION | UNKNOWN (R&D not filed) | PwG | PwG | Limited / Adequate |
| KO | Resilient | — | UNKNOWN (R&D not filed) | P | P | Exception / Exception (stale) |
| IBM | Resilient | — | EXPANDING | P | P | Limited / Limited |
| CSCO | Resilient | — | CAUTION (8-K 2.05 2026-05-13) | PwG | P | Limited / Limited |
| ORCL | Resilient | — | FLAT | P | P | Adequate / Adequate |
| CRM | Resilient | — | EXPANDING | P | P | Adequate / Adequate |
| ADBE | Resilient | — | EXPANDING | P | P | Adequate / Adequate |
| NKE | Resilient | — | CAUTION (8-K 2.05 2026-10-01, 2026-03-05) | PwG | P | Limited / Adequate |
| BA | Watch | LEVERAGE (7.11×) | FLAT | PwG | PwG | Adequate / Adequate |
| F | Resilient | — | UNKNOWN (R&D annual only) | P | P | Exception / Exception (stale) |
| GM | Resilient | — | UNKNOWN (R&D not in window) | P | P | Limited / Adequate |
| HPQ | Resilient | — | CAUTION (8-K 2.05 2025-11-25) | PwG | P | Adequate / Adequate |
| DELL | Resilient | — | EXPANDING | P | P | Limited / Limited |
| PYPL | Resilient | — | UNKNOWN (R&D not in window) | P | P | Exception / Exception (stale) |
| SBUX | Resilient | — | CAUTION (8-K 2.05 2026-09-24, 2026-05-15) | PwG | P | Limited / Limited |
| DIS | Watch | FUNDING SUBSTITUTION | UNKNOWN (R&D not filed) | PwG | PwG | Limited / Adequate |
| LULU | Resilient | — | UNKNOWN (R&D not filed) | P | P | Limited / Limited |
| PTON | Resilient | — | FLAT | P | P | Adequate / Adequate |
| CVNA | Resilient | — | UNKNOWN (R&D not filed) | P | P | Limited / Adequate |
| AAL | Resilient | — | UNKNOWN (R&D not filed) | P | P | Exception / Exception (stale) |
| CCL | Resilient | — | UNKNOWN (R&D not filed) | P | P | Limited / Adequate |
| MMM | Resilient | — | UNKNOWN (R&D annual only) | P | P | Limited / Limited |
| M | Resilient | — | UNKNOWN (R&D not filed) | P | P | Limited / Adequate |
| KSS | Resilient | — | UNKNOWN (R&D not filed) | P | P | Limited / Adequate |
| XRX | Watch | LEVERAGE, FUNDING SUBSTITUTION | UNKNOWN (R&D not filed) | PwG | PwG | Limited / Limited |

### 12.4 Year back (41, regression fixtures)
Distribution: Health 33 Resilient · 6 Watch · 2 Fragile. CoreThread 29 P · 10 PwG · 2 L. NexCore 33 P · 6 PwG · 2 M.
All records not listed below: Resilient, no flags, CT P, NC P.

| Ticker (vantage) | State | Flags | CoreThread direction | CT | NC | Evidence |
|---|---|---|---|---|---|---|
| INTC (2025-07-24) | Fragile | INVESTMENT CASH PRESSURE, FUNDING SUBSTITUTION | CAUTION (R&D −13.1% / −16.9%; 8-K 2.05 ×3) | L | M | Limited / Limited |
| BA (2025-07-29) | Fragile | see 12.2 | FLAT | L | M | Limited / Limited |
| KO (2025-05-01) | Watch | LEVERAGE, FUNDING SUBSTITUTION | UNKNOWN (R&D not filed) | PwG | PwG | Limited / Adequate |
| IBM (2025-10-23) | Watch | LEVERAGE, FUNDING SUBSTITUTION | EXPANDING | PwG | PwG | Limited / Limited |
| SBUX (2025-07-29) | Watch | FUNDING SUBSTITUTION | UNKNOWN (R&D not filed) | PwG | PwG | Limited / Limited |
| CVNA (2025-07-30) | Watch | LEVERAGE | UNKNOWN (R&D not filed) | PwG | PwG | Limited / Adequate |
| CCL (2025-09-29) | Watch | LEVERAGE | UNKNOWN (R&D not filed) | PwG | PwG | Limited / Adequate |
| XRX (2025-08-07) | Watch | LEVERAGE, FUNDING SUBSTITUTION | UNKNOWN (R&D not filed) | PwG | PwG | Limited / Limited |
| PFE (2025-08-05) | Resilient | — | CAUTION (R&D −7.9% / −11.6%; 8-K 2.05 2025-04-29) | PwG | P | Adequate / Adequate |
| HPQ (2025-08-28) | Resilient | — | CAUTION (8-K 2.05 2025-02-27) | PwG | P | Adequate / Adequate |
| PTON (2025-08-07) | Resilient | — | CAUTION (R&D −19.6% / −22.4%) | PwG | P | Adequate / Adequate |
| KSS (2025-09-04) | Resilient | — | CAUTION (8-K 2.05 2025-01-10) | PwG | P | Limited / Adequate |
| NAII (2025-09-23) | Resilient | — · n/m: OPERATING DETERIORATION | UNKNOWN (R&D annual only) | P | P | Limited / Limited |

Full per-record expected values for all 90 records (including the Resilient/Pursue rows and every evidence level) are in verdict-s5-borrowing out/s5.json, REVISED block; that file is the machine-readable fixture source.

### 12.5 Synthetic fixtures (must pass)

| # | Case | Expected FUNDING SUBSTITUTION / LOW-CASH DEBT |
|---|---|---|
| F1–F4 | OCF now −500M, a year ago −400M, net debt a year ago 100M; increase 1M / 25M / 50M / 75M | false / false / false / true |
| F5 | OCF 1,000M (a year ago 1,200M); net debt 1,500M → 2,600M | true |
| F6 | As F5 with increase 50M | false |
| F7 | OCF now 0 (a year ago 100M); increase 1M | true (near-zero case: \|0\| × 10% = 0) |
| F8 | OCF now missing | not measurable |
| F9a–d | Revenue 1,000M: OCF 20M & net debt 101M / OCF 21M & 101M / OCF 20M & 100M / OCF −50M & 500M | LOW-CASH DEBT true / false / false / true |
| F10 | OCF clearly above 2% of revenue, net debt missing | LOW-CASH DEBT false (false wins) |
| F11 | OCF at or below 2% of revenue, net debt missing | LOW-CASH DEBT not measurable |

## 13. Validation record (what is proven and what is not)

- **Tested:** the S5 FUNDING SUBSTITUTION formula passed the regression (0 of 90 records change against S4 + low-cash) and the synthetic boundary tests.
- **Not validated by real data:** none of the 90 historical observations exercised the difference between the S4 and S5 formulas (negative operating cash flow, a small positive debt increase, and falling operating cash flow at the same time). The change rests on its logic and the synthetic tests.
- **Near-zero OCF:** the materiality bar becomes very small when operating cash flow is close to zero. No extra threshold is added; LOW-CASH DEBT covers material debt in that zone. Revisit only if a real case shows a blind spot.
- **LOW-CASH DEBT:** never fires on today's 41; fires on 5 of 8 distress cases and on Boeing a year back; changes two states (Leslie's, Boeing year back).
- **NexCore caution:** fired 0 times on today's 41; conservative and largely untested.
- **Year-back reads:** later solvency does not prove an earlier Watch or Fragile wrong (Intel, Boeing).

## 14. Gaps closed while writing this document (LOCKED)

| # | Gap | Ruling |
|---|---|---|
| D1 | Potential-application wording had no rule for refining it from filed lines | Industry-code mapping only. Amazon reads "Potential application: Retail and logistics operations" with "Industry-based · SIC 5961 · Commercial discovery, not part of the verdict". The mock's "fulfillment" refinement is removed |
| D2 | A report filed **after** its extended deadline was undefined | See below |
| D3 | Per-verdict protections (7.2) had only been mocked for Pursue | Approved in full as written; additive to normal billing; NexCore Fragile condition (7.3) stays mandatory |

**D2 — filing status cases (exact):**

| Case | MISSED FILING flag | Filing status card | What stands out | Evidence |
|---|---|---|---|---|
| Required report overdue, none filed (past the extended deadline if a valid 12b-25 was filed) | true (Warning) until the report arrives | "Overdue" · Warning | Overdue filing: form, period, deadline | Exception (missed filing) |
| Filed within a valid 12b-25 extension | false | "Filed within extension" · Clear | Informational: form, period, extended deadline, filing date | unchanged |
| Extension still open, not yet filed | false | "Extension open" · Clear | Informational: form, period, extended deadline | unchanged |
| Filed after the extended deadline (received) | false | "Filed late · received" · Clear (never "On time") | "Filed late": form, reporting period, applicable extended deadline, actual filing date | unchanged by the late filing itself; a newer filing not yet incorporated still sets Exception (stale) |
| Filed by the original deadline | false | "On time" · Clear | nothing | unchanged |

Scope of "Filed late · received": the most recent required periodic report. Historical (as-of) assessments preserve what was known on the assessment date: a report received after the vantage date never clears a MISSED FILING warning in an earlier assessment.

## 15. Separate proposal — showcase tickers (NOT part of the lock)

The current fixture and showcase set is NVDA, MSFT, WMT, AMZN, GOOGL, FDX, SNAP, RIVN, UBER, TGT, ZM, NAII, UFPT. Under S5 it already shows Caution · Mixed (SNAP), Fragile (RIVN), Watch on funding substitution (NAII) and a not-measurable filing test (FDX). What it lacks:
- **INTC**: CoreThread caution from sustained R&D cuts alone (Resilient, CT PwG, NC Pursue).
- **BA or VZ**: Watch on leverage above 4× (BA 7.11×; VZ 4.21× with a not-measurable flag and Limited evidence).

Whether to add them, and what they replace, is the owner's call, evaluated separately from the engine.

## 16. Page design (LOCKED Oct 25, 2026)

The page follows the mock "Earnings Lens Verdict v2 Mock", Version 24 (files: Main.dc.html, and its clickable preview earnings-lens-preview.html). Decisions made in the mock rounds:
- Top card: "What this means for <seller>" with evidence top right; the verdict word large, beside a four-step verdict bar (Pursue · Pursue with guardrails · Monitor · Limit exposure) with the current step marked by a dot. No tags under the verdict; the Why bullets carry what decided it.
- NexCore only, when the industry code maps: a full-width band with Potential application and the Likely route bar (Partner · Device builder · Site operator, dot on the likely one), captioned "Rough guide from the industry code · Industry-based · SIC <code> · Commercial discovery, not part of the verdict". Hidden when no code maps.
- No Sales/GTM box (generic deal questions belong in the sales playbook). No "Offer Net 30" line under the verdict; payment terms appear only in Terms.
- Financial health: the four-state bar with a dot on the current state; five area cards each with its own bar and dot; every ⓘ is bullets under short headings (Formula / This quarter / Warning when; ratios: Formula / What it means / footer), closes on a click outside it.
- No prose anywhere in the page: bullets only.

## 17. Build B content rules (LOCKED Oct 25, 2026)

### 17.1 Build A findings (accepted)
- American Airlines: Watch · LEVERAGE (4.23×) · Pursue with guardrails / Pursue with guardrails on its newly incorporated quarter. Accepted.
- Greenlane: reported borrowings are never zero; "no debt line" with debt concepts in the filing = net debt not measurable. Rule D stands.
- Finance-arm detection: S4's signal (finance-receivable, finance cash-flow or revenue tags at the current period ends; finance-named segment members; finance-named entity members on debt concepts) is the rule for "finance-arm debt not separable". It lowers evidence to Limited only; never a verdict.
- Ford: fair-value disclosures are never substituted for a consistent debt-and-cash scope. Where scope cannot be reconciled, net debt is unavailable (R3).

### 17.2 Display rules
- Filing status card shows **Critical** (dot on Critical) when any 8-K item 1.03, 2.04 or 4.02 is filed in the 12 months before the assessment date. Its ⓘ names the item and date, and for 4.02 says it is a reporting-reliability problem, not necessarily insolvency.
- **Not fully measurable:** a health card where no flag fired but at least one of its flags is not measurable shows a grey "Not fully measurable" tag, no step selected on its bar, and its ⓘ names each test that could not run and why.

### 17.3 Explained from the filings (Claude layer)
- Kept, placed directly below What stands out. Its triggers, sources, verbatim quote check, caching and fallback stay as built.
- It is AI-assisted interpretation of filed text, labelled with its source (form, filing date, section). It never feeds the verdict, the health state, the terms or evidence, and never invents, restates or overrides a figure.

### 17.4 Why bullets (three per seller, deterministic, in this order)
**Bullet 1 — financial health (same facts for both entities):**
- Resilient: "Financial health Resilient: no warning thresholds triggered", plus " · capital spending above operating cash flow" when 12-month free cash flow is negative.
- Watch or Fragile: "Financial health <state>: " followed by each fired warning, joined by " · ", in these words:
  - SEVERE BURN: "operating cash flow negative for two 12-month periods, under 12 months of cash"
  - CAUTION BURN: "operating cash flow negative for two 12-month periods, 12–24 months of cash"
  - PERSISTENT BURN, RUNWAY UNKNOWN: "operating cash flow negative for two 12-month periods; runway cannot be measured"
  - INVESTMENT CASH PRESSURE: "free cash flow negative for two 12-month periods while <operating cash flow fell | net debt rose>"
  - WEAK LIQUIDITY: "current ratio <x.x>x with negative operating cash flow"
  - OPERATING DETERIORATION: "sales <a>% and operating margin <b> points on a year ago"
  - LEVERAGE: "net debt <x.xx>× operating cash flow, above 4×"
  - LOW-CASH DEBT: "operating cash flow <x>% of sales with net debt at <y>% of sales"
  - FUNDING SUBSTITUTION: "net debt up $<n> while operating cash flow fell"
  - MISSED FILING: "<form> for <period> overdue since <deadline>"
- Critical: "Critical filing: 8-K <item> on <date> (<bankruptcy | debt acceleration | reporting reliability, not necessarily insolvency>)".

**Bullet 2 — seller condition:**
- CoreThread:
  - Expanding: "Engineering spend expanding: R&D +a% and +b% on a year ago"
  - Caution: "Engineering spend under pressure: " + each reason (R&D a% / b% · restructuring filing <date> · sales and operating margin falling together)
  - Mixed: "Mixed signals: R&D up a% / b%, but " + (restructuring filing <date> | sales and operating margin falling together)
  - Flat: "Engineering spend steady: R&D a% / b% on a year ago"
  - Unknown, by its actual reason: not filed → "R&D not separately disclosed"; annual only → "R&D reported annually only; quarterly trend cannot be determined"; not in the 12-quarter window → "No R&D reported in the last 12 quarters"; otherwise → "Quarterly R&D trend cannot be determined from the available filings"
- NexCore:
  - Caution: "Cutting-back warning triggered: sales a%, operating margin b points on a year ago, plus " + (restructuring filing <date> | cash-generation warning)
  - No caution, all inputs measurable: "Cutting-back warning not triggered: sales a% year over year, operating margin ±b points"
  - Not measurable: "Cutting-back warning not fully measurable: <missing input>"

**Bullet 3 — what it means (fixed line per verdict):**

| Verdict | CoreThread | NexCore |
|---|---|---|
| Pursue | Supports engineering work on standard terms | Supports subscription and usage commitments on standard terms |
| Pursue with guardrails | Smaller funded milestones and capped unbilled work, per Terms | Cash before material activation; usage alerts or prepaid credits, per Terms |
| Monitor | Short funded discovery or a small prepaid milestone only | Small funded pilot only, collected before activation |
| Limit exposure | No new unsecured work; funds or security before delivery | No material service before collection or security |

Numbers in bullets come from the engine's computed values (one decimal for % and points, two for ×); a missing number is never filled in.

### 17.5 Financial health summary bullets (owner-approved Oct 25, 2026)
- First, for a Critical classification, the deciding Critical filing, in the §17.4 Critical wording.
- Then one bullet per fired Layer 1 warning, in the §17.4 Bullet 1 wording.
- Then up to three computed facts, in this order, neutral wording, no judgement words:
  - "Operating cash flow $<X> over the last 12 months (<±y>% on the prior 12)"
  - "Free cash flow $<Z> over the last 12 months (Earnings Lens basis)"
  - "Net debt $<N> (net debt $<M> a year ago)", a negative value shown as net cash, e.g. "Net debt $9.6B (net cash $37.3B a year ago)"
- A missing value drops that bullet; never filled in. Money in $B with one decimal ($M below $1B).
- The Financial health summary bullet count is therefore variable. The seller Why sections stay exactly three bullets.

### 17.6 Build B review rulings (Oct 25, 2026)
- ⓘ boxes: plain financial language with engine-computed figures. No internal flag names in capitals, no operators. Formula = what each measure is; This quarter = each value with a plain label; Warning when = one plain bullet per condition; Could not run = plain test name and the missing input.
- Missing values show "—" with "Not available"; never "MISSING".
- Evidence line: human-readable reasons (e.g. "investment cash test could not run"), never internal flag names.
- Operating-cash-flow change in the health summary: when the two 12-month values have opposite signs, or the prior value is zero or negative, show dollars ("from $183.0M the prior 12"), never a percentage.
- Net debt / net cash wording is set from both balances (now and a year ago):
  - both net cash (negative net debt): "net cash up/down $X";
  - both net debt (positive): "net debt up/down $X";
  - crossing zero: "moved from net cash $A to net debt $B" or "moved from net debt $A to net cash $B";
  - a zero balance is neither net debt nor net cash ("net debt of zero");
  - no movement is ever described in a way that contradicts the displayed balances. This applies to §17.4, §17.5, the area cards and the ⓘ.
- The old missed-deadline red flag in What stands out is retired; the §14 D2 filing-status item is the single filing-status authority.
- Operating segments are shown only when the filed segment amounts sum to total revenue within $1M; otherwise the section is hidden (no reconciling-items entry).
- Build B open questions 1, 2, 3, 7, 10, 11 are accepted as implemented; a year-ago DPO is not added.
