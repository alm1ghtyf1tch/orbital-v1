# Local hand tracking assets

Copyright The MediaPipe Authors / Google LLC. Distributed under the Apache
License, Version 2.0; see `LICENSE-APACHE-2.0.txt`. These assets are unmodified.

The JavaScript and WebAssembly files were copied from the pinned npm package
`@mediapipe/tasks-vision@1.1.1`, whose package metadata specifies `Apache-2.0`.
Only the ES module SIMD build used by ORBITAL is included.

The float16 Hand Landmarker model bundle, version **1**, was downloaded from
Google's [versioned model URL](https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task).
The [official Hand Landmarker overview](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker)
links this bundle and its
[Hand Tracking Lite/Full model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Hand%20Tracking%20%28Lite_Full%29%20with%20Fairness%20Oct%202021.pdf),
which identifies the license as **Apache License, Version 2.0**. The bundle
contains `hand_detector.tflite` and `hand_landmarks_detector.tflite`.
The original library license is available in the
[MediaPipe repository](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE).

Downloaded and verified on 2026-10-20. Byte sizes and SHA-256 checksums:

| File                                    |      Bytes | SHA-256                                                            |
| --------------------------------------- | ---------: | ------------------------------------------------------------------ |
| `hand_landmarker.task`                  |  7,819,105 | `fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1` |
| `wasm/vision_wasm_module_internal.js`   |    334,166 | `539a4386fd12d0723d6e900ec80467d168ba7290dda2f79e77a2181b8e906115` |
| `wasm/vision_wasm_module_internal.wasm` | 13,519,940 | `3b57e4b55ac6346bf940212e3e11250b308a6a474077385e2f527b119cf74525` |

Assets are served by ORBITAL from `/hand-tracking/`. There is no runtime CDN
dependency or API key. Camera access and these downloads begin only when the
user explicitly enables hand control. The model runs on CPU in a dedicated
worker; raw camera frames remain in the browser and are not recorded or uploaded.

MediaPipe 1.1.1 contains a utilization logging implementation. ORBITAL installs a
worker-local network guard **before** importing MediaPipe: worker fetch requests
can only read same-origin `/hand-tracking/` assets using GET. Its native module
loader is restricted to the same local asset directory. Provider logging requests
are rejected; the app does not provide a provider logging API key. This
restriction does not affect satellite catalog networking elsewhere in
the application.

The model's published limitations include poorer tracking under occlusion, low
light, and motion blur. Hand control is optional; pointer and touch controls are
always available. This feature requires a secure context (HTTPS or localhost),
a camera, Worker, OffscreenCanvas, createImageBitmap, and WebAssembly SIMD support.
