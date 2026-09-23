import { NextRequest, NextResponse } from "next/server";
import { buildPageData, TickerNotFoundError } from "@/lib/present/buildPageData";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/lens/[ticker]">) {
  const { ticker } = await ctx.params;
  try {
    const data = await buildPageData(ticker);
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof TickerNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error fetching ticker data." },
      { status: 502 }
    );
  }
}
