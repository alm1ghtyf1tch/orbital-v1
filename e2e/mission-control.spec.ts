import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { FEATURED_IDS } from "../src/lib/constants";

// Browser tests use the exact bundled, genuine elements and a fixed clock.
// This makes UI assertions independent of CelesTrak availability and pass timing.
const snapshots = JSON.parse(
  readFileSync(
    new URL("../src/data/fallback-catalogs.json", import.meta.url),
    "utf8",
  ),
) as {
  groups: Record<string, string>;
  sources: { group: string; retrievedAt: string }[];
};
const rows = snapshots.groups.visual.trim().split(/\r?\n/);
const satellites = Array.from({ length: rows.length / 3 }, (_, index) => {
  const [name, line1, line2] = rows.slice(index * 3, index * 3 + 3);
  const noradId = Number(line1.slice(2, 7));
  const year = Number(line1.slice(18, 20)) + 2000;
  const epoch = new Date(
    Date.UTC(year, 0, 1) + (Number(line1.slice(20, 32)) - 1) * 86_400_000,
  ).toISOString();
  return {
    id: String(noradId),
    noradId,
    name: name.trim(),
    line1,
    line2,
    epoch,
  };
});
const hubble = satellites.find((satellite) => satellite.noradId === 20580)!;
const fixtureCatalog = {
  group: "featured",
  source: "demo",
  fetchedAt: snapshots.sources.find((source) => source.group === "visual")!
    .retrievedAt,
  notice:
    "Demo mode uses frozen, genuine CelesTrak elements. SGP4 predictions are approximate.",
  satellites: FEATURED_IDS.flatMap((id) =>
    satellites.filter((satellite) => satellite.noradId === id),
  ),
};

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-20T17:00:00Z"));
  await page.route("**/api/catalog?*", async (route) => {
    const group = new URL(route.request().url()).searchParams.get("group");
    await route.fulfill({ json: { ...fixtureCatalog, group } });
  });
});

