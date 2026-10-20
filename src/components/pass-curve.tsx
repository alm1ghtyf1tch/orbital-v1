"use client";
import { useMemo } from "react";
import { getSatelliteLookAngles } from "@/lib/orbits";
import { utcTime } from "@/lib/format";
import type { Observer, PassPrediction, SatelliteRecord } from "@/lib/types";

export function PassCurve({
  satellite,
  observer,
  pass,
  threshold,
}: {
  satellite: SatelliteRecord | null;
  observer: Observer;
  pass: PassPrediction;
  threshold: number;
}) {
  const values = useMemo(() => {
    if (!satellite) return [];
    const start = new Date(pass.startTime).getTime(),
      end = new Date(pass.endTime).getTime();
    return Array.from(
      { length: 61 },
      (_, index) =>
        getSatelliteLookAngles(
          satellite,
          observer,
          new Date(start + ((end - start) * index) / 60),
        )?.elevation ?? threshold,
    );
  }, [satellite, observer, pass, threshold]);
  const points = values
    .map(
      (elevation, i) =>
        `${(i / 60) * 256},${72 - (Math.max(0, elevation) / 90) * 63}`,
    )
    .join(" ");
  const baseline = 72 - (threshold / 90) * 63;
  return (
    <div className="pass-curve">
      <div className="chart-axis">
        <span>90°</span>
        <span>{threshold}°</span>
      </div>
      <svg
        viewBox="0 0 256 80"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Predicted pass elevation curve, maximum ${pass.maxElevation.toFixed(1)} degrees`}
      >
        <defs>
          <linearGradient id="pass-fill" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#6dd7ed" stopOpacity=".18" />
            <stop offset="1" stopColor="#6dd7ed" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d="M0 9H256 M0 40H256"
          stroke="#26313f"
          strokeDasharray="2 5"
          fill="none"
        />
        <path d={`M0 ${baseline}H256`} stroke="#41505e" strokeDasharray="2 4" />
        <polygon
          points={`0,${baseline} ${points} 256,${baseline}`}
          fill="url(#pass-fill)"
        />
        <polyline
          points={points}
          fill="none"
          stroke="#76d9ec"
          strokeWidth="1.8"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="chart-times mono">
        <span>{utcTime(pass.startTime)}</span>
        <span>UTC</span>
        <span>{utcTime(pass.endTime)}</span>
      </div>
    </div>
  );
}
