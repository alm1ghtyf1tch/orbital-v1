"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  CameraOff,
  Check,
  ChevronDown,
  ChevronUp,
  Hand,
  LoaderCircle,
  LockKeyhole,
  Move,
  MoveVertical,
  X,
} from "lucide-react";
import { createHandGestureTracker } from "@/lib/hand-gestures";
import type { HandMotion, HandGesture, HandLandmark } from "@/lib/hand-types";

const GESTURE_LABELS: Record<HandGesture, string> = {
  none: "Show one hand to the camera",
  hold: "Hand relaxed · holding position",
  rotate: "Open palm · move to orbit",
  zoom: "Pinch · move up or down to zoom",
};

const CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
];

function drawLandmarks(
  canvas: HTMLCanvasElement | null,
  video: HTMLVideoElement | null,
  landmarks: HandLandmark[] | null,
  gesture: HandGesture,
) {
  if (!canvas) return;
  const width = video?.videoWidth || 640;
  const height = video?.videoHeight || 480;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (
    !landmarks ||
    landmarks.length !== 21 ||
    landmarks.some(
      (point) => !Number.isFinite(point.x) || !Number.isFinite(point.y),
    )
  )
    return;
  const color =
    gesture === "zoom"
      ? "#e7bc80"
      : gesture === "rotate"
        ? "#8ee6ef"
        : "#90a6b9";
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = Math.max(1, canvas.width / 280);
  context.beginPath();
  for (const [a, b] of CONNECTIONS) {
    context.moveTo(
      landmarks[a].x * canvas.width,
      landmarks[a].y * canvas.height,
    );
    context.lineTo(
      landmarks[b].x * canvas.width,
      landmarks[b].y * canvas.height,
    );
  }
  context.stroke();
  for (const point of landmarks) {
    context.beginPath();
    context.arc(
      point.x * canvas.width,
      point.y * canvas.height,
      canvas.width / 160,
      0,
      Math.PI * 2,
    );
    context.fill();
  }
}

function cameraErrorMessage(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError")
    return "Camera permission was denied. Allow camera access in your browser, then try again. Mouse and touch controls are ready.";
  if (name === "NotFoundError" || name === "DevicesNotFoundError")
    return "No camera was found. Connect a camera to use hand controls.";
  if (name === "NotReadableError" || name === "TrackStartError")
    return "The camera is busy or unavailable. Close other camera apps, then try again.";
  if (name === "SecurityError")
    return "Camera access needs HTTPS or localhost. Open this app in a secure browser context.";
  return error instanceof Error
    ? error.message
    : "Hand controls could not start. Your regular globe controls are still available.";
}

