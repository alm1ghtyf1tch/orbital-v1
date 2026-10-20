/** Browser time has two roles: wall time for UTC, monotonic time for elapsed time. */
export interface ClockReading {
  wallTimestamp: number;
  monotonicTimestamp: number;
}

export interface MissionClockState {
  timestamp: number;
  wallTimestamp: number;
  speed: number;
  paused: boolean;
  realTime: boolean;
  monotonicTimestamp: number | null;
}

export type ClockCommand =
  | { type: "togglePause" }
  | { type: "setSpeed"; speed: number }
  | { type: "reset" }
  | { type: "setOffset"; minutes: number }
  | { type: "jumpTo"; timestamp: number };

/** A deterministic initial value keeps the server and hydration renders equal. */
export function createMissionClock(): MissionClockState {
  return {
    timestamp: 0,
    wallTimestamp: 0,
    speed: 1,
    paused: false,
    realTime: true,
    monotonicTimestamp: null,
  };
}

/** Settle elapsed time under the current controls before applying any new ones. */
export function advanceMissionClock(
  clock: MissionClockState,
  reading: ClockReading,
): MissionClockState {
  const monotonicTimestamp = Math.max(
    clock.monotonicTimestamp ?? reading.monotonicTimestamp,
    reading.monotonicTimestamp,
  );
  const elapsed =
    clock.monotonicTimestamp === null
      ? 0
      : monotonicTimestamp - clock.monotonicTimestamp;
  const timestamp =
    clock.monotonicTimestamp === null || clock.realTime
      ? reading.wallTimestamp
      : clock.paused
        ? clock.timestamp
        : clock.timestamp + elapsed * clock.speed;
  return {
    ...clock,
    timestamp,
    wallTimestamp: reading.wallTimestamp,
    monotonicTimestamp,
  };
}

export function commandMissionClock(
  clock: MissionClockState,
  reading: ClockReading,
  command: ClockCommand,
): MissionClockState {
  const settled = advanceMissionClock(clock, reading);
  switch (command.type) {
    case "togglePause":
      return { ...settled, paused: !settled.paused, realTime: false };
    case "setSpeed":
      return Number.isFinite(command.speed) && command.speed > 0
        ? { ...settled, speed: command.speed, realTime: false }
        : settled;
    case "reset":
      return {
        ...settled,
        timestamp: reading.wallTimestamp,
        speed: 1,
        paused: false,
        realTime: true,
      };
    case "setOffset": {
      const timestamp = reading.wallTimestamp + command.minutes * 60_000;
      return Number.isFinite(new Date(timestamp).getTime())
        ? { ...settled, timestamp, realTime: false }
        : settled;
    }
    case "jumpTo":
      return Number.isFinite(new Date(command.timestamp).getTime())
        ? {
            ...settled,
            timestamp: command.timestamp,
            realTime: false,
            paused: true,
          }
        : settled;
  }
}
