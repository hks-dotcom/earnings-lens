// Unit tests for the ONE-OFF ITEM in "What stands out", and the two small
// formatting rules the board's reasons rest on. No network calls.
//
// The one-off item fires on the explanation layer's three financial
// triggers. Only the non-operating swing is reached by a tracked ticker
// (AMZN, NVDA, GOOGL, UBER, ZM). The unusual-tax trigger fires on none since
// the year-ago repeat rule (RIVN's tax position repeats), and nothing in the
// fixture set has net income and operating income on opposite signs.
// So each trigger, and all three at once, gets a constructed quarter here,
// and the full text the board would show is checked word for word.
//
// Usage: npx tsx scripts/test-oneoff.ts

import { KeyFinancials, LineItem } from "@/lib/xbrl/keyFinancials";
import { bandPctWords, oneOffItem, StandOutItem } from "@/lib/present/standOut";
import { heroTermsPhrase } from "@/lib/present/verdictReasons";
import { MILLIONS, MILLIONS_1DP } from "@/lib/present/format";
import { withoutRepeatedDollars } from "@/lib/present/findingExplanations";

let pass = 0;
let fail = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${ok ? "" : `\n        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`}`);
  if (ok) pass++;
  else fail++;
}

const M = 1_000_000;

function cell(value: number | undefined) {
  return value === undefined ? undefined : { value: value * M, concept: "test", method: "direct" as const, derived: false };
}

/** The latest quarter, and optionally the same quarter a year earlier (index 4). */
function line(latest: number | undefined, yearAgo?: number): LineItem {
  return { values: [cell(latest), undefined, undefined, undefined, cell(yearAgo)] };
}

interface YearAgo {
  revenue?: number;
  pretax?: number;
  tax?: number;
}

/** Only the rows the one-off triggers read. With no year-ago quarter, the tax repeat test can't be evaluated. */
function kf(
  q: { revenue: number; operating: number; pretax: number; tax: number; net: number },
  yearAgo: YearAgo = {}
): KeyFinancials {
  return {
    revenue: line(q.revenue, yearAgo.revenue),
    operatingIncome: line(q.operating),
    pretaxIncome: line(q.pretax, yearAgo.pretax),
    incomeTaxExpense: line(q.tax, yearAgo.tax),
    netIncome: line(q.net),
    quarters: [{ label: "Q2 FY26" }, {}, {}, {}, { label: "Q2 FY25" }],
  } as unknown as KeyFinancials;
}

/** What the board shows for the item: headline, sentences, figures line, rule line. */
function shown(item: StandOutItem | undefined) {
  if (!item) return undefined;
  return {
    tag: item.tag,
    tone: item.tone,
    headline: item.headline,
    sentences: [item.sentence, ...(item.more ?? []).map((m) => m.sentence)],
    explainKeys: [item.explainKey, ...(item.more ?? []).map((m) => m.explainKey)],
    figures: item.figures,
    rule: `Rule: ${item.rule}`,
  };
}

// --- Non-operating swing: AMZN's Q2 FY26 figures ---------------------------
check(
  "non-operating swing (AMZN Q2 FY26 figures)",
  shown(oneOffItem(kf({ revenue: 200606, operating: 27461, pretax: 80857, tax: 18199, net: 62647 }), MILLIONS)),
  {
    tag: "ONE-OFF ITEM",
    tone: "info",
    headline: "A non-operating item moved net income.",
    sentences: ["Pre-tax income is $53.4B above operating income."],
    explainKeys: ["non-operating-swing"],
    figures: "Operating income $27,461M · pre-tax income $80,857M (Q2 FY26)",
    rule: "Rule: flagged when pre-tax income differs from operating income by more than 5% of quarterly revenue ($10.0B here).",
  }
);

// --- Unusual tax: a valuation-allowance charge on a small pre-tax loss -----
const TAX_QUARTER = { revenue: 1000, operating: -30, pretax: -24, tax: 423, net: -447 };
const TAX_ITEM = {
  tag: "ONE-OFF ITEM",
  tone: "info",
  headline: "An unusual tax item moved net income.",
  sentences: ["Income tax of $423M against −$5M at the 21% federal rate."],
  explainKeys: ["unusual-tax"],
  figures: "Pre-tax income −$24M · income tax $423M (Q2 FY26)",
  rule: "Rule: flagged when income tax differs from 21% of pre-tax income by more than 5% of quarterly revenue ($50M here), and the same quarter last year was not also flagged.",
};

check(
  "unusual tax, year-ago quarter not evaluable (no figures): fires",
  shown(oneOffItem(kf(TAX_QUARTER), MILLIONS)),
  TAX_ITEM
);
check(
  "unusual tax, year-ago quarter missing only its tax figure: fires",
  shown(oneOffItem(kf(TAX_QUARTER, { revenue: 900, pretax: -500 }), MILLIONS)),
  TAX_ITEM
);
check(
  "unusual tax, first year only (year-ago tax near 21%): fires",
  shown(oneOffItem(kf(TAX_QUARTER, { revenue: 900, pretax: 100, tax: 22 }), MILLIONS)),
  TAX_ITEM
);
check(
  "unusual tax, a repeat (year-ago also far from 21%): no item",
  shown(oneOffItem(kf(TAX_QUARTER, { revenue: 900, pretax: -500, tax: 1 }), MILLIONS)),
  undefined
);
check(
  "a repeat of the tax condition doesn't hide a non-operating swing in the same quarter",
  shown(oneOffItem(kf({ revenue: 1000, operating: -100, pretax: 200, tax: -200, net: 400 }, { revenue: 900, pretax: -500, tax: 1 }), MILLIONS))
    ?.explainKeys,
  ["non-operating-swing", "opposite-signs"]
);

// --- Amounts follow the table's precision: one decimal under $100M revenue ---
check(
  "small filer: one decimal",
  shown(oneOffItem(kf({ revenue: 40, operating: 2, pretax: 5.5, tax: 1.1, net: 4.4 }), MILLIONS_1DP))?.sentences,
  ["Pre-tax income is $3.5M above operating income."]
);

// --- Opposite signs, with the swing exactly at the band (not past it) ------
check(
  "opposite signs",
  shown(oneOffItem(kf({ revenue: 1000, operating: -20, pretax: 30, tax: 2, net: 28 }), MILLIONS)),
  {
    tag: "ONE-OFF ITEM",
    tone: "info",
    headline: "Net income and operating income point opposite ways.",
    sentences: ["Net income is $28M while operating income is −$20M."],
    explainKeys: ["opposite-signs"],
    figures: "Operating income −$20M · net income $28M (Q2 FY26)",
    rule: "Rule: flagged when net income and operating income have opposite signs.",
  }
);

// --- All three at once: one item, a sentence per trigger -------------------
check(
  "all three triggers: one item, tax headline first",
  shown(oneOffItem(kf({ revenue: 1000, operating: -100, pretax: 200, tax: -200, net: 400 }), MILLIONS)),
  {
    tag: "ONE-OFF ITEM",
    tone: "info",
    headline: "An unusual tax item moved net income.",
    sentences: [
      "Income tax of −$200M against $42M at the 21% federal rate.",
      "Pre-tax income is $300M above operating income.",
      "Net income is $400M while operating income is −$100M.",
    ],
    explainKeys: ["unusual-tax", "non-operating-swing", "opposite-signs"],
    figures: "Operating income −$100M · pre-tax income $200M · income tax −$200M · net income $400M (Q2 FY26)",
    rule: "Rule: flagged when income tax differs from 21% of pre-tax income by more than 5% of quarterly revenue ($50M here), and the same quarter last year was not also flagged; or when pre-tax income differs from operating income by more than 5% of quarterly revenue ($50M here); or when net income and operating income have opposite signs.",
  }
);

// --- Routine tax and interest: nothing fires --------------------------------
check(
  "routine quarter: no item",
  shown(oneOffItem(kf({ revenue: 1000, operating: 200, pretax: 195, tax: 41, net: 154 }), MILLIONS)),
  undefined
);

// --- Percentages beside a band never contradict it --------------------------
check("27% stays whole", bandPctWords(26.57, 10), "up 27%");
check("10.4% beyond a 10% band keeps its decimal", bandPctWords(10.4, 10), "up 10.4%");
check("9.6% inside a 10% band keeps its decimal", bandPctWords(9.6, 10), "up 9.6%");
check("a small move never reads as 0%", bandPctWords(-0.3, 2), "down 0.3%");
check("a fall", bandPctWords(-11.06, 10), "down 11%");

// --- The hero's terms phrase, by rung ----------------------------------------
check("Strong terms", heroTermsPhrase("Strong"), "Offer Net 30; Net 45 if pushed");
check("Neutral terms", heroTermsPhrase("Neutral"), "Offer Net 30 and hold it");
check("Weak terms", heroTermsPhrase("Weak"), "Offer Net 30 · escalate before signing");

// --- An explanation never repeats a dollar figure its finding shows ------------
{
  const shown = "Pre-tax income is $53.4B above operating income. Operating income $27,461M · pre-tax income $80,857M (Q2 FY26)";
  check(
    "\"$53.4 billion\" repeats \"$53.4B\" -> dropped",
    withoutRepeatedDollars(["Other income, net of $53.4 billion in Q2 2026, drove it."], shown).dropped.length,
    1
  );
  check(
    "\"27,461 million\" and \"27461\" repeat \"$27,461M\" -> dropped",
    withoutRepeatedDollars(["It was $27,461 million.", "Also 27461."], shown).dropped.length,
    2
  );
  check(
    "a different figure is kept: $1,612.7 million, $153.4 billion",
    withoutRepeatedDollars(["A $1,612.7 million gain.", "A $153.4 billion portfolio."], shown).kept.length,
    2
  );
  check("years and percentages are not dollar figures -> kept", withoutRepeatedDollars(["Up 16% in fiscal 2026."], shown).kept.length, 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
