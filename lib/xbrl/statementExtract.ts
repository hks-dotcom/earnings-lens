import { FilingEntry } from "@/lib/edgar/submissions";
import { getFilingDocument, getFilingFiles } from "@/lib/edgar/filingIndex";
import {
  captionFor,
  flattenPresentation,
  LABEL_ROLE,
  Linkbases,
  parseLinkbases,
  PresentedLine,
} from "@/lib/xbrl/linkbase";
import { DURATION_CONCEPTS } from "@/lib/xbrl/concepts";

/**
 * What one filing says about its own statements, extracted once and kept
 * permanently (a filing never changes):
 *
 * - the income statement's lines between revenue and operating income, in
 *   the filing's order, with the filing's own captions, each line's sign
 *   toward operating income, and every non-dimensional duration figure
 *   the filing reports for those lines -- including lines on the company's
 *   own tags, which company facts does not carry;
 * - the cash-flow statement's acquisitions line: its element and caption,
 *   and whether it is filed under the company's own tag.
 *
 * Read from the filing itself: the instance, and the presentation,
 * calculation and label linkbases. Never from rendered R-files.
 */

/** Bump when the extraction logic changes; rows stored under an older version are re-extracted. */
export const STATEMENT_EXTRACT_VERSION = 2;

export interface ExtractedLine {
  element: string;
  caption: string;
  /** +1 adds to operating income, -1 subtracts from it. */
  sign: 1 | -1;
  /** "calc": the calculation linkbase gives it; "default": no weight there, so an expense line subtracts. */
  signSource: "calc" | "default";
  /** Part of cost of revenue: gross profit sits after the last such line. */
  costOfRevenue: boolean;
}

export interface ExtractedFact {
  start: string;
  end: string;
  value: number;
}

export interface FilingStatementExtract {
  version: number;
  accessionNumber: string;
  form: string;
  reportDate: string;
  filingDate: string;
  incomeStatement: {
    role: string;
    roleDefinition: string;
    revenueElement: string | undefined;
    lines: ExtractedLine[];
  } | null;
  /** Non-dimensional duration facts for every income statement line, by element. */
  facts: Record<string, ExtractedFact[]>;
  acquisitions: { element: string; caption: string; companyTag: boolean } | null;
  /** For the performance report. */
  instanceBytes: number;
  requests: number;
}

const OPERATING_INCOME = "us-gaap:OperatingIncomeLoss";
const GROSS_PROFIT = "us-gaap:GrossProfit";
const REVENUE_ELEMENTS = DURATION_CONCEPTS.revenue.map((c) => `us-gaap:${c}`);
const COST_OF_REVENUE_ELEMENTS = new Set(DURATION_CONCEPTS.costOfRevenue.map((c) => `us-gaap:${c}`));

const ACQUISITION_ELEMENTS = new Set(
  [
    "PaymentsToAcquireBusinessesNetOfCashAcquired",
    "PaymentsToAcquireBusinessesGross",
    "PaymentsToAcquireBusinessesAndInterestInAffiliates",
  ].map((c) => `us-gaap:${c}`)
);

const STRUCTURAL = /(Abstract|Table|Axis|Domain|Member|LineItems)$/;

function isStatementRole(definition: string): boolean {
  return /-\s*Statement\s*-/i.test(definition) && !/parenthetical/i.test(definition);
}

/**
 * The income statement's role: a Statement role, not parenthetical, whose
 * presentation includes operating income. A plain income statement is
 * preferred over a combined "operations and comprehensive income" one;
 * among equals, the first in the filing's own order.
 */
function incomeStatementRole(lb: Linkbases): { role: string; lines: PresentedLine[] } | undefined {
  const candidates: { role: string; definition: string; lines: PresentedLine[] }[] = [];
  for (const [role, definition] of lb.roles) {
    if (!isStatementRole(definition)) continue;
    if (/cash flow|balance sheet|financial position|stockholders|shareholders|equity/i.test(definition)) continue;
    const arcsForRole = lb.presentation.get(role);
    if (!arcsForRole) continue;
    const lines = flattenPresentation(arcsForRole);
    if (!lines.some((l) => l.concept === OPERATING_INCOME)) continue;
    candidates.push({ role, definition, lines });
  }
  const plain = candidates.find((c) => !/comprehensive/i.test(c.definition));
  const chosen = plain ?? candidates[0];
  return chosen ? { role: chosen.role, lines: chosen.lines } : undefined;
}

