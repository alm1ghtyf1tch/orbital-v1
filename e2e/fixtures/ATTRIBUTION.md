# Hand recognition test fixture

`hand-reference.jpg` is an unmodified copy of the test image distributed by the
official [MediaPipe Hand Landmarker sample notebook](https://github.com/google-ai-edge/mediapipe-samples/blob/main/examples/hand_landmarker/python/hand_landmarker.ipynb).
The notebook attributes the photograph to
[Unsplash photo `mt2fyrdXxzk`](https://unsplash.com/photos/mt2fyrdXxzk).
The original photographer retains copyright. The notebook's Apache license
applies to its code; the photograph is used under the
[Unsplash License](https://unsplash.com/license), which permits downloading,
copying, modifying, distributing, and using Unsplash photographs, including
commercial use. This notice does not relicense the photograph as Apache or as
ORBITAL code. No identity or endorsement of the depicted person is claimed.

- Download: <https://storage.googleapis.com/mediapipe-tasks/hand_landmarker/woman_hands.jpg>
- Retrieved: 2026-10-20
- Dimensions: 640 × 960 pixels
- Bytes: 67,719
- SHA-256: `70cbeb38e198c9862202e0979c21a99b40ca980d3e7b250176c85b1636a40f12`

This fixture is used only by automated tests to verify positive hand landmark
inference. Tests may draw the image into an animated canvas and capture that
canvas as a synthetic video stream. They never open a physical camera. The image
is outside `public/` and is not a product asset or a recorded user camera frame.
Tests should load it locally to keep inference verification independent of an
external image service.
