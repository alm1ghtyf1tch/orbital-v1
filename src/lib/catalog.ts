import snapshots from "@/data/fallback-catalogs.json";
import { FEATURED_IDS } from "./constants";
import type {
  CatalogGroup,
  CatalogResponse,
  SatelliteRecord,
} from "@/lib/types";

const CACHE_DURATION_MS = 2 * 60 * 60 * 1_000;
const REQUEST_TIMEOUT_MS = 10_000;
const UPSTREAM_GROUP: Record<CatalogGroup, keyof typeof snapshots.groups> = {
  featured: "visual",
  stations: "stations",
  weather: "weather",
  science: "science",
};

interface CatalogCacheEntry {
  attemptedAt: number;
  successful?: CatalogResponse;
  failure?: string;
  pending?: Promise<CatalogResponse>;
}

interface CatalogCacheState {
  entries: Partial<Record<CatalogGroup, CatalogCacheEntry>>;
  blockedUntil: number;
}

// Retain the last successful catalog through development hot reloads. Next's
// revalidating fetch additionally persists successful responses across restarts.
const catalogGlobal = globalThis as typeof globalThis & {
  __orbitalCatalogCache?: CatalogCacheState;
};
const cache = (catalogGlobal.__orbitalCatalogCache ??= {
  entries: {},
  blockedUntil: 0,
});

function validChecksum(line: string): boolean {
  if (line.length !== 69 || !/\d/.test(line[68])) return false;
  let sum = 0;
  for (const character of line.slice(0, 68)) {
    if (character >= "0" && character <= "9") sum += Number(character);
    else if (character === "-") sum += 1;
  }
  return sum % 10 === Number(line[68]);
}

function epochFromLine(line: string): string | null {
  const yearField = line.slice(18, 20);
  const dayField = line.slice(20, 32);
  if (!/^\d{2}$/.test(yearField) || !/^\d{3}\.\d{8}$/.test(dayField))
    return null;
  const shortYear = Number(yearField);
  const year = shortYear >= 57 ? shortYear + 1900 : shortYear + 2000;
  const day = Number(dayField);
  const daysInYear =
    new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1 ? 366 : 365;
  // Day 000 is permitted in the legacy format and means Dec 31 of last year.
  if (day < 0 || day >= daysInYear + 1) return null;
  return new Date(Date.UTC(year, 0, 1) + (day - 1) * 86_400_000).toISOString();
}

function validElements(line1: string, line2: string): boolean {
  if (!validChecksum(line1) || !validChecksum(line2)) return false;
  const id = line1.slice(2, 7);
  if (!/^\d{5}$/.test(id) || Number(id) === 0 || id !== line2.slice(2, 7))
    return false;
  if (!/^1 [0-9]{5}[UCS] /.test(line1) || !/^2 [0-9]{5} /.test(line2))
    return false;
  if (!/^\d{7}$/.test(line2.slice(26, 33))) return false;
  if (!/^[ +-]\.\d{8}$/.test(line1.slice(33, 43))) return false;
  if (
    ![line1.slice(44, 52), line1.slice(53, 61)].every((field) =>
      /^[ +-]\d{5}[+-]\d$/.test(field),
    )
  )
    return false;

  const angles = [
    line2.slice(8, 16),
    line2.slice(17, 25),
    line2.slice(34, 42),
    line2.slice(43, 51),
  ];
  if (angles.some((field) => !/^ *\d{1,3}\.\d{4}$/.test(field))) return false;
  const [inclination, rightAscension, perigee, anomaly] = angles.map(Number);
  if (inclination < 0 || inclination > 180) return false;
  if (
    [rightAscension, perigee, anomaly].some(
      (angle) => angle < 0 || angle >= 360,
    )
  )
    return false;
  const meanMotionField = line2.slice(52, 63);
  if (!/^ *\d{1,2}\.\d{8}$/.test(meanMotionField)) return false;
  const meanMotion = Number(meanMotionField);
  return Number.isFinite(meanMotion) && meanMotion > 0 && meanMotion <= 20;
}

/** Parse 2LE/3LE records, discarding corrupt pairs rather than plotting bad data. */
export function parseTle(text: string): SatelliteRecord[] {
  if (/<(?:!doctype|html|body)\b/i.test(text)) return [];
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim());
  const records = new Map<string, SatelliteRecord>();
  for (let index = 0; index < lines.length - 1; index += 1) {
    const line1 = lines[index];
    const line2 = lines[index + 1];
    if (
      !line1.startsWith("1 ") ||
      !line2.startsWith("2 ") ||
      !validElements(line1, line2)
    )
      continue;
    const epoch = epochFromLine(line1);
    if (!epoch) continue;
    const noradId = Number(line1.slice(2, 7));
    const id = String(noradId);
    const previous = lines[index - 1];
    const name =
      previous && !/^[12] /.test(previous)
        ? previous.replace(/^0 /, "").trim().slice(0, 100)
        : `NORAD ${noradId}`;
    const record = { id, noradId, name, line1, line2, epoch };
    const existing = records.get(id);
    if (!existing || epoch > existing.epoch) records.set(id, record);
    index += 1;
  }
  return [...records.values()];
}

