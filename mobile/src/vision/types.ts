import type { CameraPreviewOutput } from "react-native-vision-camera";
export interface Detection {
  classId: number; label: string; score: number;
  box: { top: number; left: number; bottom: number; right: number };
}
export interface LiveResult {
  quality: { status: string; reason: string | null };
  detections: Detection[];
  receivedAt: number;
  processedMs: number;
  navigation_safe: false;
}
export interface NativeSession {
  preview: CameraPreviewOutput;
  start(): Promise<void>;
  pause(): void;
  dispose(): Promise<void>;
}
