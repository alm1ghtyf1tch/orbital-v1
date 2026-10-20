import {
  Quaternion,
  Vector3,
  type OrthographicCamera,
  type PerspectiveCamera,
} from "three";

/** Reuses scratch vectors so an animated focus does not allocate each frame. */
export function createCameraFocusStep() {
  const fromDirection = new Vector3();
  const toDirection = new Vector3();
  const rotation = new Quaternion();
  const step = new Quaternion();

  return (current: Vector3, target: Vector3, fraction: number) => {
    const distance = current.length();
    const targetDistance = target.length();
    fromDirection.copy(current).normalize();
    toDirection.copy(target).normalize();
    rotation.setFromUnitVectors(fromDirection, toDirection);
    step.identity().slerp(rotation, fraction);
    // Rotating the direction independently keeps the camera outside Earth,
    // including when the requested satellite is on the opposite hemisphere.
    current
      .applyQuaternion(step)
      .setLength(distance + (targetDistance - distance) * fraction);
  };
}

export function getCameraLimits(sceneRadius: number) {
  const maxDistance = Math.max(42, sceneRadius * 3.4);
  return {
    maxDistance,
    // Include distant orbital markers and the full star shell from any allowed zoom.
    far: Math.max(180, maxDistance + Math.max(sceneRadius, 95) + 20),
  };
}

export function updateCameraClipping(
  camera: PerspectiveCamera | OrthographicCamera,
  far: number,
) {
  camera.far = far;
  camera.updateProjectionMatrix();
}
