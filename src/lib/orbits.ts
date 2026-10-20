import {
  ecfToLookAngles,
  eciToEcf,
  eciToGeodetic,
  gstime,
  propagate,
  twoline2satrec,
} from "satellite.js";
import type {
  Observer,
  OrbitPoint,
  SatellitePosition,
  SatelliteRecord,
} from "./types";

const DAY_MS = 86_400_000;
const DEGREES_PER_RADIAN = 180 / Math.PI;
const MAX_CACHE_SIZE = 256;
type PropagatorRecord = ReturnType<typeof twoline2satrec>;

// Compiling a TLE is substantially more expensive than propagating it. Key on the
// elements themselves, so refreshing a catalog never reuses an older solution.
const records = new Map<string, PropagatorRecord | null>();

function getRecord(satellite: SatelliteRecord): PropagatorRecord | null {
  const key = `${satellite.line1}\n${satellite.line2}`;
  if (records.has(key)) return records.get(key) ?? null;
  let record: PropagatorRecord | null = null;
  try {
    if (
      satellite.line1.startsWith("1 ") &&
      satellite.line2.startsWith("2 ") &&
      satellite.line1.length >= 63 &&
      satellite.line2.length >= 63 &&
      satellite.line1.slice(2, 7) === satellite.line2.slice(2, 7) &&
      Number.isFinite(Number(satellite.line2.slice(52, 63).trim())) &&
      Number(satellite.line2.slice(52, 63).trim()) > 0
    ) {
      const candidate = twoline2satrec(satellite.line1, satellite.line2);
      if (
        Number.isFinite(candidate.jdsatepoch) &&
        Number.isFinite(candidate.no) &&
        candidate.no > 0 &&
        Number.isFinite(candidate.ecco) &&
        candidate.ecco >= 0 &&
        candidate.ecco < 1 &&
        Number.isFinite(candidate.inclo)
      ) {
        record = candidate;
      }
    }
  } catch {
    // Unusable or decayed elements are represented by an absent solution.
  }
  if (records.size >= MAX_CACHE_SIZE) {
    const oldest = records.keys().next().value;
    if (oldest !== undefined) records.delete(oldest);
  }
  records.set(key, record);
  return record;
}

/** Approximate mean orbital period, in minutes, from the TLE mean motion. */
export function getOrbitalPeriod(satellite: SatelliteRecord): number {
  const meanMotion = Number(satellite.line2.slice(52, 63).trim());
  return getRecord(satellite) && Number.isFinite(meanMotion) && meanMotion > 0
    ? 1_440 / meanMotion
    : Number.NaN;
}

/** Signed age of the actual TLE epoch; negative values indicate future elements. */
export function getElementAgeDays(
  satellite: SatelliteRecord,
  date: Date,
): number {
  const record = getRecord(satellite);
  if (!record || !Number.isFinite(date.getTime())) return Number.NaN;
  const epochMs = (record.jdsatepoch - 2_440_587.5) * DAY_MS;
  return (date.getTime() - epochMs) / DAY_MS;
}

/** SGP4 prediction, not measured telemetry. Distances are km; speed is ECI km/s. */
export function getSatellitePosition(
  satellite: SatelliteRecord,
  date: Date,
): SatellitePosition | null {
  const record = getRecord(satellite);
  if (!record || !Number.isFinite(date.getTime())) return null;
  try {
    const state = propagate(record, date);
    if (!state) return null;
    const { position, velocity } = state;
    const siderealTime = gstime(date);
    const geodetic = eciToGeodetic(position, siderealTime);
    const positionEcf = eciToEcf(position, siderealTime);
    const latitude = geodetic.latitude * DEGREES_PER_RADIAN;
    const longitude = geodetic.longitude * DEGREES_PER_RADIAN;
    const altitudeKm = geodetic.height;
    const velocityKmS = Math.hypot(velocity.x, velocity.y, velocity.z);
    if (
      ![
        latitude,
        longitude,
        altitudeKm,
        velocityKmS,
        positionEcf.x,
        positionEcf.y,
        positionEcf.z,
      ].every(Number.isFinite) ||
      altitudeKm < 0
    ) {
      return null;
    }
    return {
      id: satellite.id,
      latitude,
      longitude,
      altitudeKm,
      velocityKmS,
      periodMinutes: getOrbitalPeriod(satellite),
      positionEcf,
    };
  } catch {
    return null;
  }
}

export function isValidObserver(observer: Observer): boolean {
  return (
    Number.isFinite(observer.latitude) &&
    Math.abs(observer.latitude) <= 90 &&
    Number.isFinite(observer.longitude) &&
    Math.abs(observer.longitude) <= 180 &&
    Number.isFinite(observer.altitudeKm) &&
    observer.altitudeKm >= -0.5 &&
    observer.altitudeKm <= 100
  );
}

/** Geometric topocentric angles, without refraction, terrain or optical visibility. */
export function getSatelliteLookAngles(
  satellite: SatelliteRecord,
  observer: Observer,
  date: Date,
): { elevation: number; azimuth: number; rangeKm: number } | null {
  if (!isValidObserver(observer)) return null;
  const position = getSatellitePosition(satellite, date);
  if (!position) return null;
  const look = ecfToLookAngles(
    {
      latitude: observer.latitude / DEGREES_PER_RADIAN,
      longitude: observer.longitude / DEGREES_PER_RADIAN,
      height: observer.altitudeKm,
    },
    position.positionEcf,
  );
  if (![look.elevation, look.azimuth, look.rangeSat].every(Number.isFinite)) {
    return null;
  }
  return {
    elevation: look.elevation * DEGREES_PER_RADIAN,
    azimuth: ((look.azimuth * DEGREES_PER_RADIAN) % 360 + 360) % 360,
    rangeKm: look.rangeSat,
  };
}

/** Earth-fixed trajectory centered on date; default duration is one mean orbit. */
export function getOrbitTrack(
  satellite: SatelliteRecord,
  date: Date,
  options: { minutes?: number; steps?: number } = {},
): OrbitPoint[] {
  const minutes = options.minutes ?? getOrbitalPeriod(satellite);
  const steps = options.steps ?? 180;
  if (
    !Number.isFinite(date.getTime()) ||
    !Number.isFinite(minutes) ||
    minutes <= 0 ||
    minutes > 10_080 ||
    !Number.isInteger(steps) ||
    steps < 2 ||
    steps > 4_096
  ) {
    return [];
  }
  const durationMs = minutes * 60_000;
  const startMs = date.getTime() - durationMs / 2;
  const track: OrbitPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const time = new Date(startMs + (i / steps) * durationMs);
    const position = getSatellitePosition(satellite, time);
    // An incomplete path would visually join unrelated points across failures.
    if (!position) return [];
    track.push({
      latitude: position.latitude,
      longitude: position.longitude,
      altitudeKm: position.altitudeKm,
      time: time.toISOString(),
    });
  }
  return track;
}