export default function HandControls({
  onMotion,
  onActive,
  onClose,
}: {
  onMotion: (motion: HandMotion) => void;
  onActive: (active: boolean) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<{ stop(): void } | null>(null);
  const trackerRef = useRef<ReturnType<typeof createHandGestureTracker> | null>(
    null,
  );
  const [status, setStatus] = useState<"off" | "starting" | "active" | "error">(
    "off",
  );
  const [gesture, setGesture] = useState<HandGesture>("none");
  const [message, setMessage] = useState("");
  const [minimized, setMinimized] = useState(false);

  const release = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    sessionRef.current?.stop();
    sessionRef.current = null;
    trackerRef.current?.reset();
    onActive(false);
  }, [onActive]);

  const stop = useCallback(
    (notice = "") => {
      release();
      setStatus("off");
      setGesture("none");
      setMessage(notice);
      setMinimized(false);
      drawLandmarks(canvasRef.current, videoRef.current, null, "none");
    },
    [release],
  );

  useEffect(() => {
    const hide = () => {
      if (document.visibilityState === "hidden" && controllerRef.current)
        stop(
          "Camera stopped while this tab was hidden. Enable it again when you’re ready.",
        );
    };
    const leave = () => {
      if (controllerRef.current)
        stop(
          "Camera stopped when you left this page. Enable it again when you’re ready.",
        );
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", leave);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", leave);
      release();
    };
  }, [release, stop]);

  const start = async () => {
    release();
    setStatus("starting");
    setMessage("");
    setGesture("none");
    const controller = new AbortController();
    controllerRef.current = controller;
    trackerRef.current = createHandGestureTracker();
    const fail = (error: unknown) => {
      if (controller.signal.aborted || controllerRef.current !== controller)
        return;
      release();
      setStatus("error");
      setMessage(cameraErrorMessage(error));
      setMinimized(false);
    };
    try {
      const { startHandTracking } = await import("@/lib/hand-runtime");
      if (controller.signal.aborted || !videoRef.current) return;
      const session = await startHandTracking({
        video: videoRef.current,
        signal: controller.signal,
        onLandmarks: (landmarks, timestamp) => {
          if (
            controller.signal.aborted ||
            controllerRef.current !== controller ||
            !trackerRef.current
          )
            return;
          const result = trackerRef.current.update(landmarks, timestamp);
          onMotion(result.motion);
          setGesture((current) =>
            current === result.gesture ? current : result.gesture,
          );
          drawLandmarks(
            canvasRef.current,
            videoRef.current,
            landmarks,
            result.gesture,
          );
        },
        onError: fail,
      });
      if (controller.signal.aborted || controllerRef.current !== controller) {
        session.stop();
        return;
      }
      sessionRef.current = session;
      onActive(true);
      setStatus("active");
    } catch (error) {
      fail(error);
    }
  };

  const active = status === "active";
  return (
    <section
      id="hand-controls-panel"
      className={`hand-panel ${active ? "hand-panel-active" : ""} ${minimized ? "hand-panel-mini" : ""}`}
      aria-labelledby="hand-controls-title"
    >
      <div className="hand-panel-heading">
        <h3 id="hand-controls-title">
          <Hand size={14} /> Hand controls <span>OPTIONAL</span>
        </h3>
        <div>
          {active && (
            <button
              className="icon-button"
              aria-label={
                minimized
                  ? "Expand hand controls panel"
                  : "Minimize hand controls panel"
              }
              onClick={() => setMinimized(!minimized)}
            >
              {minimized ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
          )}
          <button
            className="icon-button"
            aria-label="Close hand controls and stop camera"
            onClick={() => {
              release();
              onClose();
            }}
          >
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="hand-panel-content">
        <div className={`hand-preview ${active ? "is-streaming" : ""}`}>
          <video
            ref={videoRef}
            muted
            playsInline
            autoPlay
            aria-label="Mirrored camera preview for hand controls"
          />
          <canvas ref={canvasRef} aria-hidden="true" />
          {!active && (
            <div className="hand-preview-placeholder">
              {status === "starting" ? (
                <>
                  <LoaderCircle size={24} className="spin" />
                  <span>Starting camera & hand tracking…</span>
                  <small>You can cancel at any time.</small>
                </>
              ) : (
                <>
                  <CameraOff size={25} strokeWidth={1.2} />
                  <span>Your camera is off</span>
                </>
              )}
            </div>
          )}
          {active && (
            <span className="hand-camera-badge">
              <i className="status-dot" /> CAMERA ON
            </span>
          )}
        </div>
        <div className="hand-live-status" role="status" aria-live="polite">
          {active ? (
            <>
              <i
                className={`status-dot ${gesture === "none" ? "inactive" : ""}`}
              />
              {GESTURE_LABELS[gesture]}
            </>
          ) : status === "error" ? (
            "Hand controls unavailable"
          ) : status === "starting" ? (
            "Waiting for permission and model readiness"
          ) : (
            "Start when you’re ready"
          )}
        </div>
        {!minimized && (
          <>
            <div className="hand-gesture-guide">
              <div>
                <Hand size={14} />
                <span>
                  <strong>Open palm + move</strong>Rotate the globe
                </span>
              </div>
              <div>
                <MoveVertical size={14} />
                <span>
                  <strong>Pinch + move up / down</strong>Zoom in / out
                </span>
              </div>
              <div>
                <Move size={13} />
                <span>
                  <strong>Close or relax your hand</strong>Hold position
                </span>
              </div>
            </div>
            <p className="hand-privacy">
              <LockKeyhole size={11} />
              <span>
                Camera frames stay on your device. No recording. Mouse and touch
                always work.
              </span>
            </p>
          </>
        )}
        {message && (
          <p
            className={`hand-message ${status === "error" ? "hand-error" : ""}`}
            role={status === "error" ? "alert" : undefined}
          >
            {message}
          </p>
        )}
      </div>
      <div className="hand-panel-actions">
        {active || status === "starting" ? (
          <button className="quiet-button" onClick={() => stop()}>
            <CameraOff size={13} />
            {status === "starting" ? "Cancel & stop camera" : "Turn camera off"}
          </button>
        ) : (
          <button className="primary-button" onClick={() => void start()}>
            <Camera size={13} />
            {status === "error"
              ? "Try camera again"
              : "Enable camera & gestures"}
          </button>
        )}
        {active && !minimized && (
          <span>
            <Check size={11} /> Local processing
          </span>
        )}
      </div>
    </section>
  );
}
