import { describe, expect, it } from "vitest";
import {
  advanceMissionClock,
  commandMissionClock,
  createMissionClock,
} from "./clock";

const EPOCH = Date.parse("2026-10-20T12:00:00Z");
const reading = (elapsed: number) => ({
  wallTimestamp: EPOCH + elapsed,
  monotonicTimestamp: elapsed,
});
const initial = () => advanceMissionClock(createMissionClock(), reading(0));

describe("mission clock command timing", () => {
  it("acquires current UTC when a command arrives before the first timer tick", () => {
    const paused = commandMissionClock(createMissionClock(), reading(20), {
      type: "togglePause",
    });
    expect(paused.timestamp).toBe(EPOCH + 20);
    expect(paused.paused).toBe(true);
    const accelerated = commandMissionClock(createMissionClock(), reading(20), {
      type: "setSpeed",
      speed: 600,
    });
    expect(advanceMissionClock(accelerated, reading(25)).timestamp).toBe(
      EPOCH + 20 + 5 * 600,
    );
  });

  it("applies a speed change only to elapsed time after the command", () => {
    const accelerated = commandMissionClock(initial(), reading(490), {
      type: "setSpeed",
      speed: 600,
    });
    expect(accelerated.timestamp).toBe(EPOCH + 490);
    expect(advanceMissionClock(accelerated, reading(500)).timestamp).toBe(
      EPOCH + 490 + 10 * 600,
    );
  });

  it("settles the old speed before selecting a slower speed", () => {
    let clock = commandMissionClock(initial(), reading(0), {
      type: "setSpeed",
      speed: 600,
    });
    clock = commandMissionClock(clock, reading(490), {
      type: "setSpeed",
      speed: 1,
    });
    expect(advanceMissionClock(clock, reading(500)).timestamp).toBe(
      EPOCH + 490 * 600 + 10,
    );
  });

  it("excludes the entire paused interval when resuming between ticks", () => {
    let clock = commandMissionClock(initial(), reading(0), {
      type: "setSpeed",
      speed: 600,
    });
    clock = commandMissionClock(clock, reading(100), { type: "togglePause" });
    clock = advanceMissionClock(clock, reading(500));
    clock = commandMissionClock(clock, reading(990), { type: "togglePause" });
    expect(advanceMissionClock(clock, reading(1000)).timestamp).toBe(
      EPOCH + (100 + 10) * 600,
    );
  });

  it("anchors an offset to the command's wall time without adding earlier elapsed time", () => {
    let clock = commandMissionClock(initial(), reading(0), {
      type: "setSpeed",
      speed: 600,
    });
    clock = commandMissionClock(clock, reading(490), {
      type: "setOffset",
      minutes: 90,
    });
    const next = advanceMissionClock(clock, reading(500));
    expect(next.timestamp).toBe(EPOCH + 490 + 90 * 60_000 + 10 * 600);
    expect(next.wallTimestamp).toBe(EPOCH + 500);
  });

  it("accounts for delayed background ticks using monotonic elapsed time", () => {
    const clock = commandMissionClock(initial(), reading(0), {
      type: "setSpeed",
      speed: 60,
    });
    expect(advanceMissionClock(clock, reading(60_000)).timestamp).toBe(
      EPOCH + 60_000 * 60,
    );
  });

  it("uses wall-clock corrections only in real time, keeping simulated elapsed time stable", () => {
    const corrected = {
      wallTimestamp: EPOCH + 3_600_000,
      monotonicTimestamp: 500,
    };
    expect(advanceMissionClock(initial(), corrected).timestamp).toBe(
      corrected.wallTimestamp,
    );
    const simulated = commandMissionClock(initial(), reading(0), {
      type: "setSpeed",
      speed: 10,
    });
    expect(advanceMissionClock(simulated, corrected).timestamp).toBe(
      EPOCH + 500 * 10,
    );
  });

  it("keeps a peak preview paused and returns to current UTC on reset", () => {
    const peak = EPOCH + 4 * 3_600_000;
    let clock = commandMissionClock(initial(), reading(20), {
      type: "jumpTo",
      timestamp: peak,
    });
    clock = advanceMissionClock(clock, reading(5000));
    expect(clock.timestamp).toBe(peak);
    expect(clock.paused).toBe(true);
    clock = commandMissionClock(clock, reading(6000), { type: "reset" });
    expect(clock.timestamp).toBe(EPOCH + 6000);
    expect(clock.speed).toBe(1);
    expect(clock.paused).toBe(false);
    expect(clock.realTime).toBe(true);
  });

  it("ignores invalid public control values without poisoning the clock", () => {
    let clock = initial();
    for (const speed of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
      clock = commandMissionClock(clock, reading(100), {
        type: "setSpeed",
        speed,
      });
      expect(clock.speed).toBe(1);
    }
    clock = commandMissionClock(clock, reading(100), {
      type: "jumpTo",
      timestamp: Number.NaN,
    });
    clock = commandMissionClock(clock, reading(100), {
      type: "setOffset",
      minutes: Number.NaN,
    });
    expect(clock.timestamp).toBe(EPOCH + 100);
    expect(clock.realTime).toBe(true);
  });
});
