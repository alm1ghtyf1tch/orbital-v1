import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { startHandTracking } from "./hand-runtime";
import type { HandLandmark, HandWorkerResponse } from "./hand-types";

class FakeTrack extends EventTarget {
  stop = vi.fn();
}

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage?: (event: { data: HandWorkerResponse }) => void;
  onerror?: (event: { preventDefault: () => void }) => void;
  onmessageerror?: () => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    FakeWorker.instances.push(this);
  }
  receive(data: HandWorkerResponse) {
    this.onmessage?.({ data });
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function flush() {
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
}

describe("optional hand tracking resource lifecycle", () => {
  let track: FakeTrack;
  let stream: MediaStream;
  let video: HTMLVideoElement;
  let controller: AbortController;
  let camera: ReturnType<typeof vi.fn>;
  let onError: Mock<(error: Error) => void>;
  let onLandmarks: Mock<
    (landmarks: HandLandmark[] | null, timestamp: number) => void
  >;
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeWorker.instances = [];
    track = new FakeTrack();
    stream = {
      getTracks: () => [track],
      getVideoTracks: () => [track],
    } as unknown as MediaStream;
    video = {
      srcObject: null,
      muted: false,
      playsInline: false,
      readyState: 2,
      currentTime: 1,
      videoWidth: 640,
      videoHeight: 480,
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
    } as unknown as HTMLVideoElement;
    controller = new AbortController();
    camera = vi.fn().mockResolvedValue(stream);
    onError = vi.fn();
    onLandmarks = vi.fn();
    frames = new Map();
    nextFrame = 0;
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: camera } });
    vi.stubGlobal("window", { location: { origin: "http://localhost:3000" } });
    vi.stubGlobal("document", { visibilityState: "visible" });
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("OffscreenCanvas", class {});
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockImplementation(async () => ({ close: vi.fn() })),
    );
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        frames.set(++nextFrame, callback);
        return nextFrame;
      }),
    );
    vi.stubGlobal(
      "cancelAnimationFrame",
      vi.fn((id: number) => {
        frames.delete(id);
      }),
    );
  });

  afterEach(() => {
    controller.abort();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function start() {
    return startHandTracking({
      video,
      onError,
      onLandmarks,
      signal: controller.signal,
    });
  }

  async function ready() {
    const pending = start();
    await flush();
    const worker = FakeWorker.instances[0];
    worker.receive({ type: "ready" });
    return { session: await pending, worker };
  }

  function animate(timestamp: number) {
    const scheduled = [...frames.entries()];
    frames.clear();
    for (const [, callback] of scheduled) callback(timestamp);
  }

  it("does nothing until explicitly started and requests video without audio", async () => {
    expect(camera).not.toHaveBeenCalled();
    expect(FakeWorker.instances).toHaveLength(0);
    const { session, worker } = await ready();
    expect(camera).toHaveBeenCalledWith({
      audio: false,
      video: {
        facingMode: "user",
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
    });
    expect(worker.postMessage).toHaveBeenCalledWith({
      type: "initialize",
      origin: "http://localhost:3000",
    });
    session.stop();
  });

  it("rejects unsupported browsers without asking for camera permission", async () => {
    vi.stubGlobal("OffscreenCanvas", undefined);
    await expect(start()).rejects.toThrow("unavailable in this browser");
    expect(camera).not.toHaveBeenCalled();
  });

  it("rejects insecure contexts without asking for camera permission", async () => {
    vi.stubGlobal("isSecureContext", false);
    await expect(start()).rejects.toThrow("HTTPS or localhost");
    expect(camera).not.toHaveBeenCalled();
  });

  it("explains denied permissions without starting a worker", async () => {
    camera.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    await expect(start()).rejects.toThrow("Camera access was denied");
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it("immediately cancels an unanswered permission prompt and stops a late grant", async () => {
    const permission = deferred<MediaStream>();
    camera.mockReturnValue(permission.promise);
    const pending = start();
    const rejected = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    await rejected;
    permission.resolve(stream);
    await flush();
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBeNull();
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it("stops tracks, preview, animation and worker idempotently", async () => {
    const { session, worker } = await ready();
    session.stop();
    session.stop();
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(video.pause).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBeNull();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
    expect(onError).not.toHaveBeenCalled();
  });

  it("cleans up initialization when the local model times out", async () => {
    const pending = start();
    const rejected = expect(pending).rejects.toThrow("took too long");
    await flush();
    await vi.advanceTimersByTimeAsync(25_000);
    await rejected;
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBeNull();
  });

  it("releases the camera on worker failure during initialization", async () => {
    const pending = start();
    const rejected = expect(pending).rejects.toThrow("Model not found");
    await flush();
    FakeWorker.instances[0].receive({
      type: "error",
      message: "Model not found",
    });
    await rejected;
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports a disconnected camera once and releases resources", async () => {
    const { worker } = await ready();
    track.dispatchEvent(new Event("ended"));
    track.dispatchEvent(new Event("ended"));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toContain("camera disconnected");
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("bounds inference to one frame at a time and skips duplicate video frames", async () => {
    const { session, worker } = await ready();
    animate(100);
    await flush();
    animate(200);
    await flush();
    expect(createImageBitmap).toHaveBeenCalledTimes(1);
    worker.receive({ type: "result", landmarks: null, timestamp: 100 });
    expect(onLandmarks).toHaveBeenCalledWith(null, 100);
    animate(300);
    await flush();
    expect(createImageBitmap).toHaveBeenCalledTimes(1);
    Object.defineProperty(video, "currentTime", {
      value: 2,
      configurable: true,
    });
    animate(400);
    await flush();
    expect(createImageBitmap).toHaveBeenCalledTimes(2);
    session.stop();
  });

  it("closes a frame whose capture completes after stop", async () => {
    const capture = deferred<ImageBitmap>();
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    vi.mocked(createImageBitmap).mockReturnValue(capture.promise);
    const { session, worker } = await ready();
    animate(100);
    await flush();
    session.stop();
    capture.resolve(bitmap);
    await flush();
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
  });

  it("cleans up and reports a synchronous frame-capture failure", async () => {
    vi.mocked(createImageBitmap).mockImplementation(() => {
      throw new Error("Invalid frame");
    });
    const { worker } = await ready();
    animate(100);
    await flush();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("times out a stalled inference and releases the camera", async () => {
    await ready();
    animate(100);
    await flush();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toContain("stopped responding");
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it("keeps a newer preview attached when an older session stops", async () => {
    const { session } = await ready();
    const nextStream = {} as MediaStream;
    video.srcObject = nextStream;
    session.stop();
    expect(video.srcObject).toBe(nextStream);
    expect(video.pause).not.toHaveBeenCalled();
  });
});
