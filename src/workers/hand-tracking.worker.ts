import type { HandLandmarker } from "@mediapipe/tasks-vision";
import type { HandWorkerRequest, HandWorkerResponse } from "../lib/hand-types";
import { loadWasmModule } from "./load-wasm";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<HandWorkerRequest>) => void) | null;
  postMessage(message: HandWorkerResponse): void;
  location: Location;
  import?: (url: string) => Promise<unknown>;
};

let landmarker: HandLandmarker | undefined;
let initializing = false;
let failed = false;

function reportError(message: string) {
  if (failed) return;
  failed = true;
  try {
    landmarker?.close();
  } catch {
    /* The runtime also terminates this worker. */
  }
  landmarker = undefined;
  scope.postMessage({ type: "error", message });
}

async function initialize(origin: string) {
  if (initializing || landmarker || failed) return;
  initializing = true;
  try {
    if (origin !== scope.location.origin)
      throw new Error(
        "Hand recognition assets must use the application's origin.",
      );
    const assetRoot = new URL("/hand-tracking/", origin);
    // MediaPipe 1.1.1 contains an optional utilization logger. Restrict all fetch
    // traffic in this dedicated worker to our static, local, read-only assets.
    // This guard is installed before importing or initializing the library.
    const fetchAsset = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (input, init) => {
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        origin,
      );
      const method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      if (
        url.origin !== origin ||
        !url.pathname.startsWith(assetRoot.pathname) ||
        method !== "GET"
      ) {
        return Promise.reject(
          new Error("Hand recognition only loads local static assets."),
        );
      }
      return fetchAsset(input, init);
    };
    // MediaPipe uses this hook for its ES module WASM loader. Keep the local
    // asset import native rather than asking the app bundler to resolve a URL.
    scope.import = (url: string) => {
      const asset = new URL(url, origin);
      if (
        asset.origin !== origin ||
        !asset.pathname.startsWith(assetRoot.pathname)
      ) {
        return Promise.reject(
          new Error("Hand recognition only imports local static assets."),
        );
      }
      return loadWasmModule(asset.href);
    };
    const { FilesetResolver, HandLandmarker } =
      await import("@mediapipe/tasks-vision");
    if (!(await FilesetResolver.isSimdSupported())) {
      throw new Error(
        "Hand control needs WebAssembly SIMD support. Try an up-to-date browser.",
      );
    }
    const vision = await FilesetResolver.forVisionTasks(
      new URL("wasm", assetRoot).href,
      true,
    );
    // Next may bootstrap a bundled worker as a classic script even when its
    // constructor specifies type: "module". MediaPipe then tries importScripts
    // first, which cannot parse this loader's import.meta. Native import works
    // in both worker formats and sets the loader's global ModuleFactory. The
    // empty loader path tells MediaPipe to use that already-loaded factory.
    await scope.import(vision.wasmLoaderPath);
    landmarker = await HandLandmarker.createFromOptions(
      { ...vision, wasmLoaderPath: "" },
      {
        baseOptions: {
          modelAssetPath: new URL("hand_landmarker.task", assetRoot).href,
          delegate: "CPU",
        },
        runningMode: "VIDEO",
        numHands: 1,
        minHandDetectionConfidence: 0.65,
        minHandPresenceConfidence: 0.65,
        minTrackingConfidence: 0.6,
      },
    );
    scope.postMessage({ type: "ready" });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Unknown model error.";
    reportError(`Local hand recognition could not start. ${detail}`);
  } finally {
    initializing = false;
  }
}

scope.onmessage = ({ data }) => {
  if (data.type === "initialize") {
    void initialize(data.origin);
    return;
  }
  if (data.type !== "frame") return;
  try {
    if (!landmarker || failed)
      throw new Error("The hand recognition model is unavailable.");
    const result = landmarker.detectForVideo(data.bitmap, data.timestamp);
    scope.postMessage({
      type: "result",
      landmarks:
        result.landmarks[0]?.map(({ x, y, z }) => ({ x, y, z })) ?? null,
      timestamp: data.timestamp,
    });
  } catch {
    reportError(
      "Hand recognition could not process this camera frame. Enable hand control to retry.",
    );
  } finally {
    // ImageBitmaps are transferred from the main thread; this worker owns them.
    data.bitmap.close();
  }
};
