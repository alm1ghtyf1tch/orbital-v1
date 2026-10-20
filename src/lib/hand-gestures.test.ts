import { describe, expect, it } from "vitest";
import { createHandGestureTracker } from "./hand-gestures";
import type { HandLandmark } from "./hand-types";

// A palm facing the camera, with realistic knuckles and three joints per finger.
const OPEN: number[][] = [
  [0, 0.14],
  [-0.09, 0.07],
  [-0.17, 0.01],
  [-0.23, -0.07],
  [-0.28, -0.12],
  [-0.1, -0.03],
  [-0.12, -0.14],
  [-0.12, -0.22],
  [-0.12, -0.29],
  [0, -0.06],
  [0, -0.19],
  [0, -0.28],
  [0, -0.35],
  [0.09, -0.04],
  [0.12, -0.16],
  [0.13, -0.24],
  [0.14, -0.3],
  [0.16, 0],
  [0.21, -0.09],
  [0.23, -0.15],
  [0.25, -0.19],
];

interface Transform {
  x?: number;
  y?: number;
  scale?: number;
  rotation?: number;
  mirror?: boolean;
  tilt?: number;
}

function landmarks(points = OPEN, transform: Transform = {}): HandLandmark[] {
  const {
    x = 0.5,
    y = 0.55,
    scale = 1,
    rotation = 0,
    mirror = false,
    tilt = 0,
  } = transform;
  return points.map(([px, py]) => {
    const tx = (mirror ? -px : px) * scale;
    const ty = py * scale;
    const rx = tx * Math.cos(rotation) - ty * Math.sin(rotation);
    return {
      x: x + rx * Math.cos(tilt),
      y: y + tx * Math.sin(rotation) + ty * Math.cos(rotation),
      z: rx * Math.sin(tilt),
    };
  });
}

function pinched(ratio = 0.12): number[][] {
  const points = OPEN.map((point) => [...point]);
  const palmSize = Math.hypot(0.26, 0.03);
  points[3] = [-0.17, -0.12];
  points[4] = [-0.12, -0.16];
  points[7] = [-0.11, -0.2];
  points[8] = [-0.12 + palmSize * ratio, -0.16];
  return points;
}

function fist(): number[][] {
  const points = OPEN.map((point) => [...point]);
  for (const base of [5, 9, 13, 17]) {
    const x = points[base][0];
    points[base + 1] = [x, -0.09];
    points[base + 2] = [x + 0.01, -0.03];
    points[base + 3] = [x, 0.04];
  }
  points[4] = [-0.085, 0.04];
  return points;
}

function stabilize(
  tracker: ReturnType<typeof createHandGestureTracker>,
  hand: HandLandmark[],
  start = 0,
) {
  tracker.update(hand, start);
  tracker.update(hand, start + 50);
  return tracker.update(hand, start + 100);
}

const ZERO = { rotateX: 0, rotateY: 0, zoom: 0 };

