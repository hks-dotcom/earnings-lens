/**
 * A small reader for the three XBRL linkbases a statement needs:
 *
 * - presentation: which lines a statement shows, in what order, and which
 *   label role each line's caption uses;
 * - calculation: how the lines add up, with a weight (+1 or -1) per line;
 * - label: the caption text for each element and label role, including a
 *   company's own captions for standard us-gaap elements.
 *
 * It reads any number of documents at once, because the same linkbases can
 * live in separate files or inside the schema: every extended link found
 * in any of them is parsed the same way. Locators are scoped to their own
 * extended link, as the XBRL spec scopes them.
 *
 * Elements are named as QNames ("us-gaap:Revenues", "amzn:FulfillmentExpense"),
 * taken from each locator's href fragment ("…#us-gaap_Revenues"), which is
 * how the instance names them too.
 */

export interface PresentationArc {
  from: string;
  to: string;
  order: number;
  preferredLabel?: string;
}

export interface CalculationArc {
  from: string;
  to: string;
  weight: number;
}

export interface Linkbases {
  /** roleURI -> definition, e.g. "9952152 - Statement - Consolidated Statements of Operations". */
  roles: Map<string, string>;
  presentation: Map<string, PresentationArc[]>;
  calculation: Map<string, CalculationArc[]>;
  /** element QName -> label role -> text. */
  labels: Map<string, Map<string, string>>;
}

export const LABEL_ROLE = {
  standard: "http://www.xbrl.org/2003/role/label",
  terse: "http://www.xbrl.org/2003/role/terseLabel",
  total: "http://www.xbrl.org/2003/role/totalLabel",
} as const;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Decodes "&#160;", "&#x2019;", "&amp;" and the like; a non-breaking space becomes a plain space. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
    .replace(/ /g, " ");
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) out[m[1]] = m[2];
  return out;
}

/** "…us-gaap-2026.xsd#us-gaap_Revenues" -> "us-gaap:Revenues". */
export function conceptFromHref(href: string): string {
  const fragment = href.slice(href.indexOf("#") + 1);
  const underscore = fragment.indexOf("_");
  return underscore < 0 ? fragment : `${fragment.slice(0, underscore)}:${fragment.slice(underscore + 1)}`;
}

interface ExtendedLink {
  role: string;
  body: string;
}

function extendedLinks(text: string, name: string): ExtendedLink[] {
  const out: ExtendedLink[] = [];
  const re = new RegExp(`<((?:[\\w-]+:)?${name})\\b([^>]*)>([\\s\\S]*?)</\\1>`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const role = attrs(m[2])["xlink:role"];
    if (role) out.push({ role, body: m[3] });
  }
  return out;
}

function locators(body: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /<(?:[\w-]+:)?loc\b([^>]*)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const a = attrs(m[1]);
    if (a["xlink:label"] && a["xlink:href"]) out.set(a["xlink:label"], conceptFromHref(a["xlink:href"]));
  }
  return out;
}

function arcs(body: string, name: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  const re = new RegExp(`<(?:[\\w-]+:)?${name}\\b([^>]*)\\/?>`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const a = attrs(m[1]);
    // A prohibited arc removes a relationship inherited from elsewhere;
    // nothing is inherited here, so it is simply not a relationship.
    if (a.use === "prohibited") continue;
    out.push(a);
  }
  return out;
}

