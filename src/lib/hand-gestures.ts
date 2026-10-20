import type { HandGesture, HandLandmark, HandMotion } from "./hand-types";

interface HandGestureResult {
  gesture: HandGesture;
  motion: HandMotion;
}

interface Point {
  x: number;
  y: number;
}

const PALM = [0, 5, 9, 13, 17];
const FINGERS = [5, 9, 13, 17];
const STABLE_FRAMES = 3;
const STALE_AFTER_MS = 250;
const PINCH_ENTER = 0.28;
const PINCH_EXIT = 0.43;
const DEADZONE = 0.0018;
const MAX_STEP = 0.035;
const MAX_TRACKING_JUMP = 0.16;

const still = (gesture: HandGesture): HandGestureResult => ({
  gesture,
  motion: { rotateX: 0, rotateY: 0, zoom: 0 },
});

function distance(a: HandLandmark, b: HandLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function alignment(a: HandLandmark, b: HandLandmark, c: HandLandmark): number {
  const ab = distance(a, b);
  const bc = distance(b, c);
  if (ab < 0.0001 || bc < 0.0001) return -1;
  return (
    ((b.x - a.x) * (c.x - b.x) +
      (b.y - a.y) * (c.y - b.y) +
      (b.z - a.z) * (c.z - b.z)) /
    (ab * bc)
  );
}

function extended(
  landmarks: HandLandmark[],
  base: number,
  palmSize: number,
): boolean {
  const [mcp, pip, dip, tip] = landmarks.slice(base, base + 4);
  const length = distance(mcp, pip) + distance(pip, dip) + distance(dip, tip);
  // Joint geometry works with either hand and with a rotated palm, unlike comparing Y values.
  return (
    length > palmSize * 0.45 &&
    distance(mcp, tip) / length > 0.82 &&
    alignment(mcp, pip, dip) > 0.55 &&
    alignment(pip, dip, tip) > 0.4 &&
    distance(landmarks[0], tip) > distance(landmarks[0], pip) + palmSize * 0.12
  );
}

function inspect(landmarks: HandLandmark[] | null) {
  if (
    !landmarks ||
    landmarks.length !== 21 ||
    landmarks.some(
      (point) =>
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        !Number.isFinite(point.z) ||
        point.x < 0 ||
        point.x > 1 ||
        point.y < 0 ||
        point.y > 1,
    )
  ) {
    return null;
  }

  const palmSize = Math.max(
    distance(landmarks[0], landmarks[9]),
    distance(landmarks[5], landmarks[17]),
  );
  if (palmSize < 0.045) return null;

  const fingers = FINGERS.map((base) => extended(landmarks, base, palmSize));
  const center = PALM.reduce(
    (sum, index) => ({
      x: sum.x + landmarks[index].x / 5,
      y: sum.y + landmarks[index].y / 5,
    }),
    { x: 0, y: 0 },
  );
  const otherFingers = fingers.slice(1).filter(Boolean).length;
  // A fist can also bring thumb and index tips together. Require a pinch away from
  // the knuckles, or another extended finger, so a stop gesture never starts zooming.
  const pinchIntent =
    distance(landmarks[5], landmarks[8]) > palmSize * 0.4 &&
    (otherFingers > 0 ||
      distance(landmarks[0], landmarks[8]) >
        distance(landmarks[0], landmarks[5]) * 1.12);

  return {
    center,
    open: fingers.filter(Boolean).length >= 3,
    pinchIntent,
    pinchRatio: distance(landmarks[4], landmarks[8]) / palmSize,
  };
}

function outsideDeadzone(value: number): number {
  return Math.abs(value) > DEADZONE
    ? Math.sign(value) * (Math.abs(value) - DEADZONE)
    : 0;
}

/**
 * Interprets MediaPipe's 21 normalized landmarks without retaining camera frames.
 * An open palm rotates; a thumb/index pinch moved vertically zooms; other poses hold.
 * Output X is mirrored to match a selfie preview, and negative zoom means zoom in.
 */
export function createHandGestureTracker() {
  let gesture: HandGesture = "none";
  let candidate: HandGesture = "none";
  let candidateFrames = 0;
  let lastTime: number | null = null;
  let lastRaw: Point | null = null;
  let filtered: Point | null = null;
  let anchor: Point | null = null;

  function reset() {
    gesture = "none";
    candidate = "none";
    candidateFrames = 0;
    lastTime = null;
    lastRaw = null;
    filtered = null;
    anchor = null;
  }

  function reanchor(center: Point) {
    lastRaw = { ...center };
    filtered = { ...center };
    anchor = { ...center };
  }

  function update(
    landmarks: HandLandmark[] | null,
    timestamp: number,
  ): HandGestureResult {
    const hand = inspect(landmarks);
    if (!hand || !Number.isFinite(timestamp) || timestamp < 0) {
      reset();
      return still("none");
    }

    if (lastTime !== null && timestamp === lastTime) return still(gesture);
    if (
      lastTime !== null &&
      (timestamp < lastTime || timestamp - lastTime > STALE_AFTER_MS)
    ) {
      reset();
    }
    const elapsed = lastTime === null ? 50 : timestamp - lastTime;
    lastTime = timestamp;

    const pinchThreshold =
      gesture === "zoom" || candidate === "zoom" ? PINCH_EXIT : PINCH_ENTER;
    const detected: HandGesture =
      hand.pinchIntent && hand.pinchRatio < pinchThreshold
        ? "zoom"
        : hand.open
          ? "rotate"
          : "hold";

    // Neutral poses stop immediately. Entering or switching a movement gesture
    // takes three observations, and always anchors at the current hand position.
    if (detected === "hold") {
      gesture = "hold";
      candidate = "hold";
      candidateFrames = 0;
      reanchor(hand.center);
      return still(gesture);
    }
    if (detected !== gesture) {
      candidateFrames = detected === candidate ? candidateFrames + 1 : 1;
      candidate = detected;
      gesture = candidateFrames >= STABLE_FRAMES ? detected : "hold";
      reanchor(hand.center);
      return still(gesture);
    }
    candidate = detected;
    candidateFrames = 0;

    if (
      !lastRaw ||
      !filtered ||
      !anchor ||
      Math.hypot(hand.center.x - lastRaw.x, hand.center.y - lastRaw.y) >
        MAX_TRACKING_JUMP
    ) {
      reanchor(hand.center);
      return still(gesture);
    }

    const smoothing = elapsed / (45 + elapsed);
    filtered.x += (hand.center.x - filtered.x) * smoothing;
    filtered.y += (hand.center.y - filtered.y) * smoothing;
    lastRaw = { ...hand.center };
    let dx = outsideDeadzone(filtered.x - anchor.x);
    let dy = outsideDeadzone(filtered.y - anchor.y);
    const size = Math.hypot(dx, dy);
    if (size > MAX_STEP) {
      dx *= MAX_STEP / size;
      dy *= MAX_STEP / size;
      // Discard the excess rather than replaying a tracking jump on later frames.
      anchor = { ...filtered };
    } else {
      anchor.x += dx;
      anchor.y += dy;
    }

    return {
      gesture,
      motion:
        gesture === "rotate"
          ? { rotateX: dx === 0 ? 0 : -dx, rotateY: dy, zoom: 0 }
          : { rotateX: 0, rotateY: 0, zoom: dy },
    };
  }

  return { update, reset };
}
