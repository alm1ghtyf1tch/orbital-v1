import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

interface ModelSmokeState {
  cameraCalls: number;
  stoppedTracks: number;
  results: number;
  terminatedWorkers: number;
  showHand: boolean;
  detectedHands: number;
}

test("local hand model initializes and infers in the real production worker", async ({
  page,
  context,
}, testInfo) => {
  // This verifies one real CPU/WASM pipeline. The separate lifecycle suite
  // exercises the optional frontend on both desktop and mobile.
  test.skip(
    testInfo.project.name !== "desktop",
    "One real model smoke check is sufficient.",
  );
  const pageErrors: string[] = [];
  const requests: { url: string; method: string }[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  context.on("request", (request) =>
    requests.push({ url: request.url(), method: request.method() }),
  );

  const snapshot = JSON.parse(
    readFileSync(
      new URL("../src/data/fallback-catalogs.json", import.meta.url),
      "utf8",
    ),
  );
  const [name, line1, line2] = (snapshot.groups.visual as string)
    .trim()
    .split(/\r?\n/);
  await page.route("**/api/catalog?*", (route) =>
    route.fulfill({
      json: {
        group: new URL(route.request().url()).searchParams.get("group"),
        source: "demo",
        satellites: [
          {
            id: line1.slice(2, 7).trim(),
            noradId: Number(line1.slice(2, 7)),
            name: name.trim(),
            line1,
            line2,
            epoch: new Date(
              Date.UTC(Number(line1.slice(18, 20)) + 2000, 0, 1) +
                (Number(line1.slice(20, 32)) - 1) * 86_400_000,
            ).toISOString(),
          },
        ],
        fetchedAt: snapshot.sources[0].retrievedAt,
        notice: "Synthetic camera test with genuine frozen orbital elements.",
      },
    }),
  );

  const referenceDataUrl = `data:image/jpeg;base64,${readFileSync(new URL("./fixtures/hand-reference.jpg", import.meta.url)).toString("base64")}`;
  await page.addInitScript((imageDataUrl) => {
    const reference = new Image();
    reference.src = imageDataUrl;
    const stats: ModelSmokeState = {
      cameraCalls: 0,
      stoppedTracks: 0,
      results: 0,
      terminatedWorkers: 0,
      showHand: false,
      detectedHands: 0,
    };
    (window as unknown as { __modelSmoke: ModelSmokeState }).__modelSmoke =
      stats;
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        stats.cameraCalls++;
        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = 480;
        const drawing = canvas.getContext("2d")!;
        let frame = 0;
        let animationFrame = 0;
        const draw = () => {
          drawing.fillStyle = frame++ % 2 ? "#112633" : "#162c39";
          drawing.fillRect(0, 0, canvas.width, canvas.height);
          if (stats.showHand && reference.complete && reference.naturalWidth) {
            drawing.drawImage(reference, 0, 0, canvas.width, canvas.height);
          }
          animationFrame = requestAnimationFrame(draw);
        };
        draw();
        const stream = canvas.captureStream(15);
        for (const track of stream.getTracks()) {
          const stop = track.stop.bind(track);
          track.stop = () => {
            stats.stoppedTracks++;
            cancelAnimationFrame(animationFrame);
            stop();
          };
        }
        return stream;
      },
    });
    const NativeWorker = window.Worker;
    // Observe the real Worker; do not replace its code, model, or inference.
    class ObservedWorker extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener(
          "message",
          (
            event: MessageEvent<{ type: string; landmarks?: unknown[] | null }>,
          ) => {
            if (event.data.type === "result") {
              stats.results++;
              if (event.data.landmarks?.length === 21) stats.detectedHands++;
            }
          },
        );
      }
      terminate() {
        stats.terminatedWorkers++;
        super.terminate();
      }
    }
    Object.defineProperty(window, "Worker", {
      configurable: true,
      value: ObservedWorker,
    });
  }, referenceDataUrl);

  await page.goto("/");
  const stats = () =>
    page.evaluate(
      () =>
        (window as unknown as { __modelSmoke: ModelSmokeState }).__modelSmoke,
    );
  expect((await stats()).cameraCalls).toBe(0);
  expect(requests.some(({ url }) => url.includes("/hand-tracking/"))).toBe(
    false,
  );
  await page
    .getByRole("button", { name: "Hand controls (optional)", exact: true })
    .click();
  const panel = page.locator("#hand-controls-panel");
  await panel
    .getByRole("button", { name: "Enable camera & gestures", exact: true })
    .click();
  await Promise.race([
    panel
      .getByText("CAMERA ON", { exact: true })
      .waitFor({ state: "visible", timeout: 30_000 }),
    panel
      .getByRole("alert")
      .waitFor({ state: "visible", timeout: 30_000 })
      .then(async () => {
        throw new Error(await panel.getByRole("alert").innerText());
      }),
  ]);
  await expect
    .poll(async () => (await stats()).results, { timeout: 15_000 })
    .toBeGreaterThan(0);
  await expect(panel.getByRole("status")).toContainText("Show one hand");
  await page.evaluate(() => {
    (
      window as unknown as { __modelSmoke: ModelSmokeState }
    ).__modelSmoke.showHand = true;
  });
  await expect
    .poll(async () => (await stats()).detectedHands, { timeout: 15_000 })
    .toBeGreaterThan(2);
  await expect(panel.getByRole("status")).toContainText(
    "Open palm · move to orbit",
  );
  expect(
    requests.some(({ url }) =>
      url.includes("/hand-tracking/hand_landmarker.task"),
    ),
  ).toBe(true);
  expect(
    requests.some(({ url }) =>
      url.includes("/hand-tracking/wasm/vision_wasm_module_internal.wasm"),
    ),
  ).toBe(true);
  const applicationOrigin = new URL(page.url()).origin;
  expect(
    requests.filter(({ url }) => new URL(url).origin !== applicationOrigin),
  ).toEqual([]);
  expect(requests.filter(({ method }) => method !== "GET")).toEqual([]);
  await panel
    .getByRole("button", { name: "Turn camera off", exact: true })
    .click();
  await expect(panel).toContainText("Your camera is off");
  expect(await stats()).toMatchObject({
    cameraCalls: 1,
    stoppedTracks: 1,
    terminatedWorkers: 1,
  });
  expect(pageErrors).toEqual([]);
});