test("tracks real elements, changes selection, controls time and exports passes", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Orbital overview." }),
  ).toBeVisible();
  await expect(page.locator(".object-title h2")).toHaveText("ISS");
  await expect(
    page.locator(".telemetry-metrics .metric").first(),
  ).not.toContainText("—");
  await expect(page.getByRole("status")).toContainText("DEMO ELEMENTS");
  await expect(page.locator(".mission-clock")).toContainText("17:00:00");
  if (testInfo.project.name === "desktop") {
    expect(
      (await page.locator(".control-grid").boundingBox())!.height,
    ).toBeLessThan(750);
  }
  const search = page.getByRole("textbox", {
    name: "Search satellites by name or NORAD ID",
  });
  await search.fill("20580");
  await expect(page.locator(".satellite-row")).toHaveCount(1);
  await page.locator(".satellite-row").click();
  await expect(page.locator(".object-title h2")).toHaveText(hubble.name);
  await search.fill("no-such-object");
  await expect(page.getByText("No matching objects")).toBeVisible();
  await page
    .getByRole("button", { name: "Clear search", exact: true })
    .first()
    .click();
  await page
    .locator(".satellite-row")
    .filter({ hasText: "NORAD 25544" })
    .click();
  await page.getByRole("button", { name: "Pause simulation" }).click();
  const paused = await page.locator(".mission-clock .mono").innerText();
  await page.waitForTimeout(1100);
  await expect(page.locator(".mission-clock .mono")).toHaveText(paused);
  await page
    .getByRole("combobox", { name: "Simulation speed" })
    .selectOption("600");
  await page.getByRole("button", { name: "Resume simulation" }).click();
  await page.waitForTimeout(1000);
  await expect(page.locator(".mission-clock .mono")).not.toHaveText(paused);
  await page.getByRole("button", { name: "Reset to current UTC time" }).click();
  await expect(page.locator(".simulation-status")).toHaveText("REAL TIME");
  await page.getByRole("button", { name: "Globe layers", exact: true }).click();
  await page.getByRole("checkbox", { name: "Coordinate grid" }).check();
  await expect(
    page.getByRole("checkbox", { name: "Coordinate grid" }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Close layer options" }).click();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page
    .getByRole("button", { name: "Focus selected satellite", exact: true })
    .click();
  await expect(page.locator(".passes-table tbody tr").first()).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("orbital-25544-passes.csv");
  const csv = readFileSync((await download.path())!, "utf8");
  expect(csv).toContain("Ongoing at window start");
  expect(csv).toContain("Truncated at window end");
  expect(csv).toContain("Not an optical visibility forecast");
  await page.waitForTimeout(800);
  await page.screenshot({
    path: `artifacts/hand-controls/regression-${testInfo.project.name}.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("recovers from a catalog request failure without inventing predictions", async ({
  page,
}) => {
  let failed = true;
  await page.route("**/api/catalog?*", (route) =>
    failed
      ? route.fulfill({ status: 503, json: { error: "Catalog unavailable" } })
      : route.fulfill({ json: fixtureCatalog }),
  );
  await page.goto("/");
  await expect(
    page.getByText("Catalog unavailable", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".next-pass-card")).toContainText(
    "Prediction unavailable",
  );
  await expect(
    page.getByRole("button", { name: "Export CSV", exact: true }),
  ).toBeDisabled();
  failed = false;
  await page
    .getByRole("button", { name: "Retry request", exact: true })
    .click();
  await expect(page.locator(".object-title h2")).toHaveText("ISS");
  await expect(page.locator(".passes-table tbody tr").first()).toBeVisible();
});

test("updates observer, catalog and model disclosure accessibly", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".object-title h2")).toHaveText("ISS");
  await page.getByRole("button", { name: "Edit observer coordinates" }).click();
  await page
    .getByRole("spinbutton", { name: "Observer latitude", exact: true })
    .fill("40.7128");
  await page
    .getByRole("spinbutton", { name: "Observer longitude", exact: true })
    .fill("-74.006");
  await page
    .getByRole("spinbutton", { name: "Observer altitude in meters" })
    .fill("10");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByText("Custom ground station")).toBeVisible();
  await expect(page.locator(".observer-location")).toContainText("74.01° W");
  await page
    .getByRole("combobox", { name: "Minimum pass elevation" })
    .selectOption("20");
  await expect(page.locator(".forecast-footnote")).toContainText("above 20°");
  await page
    .getByRole("combobox", { name: "Satellite catalog group" })
    .selectOption("weather");
  await expect(page.locator(".satellite-row")).toHaveCount(
    fixtureCatalog.satellites.length,
  );
  await page
    .getByRole("button", { name: "Data sources and model information" })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("DEMO");
  await expect(page.getByRole("dialog")).toContainText(
    "not a guarantee of optical visibility",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("keeps model data usable when WebGL cannot start", async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      contextId: string,
      options?: unknown,
    ) {
      if (contextId.startsWith("webgl") || contextId === "experimental-webgl")
        return null;
      return Reflect.apply(getContext, this, [contextId, options]);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.goto("/");
  await expect(page.locator(".object-title h2")).toHaveText("ISS");
  await expect(page.getByText("3D view unavailable")).toBeVisible();
  await expect(page.locator(".passes-table tbody tr").first()).toBeVisible();
});

test("distinguishes a valid no-pass forecast from unavailable predictions", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".object-title h2")).toHaveText("ISS");
  await page.getByRole("button", { name: "Edit observer coordinates" }).click();
  await page
    .getByRole("spinbutton", { name: "Observer latitude", exact: true })
    .fill("90");
  await page
    .getByRole("spinbutton", { name: "Observer longitude", exact: true })
    .fill("0");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".next-pass-card")).toContainText(
    "No passes in this window",
  );
  await expect(page.locator(".next-pass-card")).not.toContainText(
    "Prediction unavailable",
  );
  await expect(
    page.getByRole("button", { name: "Export CSV", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".telemetry-metrics")).not.toContainText("—");
});
