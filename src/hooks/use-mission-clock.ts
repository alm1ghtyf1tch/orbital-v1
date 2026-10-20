"use client";

import { useCallback, useEffect, useState } from "react";
import {
  advanceMissionClock,
  commandMissionClock,
  createMissionClock,
  type ClockCommand,
} from "@/lib/clock";

function readTime() {
  return { wallTimestamp: Date.now(), monotonicTimestamp: performance.now() };
}

export function useMissionClock() {
  const [clock, setClock] = useState(createMissionClock);

  useEffect(() => {
    const tick = () => {
      const reading = readTime();
      setClock((current) => advanceMissionClock(current, reading));
    };
    // Hydration starts at zero; establish UTC immediately after mounting.
    const initialization = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 500);
    return () => {
      window.clearTimeout(initialization);
      window.clearInterval(timer);
    };
  }, []);

  const command = useCallback((action: ClockCommand) => {
    // Capture the event's boundary now, rather than when React runs its updater.
    const reading = readTime();
    setClock((current) => commandMissionClock(current, reading, action));
  }, []);
  const togglePause = useCallback(
    () => command({ type: "togglePause" }),
    [command],
  );
  const setSpeed = useCallback(
    (speed: number) => command({ type: "setSpeed", speed }),
    [command],
  );
  const reset = useCallback(() => command({ type: "reset" }), [command]);
  const setOffset = useCallback(
    (minutes: number) => command({ type: "setOffset", minutes }),
    [command],
  );
  const jumpTo = useCallback(
    (time: string) =>
      command({ type: "jumpTo", timestamp: new Date(time).getTime() }),
    [command],
  );

  return {
    timestamp: clock.timestamp,
    wallTimestamp: clock.wallTimestamp,
    speed: clock.speed,
    paused: clock.paused,
    realTime: clock.realTime,
    togglePause,
    setSpeed,
    reset,
    setOffset,
    jumpTo,
  };
}
