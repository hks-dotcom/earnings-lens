import { NextRequest, NextResponse } from "next/server";
import { readOneStatementFiling, StatementsTickerNotFound } from "@/lib/xbrl/statementLoader";

/**
 * Reads and stores one filing for the statement tabs. One filing per
 * request keeps every request to about a second, well inside any function
 * limit, and the page calls these one after another so EDGAR sees one
 * reader at a time.
 */
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/statements/[ticker]/filings/[accession]">) {
  const { ticker, accession } = await ctx.params;
  try {
    return NextResponse.json(await readOneStatementFiling(ticker, accession));
  } catch (err) {
    if (err instanceof StatementsTickerNotFound) return NextResponse.json({ error: err.message }, { status: 404 });
    console.error(err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Reading the filing failed." }, { status: 502 });
  }
}
