import { NextRequest, NextResponse } from "next/server";
import { getCatalog } from "@/lib/catalog";
import type { CatalogGroup } from "@/lib/types";

export const runtime = "nodejs";
// Render each request while preserving the explicitly cached upstream fetch.
export const revalidate = 0;

const GROUPS = new Set<CatalogGroup>(["featured", "stations", "weather", "science"]);

export async function GET(request: NextRequest) {
  const group = request.nextUrl.searchParams.get("group") ?? "featured";
  if (!GROUPS.has(group as CatalogGroup)) {
    return NextResponse.json({ error: "Invalid catalog group. Use featured, stations, weather, or science." }, { status: 400 });
  }
  const catalog = await getCatalog(group as CatalogGroup);
  return NextResponse.json(catalog, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
