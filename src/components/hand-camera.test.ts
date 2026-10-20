import { describe, expect, it } from "vitest";
import { Spherical, Vector3 } from "three";
import type { HandCameraInput } from "@/lib/hand-types";
import { clearHandCameraMotion, createHandCameraStep } from "./hand-camera";

function input(values: Partial<HandCameraInput> = {}): HandCameraInput {
  return {
    active: true,
    rotateX: 0,
    rotateY: 0,
    zoom: 0,
    updatedAt: 1000,
    ...values,
  };
}

describe("optional hand camera movement", () => {
  it("rotates in the same direction as a mirrored hand drag without changing distance", () => {
    const move = createHandCameraStep();
    const camera = new Vector3(0, 0, 8);
    const mailbox = input({ rotateX: 0.1, rotateY: -0.1 });
    expect(move(camera, new Vector3(), mailbox, 42, 1000)).toBe(true);
    const spherical = new Spherical().setFromVector3(camera);
    expect(spherical.theta).toBeCloseTo(-0.3);
    expect(spherical.phi).toBeCloseTo(Math.PI / 2 + 0.3);
    expect(camera.length()).toBeCloseTo(8);
    expect(camera.x).toBeLessThan(0);
  });

  it("consumes each movement once so a slow inference frame never keeps drifting", () => {
    const move = createHandCameraStep();
    const camera = new Vector3(4, 3, -5);
    const mailbox = input({ rotateX: 0.1, zoom: -0.05 });
    move(camera, new Vector3(), mailbox, 42, 1000);
    const afterMovement = camera.clone();
    expect(move(camera, new Vector3(), mailbox, 42, 1016)).toBe(false);
    expect(camera.equals(afterMovement)).toBe(true);
    expect(mailbox).toMatchObject({ rotateX: 0, rotateY: 0, zoom: 0 });
    expect(mailbox.active).toBe(true);
  });

  it("zooms in when a pinch is lifted and out when lowered, within camera limits", () => {
    const move = createHandCameraStep();
    const camera = new Vector3(0, 0, 8);
    const target = new Vector3();
    move(camera, target, input({ zoom: -0.1 }), 42, 1000);
    expect(camera.length()).toBeCloseTo(8 * Math.exp(-0.4));
    move(camera, target, input({ zoom: -100 }), 42, 1000);
    expect(camera.length()).toBeCloseTo(3.3);
    move(camera, target, input({ zoom: 100 }), 42, 1000);
    expect(camera.length()).toBeCloseTo(42);
    // High orbital catalogs keep their larger existing camera envelope.
    move(camera, target, input({ zoom: 100 }), 185.3, 1000);
    expect(camera.length()).toBeCloseTo(185.3);
  });

  it("clamps both poles and stays finite through repeated combined movements", () => {
    const move = createHandCameraStep();
    const camera = new Vector3(0, 0, 8);
    const target = new Vector3();
    move(camera, target, input({ rotateY: 1 }), 42, 1000);
    expect(new Spherical().setFromVector3(camera).phi).toBeCloseTo(0.1);
    move(camera, target, input({ rotateY: -1 }), 42, 1000);
    expect(new Spherical().setFromVector3(camera).phi).toBeCloseTo(
      Math.PI - 0.1,
    );
    for (let i = 0; i < 500; i++) {
      move(
        camera,
        target,
        input({
          rotateX: 0.13,
          rotateY: i % 2 ? -0.2 : 0.2,
          zoom: i % 2 ? -0.1 : 0.1,
        }),
        42,
        1000,
      );
      expect(Number.isFinite(camera.length())).toBe(true);
      expect(camera.length()).toBeGreaterThanOrEqual(3.3 - 1e-10);
      expect(camera.length()).toBeLessThanOrEqual(42 + 1e-10);
    }
  });

  it("orbits around the controls target and keeps its distance from that target", () => {
    const move = createHandCameraStep();
    const target = new Vector3(1, 2, 3);
    const camera = new Vector3(1, 2, 11);
    move(camera, target, input({ rotateX: 0.1 }), 42, 1000);
    expect(camera.distanceTo(target)).toBeCloseTo(8);
    expect(
      new Spherical().setFromVector3(camera.clone().sub(target)).theta,
    ).toBeCloseTo(-0.3);
    expect(target.toArray()).toEqual([1, 2, 3]);
  });

  it.each([
    undefined,
    input(),
    input({ active: false, rotateX: 0.1 }),
    input({ rotateX: 0.1, updatedAt: 749 }),
    input({ rotateX: 0.1, updatedAt: 1001 }),
    input({ rotateX: Number.NaN }),
    input({ rotateY: Number.POSITIVE_INFINITY }),
    input({ zoom: Number.NEGATIVE_INFINITY }),
    input({ rotateX: 0.1, updatedAt: Number.NaN }),
  ])(
    "leaves the baseline camera exactly unchanged for absent, idle, inactive, stale, or invalid input %j",
    (mailbox) => {
      const move = createHandCameraStep();
      const camera = new Vector3(4.9, 3.6, -5.2);
      const original = camera.clone();
      expect(move(camera, new Vector3(), mailbox, 42, 1000)).toBe(false);
      expect(camera.equals(original)).toBe(true);
      if (mailbox)
        expect(mailbox).toMatchObject({ rotateX: 0, rotateY: 0, zoom: 0 });
    },
  );

  it("discards a pending movement when a pointer or button takes control", () => {
    const mailbox = input({ rotateX: 0.2, rotateY: -0.1, zoom: 0.1 });
    clearHandCameraMotion(mailbox);
    expect(mailbox).toEqual(input());
    expect(() => clearHandCameraMotion(undefined)).not.toThrow();
  });

  it("does not create a direction when the camera equals its target", () => {
    const move = createHandCameraStep();
    const camera = new Vector3();
    expect(move(camera, new Vector3(), input({ rotateX: 0.2 }), 42, 1000)).toBe(
      false,
    );
    expect(camera.toArray()).toEqual([0, 0, 0]);
  });
});
