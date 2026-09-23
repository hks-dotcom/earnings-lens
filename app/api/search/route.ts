import { NextRequest, NextResponse } from "next/server";
import { searchCompanies, SEARCH_LIMIT } from "@/lib/edgar/tickers";

/**
 * Company search. The ticker map lives server-side (it is fetched from SEC
 * with the contact-email User-Agent and cached there), so the browser asks
 * this route rather than downloading the whole file itself.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  try {
    return NextResponse.json({ matches: await searchCompanies(q, SEARCH_LIMIT) });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Company search unavailable." }, { status: 502 });
  }
}
