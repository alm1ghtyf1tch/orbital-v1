import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const snapshot = JSON.parse(
  readFileSync(
    new URL("../src/data/fallback-catalogs.json", import.meta.url),
    "utf8",
  ),
) as {
  groups: Record<string, string>;
  sources: { group: string; retrievedAt: string }[];
};
const rows = snapshot.groups.visual.trim().split(/\r?\n/);
const satellites = Array.from({ length: rows.length / 3 }, (_, index) => {
  const [name, line1, line2] = rows.slice(index * 3, index * 3 + 3);
  const noradId = Number(line1.slice(2, 7));
  return {
    id: String(noradId),
    noradId,
    name: name.trim(),
    line1,
    line2,
    epoch: new Date(
      Date.UTC(Number(line1.slice(18, 20)) + 2000, 0, 1) +
        (Number(line1.slice(20, 32)) - 1) * 86_400_000,
    ).toISOString(),
  };
}).filter((satellite) => satellite.noradId === 25544);

interface CameraHarness {
  calls: number;
  stoppedTracks: number;
  workers: number;
  terminatedWorkers: number;
  frames: number;
  pose: "none" | "palm" | "pinch";
  grantPending: (() => void) | null;
}

/** Real browser video from a synthetic canvas; never accesses camera hardware. */
async function installCameraHarness(
  page: Page,
  mode: "deny" | "pending" | "active",
) {
  await page.addInitScript((cameraMode) => {
    const state: CameraHarness = {
      calls: 0,
      stoppedTracks: 0,
      workers: 0,
      terminatedWorkers: 0,
      frames: 0,
      grantPending: null,
      pose: "none",
    };
    (window as unknown as { __handHarness: CameraHarness }).__handHarness =
      state;

    function makeStream() {
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 240;
      const context = canvas.getContext("2d")!;
      let animationFrame = 0;
      let frame = 0;
      const draw = () => {
        context.fillStyle = frame++ % 2 ? "#102a38" : "#153542";
        context.fillRect(0, 0, 320, 240);
        animationFrame = requestAnimationFrame(draw);
      };
      draw();
      const stream = canvas.captureStream(15);
      for (const track of stream.getTracks()) {
        const nativeStop = track.stop.bind(track);
        let stopped = false;
        track.stop = () => {
          if (!stopped) {
            stopped = true;
            state.stoppedTracks++;
          }
          cancelAnimationFrame(animationFrame);
          nativeStop();
        };
      }
      return stream;
    }

    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: () => {
        state.calls++;
        if (cameraMode === "deny") {
          return Promise.reject(
            new DOMException("Denied by test", "NotAllowedError"),
          );
        }
        if (cameraMode === "pending") {
          return new Promise<MediaStream>((resolve) => {
            state.grantPending = () => resolve(makeStream());
          });
        }
        return Promise.resolve(makeStream());
      },
    });

    // Exercise the production frontend/runtime lifecycle with a deterministic
    // worker boundary; the real model is covered separately by a smoke check.
    class HandWorker extends EventTarget {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      onmessageerror: (() => void) | null = null;
      private stopped = false;
      constructor() {
        super();
        state.workers++;
      }
      postMessage(message: {
        type: string;
        bitmap?: ImageBitmap;
        timestamp?: number;
      }) {
        if (message.type === "initialize") {
          queueMicrotask(() => {
            if (!this.stopped)
              this.onmessage?.(
                new MessageEvent("message", { data: { type: "ready" } }),
              );
          });
        } else if (message.type === "frame") {
          state.frames++;
          message.bitmap?.close();
          const points = [
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
          if (state.pose === "pinch") {
            points[3] = [-0.17, -0.12];
            points[4] = [-0.12, -0.16];
            points[7] = [-0.11, -0.2];
            points[8] = [-0.089, -0.16];
          }
          const landmarks =
            state.pose === "none"
              ? null
              : points.map(([x, y]) => ({ x: x + 0.5, y: y + 0.55, z: 0 }));
          queueMicrotask(() => {
            if (!this.stopped)
              this.onmessage?.(
                new MessageEvent("message", {
                  data: {
                    type: "result",
                    landmarks,
                    timestamp: message.timestamp,
                  },
                }),
              );
          });
        }
      }
      terminate() {
        if (!this.stopped) state.terminatedWorkers++;
        this.stopped = true;
      }
    }
    Object.defineProperty(window, "Worker", {
      configurable: true,
      value: HandWorker,
    });
  }, mode);
}

