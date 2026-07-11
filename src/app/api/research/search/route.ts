import { NextResponse } from "next/server";
import {
  getContractorOpportunitySearchResults,
  inferSearchTrades,
} from "@/lib/contractor-opportunity-engine";
import { createOpportunitySearchIndex } from "@/lib/research";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";
  if (!q) {
    return NextResponse.json({ error: "Missing q" }, { status: 400 });
  }

  const trade = searchParams.get("trade") ?? inferSearchTrades(q)[0] ?? undefined;
  const city = searchParams.get("city") ?? undefined;
  const county = searchParams.get("county") ?? undefined;
  const stage = searchParams.get("stage") ?? undefined;
  const packageSize = searchParams.get("package_size") ?? undefined;
  const hasPhone = searchParams.get("has_phone");
  const topK = Number(searchParams.get("top_k") ?? 20);

  // Use trade-filtered inventory as the ConstructIQ document corpus when a trade is inferred.
  const inventory = getContractorOpportunitySearchResults(q);
  const index = createOpportunitySearchIndex(inventory);
  const hits = index.search(q, {
    trade,
    city,
    county,
    stage,
    package_size: packageSize,
    has_phone: hasPhone == null ? undefined : hasPhone === "true",
  }, Number.isFinite(topK) ? topK : 20);

  return NextResponse.json({
    query: q,
    filters: { trade, city, county, stage, package_size: packageSize, has_phone: hasPhone },
    count: hits.length,
    hits,
    engine: "constructiq-hybrid-v1",
  });
}
