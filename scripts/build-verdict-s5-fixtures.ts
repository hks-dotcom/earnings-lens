// Builds the frozen S5 verdict fixtures in tests/fixtures/verdict-s5/ from
// the report-only simulations. Run once; the fixtures are then checked in
// and scripts/test-verdict-s5.ts reads only them (no network, no reports
// folder).
//
// Each record carries:
//   x        -- the frozen engine inputs, the `.x` object exactly as the S4
//               simulation stored it (verdict-s4 out/s4.json for today,
//               out/partd4-D1.json for distress, out/partd4-D3.json for a
//               year back);
//   expected -- the REVISED block for the same record from
//               verdict-s5-borrowing out/s5.json (the rules document's
//               machine-readable fixture source, section 12.4).
// Records are matched by set + ticker (+ vantage). scripts/lib/verdictS5Fixtures.ts
// maps both to the engine's types.
//
// Usage: npx tsx scripts/build-verdict-s5-fixtures.ts

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const REPORTS = path.join(os.homedir(), "earnings-lens-reports");
const OUT = path.join(process.cwd(), "tests/fixtures/verdict-s5");
const TODAY = "2026-10-25"; // the S4 assessment date: the app clock of the read the S4 inputs came from

type Json = Record<string, unknown>;
const read = (p: string) => JSON.parse(fs.readFileSync(path.join(REPORTS, p), "utf8"));

const s4: Json[] = read("verdict-s4/out/s4.json");
const d1: Json[] = read("verdict-s4/out/partd4-D1.json");
const d3: Record<string, Json> = read("verdict-s4/out/partd4-D3.json");
const s5: Json[] = read("verdict-s5-borrowing/out/s5.json");

function expectedFor(set: string, ticker: string, vantage: string | null): Json {
  const hits = s5.filter((r) => r.set === set && r.ticker === ticker && (r.vantage ?? null) === vantage);
  if (hits.length !== 1) throw new Error(`expected exactly one s5.json record for ${set} ${ticker} ${vantage}, found ${hits.length}`);
  return hits[0].REVISED as Json;
}

const sets: Record<string, Json[]> = { today: [], distress: [], yearback: [] };
for (const r of s4) {
  const ticker = r.t as string;
  sets.today.push({ set: "today", ticker, cik: r.cik, vantage: null, assessmentDate: TODAY, source: "verdict-s4/out/s4.json", x: r.x, expected: expectedFor("today", ticker, null) });
}
for (const r of d1) {
  const ticker = r.ticker as string;
  const vantage = (r.historical as Json).vantage as string;
  sets.distress.push({ set: "distress", ticker, cik: (r.historical as Json).cik, vantage, assessmentDate: vantage, source: "verdict-s4/out/partd4-D1.json", x: r.x, expected: expectedFor("distress", ticker, vantage) });
}
for (const [ticker, r] of Object.entries(d3)) {
  const vantage = r.vantage as string;
  const cik = s4.find((t) => t.t === ticker)?.cik;
  if (!cik) throw new Error(`no CIK for year-back ${ticker}`);
  sets.yearback.push({ set: "year-back", ticker, cik, vantage, assessmentDate: vantage, source: "verdict-s4/out/partd4-D3.json", x: r.x, expected: expectedFor("year-back", ticker, vantage) });
}

const total = Object.values(sets).reduce((n, s) => n + s.length, 0);
if (total !== s5.length) throw new Error(`matched ${total} records, s5.json has ${s5.length}`);

fs.mkdirSync(OUT, { recursive: true });
for (const [name, records] of Object.entries(sets)) {
  const text = JSON.stringify(records, null, 1) + "\n";
  fs.writeFileSync(path.join(OUT, `${name}.json`), text);
  console.log(`${name}.json: ${records.length} records`);
}
