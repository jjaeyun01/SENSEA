import type { LumaFrame } from "./RealtimeFrameProcessor.mjs";
export interface LocalQualityResult {
  kind: "frame_quality";
  status: "usable" | "retake";
  reason: "low_resolution" | "too_dark" | "too_bright" | "low_detail" | null;
  meanLuma: number;
  edgeMean: number;
  sampledPixels: number;
  navigation_safe: false;
}
export function analyzeLumaFrame(
  frame: LumaFrame, context?: { signal?: AbortSignal },
): LocalQualityResult;
