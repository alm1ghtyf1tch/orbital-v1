/** Normalized, incremental hand movement; positive Y points down the preview. */
export interface HandMotion {
  rotateX: number;
  rotateY: number;
  zoom: number;
}

/** Mutable mailbox read by the globe's render loop without re-rendering the app. */
export interface HandCameraInput extends HandMotion {
  active: boolean;
  updatedAt: number;
}

export type HandGesture = "none" | "hold" | "rotate" | "zoom";

export interface HandLandmark {
  x: number;
  y: number;
  z: number;
}

export type HandWorkerRequest =
  | { type: "initialize"; origin: string }
  | { type: "frame"; bitmap: ImageBitmap; timestamp: number };

export type HandWorkerResponse =
  | { type: "ready" }
  | { type: "result"; landmarks: HandLandmark[] | null; timestamp: number }
  | { type: "error"; message: string };
