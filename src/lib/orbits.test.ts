import { describe, expect, it } from "vitest";
import { gstime } from "satellite.js";
import {
  getElementAgeDays,
  getOrbitalPeriod,
  getOrbitTrack,
  getSatelliteLookAngles,
  getSatellitePosition,
} from "./orbits";
import type { SatelliteRecord } from "./types";

// Vallado et al., AIAA 2006-6753, SGP4 verification case 00005.
// Source: https://celestrak.org/publications/AIAA/2006-6753/
// The distributed verification vectors are also preserved at
// https://github.com/aholinch/sgp4/tree/master/data (SGP4-VER.TLE/tcppver.out).
const VANGUARD: SatelliteRecord = {
  id: "5",
  noradId: 5,
  name: "VANGUARD 1",
  line1:
    "1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753",
  line2:
    "2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667",
  epoch: "2000-06-27T18:50:19.733Z",
};
const epoch = new Date(VANGUARD.epoch);

// WGS84 geodetic -> ECF independently checks the returned latitude/longitude.
function geodeticEcf(latitude: number, longitude: number, altitudeKm: number) {
  const lat = (latitude * Math.PI) / 180;
  const lon = (longitude * Math.PI) / 180;
  const eccentricitySquared = 6.6943799901413165e-3;
  const radius =
    6_378.137 / Math.sqrt(1 - eccentricitySquared * Math.sin(lat) ** 2);
  return {
    x: (radius + altitudeKm) * Math.cos(lat) * Math.cos(lon),
    y: (radius + altitudeKm) * Math.cos(lat) * Math.sin(lon),
    z: (radius * (1 - eccentricitySquared) + altitudeKm) * Math.sin(lat),
  };
}

