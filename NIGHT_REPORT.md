# ORBITAL — Night report

Delivered locally on **20 October 2026**, Asia/Almaty. Work is on **`feat/orbital-mission-control`**. Nothing was pushed or deployed.

## Delivered

ORBITAL is a functioning Next.js / TypeScript / Tailwind application with a custom mission-control interface, rather than a static visual prototype.

- **Interactive Earth:** locally bundled NASA Blue Marble texture, atmospheric glow, stars, selectable satellite markers, observer marker, one-revolution Earth-fixed orbit and ground track, coordinate grid, camera orbit/zoom, selection focus, expandable view, and layer controls. Reduced-motion preferences are respected. Camera focus supports opposing hemispheres and high-altitude science spacecraft.
- **Genuine tracking calculations:** satellite.js SGP4 propagation supplies latitude, longitude, altitude, inertial velocity and mean orbital period. The details panel also shows TLE inclination and element age. Positions update as simulation time advances.
- **Catalog service:** CelesTrak TLE retrieval with four selectable groups, name/NORAD search, checksum and field validation, concurrent-request deduplication, two-hour caching, ten-second timeout, HTTP backoff, and last-known-good preservation. Frozen, genuine fallback elements are explicitly labeled demo. Original element epochs and available upstream retrieval timestamps are preserved.
- **Pass prediction:** default observer Astana, Kazakhstan; editable latitude, longitude and altitude; a 24-hour geometric forecast with 0°/10°/20° acquisition thresholds, refined crossing times and maxima, countdown, sampled elevation curve, azimuth directions, duration, peak-time preview and CSV export. Ongoing and window-truncated events are qualified, including in the exported CSV.
- **Simulation controls:** UTC mission clock, pause/resume, 1×/10×/60×/600× speeds, ±90-minute scrubber, reset to current time, and paused preview at a predicted pass peak. Commands account for elapsed time at their exact event boundary.
- **Usability and recovery:** responsive desktop/mobile layouts, loading and empty states, editable observer form, source/model disclosure dialog, failed-request retry, and a WebGL error boundary. Tracking and pass planning remain usable if the globe cannot render. Unavailable propagation is distinguished from a valid forecast with no passes.

No paid keys, account, database, external fonts or runtime texture service are required.

## Data provenance

Four real CelesTrak responses were successfully downloaded on **2026-10-20 at approximately 16:43 UTC** (21:43 in Almaty): visual, stations, weather and science. The bundled datasets contain 155 bright objects, 17 station-group objects, 72 weather objects and 46 science objects. Featured curates 20 objects, starting with ISS and including the Chinese space station, Hubble, Terra and Aqua.

Exact URLs, response status, sizes and retrieval times are in [snapshot-provenance.json](src/data/snapshot-provenance.json). Raw TLEs and fallback documentation are under [src/data](src/data/README.md). NASA texture provenance and usage credits are in [ATTRIBUTION.md](public/textures/ATTRIBUTION.md).

Catalog membership does not establish that a spacecraft remains operational. Every displayed position and pass is an **approximate orbital prediction, never measured live telemetry**.

## Verification results

| Check | Result |
| --- | --- |
| ESLint | Passed, no warnings in final run |
| TypeScript | Passed; `next typegen` prepares generated route declarations before checking |
| Vitest | **59 tests passed across 5 files** |
| Production build | Passed with Next.js 16.4.2 / Turbopack |
| Production browser checks | **10 passed**, desktop and emulated iPhone viewport in installed Chrome |
| Development smoke check | `npm run dev` served HTTP 200 with the expected page |
| Production dependency audit | `npm audit --omit=dev`: **0 vulnerabilities** |
| Git whitespace check | `git diff --check`: passed |

Numerical tests include three published Vallado SGP4 reference vectors, independent WGS 84 / topocentric geometry, a full day of one-second reference pass sampling over Astana, threshold crossing/peak consistency, grazing events narrower than the discovery step, ongoing and clipped windows, invalid/decayed elements, and deep-space propagation after backward time changes. Application tests cover parser corruption, malformed upstream responses, cache behavior, timeout/backoff, retrieval provenance, clock transitions and camera geometry.

Browser checks exercised satellite search/selection, time controls, layer toggles, camera actions, CSV contents, observer edits, catalog switching, source-dialog keyboard dismissal, failed catalog recovery, no-pass forecasts and forced WebGL failure. They also assert no page overflow, a bounded desktop workspace height and no unexpected JavaScript page errors in the main tracking scenario. Browser catalogs use the bundled genuine elements and a fixed clock for deterministic results; these checks do not repeatedly download CelesTrak data.

Reviewed screenshots are saved in [orbital-desktop.png](artifacts/orbital-desktop.png) and [orbital-mobile.png](artifacts/orbital-mobile.png). They intentionally show **demo provenance**, with real SGP4 calculations at a fixed UTC time. Mobile was emulated in Chromium; physical devices, Safari and Firefox were not tested.

## Confirmed issues fixed during review

- Replaced satellite.js 7's browser-incompatible optional WASM export path with **pinned JavaScript-only satellite.js 6.0.2**. The reference-vector and pass tests pass unchanged.
- Corrected elapsed-time accounting around speed, pause, resume and offset commands.
- Corrected camera interpolation through Earth, high-orbit clipping and auto-rotation conflicts.
- Stabilized texture loading to avoid repeated GPU uploads on clock updates.
- Removed a loading-label DOM ownership race and gave globe labels a stable portal host; browser page-error checks now pass.
- Corrected observer-form overlap and prevented catalog content from expanding the entire desktop workspace.
- Qualified clipped forecast boundaries in the card, table and CSV; distinguished unavailable prediction from no geometric passes.

## Remaining limitations

- SGP4 accuracy decreases away from the TLE epoch, especially after maneuvers or decay. Elements more than three days from simulation time are flagged; this threshold is not an accuracy guarantee. Frozen demo elements grow old and can become unusable.
- Predictions model geometric line of sight. They do not evaluate sunlight, Earth shadow, atmospheric refraction, weather or terrain. An overhead pass does not imply optical visibility. Lighting on the globe is illustrative.
- Legacy numeric TLE supports NORAD IDs through 99999. Six-digit catalog objects need a future OMM/JSON path. The app presents selected catalogs, not every object in orbit.
- The UI displays the first five passes and exports up to eight within the forecast window. Clipped durations and peaks describe only the included interval. Forecasts refresh by simulation minute; positions update by simulation second.
- Observer input is session state and resets on reload. Altitude above sea level is treated as an approximate WGS 84 height. There is no saved mission state or authentication.
- Cache/rate coordination is local to an installation. Multi-instance hosting would need a shared cache and aggregate request limiting. CelesTrak availability remains external; both cached and demo recovery are implemented.
- The full development dependency audit reports **5 high-severity findings** through the matching Next.js ESLint configuration's `fast-glob` → `micromatch` → `braces` chain ([upstream advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)). The latest available braces release is affected; npm's suggested fix downgrades the Next lint configuration across major versions. This unresolved tooling issue is confined to development dependencies; the production dependency audit is clean.

## Run and verify

Use Node.js **22.12+** (22 or 24 LTS recommended; delivery checks used Node 26.8.1).

```sh
npm ci
npm run dev
```

Open **http://localhost:3000**. For production: `npm run build && npm start`.

```sh
npm run check
npm run test:e2e
```

The browser suite uses an existing production build and starts its local server automatically. Installed macOS Chrome is detected; otherwise run `npx playwright install chromium` or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. See [README.md](README.md) for the full guide and architecture.

Implementation and hardening milestones are committed locally. Generated development/test servers were stopped after verification.
