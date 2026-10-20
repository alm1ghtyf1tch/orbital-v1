# Optional hand controls — delivery report

Delivered locally on **20 October 2026**, on **`feat/optional-hand-controls`**.

## Approved version preserved

The approved application is preserved at the annotated tag **`orbital-v1.0.0`**, pointing to commit **`2b53f3d`**. The original **`feat/orbital-mission-control`** branch still points to that commit. Neither reference was moved while adding this feature.

Orbital propagation, pass prediction, catalog retrieval, bundled orbital data, Earth textures, the original screenshots and the original `NIGHT_REPORT.md` are unchanged from the approved version. Regression screenshots for this feature use a separate directory. Nothing was pushed or deployed.

## Using the optional feature

1. Run `npm run dev` and open **http://localhost:3000**.
2. Click the **hand icon** in the globe toolbar. This opens the guide with the camera still off.
3. Click **Enable camera & gestures** and allow your browser's camera permission.
4. Show one hand clearly, with your palm facing the camera. Briefly hold a new gesture before moving.

| Gesture                                      | Action                                                     |
| -------------------------------------------- | ---------------------------------------------------------- |
| Open palm + move                             | Rotate the globe in the direction of the mirrored preview. |
| Thumb/index pinch + move upward or downward  | Zoom in or out.                                            |
| Close/relax the hand, or remove it from view | Hold position.                                             |

The panel shows a mirrored preview, detected hand skeleton and current action. It can be minimized. Mouse, touch and toolbar controls remain available. Direct mouse/touch interaction takes priority over hand movement.

The feature is **off by default**, does not remember activation across reloads, and never requests camera permission merely because the dashboard or panel was opened. **Turn camera off**, closing the panel, hiding the tab or leaving the page releases the session. A browser permission prompt may remain after Cancel; a stream granted later to that canceled request is immediately stopped.

## Implementation and privacy

- Pinned MediaPipe Hand Landmarker **1.1.1**, with an Apache-licensed model and WASM assets bundled locally. No paid service, API key or runtime CDN dependency.
- Recognition runs in a separate CPU worker at up to 15 frames/second, with frames bounded to 640 × 480 and only one frame in flight. First activation loads approximately **20.7 MiB** of local assets.
- Gesture interpretation uses palm-relative geometry, pinch hysteresis, brief pose stabilization, smoothing, deadzones, bounded movement and reacquisition anchors. Lost or stale tracking does not replay accumulated motion.
- The globe reads an imperative input mailbox, avoiding dashboard state updates for every camera frame. Existing globe focus, orbit, zoom and tracking calculations remain in place.
- Video frames remain in the browser. No microphone, recording, frame storage or image upload is used. The worker restricts fetches to local GET requests for hand-tracking assets, blocking the SDK's provider utilization logger. Browser verification observed only local GET requests during real model inference.
- Stop, cancel, failure, revocation and teardown paths release camera tracks, worker, animation callbacks and transferred image buffers. Late permission grants and late bitmap completion are covered by tests.

MediaPipe's ES module WASM loader is preloaded natively before SDK initialization so it works with Next's production worker bootstrap. The shipped model/loader/WASM files are unmodified. See [asset licenses, provenance and checksums](public/hand-tracking/ATTRIBUTION.md).

## Verification

| Check                           | Result                                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------------------------- |
| ESLint                          | Passed without warnings                                                                            |
| TypeScript and route generation | Passed                                                                                             |
| Vitest                          | **113 tests passed in 9 files**: the original 59 plus 54 gesture, camera, runtime and worker tests |
| Next.js production build        | Passed with Turbopack                                                                              |
| Production browser suite        | **19 passed, 1 intentionally skipped**                                                             |
| Production dependency audit     | **0 vulnerabilities**                                                                              |
| Approved baseline comparison    | Core calculations, data, textures and original deliverables unchanged                              |

The real-model check also passed against `next dev`, including positive hand detection and cleanup.

The browser suite retains the original ten desktop/mobile dashboard checks and adds eight camera/gesture lifecycle checks plus one real CPU/WASM model check. The duplicate real-model run is deliberately skipped for the emulated mobile project; the optional UI lifecycle runs on both viewport sizes.

The real-model check uses an animated canvas as its camera source. It first verifies an empty frame, then detects a real open hand from the attributed official MediaPipe reference photograph and reaches the application's **Open palm** state. This exercises the actual worker, model, landmark inference and gesture interpreter. It also verifies that stopping releases the stream and worker. The other lifecycle tests use deterministic worker output to cover pinch recognition, permission denial, canceled requests, stop/restart and closing the panel. **No physical webcam was accessed during development or verification.** Reference-image licensing is recorded in [fixture attribution](e2e/fixtures/ATTRIBUTION.md).

Screenshots are under [artifacts/hand-controls](artifacts/hand-controls/), separate from the approved baseline captures. Run verification with:

```sh
npm run check
PLAYWRIGHT_PORT=3010 npm run test:e2e
```

The alternate test port keeps verification separate from an existing development server. Browser tests use genuine frozen orbital elements rather than repeatedly downloading CelesTrak data.

## Practical limits

- Good lighting, a clearly visible palm and one hand at a time give the most reliable results. Occlusion, motion blur and ambiguous poses can stop or reduce movement.
- HTTPS or localhost and a current browser with camera access, Worker, OffscreenCanvas, createImageBitmap and WebAssembly SIMD are required. Unsupported or denied access affects only this optional tool.
- Verification used Chromium with desktop and emulated mobile viewports. Physical camera ergonomics and Safari/Firefox were not manually tested.
- Very slow devices may exceed the 250 ms tracking freshness interval, causing safe re-anchoring and reduced responsiveness. Mouse and touch remain available.
- The baseline's existing development-only ESLint dependency advisory remains documented in `NIGHT_REPORT.md`; the production audit is clean.