export function parseLinkbases(documents: string[]): Linkbases {
  const roles = new Map<string, string>();
  const presentation = new Map<string, PresentationArc[]>();
  const calculation = new Map<string, CalculationArc[]>();
  const labels = new Map<string, Map<string, string>>();

  for (const text of documents) {
    const roleRe = /<(?:[\w-]+:)?roleType\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?roleType>/g;
    let m: RegExpExecArray | null;
    while ((m = roleRe.exec(text))) {
      const uri = attrs(m[1]).roleURI;
      const definition = m[2].match(/<(?:[\w-]+:)?definition\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?definition>/)?.[1];
      if (uri) roles.set(uri, decodeEntities(definition ?? "").trim());
    }

    for (const link of extendedLinks(text, "presentationLink")) {
      const locs = locators(link.body);
      const list = presentation.get(link.role) ?? [];
      for (const a of arcs(link.body, "presentationArc")) {
        const from = locs.get(a["xlink:from"]);
        const to = locs.get(a["xlink:to"]);
        if (!from || !to) continue;
        list.push({ from, to, order: Number(a.order ?? 0), preferredLabel: a.preferredLabel });
      }
      presentation.set(link.role, list);
    }

    for (const link of extendedLinks(text, "calculationLink")) {
      const locs = locators(link.body);
      const list = calculation.get(link.role) ?? [];
      for (const a of arcs(link.body, "calculationArc")) {
        const from = locs.get(a["xlink:from"]);
        const to = locs.get(a["xlink:to"]);
        if (!from || !to) continue;
        list.push({ from, to, weight: Number(a.weight ?? 1) });
      }
      calculation.set(link.role, list);
    }

    for (const link of extendedLinks(text, "labelLink")) {
      const locs = locators(link.body);
      const resources = new Map<string, { role: string; text: string }[]>();
      const resRe = /<(?:[\w-]+:)?label\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?label>/g;
      let r: RegExpExecArray | null;
      while ((r = resRe.exec(link.body))) {
        const a = attrs(r[1]);
        const lang = a["xml:lang"] ?? "en-US";
        if (!lang.toLowerCase().startsWith("en")) continue;
        const key = a["xlink:label"];
        if (!key) continue;
        const txt = decodeEntities(r[2].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
        const list = resources.get(key) ?? [];
        list.push({ role: a["xlink:role"] ?? LABEL_ROLE.standard, text: txt });
        resources.set(key, list);
      }
      for (const a of arcs(link.body, "labelArc")) {
        const concept = locs.get(a["xlink:from"]);
        const res = resources.get(a["xlink:to"]);
        if (!concept || !res) continue;
        const byRole = labels.get(concept) ?? new Map<string, string>();
        for (const { role, text: t } of res) if (!byRole.has(role)) byRole.set(role, t);
        labels.set(concept, byRole);
      }
    }
  }

  return { roles, presentation, calculation, labels };
}

export interface PresentedLine {
  concept: string;
  preferredLabel?: string;
  depth: number;
}

/** A presentation role flattened depth-first in `order`, as the statement reads top to bottom. */
export function flattenPresentation(arcList: PresentationArc[]): PresentedLine[] {
  const children = new Map<string, PresentationArc[]>();
  const isChild = new Set<string>();
  for (const a of arcList) {
    const list = children.get(a.from) ?? [];
    list.push(a);
    children.set(a.from, list);
    isChild.add(a.to);
  }
  for (const list of children.values()) list.sort((x, y) => x.order - y.order);
  const roots = [...new Set(arcList.map((a) => a.from))].filter((c) => !isChild.has(c));

  const out: PresentedLine[] = [];
  const seen = new Set<string>();
  const walk = (concept: string, depth: number, preferredLabel?: string) => {
    out.push({ concept, preferredLabel, depth });
    if (seen.has(concept)) return; // a cycle would be malformed; never loop
    seen.add(concept);
    for (const a of children.get(concept) ?? []) walk(a.to, depth + 1, a.preferredLabel);
  };
  for (const root of roots) walk(root, 0);
  return out;
}

/** The caption an element shows with a given label role, falling back to the terse and then the standard label. */
export function captionFor(lb: Linkbases, concept: string, role?: string): string | undefined {
  const byRole = lb.labels.get(concept);
  if (!byRole) return undefined;
  return (role && byRole.get(role)) || byRole.get(LABEL_ROLE.terse) || byRole.get(LABEL_ROLE.standard);
}
