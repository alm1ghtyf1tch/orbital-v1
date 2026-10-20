import { beforeAll, describe, expect, it } from "vitest";
import { eciToEcf, gstime, propagate, twoline2satrec } from "satellite.js";
import { getSatelliteLookAngles, getSatellitePosition } from "./orbits";
import { predictPasses } from "./passes";
import type { Observer, PassPrediction, SatelliteRecord } from "./types";

// Historical ISS elements from the satellite.js maintainers' example. These
// fixtures test deterministic geometry, and are never presented as current data.
const ISS: SatelliteRecord = {
  id: "25544", noradId: 25544, name: "ISS (ZARYA)",
  line1: "1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992",
  line2: "2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442",
  epoch: "2019-06-05T12:12:58.000Z",
};
const ASTANA: Observer = { latitude: 51.1694, longitude: 71.4491, altitudeKm: 0.347 };
const START = new Date("2019-06-05T00:00:00Z");

// Independent ENU look-angle calculation. It intentionally does not use the
// application's look-angle, pass-discovery or refinement implementations.
const record = twoline2satrec(ISS.line1, ISS.line2);
const lat = ASTANA.latitude * Math.PI / 180;
const lon = ASTANA.longitude * Math.PI / 180;
const eccentricitySquared = 6.6943799901413165e-3;
const radius = 6_378.137 / Math.sqrt(1 - eccentricitySquared * Math.sin(lat) ** 2);
const observerEcf = {
  x: (radius + ASTANA.altitudeKm) * Math.cos(lat) * Math.cos(lon),
  y: (radius + ASTANA.altitudeKm) * Math.cos(lat) * Math.sin(lon),
  z: (radius * (1 - eccentricitySquared) + ASTANA.altitudeKm) * Math.sin(lat),
};
function independentElevation(time: number): number {
  const date = new Date(time);
  const state = propagate(record, date)!;
  const position = eciToEcf(state.position, gstime(date));
  const x = position.x - observerEcf.x;
  const y = position.y - observerEcf.y;
  const z = position.z - observerEcf.z;
  const east = -Math.sin(lon) * x + Math.cos(lon) * y;
  const north = -Math.sin(lat) * Math.cos(lon) * x - Math.sin(lat) * Math.sin(lon) * y + Math.cos(lat) * z;
  const up = Math.cos(lat) * Math.cos(lon) * x + Math.cos(lat) * Math.sin(lon) * y + Math.sin(lat) * z;
  return Math.atan2(up, Math.hypot(east, north)) * 180 / Math.PI;
}