describe("hand gesture recognition", () => {
  it.each([
    { rotation: 0, scale: 1 },
    { rotation: Math.PI / 2, scale: 0.6 },
    { rotation: Math.PI, scale: 1.15 },
    { rotation: -0.7, scale: 0.75, mirror: true },
    { rotation: 0.3, tilt: 0.8, mirror: true },
  ])(
    "recognizes an open palm under rotation, handedness, scale, and depth: %j",
    (transform) => {
      const tracker = createHandGestureTracker();
      expect(stabilize(tracker, landmarks(OPEN, transform))).toEqual({
        gesture: "rotate",
        motion: ZERO,
      });
    },
  );

  it("requires three consecutive frames before allowing movement", () => {
    const tracker = createHandGestureTracker();
    expect(tracker.update(landmarks(), 0).gesture).toBe("hold");
    expect(tracker.update(landmarks(OPEN, { x: 0.52 }), 50).gesture).toBe(
      "hold",
    );
    expect(tracker.update(landmarks(OPEN, { x: 0.54 }), 100)).toEqual({
      gesture: "rotate",
      motion: ZERO,
    });
    expect(
      tracker.update(landmarks(OPEN, { x: 0.56 }), 150).motion.rotateX,
    ).toBeLessThan(0);
  });

  it("moves in selfie-preview directions and keeps sustained movement responsive", () => {
    const tracker = createHandGestureTracker();
    stabilize(tracker, landmarks());
    let rotation = 0;
    for (let i = 1; i <= 8; i++) {
      const result = tracker.update(
        landmarks(OPEN, { x: 0.5 - i * 0.01, y: 0.55 + i * 0.005 }),
        100 + i * 50,
      );
      expect(result.motion.rotateX).toBeGreaterThan(0);
      expect(result.motion.rotateY).toBeGreaterThan(0);
      expect(result.motion.zoom).toBe(0);
      rotation += result.motion.rotateX;
    }
    expect(rotation).toBeGreaterThan(0.06);
  });

  it("suppresses subpixel positional noise rather than drifting the camera", () => {
    const tracker = createHandGestureTracker();
    stabilize(tracker, landmarks());
    for (let i = 1; i <= 30; i++) {
      const jitter = i % 2 ? 0.0008 : -0.0008;
      expect(
        tracker.update(
          landmarks(OPEN, { x: 0.5 + jitter, y: 0.55 - jitter }),
          100 + i * 40,
        ).motion,
      ).toEqual(ZERO);
    }
  });

  it("recognizes pinch and zooms in when the pinched hand moves up", () => {
    const tracker = createHandGestureTracker();
    expect(stabilize(tracker, landmarks(pinched())).gesture).toBe("zoom");
    const moved = tracker.update(
      landmarks(pinched(), { y: 0.52, x: 0.52 }),
      150,
    );
    expect(moved.motion.zoom).toBeLessThan(0);
    expect(moved.motion.rotateX).toBe(0);
    expect(moved.motion.rotateY).toBe(0);
  });

  it("normalizes pinch to palm size and works with a mirrored rotated hand", () => {
    for (const scale of [0.55, 1.2]) {
      const tracker = createHandGestureTracker();
      expect(
        stabilize(
          tracker,
          landmarks(pinched(0.22), { scale, rotation: 0.9, mirror: true }),
        ).gesture,
      ).toBe("zoom");
    }
  });

  it("uses pinch hysteresis so small changes near the threshold do not switch modes", () => {
    const tracker = createHandGestureTracker();
    stabilize(tracker, landmarks(pinched(0.23)));
    for (let i = 0; i < 6; i++) {
      expect(
        tracker.update(landmarks(pinched(i % 2 ? 0.29 : 0.38)), 150 + i * 50)
          .gesture,
      ).toBe("zoom");
    }
    expect(tracker.update(landmarks(pinched(0.5)), 450).gesture).toBe("hold");
    expect(tracker.update(landmarks(pinched(0.5)), 500).gesture).toBe("hold");
    expect(tracker.update(landmarks(pinched(0.5)), 550).gesture).toBe("rotate");
  });

  it("stops immediately for a fist even when thumb and index tips are touching", () => {
    const tracker = createHandGestureTracker();
    stabilize(tracker, landmarks());
    const stopped = tracker.update(landmarks(fist(), { x: 0.6 }), 150);
    expect(stopped).toEqual({ gesture: "hold", motion: ZERO });
    expect(stabilize(tracker, landmarks(fist()), 200)).toEqual({
      gesture: "hold",
      motion: ZERO,
    });
  });

  it("does not move the camera while changing gesture or replay the transition", () => {
    const tracker = createHandGestureTracker();
    stabilize(tracker, landmarks());
    const change = landmarks(pinched(), { x: 0.6, y: 0.6 });
    expect(stabilize(tracker, change, 150)).toEqual({
      gesture: "zoom",
      motion: ZERO,
    });
    expect(tracker.update(change, 300)).toEqual({
      gesture: "zoom",
      motion: ZERO,
    });
  });

  it("clears the anchor on hand loss and reacquires without jumping", () => {
    const tracker = createHandGestureTracker();
    stabilize(tracker, landmarks());
    expect(tracker.update(null, 150)).toEqual({
      gesture: "none",
      motion: ZERO,
    });
    const reacquired = landmarks(OPEN, { x: 0.65 });
    expect(stabilize(tracker, reacquired, 200)).toEqual({
      gesture: "rotate",
      motion: ZERO,
    });
    expect(tracker.update(reacquired, 350).motion).toEqual(ZERO);
  });

  it("re-anchors stale or reversed timestamps, and ignores duplicate frames", () => {
    const tracker = createHandGestureTracker();
    stabilize(tracker, landmarks());
    expect(tracker.update(landmarks(OPEN, { x: 0.6 }), 100).motion).toEqual(
      ZERO,
    );
    expect(tracker.update(landmarks(OPEN, { x: 0.6 }), 500)).toEqual({
      gesture: "hold",
      motion: ZERO,
    });
    expect(stabilize(tracker, landmarks(OPEN, { x: 0.6 }), 550)).toEqual({
      gesture: "rotate",
      motion: ZERO,
    });
    expect(tracker.update(landmarks(), 20)).toEqual({
      gesture: "hold",
      motion: ZERO,
    });
  });

  it("clamps a rapid movement and discards implausible tracking jumps", () => {
    const tracker = createHandGestureTracker();
    stabilize(tracker, landmarks());
    const fast = tracker.update(landmarks(OPEN, { x: 0.62 }), 150);
    expect(Math.abs(fast.motion.rotateX)).toBeLessThanOrEqual(0.035);
    expect(fast.motion.rotateX).toBeLessThan(0);
    expect(tracker.update(landmarks(OPEN, { x: 0.4 }), 200).motion).toEqual(
      ZERO,
    );
    expect(tracker.update(landmarks(OPEN, { x: 0.4 }), 250).motion).toEqual(
      ZERO,
    );
  });

  it("rejects missing, invalid, out-of-frame, or too-small landmarks", () => {
    const invalid = landmarks();
    invalid[8].x = Number.NaN;
    const outside = landmarks();
    outside[20].y = -0.01;
    const infiniteDepth = landmarks();
    infiniteDepth[0].z = Number.POSITIVE_INFINITY;
    for (const input of [
      null,
      [],
      landmarks().slice(0, 20),
      invalid,
      outside,
      infiniteDepth,
      landmarks(OPEN, { scale: 0.1 }),
    ]) {
      const tracker = createHandGestureTracker();
      stabilize(tracker, landmarks());
      expect(tracker.update(input, 150)).toEqual({
        gesture: "none",
        motion: ZERO,
      });
    }
  });

  it("reset prevents old movement or mode from carrying over into a new session", () => {
    const tracker = createHandGestureTracker();
    stabilize(tracker, landmarks(pinched()));
    tracker.reset();
    expect(tracker.update(landmarks(OPEN, { x: 0.6 }), 1000)).toEqual({
      gesture: "hold",
      motion: ZERO,
    });
  });
});
