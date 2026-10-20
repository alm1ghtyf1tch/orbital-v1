import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import snapshots from "@/data/fallback-catalogs.json";

const ISS = snapshots.groups.stations.split(/\r?\n/).slice(0, 3).join("\n");
const DAY_MS = 86_400_000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1_000;

function checksum(line: string): string {
  const first68 = line.slice(0, 68);
  const sum = [...first68].reduce((total, character) => total + (/\d/.test(character) ? Number(character) : character === "-" ? 1 : 0), 0);
  return first68 + (sum % 10);
}

function replaceField(record: string, line: number, start: number, value: string): string {
  const lines = record.split("\n");
  lines[line] = checksum(lines[line].slice(0, start) + value + lines[line].slice(start + value.length));
  return lines.join("\n");
}

async function isolatedCatalog() {
  vi.resetModules();
  delete (globalThis as typeof globalThis & { __orbitalCatalogCache?: unknown }).__orbitalCatalogCache;
  return import("@/lib/catalog");
}

describe("TLE validation and parsing", () => {
  it("parses a genuine ISS record without replacing its source epoch", async () => {
    const { parseTle } = await isolatedCatalog();
    const [iss] = parseTle(ISS.replaceAll("\n", "\r\n"));
    expect(iss.noradId).toBe(25544);
    expect(iss.id).toBe("25544");
    expect(iss.name).toBe("ISS (ZARYA)");
    expect(iss.epoch).toBe("2026-10-20T12:45:45.460Z");
    expect(iss.line1).toHaveLength(69);
    expect(iss.line2).toHaveLength(69);
  });

  it("accepts unnamed 2LE records and the optional 0 name prefix", async () => {
    const { parseTle } = await isolatedCatalog();
    expect(parseTle(ISS.split("\n").slice(1).join("\n"))[0].name).toBe("NORAD 25544");
    expect(parseTle(`0 ${ISS}`)[0].name).toBe("ISS (ZARYA)");
  });

  it("rejects missing lines, HTML, invalid lengths and corrupt checksums", async () => {
    const { parseTle } = await isolatedCatalog();
    expect(parseTle("<html>Upstream unavailable</html>")).toEqual([]);
    expect(parseTle(ISS.split("\n").slice(0, 2).join("\n"))).toEqual([]);
    expect(parseTle(ISS.slice(0, -1))).toEqual([]);
    const lines = ISS.split("\n");
    lines[1] = lines[1].slice(0, 68) + ((Number(lines[1][68]) + 1) % 10);
    expect(parseTle(lines.join("\n"))).toEqual([]);
  });

  it("rejects mismatched catalog IDs even with valid checksums", async () => {
    const { parseTle } = await isolatedCatalog();
    expect(parseTle(replaceField(ISS, 2, 2, "25545"))).toEqual([]);
  });

  it.each([
    [2, 8, "181.0000"],
    [2, 17, "360.0000"],
    [2, 26, "abcdefg"],
    [2, 52, " 0.00000000"],
    [2, 52, "21.00000000"],
    [1, 20, "367.00000000"],
  ])("rejects out-of-range or malformed orbital fields (%i:%i)", async (line, start, value) => {
    const { parseTle } = await isolatedCatalog();
    expect(parseTle(replaceField(ISS, line, start, value))).toEqual([]);
  });

  it("applies the standard 1957/2056 epoch rollover and leap days", async () => {
    const { parseTle } = await isolatedCatalog();
    expect(parseTle(replaceField(ISS, 1, 18, "57001.00000000"))[0].epoch).toBe("1957-01-01T00:00:00.000Z");
    expect(parseTle(replaceField(ISS, 1, 18, "56001.00000000"))[0].epoch).toBe("2056-01-01T00:00:00.000Z");
    expect(parseTle(replaceField(ISS, 1, 18, "24366.50000000"))[0].epoch).toBe("2024-12-31T12:00:00.000Z");
    expect(parseTle(replaceField(ISS, 1, 18, "25366.50000000"))).toEqual([]);
  });

  it("deduplicates records by NORAD ID and keeps the newest element epoch", async () => {
    const { parseTle } = await isolatedCatalog();
    const newer = replaceField(ISS, 1, 20, "294.00000000");
    const records = parseTle(`${newer}\n${ISS}\n${newer}`);
    expect(records).toHaveLength(1);
    expect(records[0].epoch).toBe("2026-10-21T00:00:00.000Z");
  });

  it("loads every bundled snapshot with valid checksums and epochs", async () => {
    const { parseTle } = await isolatedCatalog();
    for (const snapshot of Object.values(snapshots.groups)) {
      const records = parseTle(snapshot);
      expect(records.length).toBe(snapshot.trim().split(/\r?\n/).length / 3);
      expect(records.every((record) => Number.isFinite(Date.parse(record.epoch)))).toBe(true);
    }
  });
});

