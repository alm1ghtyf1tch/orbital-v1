import { Spherical, Vector3 } from "three";
import type { HandCameraInput } from "@/lib/hand-types";

const MIN_DISTANCE = 3.3;
const MAX_INPUT_AGE_MS = 250;

function bounded(value: number) {
  return Math.max(-1, Math.min(1, value));
}

function isFiniteVector(value: Vector3) {
  return (
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.z)
  );
}

/** Discard queued deltas without ending the optional camera session. */
export function clearHandCameraMotion(input: HandCameraInput | undefined) {
  if (!input) return;
  input.rotateX = 0;
  input.rotateY = 0;
  input.zoom = 0;
}

/**
 * Consume a mailbox once, then rotate around OrbitControls' current target.
 * The scratch objects are reused on every frame. Like dragging the globe,
 * moving a hand right decreases camera azimuth; lifting a pinch zooms in.
 */
export function createHandCameraStep() {
  const offset = new Vector3();
  const spherical = new Spherical();

  return (
    position: Vector3,
    target: Vector3,
    input: HandCameraInput | undefined,
    maxDistance: number,
    now: number,
  ): boolean => {
    if (!input) return false;
    const { rotateX, rotateY, zoom, active, updatedAt } = input;
    clearHandCameraMotion(input);

    if (
      !active ||
      !Number.isFinite(now) ||
      !Number.isFinite(updatedAt) ||
      now < updatedAt ||
      now - updatedAt > MAX_INPUT_AGE_MS ||
      !Number.isFinite(rotateX) ||
      !Number.isFinite(rotateY) ||
      !Number.isFinite(zoom) ||
      !Number.isFinite(maxDistance) ||
      (rotateX === 0 && rotateY === 0 && zoom === 0) ||
      !isFiniteVector(position) ||
      !isFiniteVector(target)
    )
      return false;

    offset.copy(position).sub(target);
    const distanceSquared = offset.lengthSq();
    if (!Number.isFinite(distanceSquared) || distanceSquared < 1e-12)
      return false;

    spherical.setFromVector3(offset);
    // Guard against errant inputs while retaining normalized gesture movement.
    spherical.theta -= bounded(rotateX) * 3;
    spherical.phi = Math.max(
      0.1,
      Math.min(Math.PI - 0.1, spherical.phi - bounded(rotateY) * 3),
    );
    spherical.radius = Math.max(
      MIN_DISTANCE,
      Math.min(
        Math.max(MIN_DISTANCE, maxDistance),
        spherical.radius * Math.exp(bounded(zoom) * 4),
      ),
    );
    position.copy(offset.setFromSpherical(spherical)).add(target);
    return true;
  };
}
