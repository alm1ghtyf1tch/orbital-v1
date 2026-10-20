import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { createCameraFocusStep, getCameraLimits } from "./globe-camera";

describe("globe camera framing", () => {
  it("reaches an antipodal satellite without crossing Earth or the controls minimum distance", () => {
    const move = createCameraFocusStep();
    const camera = new Vector3(8, 0, 0);
    const target = new Vector3(-6.5, 0, 0);
    for (let i = 0; i < 200; i++) {
      move(camera, target, 0.1);
      expect(camera.length()).toBeGreaterThanOrEqual(6.5 - 1e-10);
      expect(camera.length()).toBeLessThanOrEqual(8 + 1e-10);
    }
    expect(camera.distanceTo(target)).toBeLessThan(0.0001);
  });

  it("keeps ordinary low Earth orbit zoom limits unchanged", () => {
    expect(getCameraLimits(2.2)).toEqual({ maxDistance: 42, far: 180 });
  });

  it("allows high science orbit focus and renders its surroundings", () => {
    // MMS can have a scene radius above 54 (roughly 174,000 km from Earth center).
    const radius = 54.5;
    const limits = getCameraLimits(radius);
    expect(limits.maxDistance).toBeGreaterThan(radius * 2.65);
    expect(limits.far).toBeGreaterThan(limits.maxDistance + radius);
    expect(limits.far).toBeGreaterThan(limits.maxDistance + 95);
  });
});
