export interface Photo {
  uri: string;
  mimeType?: "image/jpeg" | "image/png" | "image/webp";
}
export interface DescribeRequest {
  photo: Photo;
  requestId: string;
  expectedPlace?: string;
  signal: AbortSignal;
}
interface ResultBase {
  request_id: string;
  navigation_safe: false;
}
export interface DescribedResult extends ResultBase {
  status: "described";
  quality: { status: "usable"; reason: null; guidance: null };
  description: string;
  recognized_text: string[];
  uncertainty: "low" | "medium" | "high";
  roadway: "detected" | "not_detected" | "uncertain";
  sidewalk: "detected" | "not_detected" | "uncertain";
}
export interface RetakeResult extends ResultBase {
  status: "retake";
  quality: {
    status: "retake";
    reason: "low_resolution" | "too_dark" | "too_bright" | "low_detail";
    guidance: string;
  };
}
export type VisionResult = DescribedResult | RetakeResult;
export class VisionRequestError extends Error {
  code: string;
  constructor(code: string, message: string);
}
export class LatestVisionController {
  constructor(options: {
    capture: () => Promise<Photo>;
    describe: (request: DescribeRequest) => Promise<unknown>;
    stopSpeech: () => Promise<void> | void;
    speak: (text: string) => void;
    makeRequestId: () => string;
    onResult?: (result: VisionResult) => void;
    onError?: (error: unknown) => void;
    now?: () => number;
    maxResultAgeMs?: number;
  });
  setStationary(value: boolean): Promise<void>;
  request(options?: { expectedPlace?: string }): Promise<VisionResult | null>;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
}