function cashFlowRole(lb: Linkbases): { role: string; lines: PresentedLine[] } | undefined {
  for (const [role, definition] of lb.roles) {
    if (!isStatementRole(definition) || !/cash flow/i.test(definition)) continue;
    const arcsForRole = lb.presentation.get(role);
    if (arcsForRole) return { role, lines: flattenPresentation(arcsForRole) };
  }
  return undefined;
}

/**
 * Each element's weight toward operating income: the product of the
 * calculation weights on the path down from operating income. Read from
 * the statement's own calculation role first, then any role, since some
 * filers put the operating-income calculation elsewhere.
 */
function signsTowardOperatingIncome(lb: Linkbases, role: string): Map<string, number> {
  const signs = new Map<string, number>();
  const walk = (arcsForRole: { from: string; to: string; weight: number }[]) => {
    const children = new Map<string, { to: string; weight: number }[]>();
    for (const a of arcsForRole) {
      const list = children.get(a.from) ?? [];
      list.push(a);
      children.set(a.from, list);
    }
    const visit = (concept: string, weight: number, depth: number) => {
      if (depth > 12) return;
      for (const c of children.get(concept) ?? []) {
        const w = weight * Math.sign(c.weight || 1);
        if (!signs.has(c.to)) signs.set(c.to, w);
        visit(c.to, w, depth + 1);
      }
    };
    visit(OPERATING_INCOME, 1, 0);
  };
  const own = lb.calculation.get(role);
  if (own) walk(own);
  if (signs.size === 0) for (const arcsForRole of lb.calculation.values()) walk(arcsForRole);
  return signs;
}

/** Elements that are a sum of other elements in the statement's calculation role. */
function calculationParents(lb: Linkbases, role: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const a of lb.calculation.get(role) ?? []) {
    const set = out.get(a.from) ?? new Set<string>();
    set.add(a.to);
    out.set(a.from, set);
  }
  return out;
}

function extractIncomeStatement(lb: Linkbases): FilingStatementExtract["incomeStatement"] {
  const found = incomeStatementRole(lb);
  if (!found) return null;
  const { role, lines: presented } = found;

  const opIndex = presented.findIndex((l) => l.concept === OPERATING_INCOME);
  // Revenue is the last revenue element before operating income: the total,
  // after any components a filer lists above it.
  let revIndex = -1;
  for (let i = 0; i < opIndex; i++) if (REVENUE_ELEMENTS.includes(presented[i].concept)) revIndex = i;

  const between = presented.slice(revIndex + 1, opIndex).filter((l) => !STRUCTURAL.test(l.concept));
  const betweenConcepts = new Set(between.map((l) => l.concept));
  const parents = calculationParents(lb, role);
  const signs = signsTowardOperatingIncome(lb, role);
  const gpIndex = between.findIndex((l) => l.concept === GROSS_PROFIT);

  const lines: ExtractedLine[] = [];
  const seen = new Set<string>();
  between.forEach((l, i) => {
    if (l.concept === GROSS_PROFIT || seen.has(l.concept)) return;
    // A company subtotal (total costs and expenses, total operating
    // expenses) is not shown: it is a sum of lines already shown. Only a
    // sum whose parts are on the statement counts -- a parent whose
    // children live elsewhere is the only place its figure appears.
    const kids = parents.get(l.concept);
    const isSubtotal =
      (kids !== undefined && [...kids].some((k) => betweenConcepts.has(k))) || l.preferredLabel === LABEL_ROLE.total;
    if (isSubtotal) return;
    seen.add(l.concept);
    const weight = signs.get(l.concept);
    lines.push({
      element: l.concept,
      caption: captionFor(lb, l.concept, l.preferredLabel) ?? l.concept.split(":")[1],
      sign: weight === undefined ? -1 : weight > 0 ? 1 : -1,
      signSource: weight === undefined ? "default" : "calc",
      costOfRevenue: gpIndex >= 0 ? i < gpIndex : COST_OF_REVENUE_ELEMENTS.has(l.concept),
    });
  });

  return {
    role,
    roleDefinition: lb.roles.get(role) ?? "",
    revenueElement: revIndex >= 0 ? presented[revIndex].concept : undefined,
    lines,
  };
}

