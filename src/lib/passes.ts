import { getSatelliteLookAngles, isValidObserver } from "./orbits";
import type { Observer, PassPrediction, SatelliteRecord } from "./types";

export interface PassOptions {
  hours?: number;
  /** Start and end use this acquisition elevation above the geometric horizon. */
  minElevation?: number;
  maxPasses?: number;
  stepSeconds?: number;
}

interface Sample {
  time: number;
  elevation: number;
  azimuth: number;
}

/**
 * Approximate geometric passes, not optically visible passes. Samples locate
 * candidate events; bisection refines crossings and golden-section search refines
 * culmination. Ongoing/window-clipped events are explicitly marked.
 */
export function predictPasses(
  satellite: SatelliteRecord,
  observer: Observer,
  startDate: Date,
  options: PassOptions = {},
): PassPrediction[] {
  const hours = options.hours ?? 24;
  const minElevation = options.minElevation ?? 10;
  const maxPasses = options.maxPasses ?? 6;
  const stepSeconds = options.stepSeconds ?? 30;
  const startMs = startDate.getTime();
  if (
    !isValidObserver(observer) ||
    !Number.isFinite(startMs) ||
    !Number.isFinite(hours) ||
    hours <= 0 ||
    hours > 168 ||
    !Number.isFinite(minElevation) ||
    minElevation < 0 ||
    minElevation >= 90 ||
    !Number.isInteger(maxPasses) ||
    maxPasses < 1 ||
    maxPasses > 100 ||
    !Number.isFinite(stepSeconds) ||
    stepSeconds < 1 ||
    stepSeconds > 120
  ) {
    return [];
  }
  const endMs = startMs + hours * 3_600_000;
  if (!Number.isFinite(new Date(endMs).getTime())) return [];
  // Keep discovery sufficiently fine even when a caller requests coarse steps.
  const stepMs = Math.min(stepSeconds, 30) * 1_000;
  const sample = (time: number): Sample | null => {
    const look = getSatelliteLookAngles(satellite, observer, new Date(time));
    return look ? { time, elevation: look.elevation, azimuth: look.azimuth } : null;
  };
  const crossing = (a: Sample, b: Sample): Sample | null => {
    let left = a;
    let right = b;
    // Resolve events to 100 ms, well below the accuracy of ordinary TLEs.
    while (right.time - left.time > 100) {
      const middle = sample((left.time + right.time) / 2);
      if (!middle) return null;
      if ((middle.elevation >= minElevation) === (left.elevation >= minElevation)) {
        left = middle;
      } else {
        right = middle;
      }
    }
    return sample((left.time + right.time) / 2);
  };
  const maximum = (leftMs: number, rightMs: number): Sample | null => {
    // Every candidate is bracketed around a coarse local peak. Refining only
    // that bracket also works for multi-hour/geosynchronous above-mask windows.
    const ratio = (Math.sqrt(5) - 1) / 2;
    let left = leftMs;
    let right = rightMs;
    let a = sample(right - ratio * (right - left));
    let b = sample(left + ratio * (right - left));
    if (!a || !b) return null;
    while (right - left > 100) {
      if (a.elevation > b.elevation) {
        right = b.time;
        b = a;
        a = sample(right - ratio * (right - left));
        if (!a) return null;
      } else {
        left = a.time;
        a = b;
        b = sample(left + ratio * (right - left));
        if (!b) return null;
      }
    }
    const candidates = [sample(leftMs), sample(rightMs), a, b].filter(
      (value): value is Sample => value !== null,
    );
    return candidates.reduce((best, item) => item.elevation > best.elevation ? item : best);
  };

  const passes: PassPrediction[] = [];
  let previous = sample(startMs);
  if (!previous) return [];
  let activeStart: Sample | null = previous.elevation >= minElevation ? previous : null;
  let ongoing = activeStart !== null;
  let peak = activeStart;
  let beforePrevious: Sample | null = null;
  let lastEndMs = Number.NEGATIVE_INFINITY;

  const complete = (end: Sample, truncated: boolean): boolean => {
    if (!activeStart || !peak) return false;
    const refinedPeak = maximum(
      Math.max(activeStart.time, peak.time - stepMs),
      Math.min(end.time, peak.time + stepMs),
    );
    if (!refinedPeak) return false;
    passes.push({
      id: `${satellite.id}-${Math.round(activeStart.time)}`,
      startTime: new Date(activeStart.time).toISOString(),
      peakTime: new Date(refinedPeak.time).toISOString(),
      endTime: new Date(end.time).toISOString(),
      maxElevation: refinedPeak.elevation,
      azimuthStart: activeStart.azimuth,
      azimuthEnd: end.azimuth,
      ongoing,
      truncated,
    });
    lastEndMs = end.time;
    return true;
  };

  for (let time = Math.min(startMs + stepMs, endMs); time <= endMs; time = Math.min(time + stepMs, endMs)) {
    const current = sample(time);
    // Never manufacture an end/peak across an interval we could not propagate.
    if (!current) return passes;
    if (!activeStart && current.elevation >= minElevation) {
      activeStart = crossing(previous, current);
      if (!activeStart) return passes;
      ongoing = false;
      peak = current;
    } else if (activeStart && current.elevation < minElevation) {
      const end = crossing(previous, current);
      if (!end || !complete(end, false)) return passes;
      if (passes.length >= maxPasses) return passes;
      activeStart = null;
      peak = null;
    } else if (!activeStart && previous.elevation < minElevation) {
      // A grazing pass can be shorter than one discovery step. Refine local
      // maxima even when all coarse samples are below the acquisition mask.
      // The two boundary intervals also cover a peak clipped by the window.
      const localPeak = beforePrevious !== null &&
        previous.elevation > beforePrevious.elevation &&
        previous.elevation >= current.elevation;
      if (localPeak || beforePrevious === null || time === endMs) {
        const left = localPeak && beforePrevious ? beforePrevious : previous;
        const hiddenPeak = maximum(left.time, current.time);
        if (hiddenPeak && hiddenPeak.elevation >= minElevation && hiddenPeak.time > lastEndMs) {
          const start = crossing(left, hiddenPeak);
          const end = crossing(hiddenPeak, current);
          if (!start || !end) return passes;
          activeStart = start;
          peak = hiddenPeak;
          ongoing = false;
          if (!complete(end, false)) return passes;
          if (passes.length >= maxPasses) return passes;
          activeStart = null;
          peak = null;
        }
      }
    }
    if (activeStart && (!peak || current.elevation > peak.elevation)) peak = current;
    beforePrevious = previous;
    previous = current;
    if (time === endMs) break;
  }
  if (activeStart) complete(previous, true);
  return passes;
}
