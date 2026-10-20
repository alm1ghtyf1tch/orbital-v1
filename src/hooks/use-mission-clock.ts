"use client";

import { useCallback, useEffect, useState } from "react";

interface ClockState {
  timestamp: number;
  wallTimestamp: number;
  speed: number;
  paused: boolean;
  realTime: boolean;
}

export function useMissionClock() {
  const [clock, setClock] = useState<ClockState>({ timestamp: 0, wallTimestamp: 0, speed: 1, paused: false, realTime: true });

  useEffect(() => {
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const next = performance.now();
      const elapsed = next - previous;
      previous = next;
      setClock((current) => ({
        ...current,
        wallTimestamp: Date.now(),
        timestamp: current.paused ? current.timestamp : current.realTime ? Date.now() : current.timestamp + elapsed * current.speed,
      }));
    }, 500);
    return () => window.clearInterval(timer);
  }, []);

  const togglePause = useCallback(() => setClock((current) => ({
    ...current, timestamp: current.timestamp || Date.now(), paused: !current.paused, realTime: false,
  })), []);
  const setSpeed = useCallback((speed: number) => setClock((current) => ({
    ...current, timestamp: current.timestamp || Date.now(), speed, realTime: false,
  })), []);
  const reset = useCallback(() => setClock({ timestamp: Date.now(), wallTimestamp: Date.now(), speed: 1, paused: false, realTime: true }), []);
  const setOffset = useCallback((minutes: number) => setClock((current) => ({
    ...current, timestamp: Date.now() + minutes * 60_000, realTime: false,
  })), []);
  const jumpTo = useCallback((time: string) => setClock((current) => ({
    ...current, timestamp: new Date(time).getTime(), realTime: false, paused: true,
  })), []);

  return { ...clock, togglePause, setSpeed, reset, setOffset, jumpTo };
}