async function harnessState(page: Page) {
  return page.evaluate(() => {
    const { calls, stoppedTracks, workers, terminatedWorkers, frames } = (
      window as unknown as { __handHarness: CameraHarness }
    ).__handHarness;
    return { calls, stoppedTracks, workers, terminatedWorkers, frames };
  });
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-20T17:00:00Z"));
  await page.route("**/api/catalog?*", (route) =>
    route.fulfill({
      json: {
        group: new URL(route.request().url()).searchParams.get("group"),
        source: "demo",
        satellites,
        fetchedAt: snapshot.sources.find((source) => source.group === "visual")!
          .retrievedAt,
        notice: "Demo mode uses genuine frozen CelesTrak orbital elements.",
      },
    }),
  );
});

test("hand controls stay completely off until explicitly enabled", async ({
  page,
}, testInfo) => {
  await installCameraHarness(page, "deny");
  const handAssetRequests: string[] = [];
  page.on("request", (request) => {
    if (
      /\.task(?:$|\?)|vision_wasm|tasks-vision|mediapipe|\/hand-tracking\//i.test(
        request.url(),
      )
    ) {
      handAssetRequests.push(request.url());
    }
  });
  await page.goto("/");
  await expect(page.locator(".object-title h2")).toHaveText("ISS");
  await expect(page.locator("#hand-controls-panel")).toHaveCount(0);
  const trigger = page.getByRole("button", {
    name: "Hand controls (optional)",
    exact: true,
  });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  const panel = page.locator("#hand-controls-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Your camera is off");
  await expect(panel).toContainText("Camera frames stay on your device");
  await expect(
    panel.getByRole("button", {
      name: "Enable camera & gestures",
      exact: true,
    }),
  ).toBeVisible();
  const panelBounds = (await panel.boundingBox())!;
  const actionBounds = (await panel
    .getByRole("button", { name: "Enable camera & gestures", exact: true })
    .boundingBox())!;
  expect(actionBounds.y).toBeGreaterThanOrEqual(panelBounds.y);
  expect(actionBounds.y + actionBounds.height).toBeLessThanOrEqual(
    panelBounds.y + panelBounds.height,
  );
  expect(await harnessState(page)).toMatchObject({ calls: 0, workers: 0 });
  expect(handAssetRequests).toEqual([]);
  await page.screenshot({
    path: `artifacts/hand-controls/optional-panel-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await panel
    .getByRole("button", { name: "Close hand controls and stop camera" })
    .click();
  await expect(panel).toHaveCount(0);
  expect(await harnessState(page)).toMatchObject({ calls: 0, workers: 0 });
});

test("denied camera access gives a useful error and preserves normal controls", async ({
  page,
}) => {
  await installCameraHarness(page, "deny");
  await page.goto("/");
  await page
    .getByRole("button", { name: "Hand controls (optional)", exact: true })
    .click();
  const panel = page.locator("#hand-controls-panel");
  await panel
    .getByRole("button", { name: "Enable camera & gestures", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText(
    /camera (?:access|permission).*denied/i,
  );
  await expect(
    panel.getByRole("button", { name: "Try camera again", exact: true }),
  ).toBeVisible();
  expect(await harnessState(page)).toMatchObject({
    calls: 1,
    workers: 0,
    stoppedTracks: 0,
  });
  await panel
    .getByRole("button", { name: "Close hand controls and stop camera" })
    .click();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page
    .getByRole("button", { name: "Focus selected satellite", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Pause simulation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Resume simulation", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".telemetry-metrics")).not.toContainText("—");
  await expect(page.locator(".passes-table tbody tr").first()).toBeVisible();
});

test("cancelling pending permission stops a stream granted after cancellation", async ({
  page,
}) => {
  await installCameraHarness(page, "pending");
  await page.goto("/");
  await page
    .getByRole("button", { name: "Hand controls (optional)", exact: true })
    .click();
  const panel = page.locator("#hand-controls-panel");
  await panel
    .getByRole("button", { name: "Enable camera & gestures", exact: true })
    .click();
  await expect.poll(async () => (await harnessState(page)).calls).toBe(1);
  await panel
    .getByRole("button", { name: "Cancel & stop camera", exact: true })
    .click();
  await expect(panel).toContainText("Your camera is off");
  await page.evaluate(() => {
    (window as unknown as { __handHarness: CameraHarness }).__handHarness
      .grantPending!();
  });
  await expect
    .poll(async () => (await harnessState(page)).stoppedTracks)
    .toBe(1);
  expect(await harnessState(page)).toMatchObject({ workers: 0 });
  await expect(
    panel.getByRole("button", {
      name: "Enable camera & gestures",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await panel
      .locator("video")
      .evaluate((video: HTMLVideoElement) => video.srcObject),
  ).toBeNull();
});

test("an enabled camera session processes frames and releases resources on stop and close", async ({
  page,
}) => {
  await installCameraHarness(page, "active");
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");
  await page
    .getByRole("button", { name: "Hand controls (optional)", exact: true })
    .click();
  const panel = page.locator("#hand-controls-panel");
  await panel
    .getByRole("button", { name: "Enable camera & gestures", exact: true })
    .click();
  await expect(panel.getByText("CAMERA ON", { exact: true })).toBeVisible();
  await expect
    .poll(async () => (await harnessState(page)).frames)
    .toBeGreaterThan(0);
  await expect(panel.getByRole("status")).toContainText("Show one hand");
  await page.evaluate(() => {
    (window as unknown as { __handHarness: CameraHarness }).__handHarness.pose =
      "palm";
  });
  await expect(panel.getByRole("status")).toContainText(
    "Open palm · move to orbit",
  );
  await page.evaluate(() => {
    (window as unknown as { __handHarness: CameraHarness }).__handHarness.pose =
      "pinch";
  });
  await expect(panel.getByRole("status")).toContainText(
    "Pinch · move up or down to zoom",
  );
  expect(
    await panel
      .locator("video")
      .evaluate((video: HTMLVideoElement) => video.srcObject !== null),
  ).toBe(true);
  await panel
    .getByRole("button", { name: "Minimize hand controls panel" })
    .click();
  await expect(
    panel.getByRole("button", { name: "Expand hand controls panel" }),
  ).toBeVisible();
  expect(await harnessState(page)).toMatchObject({
    stoppedTracks: 0,
    terminatedWorkers: 0,
  });
  await panel
    .getByRole("button", { name: "Turn camera off", exact: true })
    .click();
  await expect(panel).toContainText("Your camera is off");
  expect(await harnessState(page)).toMatchObject({
    calls: 1,
    stoppedTracks: 1,
    workers: 1,
    terminatedWorkers: 1,
  });
  expect(
    await panel
      .locator("video")
      .evaluate((video: HTMLVideoElement) => video.srcObject),
  ).toBeNull();
  await panel
    .getByRole("button", { name: "Enable camera & gestures", exact: true })
    .click();
  await expect(panel.getByText("CAMERA ON", { exact: true })).toBeVisible();
  await panel
    .getByRole("button", { name: "Close hand controls and stop camera" })
    .click();
  await expect(panel).toHaveCount(0);
  expect(await harnessState(page)).toMatchObject({
    calls: 2,
    stoppedTracks: 2,
    workers: 2,
    terminatedWorkers: 2,
  });
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  expect(pageErrors).toEqual([]);
});