describe("geometric pass prediction", () => {
  let passes: PassPrediction[];
  const dense: { start: number; end: number; peak: number; maximum: number }[] = [];
  beforeAll(() => {
    passes = predictPasses(ISS, ASTANA, START, { maxPasses: 20 });
    let active: { start: number; end: number; peak: number; maximum: number } | null = null;
    for (let time = START.getTime(); time <= START.getTime() + 86_400_000; time += 1_000) {
      const elevation = independentElevation(time);
      if (elevation >= 10) {
        if (!active) active = { start: time, end: time, peak: time, maximum: elevation };
        active.end = time;
        if (elevation > active.maximum) { active.peak = time; active.maximum = elevation; }
      } else if (active) {
        dense.push(active);
        active = null;
      }
    }
    if (active) dense.push(active);
  });

  it("finds the same passes as a full day of independent one-second samples", () => {
    expect(passes.length).toBeGreaterThan(2);
    expect(passes).toHaveLength(dense.length);
    for (let i = 0; i < dense.length; i++) {
      const prediction = passes[i];
      const reference = dense[i];
      const start = new Date(prediction.startTime).getTime();
      const end = new Date(prediction.endTime).getTime();
      const peak = new Date(prediction.peakTime).getTime();
      expect(Math.abs(start - reference.start)).toBeLessThan(1_100);
      expect(Math.abs(end - reference.end)).toBeLessThan(1_100);
      expect(Math.abs(peak - reference.peak)).toBeLessThan(1_100);
      // A one-second grid slightly underestimates a fast near-zenith peak.
      expect(Math.abs(prediction.maxElevation - reference.maximum)).toBeLessThan(0.02);
      expect(independentElevation(start)).toBeCloseTo(10, 1);
      expect(independentElevation(end)).toBeCloseTo(10, 1);
      expect(start).toBeLessThanOrEqual(peak);
      expect(peak).toBeLessThanOrEqual(end);
      expect(prediction.ongoing).toBe(false);
      expect(prediction.truncated).toBe(false);
      expect(prediction.azimuthStart).toBeGreaterThanOrEqual(0);
      expect(prediction.azimuthEnd).toBeLessThan(360);
    }
  });

  it("honors the selected acquisition elevation and limits result count", () => {
    const high = predictPasses(ISS, ASTANA, START, { minElevation: 20, maxPasses: 2 });
    expect(high).toHaveLength(2);
    for (const pass of high) {
      expect(independentElevation(new Date(pass.startTime).getTime())).toBeCloseTo(20, 1);
      expect(independentElevation(new Date(pass.endTime).getTime())).toBeCloseTo(20, 1);
      expect(pass.maxElevation).toBeGreaterThanOrEqual(20);
    }
  });

  it("marks an ongoing pass and clips it to the requested start", () => {
    const during = new Date(passes[0].peakTime);
    const results = predictPasses(ISS, ASTANA, during, { hours: 1 });
    expect(results[0].ongoing).toBe(true);
    expect(results[0].startTime).toBe(during.toISOString());
    expect(results[0].truncated).toBe(false);
    expect(Math.abs(new Date(results[0].endTime).getTime() - new Date(passes[0].endTime).getTime())).toBeLessThan(100);
  });

  it("marks a window-clipped end without claiming an actual loss of signal", () => {
    const start = new Date(new Date(passes[0].startTime).getTime() - 60_000);
    const end = new Date(passes[0].peakTime);
    const hours = (end.getTime() - start.getTime()) / 3_600_000;
    const results = predictPasses(ISS, ASTANA, start, { hours });
    expect(results).toHaveLength(1);
    expect(results[0].ongoing).toBe(false);
    expect(results[0].truncated).toBe(true);
    expect(results[0].endTime).toBe(end.toISOString());
    expect(new Date(results[0].peakTime).getTime()).toBeLessThanOrEqual(end.getTime());
    expect(results[0].maxElevation).toBeCloseTo(independentElevation(end.getTime()), 3);
  });

  it("reports both clipping flags for an entire window already above threshold", () => {
    const during = new Date(passes[0].peakTime);
    const results = predictPasses(ISS, ASTANA, during, { hours: 1 / 3600 });
    expect(results).toHaveLength(1);
    expect(results[0].ongoing).toBe(true);
    expect(results[0].truncated).toBe(true);
    expect(new Date(results[0].endTime).getTime() - during.getTime()).toBe(1000);
  });

  it("detects a grazing acquisition shorter than the discovery interval", () => {
    const reference = passes[0];
    const start = new Date(new Date(reference.startTime).getTime() - 60_000);
    const finish = new Date(reference.endTime).getTime() + 60_000;
    const results = predictPasses(ISS, ASTANA, start, {
      hours: (finish - start.getTime()) / 3_600_000,
      minElevation: reference.maxElevation - 0.0001,
      stepSeconds: 30,
    });
    expect(results).toHaveLength(1);
    expect(new Date(results[0].endTime).getTime() - new Date(results[0].startTime).getTime()).toBeLessThan(30_000);
    expect(results[0].maxElevation).toBeCloseTo(reference.maxElevation, 4);
  });

  it("returns no ISS passes over an unreachable polar observer", () => {
    expect(predictPasses(ISS, { latitude: 90, longitude: 0, altitudeKm: 0 }, START)).toEqual([]);
  });

  it("represents a continuously accessible geostationary satellite as one clipped window", () => {
    const geostationary: SatelliteRecord = {
      id: "28626", noradId: 28626, name: "XM-3 (Vallado fixture)",
      line1: "1 28626U 05008A   06176.46683397 -.00000205  00000-0  10000-3 0  2190",
      line2: "2 28626   0.0019 286.9433 0000335  13.7918  55.6504  1.00270176  4891",
      epoch: "2006-06-25T11:12:14.455Z",
    };
    const date = new Date(geostationary.epoch);
    const position = getSatellitePosition(geostationary, date)!;
    const results = predictPasses(geostationary, { latitude: 20, longitude: position.longitude, altitudeKm: 0 }, date);
    expect(results).toHaveLength(1);
    expect(results[0].ongoing).toBe(true);
    expect(results[0].truncated).toBe(true);
    expect(new Date(results[0].endTime).getTime() - date.getTime()).toBe(86_400_000);
    expect(results[0].maxElevation).toBeGreaterThan(65);
  });

  it("returns empty results for invalid inputs or unpropagatable elements", () => {
    for (const observer of [
      { ...ASTANA, latitude: 91 }, { ...ASTANA, longitude: -181 },
      { ...ASTANA, latitude: Number.NaN }, { ...ASTANA, altitudeKm: -1 },
    ]) expect(predictPasses(ISS, observer, START)).toEqual([]);
    expect(predictPasses(ISS, ASTANA, new Date("invalid"))).toEqual([]);
    expect(predictPasses(ISS, ASTANA, START, { hours: -1 })).toEqual([]);
    expect(predictPasses(ISS, ASTANA, START, { hours: 1000 })).toEqual([]);
    expect(predictPasses(ISS, ASTANA, START, { minElevation: 90 })).toEqual([]);
    expect(predictPasses(ISS, ASTANA, START, { minElevation: -10 })).toEqual([]);
    expect(predictPasses(ISS, ASTANA, START, { maxPasses: 0 })).toEqual([]);
    expect(predictPasses(ISS, ASTANA, START, { stepSeconds: 0 })).toEqual([]);
    expect(predictPasses({ ...ISS, line1: "invalid" }, ASTANA, START)).toEqual([]);
  });

  it("returns the same topocentric elevation as independent ENU geometry", () => {
    const date = new Date(passes[0].peakTime);
    const look = getSatelliteLookAngles(ISS, ASTANA, date)!;
    expect(look.elevation).toBeCloseTo(independentElevation(date.getTime()), 8);
    expect(look.rangeKm).toBeGreaterThan(300);
    expect(look.azimuth).toBeGreaterThanOrEqual(0);
    expect(look.azimuth).toBeLessThan(360);
  });
});