function extractAcquisitions(lb: Linkbases): FilingStatementExtract["acquisitions"] {
  const found = cashFlowRole(lb);
  if (!found) return null;
  const lines = found.lines;
  const start = lines.findIndex((l) => /InvestingActivities/i.test(l.concept) && /Abstract$/.test(l.concept));
  const from = start >= 0 ? start : 0;
  const endOffset = lines
    .slice(from)
    .findIndex((l) => /^us-gaap:NetCashProvidedByUsedInInvestingActivities(ContinuingOperations)?$/.test(l.concept));
  const section = lines.slice(from, endOffset >= 0 ? from + endOffset : lines.length);
  for (const l of section) {
    if (STRUCTURAL.test(l.concept)) continue;
    const caption = captionFor(lb, l.concept, l.preferredLabel) ?? "";
    const companyTag = !l.concept.startsWith("us-gaap:");
    if (ACQUISITION_ELEMENTS.has(l.concept) || (companyTag && /acqui/i.test(caption))) {
      return { element: l.concept, caption, companyTag };
    }
  }
  return null;
}

interface Context {
  start?: string;
  end: string;
  dimensional: boolean;
}

function parseContexts(xml: string): Map<string, Context> {
  const out = new Map<string, Context>();
  const re = /<(?:[\w-]+:)?context\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?context>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const body = m[2];
    const dimensional = /explicitMember|typedMember/.test(body);
    const start = body.match(/<(?:[\w-]+:)?startDate>([^<]+)</)?.[1]?.trim();
    const end = body.match(/<(?:[\w-]+:)?endDate>([^<]+)</)?.[1]?.trim();
    const instant = body.match(/<(?:[\w-]+:)?instant>([^<]+)</)?.[1]?.trim();
    if (start && end) out.set(m[1], { start, end, dimensional });
    else if (instant) out.set(m[1], { end: instant, dimensional });
  }
  return out;
}

/** Non-dimensional duration facts for the given elements. */
function durationFacts(xml: string, elements: Set<string>): Record<string, ExtractedFact[]> {
  const contexts = parseContexts(xml);
  const out: Record<string, ExtractedFact[]> = {};
  const re = /<([\w-]+:[\w.-]+)\b([^>]*)>([^<]*)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const element = m[1];
    if (!elements.has(element)) continue;
    const ref = m[2].match(/contextRef="([^"]+)"/)?.[1];
    const ctx = ref ? contexts.get(ref) : undefined;
    if (!ctx || ctx.dimensional || !ctx.start) continue;
    const raw = m[3].trim();
    if (raw === "" || Number.isNaN(Number(raw))) continue;
    const list = (out[element] ??= []);
    if (!list.some((f) => f.start === ctx.start && f.end === ctx.end)) {
      list.push({ start: ctx.start, end: ctx.end, value: Number(raw) });
    }
  }
  return out;
}

export async function extractFilingStatement(cik: string, filing: FilingEntry): Promise<FilingStatementExtract> {
  let requests = 1;
  const files = await getFilingFiles(cik, filing.accessionNumber);
  const docs: string[] = [];
  for (const name of [files.schema, files.presentation, files.calculation, files.label]) {
    if (!name) continue;
    docs.push(await getFilingDocument(cik, filing.accessionNumber, name));
    requests++;
  }
  const lb = parseLinkbases(docs);
  const incomeStatement = extractIncomeStatement(lb);
  const acquisitions = extractAcquisitions(lb);

  let facts: Record<string, ExtractedFact[]> = {};
  let instanceBytes = 0;
  if (files.instance && incomeStatement) {
    const xml = await getFilingDocument(cik, filing.accessionNumber, files.instance);
    requests++;
    instanceBytes = Buffer.byteLength(xml, "utf8");
    facts = durationFacts(xml, new Set(incomeStatement.lines.map((l) => l.element)));
  }

  return {
    version: STATEMENT_EXTRACT_VERSION,
    accessionNumber: filing.accessionNumber,
    form: filing.form,
    reportDate: filing.reportDate,
    filingDate: filing.filingDate,
    incomeStatement,
    facts,
    acquisitions,
    instanceBytes,
    requests,
  };
}