describe("CelesTrak catalog loading", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T15:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("fetches the requested dataset and reuses it for two hours", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(snapshots.groups.visual));
    vi.stubGlobal("fetch", fetchMock);
    const { getCatalog } = await isolatedCatalog();
    const result = await getCatalog("featured");
    expect(result.source).toBe("celestrak");
    expect(result.satellites).toHaveLength(20);
    expect(result.satellites[0].noradId).toBe(25544);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("GROUP=visual&FORMAT=TLE"), expect.objectContaining({ next: { revalidate: 7_200 } }));
    vi.setSystemTime(Date.now() + TWO_HOURS_MS - 1);
    expect((await getCatalog("featured")).source).toBe("cache");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("deduplicates simultaneous requests to the same upstream dataset", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(snapshots.groups.stations));
    vi.stubGlobal("fetch", fetchMock);
    const { getCatalog } = await isolatedCatalog();
    const [first, second] = await Promise.all([getCatalog("stations"), getCatalog("stations")]);
    expect(first).toEqual(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes after two hours and preserves the last good catalog on network failure", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(snapshots.groups.stations)).mockRejectedValueOnce(new TypeError("Network unavailable"));
    vi.stubGlobal("fetch", fetchMock);
    const { getCatalog } = await isolatedCatalog();
    const first = await getCatalog("stations");
    vi.setSystemTime(Date.now() + TWO_HOURS_MS);
    const second = await getCatalog("stations");
    expect(second.source).toBe("cache");
    expect(second.satellites).toEqual(first.satellites);
    expect(second.fetchedAt).toBe(first.fetchedAt);
    expect(second.notice).toContain("last successful");
    await getCatalog("stations");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("backs off all queries after an HTTP error and supplies labeled genuine demo catalogs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("Forbidden", { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    const { getCatalog } = await isolatedCatalog();
    for (const group of ["featured", "stations", "weather", "science"] as const) {
      const result = await getCatalog(group);
      expect(result.source).toBe("demo");
      expect(result.satellites.length).toBeGreaterThan(0);
      expect(result.notice).toContain("frozen, genuine CelesTrak elements");
      expect(result.notice).toContain("not measured telemetry");
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["<html><body>Rate limited</body></html>", "No GP data found", "", ISS.slice(0, -1)])("falls back safely for an unusable response", async (body) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(body));
    vi.stubGlobal("fetch", fetchMock);
    const { getCatalog } = await isolatedCatalog();
    const result = await getCatalog("featured");
    expect(result.source).toBe("demo");
    expect(result.satellites[0].noradId).toBe(25544);
    await getCatalog("featured");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("aborts a stalled upstream after ten seconds", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));
    const { getCatalog } = await isolatedCatalog();
    const pending = getCatalog("stations");
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await pending;
    expect(result.source).toBe("demo");
    expect(result.notice).toContain("timed out after 10 seconds");
  });

  it("keeps original demo element epochs even when the system date advances", async () => {
    vi.setSystemTime(Date.now() + DAY_MS * 60);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Offline")));
    const { getCatalog, parseTle } = await isolatedCatalog();
    const result = await getCatalog("stations");
    expect(result.satellites[0].epoch).toBe(parseTle(ISS)[0].epoch);
    expect(result.fetchedAt.startsWith("2026-10-20")).toBe(true);
  });
});

describe("Catalog HTTP route", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects an unknown group without contacting the upstream service", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await isolatedCatalog();
    const { GET } = await import("@/app/api/catalog/route");
    const { NextRequest } = await import("next/server");
    const response = await GET(new NextRequest("http://localhost/api/catalog?group=unknown"));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("Invalid catalog group");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("defaults to featured and returns a JSON catalog with caching controlled on the server", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(snapshots.groups.visual)));
    await isolatedCatalog();
    const { GET } = await import("@/app/api/catalog/route");
    const { NextRequest } = await import("next/server");
    const response = await GET(new NextRequest("http://localhost/api/catalog"));
    const catalog = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(catalog.group).toBe("featured");
    expect(catalog.satellites).toHaveLength(20);
  });
});
