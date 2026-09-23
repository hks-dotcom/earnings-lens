import { NextRequest, NextResponse } from "next/server";
import { statementsOrWork, StatementsTickerNotFound } from "@/lib/xbrl/statementLoader";

/**
 * The statement tabs' first request, made after the board has rendered:
 * either the assembled statements (every filing already extracted), or the
 * filings still to read, which the page then reads one per request through
 * ./filings/[accession] while it shows "Reading filing N of M".
 */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/statements/[ticker]">) {
  const { ticker } = await ctx.params;
  try {
    return NextResponse.json(await statementsOrWork(ticker));
  } catch (err) {
    if (err instanceof StatementsTickerNotFound) return NextResponse.json({ error: err.message }, { status: 404 });
    console.error(err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Statements failed." }, { status: 502 });
  }
}
