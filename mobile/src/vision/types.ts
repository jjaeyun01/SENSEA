import type { CameraPreviewOutput } from "react-native-vision-camera";
export interface Detection {
  classId: number; label: string; score: number;
  /** Weaker close-looking candidate, excluded from ordinary automatic descriptions. */
  nearCandidate?: boolean;
  box: { top: number; left: number; bottom: number; right: number };
}
export interface LiveResult {
  quality: { status: string; reason: string | null };
  detections: Detection[];
  imageSize?: { width: number; height: number };
  receivedAt: number;
  processedMs: number;
  navigation_safe: false;
}
export interface NativeSession {
  preview: CameraPreviewOutput;
  start(): Promise<void>;
  startAnalysis(): Promise<void>;
  pause(): void;
  dispose(): Promise<void>;
}

export interface HazardObservation {
  trackId: number;
  label: string;
  direction: "left" | "center" | "right";
  level: "notice" | "caution" | "priority";
  box: Detection["box"];
  kind: "dynamic" | "static" | "elevation" | "overhead";
  mobility: "dynamic_capable" | "usually_static";
  screenRelation: "direct" | "offset" | "side" | "unknown";
  pathInterference: "unknown";
  distance: "unknown";
  distanceMeters: null;
  imageScale: "large" | "medium" | "small";
  motion: "toward_center" | "growing" | "lateral" | "unresolved";
  /** Relative ordering of image cues, not a collision probability. */
  priorityScore: number;
  reasons: string[];
}
export interface HazardAssessment {
  status: "unavailable" | "observing" | "notice" | "caution" | "priority";
  summary: string;
  confirmedCount: number;
  warningCount: number;
  action: "check_priority" | "check_surroundings" | "observe" | "unavailable";
  guidance: string;
  hazards: HazardObservation[];
  observedAt: number;
  navigation_safe: false;
}

export interface UrbanResult {
 generation:number; receivedAt:number; processedMs:number; quality:"usable"|"retake";
 imageSize:{width:number;height:number};
 detections:Array<{label:string;score:number;box:Detection["box"];source:"owlvit";level?:string}>;
 texts:Array<{text:string;box:Detection["box"]}>;
 heading?:number; headingAt:number; headingAccuracy:number;
}
