export interface LumaFrame {
  data: Uint8Array;
  width: number;
  height: number;
  rowStride?: number;
  /** Monotonic milliseconds in the same clock domain as the processor's now(). */
  capturedAt: number;
  /** Synchronous cleanup; each new lease is submitted once. */
  release(): void;
}
export interface FrameStats {
  received: number; analyzed: number; delivered: number; dropped: number;
  released: number; errors: number; timeouts: number;
  peakRetainedFrames: number; peakRetainedBytes: number;
  inFlight: number; pending: number; retainedFrames: number; retainedBytes: number;
  enabled: boolean;
}
export class RealtimeFrameProcessor<Result = unknown> {
  constructor(options: {
    analyze: (frame: LumaFrame, context: { signal: AbortSignal }) => Result | Promise<Result>;
    onResult?: (result: Result, timing: { capturedAt: number; ageMs: number }) => void;
    onError?: (error: unknown) => void;
    minIntervalMs?: number;
    maxResultAgeMs?: number;
    analysisTimeoutMs?: number;
    maxFrameBytes?: number;
    now?: () => number;
    schedule?: (callback: () => void, delay: number) => unknown;
    unschedule?: (timer: unknown) => void;
  });
  start(): void;
  pause(): void;
  dispose(): void;
  offer(frame: LumaFrame): boolean;
  getStats(): FrameStats;
}
