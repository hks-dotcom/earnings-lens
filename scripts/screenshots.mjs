// One-off tool (not part of the app) to capture the review screenshots of
// the running dev server into screenshots/. Uses Playwright directly since
// the deliverable needs real files on disk, not just inline preview images.
//
// Replaces the earlier take-screenshot*.mjs one-offs -- one script, one
// shot list, so the set can be regenerated in a single command after a UI
// change instead of remembering which of five scripts covered which shot.
//
// Before any shot is taken, the phone layout is checked in both Chromium
// and WebKit, and a failure stops the run with a non-zero exit: a broken
// layout never produces a fresh screenshot for the README.
//
// Usage: node scripts/screenshots.mjs http://localhost:PORT
//        node scripts/screenshots.mjs http://localhost:PORT --check-only

import { chromium, webkit } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 375, height: 812 }; // iPhone-ish

// ticker null = leave whatever the page loaded with (NVDA is the default).
// annual: true clicks the Annual toggle before the shot and back after.
const SHOTS = [
  { file: "nvda-services.png", ticker: null, lens: "Services", viewport: DESKTOP },
  { file: "nvda-saas.png", ticker: null, lens: "SaaS", viewport: DESKTOP },
  // Three fiscal years with two comparison columns, margins included.
  { file: "nvda-annual.png", ticker: null, lens: "Services", viewport: DESKTOP, annual: true },
  // The README showcase: the richest "What stands out" list on a famous
  // name -- cash burn with a runway, payables stretching, overhead against
  // sales, profits rising -- plus the one-off pointer in the Summary.
  { file: "amzn-services.png", ticker: "AMZN", lens: "Services", viewport: DESKTOP },
  { file: "wmt-services.png", ticker: "WMT", lens: "Services", viewport: DESKTOP },
  { file: "naii-services.png", ticker: "NAII", lens: "Services", viewport: DESKTOP },
  // A restructuring filing, so spending cuts fire and the SaaS lens drops
  // to low opportunity while the Services lens does not.
  { file: "snap-saas.png", ticker: "SNAP", lens: "SaaS", viewport: DESKTOP },
  // The burn case, against Amazon's heavy investment above: operations
  // themselves consume cash, so this one carries a runway -- divided by
  // the four-quarter average, the larger of the two measures.
  { file: "rivn-services.png", ticker: "RIVN", lens: "Services", viewport: DESKTOP },
  // The grey zone plus rising payables, the one path that reaches Weak
  // without a red flag or a distress score.
  { file: "tgt-services.png", ticker: "TGT", lens: "Services", viewport: DESKTOP },
  // A distress score on a profitable, cash-generating company: the tile
  // reads "treated as grey zone" and the panel says why.
  { file: "uber-services.png", ticker: "UBER", lens: "Services", viewport: DESKTOP },
  { file: "amzn-phone-width.png", ticker: "AMZN", lens: null, viewport: PHONE },
];

const baseUrl = process.argv[2];
const checkOnly = process.argv.includes("--check-only");
if (!baseUrl) {
  console.error("Usage: node scripts/screenshots.mjs http://localhost:PORT [--check-only]");
  process.exit(1);
}

// The phone-layout check: these companies, both lenses, both engines.
// AMZN has the longest verdict and the densest "What stands out" list,
// RIVN carries the cash-burn item's long figures line, and NAII is a small
// filer with one-decimal figures and a red-flag row -- between them they
// put every kind of row the board can show on a 375px screen.
const LAYOUT_TICKERS = ["AMZN", "RIVN", "NAII"];
const LAYOUT_LENSES = ["Services", "SaaS"];
const LAYOUT_ENGINES = [
  ["chromium", chromium],
  ["webkit", webkit],
];

/**
 * Every element inside the lens board whose right edge lies past the
 * board's own inner right edge (inside its border).
 *
 * Measured element by element with getBoundingClientRect rather than
 * with the page's scrollWidth, because the page cannot report this:
 * html and body have overflow-x hidden, so an overflowing board is
 * clipped by the viewport and scrollWidth never grows past it. That is
 * how a matrix hanging out of the board's border got through the old
 * check. Nothing here is exempt -- a scroll container inside the board is
 * itself a phone-layout failure, so its children count too.
 */
