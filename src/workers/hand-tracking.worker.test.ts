import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HandWorkerRequest } from "../lib/hand-types";

const inference = vi.hoisted(() => ({
  supported: vi.fn(),
  fileset: vi.fn(),
  create: vi.fn(),
  detect: vi.fn(),
  close: vi.fn(),
  loadWasm: vi.fn(),
}));

vi.mock("./load-wasm", () => ({ loadWasmModule: inference.loadWasm }));

vi.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: {
    isSimdSupported: inference.supported,
    forVisionTasks: inference.fileset,
  },
  HandLandmarker: { createFromOptions: inference.create },
}));

async function flush() {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

describe("local hand recognition worker", () => {
  let scope: {
    location: { origin: string };
    postMessage: ReturnType<typeof vi.fn>;
    onmessage: ((event: { data: HandWorkerRequest }) => void) | null;
    import?: (url: string) => Promise<unknown>;
  };
  let nativeFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();
    inference.supported.mockResolvedValue(true);
    inference.fileset.mockResolvedValue({
      wasmLoaderPath:
        "https://orbital.test/hand-tracking/wasm/vision_wasm_module_internal.js",
      wasmBinaryPath:
        "https://orbital.test/hand-tracking/wasm/vision_wasm_module_internal.wasm",
    });
    inference.loadWasm.mockResolvedValue(undefined);
    inference.create.mockResolvedValue({
      detectForVideo: inference.detect,
      close: inference.close,
    });
    inference.detect.mockReturnValue({ landmarks: [] });
    nativeFetch = vi.fn().mockResolvedValue(new Response("asset"));
    scope = {
      location: { origin: "https://orbital.test" },
      postMessage: vi.fn(),
      onmessage: null,
    };
    vi.stubGlobal("self", scope);
    vi.stubGlobal("fetch", nativeFetch);
    await import("./hand-tracking.worker");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function initialize() {
    scope.onmessage!({
      data: { type: "initialize", origin: "https://orbital.test" },
    });
    await flush();
  }

  it("loads the model only on initialize, from local assets, using CPU", async () => {
    expect(inference.create).not.toHaveBeenCalled();
    await initialize();
    expect(inference.fileset).toHaveBeenCalledWith(
      "https://orbital.test/hand-tracking/wasm",
      true,
    );
    expect(inference.loadWasm).toHaveBeenCalledWith(
      "https://orbital.test/hand-tracking/wasm/vision_wasm_module_internal.js",
    );
    expect(inference.create).toHaveBeenCalledWith(
      expect.objectContaining({ wasmLoaderPath: "" }),
      expect.objectContaining({
        baseOptions: {
          delegate: "CPU",
          modelAssetPath:
            "https://orbital.test/hand-tracking/hand_landmarker.task",
        },
        runningMode: "VIDEO",
        numHands: 1,
      }),
    );
    expect(scope.postMessage).toHaveBeenCalledWith({ type: "ready" });
  });

  it("blocks provider logging and external assets before importing the model", async () => {
    await initialize();
    await expect(
      fetch("https://odml.pa.googleapis.com/v1/log", { method: "POST" }),
    ).rejects.toThrow("local static assets");
    await expect(
      fetch("https://orbital.test/hand-tracking/anything", { method: "POST" }),
    ).rejects.toThrow("local static assets");
    await expect(fetch("https://orbital.test/api/catalog")).rejects.toThrow(
      "local static assets",
    );
    await expect(
      scope.import!("https://example.com/loader.js"),
    ).rejects.toThrow("local static assets");
    await fetch("https://orbital.test/hand-tracking/hand_landmarker.task");
    expect(nativeFetch).toHaveBeenCalledTimes(1);
  });

  it("returns finite landmark coordinates and closes the transferred frame", async () => {
    const point = { x: 0.2, y: 0.3, z: -0.1, visibility: 0.99 };
    inference.detect.mockReturnValue({ landmarks: [[point]] });
    await initialize();
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    scope.onmessage!({ data: { type: "frame", bitmap, timestamp: 123 } });
    expect(inference.detect).toHaveBeenCalledWith(bitmap, 123);
    expect(scope.postMessage).toHaveBeenLastCalledWith({
      type: "result",
      landmarks: [{ x: 0.2, y: 0.3, z: -0.1 }],
      timestamp: 123,
    });
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it("reports no hand as null", async () => {
    await initialize();
    scope.onmessage!({
      data: {
        type: "frame",
        bitmap: { close: vi.fn() } as unknown as ImageBitmap,
        timestamp: 1,
      },
    });
    expect(scope.postMessage).toHaveBeenLastCalledWith({
      type: "result",
      landmarks: null,
      timestamp: 1,
    });
  });

  it("closes frame and model on inference failure without repeating errors", async () => {
    inference.detect.mockImplementation(() => {
      throw new Error("WASM failed");
    });
    await initialize();
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    scope.onmessage!({ data: { type: "frame", bitmap, timestamp: 1 } });
    scope.onmessage!({ data: { type: "frame", bitmap, timestamp: 2 } });
    expect(bitmap.close).toHaveBeenCalledTimes(2);
    expect(inference.close).toHaveBeenCalledTimes(1);
    expect(
      scope.postMessage.mock.calls.filter(
        ([message]) => message.type === "error",
      ),
    ).toHaveLength(1);
  });

  it("gives a useful unsupported SIMD error before loading the model", async () => {
    inference.supported.mockResolvedValue(false);
    await initialize();
    expect(inference.create).not.toHaveBeenCalled();
    expect(scope.postMessage).toHaveBeenCalledWith({
      type: "error",
      message: expect.stringContaining("WebAssembly SIMD"),
    });
  });
});