describe("SGP4 orbital predictions", () => {
  it.each([
    [
      0,
      [7022.46529266, -1400.08296755, 0.03995155],
      [1.893841015, 6.405893759, 4.53480725],
    ],
    [
      360,
      [-7154.03120202, -3783.17682504, -3536.19412294],
      [4.741887409, -4.151817765, -2.093935425],
    ],
    [
      1440,
      [-938.55923943, -6268.18748831, -4294.02924751],
      [7.536105209, -0.427127707, 0.98987808],
    ],
  ])(
    "matches published Vallado position/speed at epoch + %d minutes",
    (minutes, positionReference, velocityReference) => {
      const date = new Date(epoch.getTime() + minutes * 60_000);
      const result = getSatellitePosition(VANGUARD, date);
      expect(result).not.toBeNull();
      const { x, y, z } = result!.positionEcf;
      const theta = gstime(date);
      const eci = [
        x * Math.cos(theta) - y * Math.sin(theta),
        x * Math.sin(theta) + y * Math.cos(theta),
        z,
      ];
      eci.forEach((component, index) => {
        // JavaScript Date truncates the reference epoch's fractional millisecond.
        expect(Math.abs(component - positionReference[index])).toBeLessThan(
          0.01,
        );
      });
      expect(result!.velocityKmS).toBeCloseTo(
        Math.hypot(...velocityReference),
        5,
      );
    },
  );

  it("round-trips geodetic location through WGS84 at several orbital latitudes", () => {
    for (const minutes of [0, 20, 40, 60, 80, 100]) {
      const result = getSatellitePosition(
        VANGUARD,
        new Date(epoch.getTime() + minutes * 60_000),
      )!;
      const independentlyCalculated = geodeticEcf(
        result.latitude,
        result.longitude,
        result.altitudeKm,
      );
      expect(result.latitude).toBeGreaterThanOrEqual(-90);
      expect(result.latitude).toBeLessThanOrEqual(90);
      expect(result.longitude).toBeGreaterThanOrEqual(-180);
      expect(result.longitude).toBeLessThanOrEqual(180);
      for (const coordinate of ["x", "y", "z"] as const) {
        expect(independentlyCalculated[coordinate]).toBeCloseTo(
          result.positionEcf[coordinate],
          4,
        );
      }
    }
  });

  it("calculates the mean period and signed TLE age independently of metadata", () => {
    expect(getOrbitalPeriod(VANGUARD)).toBeCloseTo(1440 / 10.82419157, 8);
    const incorrectMetadata = { ...VANGUARD, epoch: "2099-01-01T00:00:00Z" };
    expect(
      getElementAgeDays(
        incorrectMetadata,
        new Date(epoch.getTime() + 86_400_000),
      ),
    ).toBeCloseTo(1, 6);
    expect(
      getElementAgeDays(VANGUARD, new Date(epoch.getTime() - 86_400_000)),
    ).toBeCloseTo(-1, 6);
  });

  it("centers an Earth-fixed track on simulation time with a complete orbit duration", () => {
    const track = getOrbitTrack(VANGUARD, epoch, { steps: 180 });
    expect(track).toHaveLength(181);
    expect(new Date(track[90].time).getTime()).toBe(epoch.getTime());
    const span =
      new Date(track[180].time).getTime() - new Date(track[0].time).getTime();
    expect(Math.abs(span - getOrbitalPeriod(VANGUARD) * 60_000)).toBeLessThan(
      2,
    );
    expect(track[90].latitude).toBeCloseTo(
      getSatellitePosition(VANGUARD, epoch)!.latitude,
      6,
    );
  });

  it("places an observer directly under the predicted satellite near zenith", () => {
    const date = new Date(epoch.getTime() + 20 * 60_000);
    const position = getSatellitePosition(VANGUARD, date)!;
    const angles = getSatelliteLookAngles(
      VANGUARD,
      {
        latitude: position.latitude,
        longitude: position.longitude,
        altitudeKm: 0,
      },
      date,
    )!;
    expect(angles.elevation).toBeCloseTo(90, 5);
    expect(angles.rangeKm).toBeCloseTo(position.altitudeKm, 5);
  });

  it("fails safely for malformed elements, invalid times and invalid track options", () => {
    const malformed = { ...VANGUARD, line1: "bad elements" };
    expect(getSatellitePosition(malformed, epoch)).toBeNull();
    expect(getSatellitePosition(VANGUARD, new Date("invalid"))).toBeNull();
    expect(getOrbitalPeriod(malformed)).toBeNaN();
    expect(getElementAgeDays(malformed, epoch)).toBeNaN();
    expect(getOrbitTrack(VANGUARD, epoch, { steps: 0 })).toEqual([]);
    expect(getOrbitTrack(VANGUARD, epoch, { minutes: -1 })).toEqual([]);
    expect(getOrbitTrack(malformed, epoch)).toEqual([]);
    const invalidMotion = {
      ...VANGUARD,
      line2: `${VANGUARD.line2.slice(0, 52)}10.82bad157${VANGUARD.line2.slice(63)}`,
    };
    expect(getSatellitePosition(invalidMotion, epoch)).toBeNull();
    expect(
      getSatelliteLookAngles(
        VANGUARD,
        { latitude: 91, longitude: 0, altitudeKm: 0 },
        epoch,
      ),
    ).toBeNull();
  });

  it("does not return positions after orbital decay", () => {
    const decaying: SatelliteRecord = {
      id: "28872",
      noradId: 28872,
      name: "Vallado decayed test case",
      line1:
        "1 28872U 05037B   05333.02012661  .25992681  00000-0  24476-3 0  1534",
      line2:
        "2 28872  96.4736 157.9986 0303955 244.0492 110.6523 16.46015938 10708",
      epoch: "2005-11-29T00:28:58.939Z",
    };
    // Verification case is below the Earth's surface 60 minutes after epoch.
    expect(
      getSatellitePosition(decaying, new Date("2005-11-29T01:28:58.939Z")),
    ).toBeNull();
  });

  it("keeps cached deep-space propagation stable when forecasts and scrubbing move time backward", () => {
    const geostationary: SatelliteRecord = {
      id: "28626",
      noradId: 28626,
      name: "XM-3 (Vallado fixture)",
      line1:
        "1 28626U 05008A   06176.46683397 -.00000205  00000-0  10000-3 0  2190",
      line2:
        "2 28626   0.0019 286.9433 0000335  13.7918  55.6504  1.00270176  4891",
      epoch: "2006-06-25T11:12:14.455Z",
    };
    const date = new Date(geostationary.epoch);
    const original = getSatellitePosition(geostationary, date);
    expect(original).not.toBeNull();
    for (const hours of [24, 48, -24, 12, -12]) {
      expect(
        getSatellitePosition(
          geostationary,
          new Date(date.getTime() + hours * 3_600_000),
        ),
      ).not.toBeNull();
    }
    getOrbitTrack(geostationary, date, { steps: 20 });
    expect(getSatellitePosition(geostationary, date)).toEqual(original);
  });
});