function findBoardOverflow() {
  const board = document.querySelector("[data-lens-board]");
  if (!board) return ["no [data-lens-board] element on the page"];
  const box = board.getBoundingClientRect();
  const edge = box.right - parseFloat(getComputedStyle(board).borderRightWidth);
  const viewport = document.documentElement.clientWidth;
  const offenders = [];
  if (box.right > viewport + 0.5) {
    offenders.push(`the board itself: right ${box.right.toFixed(1)} > viewport ${viewport}`);
  }
  const past = new Set();
  for (const el of board.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue; // not rendered (closed <details>, hidden tooltip)
    if (r.right > edge + 0.5) past.add(el);
  }
  // Report only the outermost offender in each chain: when a column
  // overflows, every descendant of it does too, and listing them all
  // buries the cause. The total is still reported.
  for (const el of past) {
    let ancestorAlsoPast = false;
    for (let a = el.parentElement; a && a !== board; a = a.parentElement) {
      if (past.has(a)) { ancestorAlsoPast = true; break; }
    }
    if (ancestorAlsoPast) continue;
    const r = el.getBoundingClientRect();
    const cls = typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/).join(".")}` : "";
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
    offenders.push(`<${el.tagName.toLowerCase()}${cls}> right ${r.right.toFixed(1)} > board edge ${edge.toFixed(1)}${text ? ` "${text}"` : ""}`);
  }
  if (past.size > offenders.length) offenders.push(`(${past.size} elements past the edge in total)`);
  return offenders;
}

async function checkPhoneLayout() {
  let failures = 0;
  for (const [engineName, engine] of LAYOUT_ENGINES) {
    const browser = await engine.launch();
    const page = await browser.newPage({ viewport: PHONE });
    page.on("pageerror", (err) => console.log(`PAGE ERROR (${engineName}):`, err.message));
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await waitForBoard(page);

    for (const ticker of LAYOUT_TICKERS) {
      await setTicker(page, ticker);
      for (const lens of LAYOUT_LENSES) {
        await selectLens(page, lens);
        const offenders = await page.evaluate(findBoardOverflow);
        if (offenders.length === 0) {
          console.log(`phone layout ${engineName.padEnd(8)} ${ticker.padEnd(5)} ${lens.padEnd(10)} ok`);
        } else {
          failures++;
          console.log(`phone layout ${engineName.padEnd(8)} ${ticker.padEnd(5)} ${lens.padEnd(10)} FAIL`);
          for (const line of offenders) console.log(`    ${line}`);
        }
      }
    }
    await browser.close();
  }
  return failures;
}

const OUT_DIR = join(process.cwd(), "screenshots");
mkdirSync(OUT_DIR, { recursive: true });

async function waitForBoard(page) {
  await page.waitForSelector("[data-lens-board]", { timeout: 60000 });
  await page.waitForTimeout(500);
}

async function setTicker(page, ticker) {
  const input = page.locator("#tk");
  await input.click({ clickCount: 3 });
  await input.fill(ticker);
  await page.getByRole("button", { name: "Go" }).click();
  // Wait for the board's identity line, "COMPANY (TICKER)", to show the new
  // company. The parentheses matter: the search dropdown lists the bare
  // ticker the moment it is typed, so matching on the ticker alone can
  // return before the board has changed. Generous: the first request for
  // a company is a cold EDGAR fetch of submissions plus company facts.
  await page.waitForFunction(
    (t) => document.body.innerText.includes(`(${t})`),
    ticker,
    { timeout: 60000 }
  );
  await page.waitForTimeout(500);
}

/** Picks a lens by its identifier ("Services"/"SaaS"), not the toggle's display label. */
async function selectLens(page, lens) {
  await page.locator(`button[data-lens="${lens}"]`).click();
  await page.waitForTimeout(300);
}

/** The Annual toggle is a button that stays pressed; read its state rather than assuming. */
async function setAnnual(page, wanted) {
  const button = page.getByRole("button", { name: "Annual" });
  if ((await button.count()) === 0) return;
  const pressed = (await button.getAttribute("aria-pressed")) === "true";
  if (pressed !== wanted) {
    await button.click();
    await page.waitForTimeout(300);
  }
}

async function main() {
  const layoutFailures = await checkPhoneLayout();
  if (layoutFailures > 0) {
    console.error(`\nphone layout check FAILED on ${layoutFailures} board(s); no screenshots taken.`);
    process.exit(1);
  }
  console.log("phone layout check passed in both engines.\n");
  if (checkOnly) return;

  const browser = await chromium.launch();
  // One page per viewport so the desktop shots reuse a single warm session
  // and the phone shot gets a genuine cold load at 375px.
  let page = null;
  let currentViewport = null;
  let currentTicker = null;

  for (const shot of SHOTS) {
    if (shot.viewport !== currentViewport) {
      if (page) await page.close();
      page = await browser.newPage({ viewport: shot.viewport });
      page.on("pageerror", (err) => console.log(`PAGE ERROR (${shot.file}):`, err.message));
      await page.goto(baseUrl, { waitUntil: "networkidle" });
      await waitForBoard(page);
      currentViewport = shot.viewport;
      currentTicker = null;
    }

    if (shot.ticker && shot.ticker !== currentTicker) {
      await setTicker(page, shot.ticker);
      currentTicker = shot.ticker;
    }
    if (shot.lens) await selectLens(page, shot.lens);
    // Always set it explicitly: the toggle persists across shots on the
    // same warm page, so an unset shot would inherit the previous one.
    await setAnnual(page, shot.annual === true);

    if (shot.viewport === PHONE) {
      // Guard the phone layout: the page itself must not scroll sideways,
      // even though the key-financials table inside it does.
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      console.log(
        `phone width check: viewport=${PHONE.width}, documentElement.scrollWidth=${scrollWidth}` +
          (scrollWidth > PHONE.width ? "  <-- PAGE OVERFLOWS" : "  (ok)")
      );
      if (scrollWidth > PHONE.width) {
        console.error("page scrolls sideways at phone width; stopping.");
        process.exit(1);
      }
    }

    await page.screenshot({ path: join(OUT_DIR, shot.file), fullPage: true });
    console.log(`saved ${shot.file}`);
  }

  if (page) await page.close();
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
