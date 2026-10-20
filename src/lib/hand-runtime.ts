import type {
  HandLandmark,
  HandWorkerRequest,
  HandWorkerResponse,
} from "./hand-types";

interface HandTrackingOptions {
  video: HTMLVideoElement;
  onLandmarks: (landmarks: HandLandmark[] | null, timestamp: number) => void;
  onError: (error: Error) => void;
  signal: AbortSignal;
}

const FRAME_INTERVAL = 1_000 / 15;
const INITIALIZATION_TIMEOUT = 25_000;
const FRAME_TIMEOUT = 10_000;

function abortError() {
  return new DOMException("Hand control was stopped.", "AbortError");
}

function cameraError(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return new Error(
      "Camera access was denied. Allow camera access in your browser, then try again.",
    );
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return new Error(
      "No camera was found. Connect a camera to use hand control.",
    );
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return new Error(
      "The camera is busy or unavailable. Close other apps using it, then try again.",
    );
  }
  return new Error(
    "The camera could not start. Check your camera and browser permissions.",
  );
}

/**
 * Called only after the user enables hand control. Importing this module does
 * not request a camera, start a worker, or download the recognition model.
 */
export async function startHandTracking({
  video,
  onLandmarks,
  onError,
  signal,
}: HandTrackingOptions): Promise<{ stop(): void }> {
  if (signal.aborted) throw abortError();
  if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("Hand control needs camera access on HTTPS or localhost.");
  }
  if (
    typeof Worker === "undefined" ||
    typeof createImageBitmap !== "function" ||
    typeof OffscreenCanvas === "undefined" ||
    typeof WebAssembly === "undefined"
  ) {
    throw new Error(
      "Hand control is unavailable in this browser. Try a current version of Chrome, Edge, Firefox, or Safari.",
    );
  }

  let stopped = false;
  let started = false;
  let stream: MediaStream | undefined;
  let worker: Worker | undefined;
  let animationFrame: number | undefined;
  let stageTimeout: ReturnType<typeof setTimeout> | undefined;
  let frameTimeout: ReturnType<typeof setTimeout> | undefined;
  let framePending = false;
  let lastCapture = -Infinity;
  let lastVideoTime = -1;
  const tracks: MediaStreamTrack[] = [];

  let rejectStartup!: (reason: Error) => void;
  const startupFailure = new Promise<never>((_, reject) => {
    rejectStartup = reject;
  });

  function stop() {
    if (stopped) return;
    stopped = true;
    signal.removeEventListener("abort", onAbort);
    if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
    clearTimeout(stageTimeout);
    clearTimeout(frameTimeout);
    for (const track of tracks)
      track.removeEventListener("ended", onTrackEnded);
    for (const track of stream?.getTracks() ?? []) track.stop();
    worker?.terminate();
    // An older, cancelled session must not detach a newer session's preview.
    if (stream && video.srcObject === stream) {
      video.pause();
      video.srcObject = null;
    }
  }

  function fail(error: Error) {
    if (stopped) return;
    stop();
    if (started) onError(error);
    else rejectStartup(error);
  }

  function onAbort() {
    stop();
    rejectStartup(abortError());
  }

  function onTrackEnded() {
    fail(
      new Error(
        "The camera disconnected or camera access was revoked. Enable hand control to reconnect.",
      ),
    );
  }

  signal.addEventListener("abort", onAbort, { once: true });

  function timeout(message: string, duration: number) {
    return new Promise<never>((_, reject) => {
      stageTimeout = setTimeout(() => reject(new Error(message)), duration);
    });
  }

  function capture(timestamp: number) {
    if (stopped) return;
    animationFrame = requestAnimationFrame(capture);
    if (
      document.visibilityState === "hidden" ||
      framePending ||
      timestamp - lastCapture < FRAME_INTERVAL ||
      video.readyState < 2 ||
      video.currentTime === lastVideoTime ||
      !video.videoWidth ||
      !video.videoHeight
    )
      return;

    framePending = true;
    lastCapture = timestamp;
    lastVideoTime = video.currentTime;
    const scale = Math.min(1, 640 / video.videoWidth, 480 / video.videoHeight);
    // Keep just one bounded-size frame in flight; never build a frame queue.
    frameTimeout = setTimeout(() => {
      fail(
        new Error(
          "Hand recognition stopped responding. Enable hand control to try again.",
        ),
      );
    }, FRAME_TIMEOUT);
    Promise.resolve()
      .then(() =>
        createImageBitmap(video, {
          resizeWidth: Math.max(1, Math.round(video.videoWidth * scale)),
          resizeHeight: Math.max(1, Math.round(video.videoHeight * scale)),
          resizeQuality: "low",
        }),
      )
      .then((bitmap) => {
        if (stopped) {
          bitmap.close();
          return;
        }
        try {
          const message: HandWorkerRequest = {
            type: "frame",
            bitmap,
            timestamp,
          };
          worker!.postMessage(message, [bitmap]);
        } catch {
          bitmap.close();
          fail(
            new Error(
              "The camera frame could not be processed. Enable hand control to try again.",
            ),
          );
        }
      })
      .catch(() => {
        fail(
          new Error(
            "The camera frame could not be read. Enable hand control to try again.",
          ),
        );
      });
  }

  try {
    const camera = navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
      })
      .catch((error: unknown) => {
        throw cameraError(error);
      });
    // getUserMedia cannot be aborted. Release a late permission grant even when
    // the user already disabled the feature or navigated away.
    void camera.then(
      (lateStream) => {
        if (stopped) for (const track of lateStream.getTracks()) track.stop();
      },
      () => {},
    );
    stream = await Promise.race([camera, startupFailure]);
    if (stopped) throw abortError();
    tracks.push(...stream.getVideoTracks());
    for (const track of tracks) track.addEventListener("ended", onTrackEnded);
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await Promise.race([
      video.play(),
      startupFailure,
      timeout(
        "The camera preview did not start. Enable hand control to try again.",
        10_000,
      ),
    ]);
    clearTimeout(stageTimeout);
    if (stopped) throw abortError();

    worker = new Worker(
      new URL("../workers/hand-tracking.worker.ts", import.meta.url),
      {
        type: "module",
        name: "orbital-hand-tracking",
      },
    );
    const ready = new Promise<void>((resolve) => {
      worker!.onmessage = ({ data }: MessageEvent<HandWorkerResponse>) => {
        if (stopped) return;
        if (data.type === "ready") resolve();
        if (data.type === "error") fail(new Error(data.message));
        if (data.type === "result") {
          clearTimeout(frameTimeout);
          framePending = false;
          onLandmarks(data.landmarks, data.timestamp);
        }
      };
      worker!.onerror = (event) => {
        event.preventDefault();
        fail(
          new Error(
            "The hand recognition worker could not start or stopped unexpectedly. Enable hand control to retry.",
          ),
        );
      };
      worker!.onmessageerror = () => {
        fail(
          new Error(
            "Hand recognition could not communicate with the globe. Enable hand control to retry.",
          ),
        );
      };
    });
    const initialize: HandWorkerRequest = {
      type: "initialize",
      origin: window.location.origin,
    };
    worker.postMessage(initialize);
    await Promise.race([
      ready,
      startupFailure,
      timeout(
        "The local hand recognition model took too long to load. Enable hand control to retry.",
        INITIALIZATION_TIMEOUT,
      ),
    ]);
    clearTimeout(stageTimeout);
    if (stopped) throw abortError();
    started = true;
    animationFrame = requestAnimationFrame(capture);
    return { stop };
  } catch (error) {
    stop();
    throw error instanceof Error
      ? error
      : new Error("Hand control could not start. Enable it to try again.");
  }
}