function selectGroup(
  records: SatelliteRecord[],
  group: CatalogGroup,
): SatelliteRecord[] {
  if (group !== "featured") {
    if (group === "stations")
      return records.sort(
        (a, b) => Number(b.noradId === 25544) - Number(a.noradId === 25544),
      );
    return records;
  }
  const byId = new Map(records.map((record) => [record.noradId, record]));
  return FEATURED_IDS.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

function unavailable(group: CatalogGroup, failure: string): CatalogResponse {
  const previous = cache.entries[group]?.successful;
  if (previous) {
    return {
      ...previous,
      source: "cache",
      notice: `${failure} Using the last successful CelesTrak catalog from ${previous.fetchedAt}. Predictions become less reliable as element epochs age.`,
    };
  }
  const upstreamGroup = UPSTREAM_GROUP[group];
  const provenance = snapshots.sources.find(
    (source) => source.group === upstreamGroup,
  )!;
  return {
    group,
    satellites: selectGroup(parseTle(snapshots.groups[upstreamGroup]), group),
    source: "demo",
    fetchedAt: provenance.retrievedAt,
    notice: `${failure} Demo mode uses frozen, genuine CelesTrak elements downloaded ${provenance.retrievedAt}. Positions and passes are approximate SGP4 predictions, not measured telemetry; old elements can be very inaccurate.`,
  };
}

/** Fetch on demand, at most once per group every two hours, with stale fallback. */
export async function getCatalog(
  group: CatalogGroup,
): Promise<CatalogResponse> {
  const now = Date.now();
  const existing = cache.entries[group];
  if (existing?.pending) return existing.pending;
  if (existing && now - existing.attemptedAt < CACHE_DURATION_MS) {
    if (existing.failure) return unavailable(group, existing.failure);
    if (existing.successful) return { ...existing.successful, source: "cache" };
  }
  if (now < cache.blockedUntil) {
    return unavailable(
      group,
      "CelesTrak requests are paused after an upstream error (two-hour backoff).",
    );
  }

  const entry: CatalogCacheEntry = {
    attemptedAt: now,
    successful: existing?.successful,
  };
  cache.entries[group] = entry;
  const pending = Promise.resolve().then(async (): Promise<CatalogResponse> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${UPSTREAM_GROUP[group]}&FORMAT=TLE`;
      const response = await fetch(url, {
        headers: { Accept: "text/plain" },
        cache: "force-cache",
        next: { revalidate: CACHE_DURATION_MS / 1_000 },
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) {
        cache.blockedUntil = Date.now() + CACHE_DURATION_MS;
        throw new Error(`CelesTrak returned HTTP ${response.status}.`);
      }
      const body = await response.text();
      const satellites = selectGroup(parseTle(body), group);
      if (
        satellites.length === 0 ||
        ((group === "featured" || group === "stations") &&
          !satellites.some((satellite) => satellite.noradId === 25544))
      ) {
        throw new Error("CelesTrak did not return a usable orbital catalog.");
      }
      // Next's persistent fetch cache retains the origin's response headers. Do
      // not relabel an old HTTP response with a fresh retrieval time on restart
      // or while Next serves stale data during background revalidation.
      const completedAt = Date.now();
      const originDate = Date.parse(response.headers.get("date") ?? "");
      const ageSeconds = Number(response.headers.get("age") ?? "0");
      const responseTime =
        Number.isFinite(originDate) && originDate <= completedAt + 60_000
          ? Math.min(originDate, completedAt)
          : Number.isFinite(ageSeconds) && ageSeconds > 0
            ? completedAt - ageSeconds * 1_000
            : completedAt;
      const isCachedResponse =
        completedAt - responseTime > 60_000 || ageSeconds > 0;
      const fetchedAt = new Date(responseTime).toISOString();
      const catalog: CatalogResponse = {
        group,
        satellites,
        source: isCachedResponse ? "cache" : "celestrak",
        fetchedAt,
      };
      entry.successful = catalog;
      return catalog;
    } catch (error) {
      entry.failure =
        error instanceof Error && error.name === "AbortError"
          ? "CelesTrak timed out after 10 seconds."
          : error instanceof Error
            ? error.message
            : "CelesTrak is unavailable.";
      return unavailable(group, entry.failure);
    } finally {
      clearTimeout(timeout);
      entry.pending = undefined;
    }
  });
  entry.pending = pending;
  return pending;
}
