# ORBITAL

A local satellite mission-control application with an interactive 3D Earth, genuine CelesTrak orbital elements, SGP4 position estimates and observer pass predictions. No paid services, API keys, account or environment variables are required.

## Run locally

Use **Node.js 22.12 or newer**; Node 22 or 24 LTS is recommended. Development for this delivery used Node 26. Install the locked dependencies and start Next.js:

```sh
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Internet access enables CelesTrak updates; bundled genuine elements provide an explicitly labeled demo fallback when the upstream catalog is unavailable. WebGL enables the globe; tracking panels and pass planning remain usable when 3D rendering fails.

For a production server:

```sh
npm run build
npm start
```

## Use the dashboard

- Search by satellite name or NORAD ID. Choose Featured, Space stations, Weather, or Science & exploration. Featured includes the ISS, Hubble, the Chinese space station, Terra and Aqua.
- Drag the globe to orbit the camera and scroll or use the buttons to zoom. Select a satellite from its marker or the catalog, focus the camera on it, and toggle its orbit, ground track, geographic grid or automatic camera rotation.
- Inspect predicted latitude, longitude, altitude, inertial speed, mean orbital period, inclination and element age. The selected orbit shows one revolution in an Earth-fixed frame.
- Pause the mission clock, choose 1×/10×/60×/600× simulation speed, move up to 90 minutes either side of current time, or use **NOW** to return to the current UTC clock. Previewing a pass peak pauses the simulation at that time.
- Edit the ground observer's latitude, longitude and altitude. The default is Astana, Kazakhstan: 51.1694° N, 71.4491° E, approximately 347 m altitude.
- Predict the selected satellite's next 24 hours of geometric passes above 0°, 10° or 20° elevation. The dashboard includes a countdown, elevation curve, peak elevation, start/end azimuths and CSV export with observer, source, element epoch and boundary flags. The table shows the first five events; CSV includes up to eight events within the window.

All displayed pass times are **UTC**. A pass starts and ends at the selected minimum elevation, which is 10° by default. **IN VIEW** can mean that the event started before the forecast window; its displayed start is then the window boundary. **PARTIAL** means the event continues beyond the window; the displayed end is a forecast boundary, not a predicted loss of access. Peak elevation and duration for clipped events describe only the included interval. CSV exports preserve both flags.

## Data and accuracy

Every satellite position and pass is an **approximate orbital prediction, never measured live telemetry**. A catalog entry does not establish that a spacecraft remains operational. An overhead pass is not an optical-visibility forecast: sunlight, Earth shadow, atmospheric refraction, terrain and weather are not evaluated. Earth lighting and atmospheric effects are illustrative.

The source labels distinguish:

| Source      | Meaning                                                                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `celestrak` | Valid orbital elements returned through the CelesTrak fetch path with a recent upstream response date.                                   |
| `cache`     | Retained CelesTrak elements, including normal two-hour caching and last-known-good data after a failed refresh. Failures carry a notice. |
| `demo`      | Frozen, genuine bundled CelesTrak elements used when no successful catalog is available. Demo mode is explicitly disclosed.              |

The server requests only the selected catalog, deduplicates concurrent requests, uses a ten-second timeout and checks TLE checksums, matching catalog IDs, epochs and orbital field ranges. It caches each group's attempts for two hours in accordance with [CelesTrak's usage policy](https://celestrak.org/usage-policy.php). Upstream HTTP errors pause further requests for two hours. Clicking Refresh respects these limits. Next.js's local data cache supplements process memory; normal client data stays loaded until a refresh or catalog change.

Retrieval time and orbital epoch are different. Retained upstream HTTP timestamps are preserved when available; element epochs are never advanced to make data appear fresh. Elements more than three days from simulation time are flagged, but three days is a display threshold, not an accuracy guarantee. Maneuvers, orbital decay and propagation far from the source epoch can produce substantial errors. Invalid or decayed solutions are reported as unavailable.

Bundled snapshots were downloaded on **2026-10-20 UTC** and remain frozen. Exact URLs, retrieval times and raw TLE responses are recorded in [snapshot provenance](src/data/snapshot-provenance.json) and [data documentation](src/data/README.md). Old demo elements can be very inaccurate at today's date. The legacy TLE format used here supports numeric NORAD IDs only through 99999; newly cataloged six-digit objects require a future OMM/JSON implementation.

## Architecture

| Location                        | Responsibility                                                                                                                                        |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app`                       | Next.js App Router entry, global Tailwind styling, and `GET /api/catalog?group=featured\|stations\|weather\|science`. Unknown groups return HTTP 400. |
| `src/lib/catalog.ts`            | TLE parsing and validation, curated Featured selection, upstream caching, provenance and fallback policy.                                             |
| `src/lib/orbits.ts`             | Cached satellite.js propagators, SGP4 positions, WGS 84 geodetic coordinates, Earth-fixed tracks and observer look angles.                            |
| `src/lib/passes.ts`             | Pass discovery, refined elevation crossings and maxima, and explicit ongoing/window-clipped boundaries.                                               |
| `src/lib/clock.ts`, `src/hooks` | Tested simulation-clock transitions, catalog loading and React state integration.                                                                     |
| `src/components`                | Mission-control UI, client-loaded React Three Fiber/Three.js globe, camera behavior and WebGL error fallback.                                         |
| `src/data`, `public/textures`   | Bundled orbital snapshots and local NASA Blue Marble texture, with provenance and attribution.                                                        |
| `src/**/*.test.ts`, `e2e`       | Vitest numerical/application tests and Playwright desktop/mobile browser scenarios.                                                                   |

The stack is Next.js 16, React 19, TypeScript, Tailwind CSS 4, Three.js with React Three Fiber/Drei, satellite.js 6 and Vitest 5. Exact installed versions are locked in `package-lock.json`.

Positions and forecasts are computed locally in the browser as simulation time advances. Only orbital-catalog retrieval uses the server. There is no database, authentication or saved mission state: observer settings and selections reset on reload. Cache state is local to each running installation, with no shared backing across instances; a multi-instance installation would need shared caching/rate coordination to maintain an aggregate upstream request limit.

## Verification

Run all required checks:

```sh
npm run check
```

Individual commands are `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`; `npm run test:watch` supports iterative work. Vitest covers published SGP4 reference vectors, independent coordinate geometry, pass predictions against dense reference sampling, clipping/grazing cases, malformed and decayed elements, catalog failures/caching, clock transitions and camera behavior. See `NIGHT_REPORT.md` for the delivery's actual verification results and remaining limitations.

Optional browser checks run against a production build:

```sh
npm run build && npm run test:e2e
```

Playwright automatically uses `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` when available on macOS. Otherwise install its Chromium browser with `npx playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to a compatible executable. The configuration starts the local production server on port 3000 and can reuse an existing server outside CI. Browser scenarios use frozen genuine elements and a fixed clock, avoiding additional CelesTrak downloads. The main browser scenario saves desktop/mobile captures under `artifacts/`; Playwright retains failure traces/screenshots under `test-results/`.

## Credits

Orbital data: [CelesTrak GP data](https://celestrak.org/NORAD/documentation/gp-data-formats.php). Propagation: [satellite.js](https://github.com/shashwatak/satellite-js). Earth imagery: NASA Goddard Space Flight Center / NASA Earth Observatory, [Blue Marble](https://visibleearth.nasa.gov/collection/1484/blue-marble); the local texture is a historical geographic composite, not current weather imagery. See [texture attribution](public/textures/ATTRIBUTION.md) for the exact image source and NASA usage guidance.
