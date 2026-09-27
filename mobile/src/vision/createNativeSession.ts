import { Platform } from "react-native";
import { Asset } from "expo-asset";
import { loadTensorflowModel, type TfliteModel } from "react-native-fast-tflite";
import { VisionCamera, type CameraPreviewOutput } from "react-native-vision-camera";
import { createResizer, isResizerAvailable, type Resizer } from "react-native-vision-camera-resizer";
import { createWorkletRuntimeForThread } from "react-native-vision-camera-worklets";
import { createSynchronizable, scheduleOnRN, scheduleOnRuntime } from "react-native-worklets";
import labels from "../../assets/models/labels.json";
import { analyzeOwnedFrame, isFreshResult } from "./detection.mjs";
import type { LiveResult, NativeSession } from "./types";

let occupied = false;
let cameraPromise: ReturnType<typeof VisionCamera.createCameraSession> | undefined;

/** Preview owns startup. No model, GPU converter or worklet is required to open it. */
export async function createNativeSession(
  onResult: (result: LiveResult) => void,
  onError: (message: string) => void,
  onAnalysisError: (message: string) => void,
): Promise<NativeSession> {
  if (occupied) throw new Error("이전 카메라를 정리하고 있습니다. 잠시 후 다시 시도해 주세요.");
  occupied = true;
  let preview: CameraPreviewOutput | undefined;
  try {
    cameraPromise ??= VisionCamera.createCameraSession(false);
    const camera = await cameraPromise;
    preview = VisionCamera.createPreviewOutput();
    preview.outputOrientation = "up";
    const previewOutput = preview;
    let stopped = false;
    let closing: Promise<void> | undefined;
    let starting: Promise<void> | undefined;
    let analysisStarting: Promise<void> | undefined;
    let model: TfliteModel | undefined;
    let converter: Resizer | undefined;
    let pipeline: ReturnType<typeof getFramePipeline> | undefined;
    let active: ReturnType<typeof createSynchronizable<boolean>> | undefined;
    let cleanupFailed = false;
    let hardwareReleaseFailed = false;
    const errors = camera.addOnErrorListener(() => {
      if (!stopped) onError("카메라 연결에 실패했습니다. 다른 앱에서 카메라를 사용 중인지 확인해 주세요.");
    });
    const interruptions = camera.addOnInterruptionStartedListener(() => {
      if (!stopped) onError("카메라가 일시 중단되었습니다. 다시 켜 주세요.");
    });
    const configurePreview = () => camera.configure([{
      input: "back", outputs: [{ output: previewOutput, mirrorMode: "off" }], constraints: [],
    }]);

    const releaseAnalysis = async () => {
      active?.setBlocking(false);
      // Detach the worklet first, then dispose each Nitro object exactly once
      // from its creating runtime. Nitro dispose clears wrapper caches across
      // runtimes; disposing again through another wrapper can target invalid state.
      const detector = model, resizer = converter;
      model = undefined;
      converter = undefined;
      let failure: unknown;
      if (pipeline) {
        const { frameOutput, runtime } = pipeline;
        try {
          await new Promise<void>((resolve, reject) => {
            const complete = (reason: string | undefined) => reason ? reject(new Error(reason)) : resolve();
            scheduleOnRuntime(runtime, () => {
              "worklet";
              let reason: string | undefined;
              try { frameOutput.setOnFrameCallback(undefined); }
              catch (error) { reason = error instanceof Error ? error.message : "Frame callback cleanup failed"; }
              scheduleOnRN(complete, reason);
            });
          });
        } catch (error) { failure = error; }
      }
      for (const resource of [resizer, detector]) {
        try { resource?.dispose(); }
        catch (error) { failure ??= error; }
      }
      if (failure) throw failure;
    };

    const prepareAnalysis = async () => {
      // Called only after onPreviewStarted confirms that the user sees camera frames.
      let stage = "model asset";
      const useCpuRgb = Platform.OS === "android";
      try {
        await starting;
        if (stopped) return;
        if (!useCpuRgb && !isResizerAvailable()) {
          onAnalysisError("이 기기는 현재 사물 분석 방식을 지원하지 않습니다. 실시간 카메라 화면은 사용할 수 있습니다.");
          return;
        }
        // Android release require() resolves to a raw resource name, but
        // fast-tflite 3's Android loader accepts URLs only. Materialize the
        // bundled public model locally; this does not store camera images.
        const asset = Asset.fromModule(require("../../assets/models/efficientdet-lite0.tflite"));
        await asset.downloadAsync();
        if (stopped) return;
        if (!asset.localUri?.startsWith("file://")) throw new Error("No local model asset");
        stage = "model load";
        model = await loadTensorflowModel({ url: asset.localUri }, []);
        if (stopped) return;
        const input = model.inputs[0];
        if (model.inputs.length !== 1 || input.dataType !== "uint8" ||
            input.shape.join(",") !== "1,320,320,3" || model.outputs.length !== 4 ||
            model.outputs.some(tensor => tensor.dataType !== "float32")) {
          throw new Error("Invalid model contract");
        }
        console.info("[SENSEA] Local model ready");
        stage = "frame converter";
        if (!useCpuRgb) {
          converter = await createResizer({
            width: 320, height: 320, channelOrder: "rgb", dataType: "uint8",
            scaleMode: "contain", pixelLayout: "interleaved",
          });
        }
        if (stopped) return;
        stage = "frame runtime";
        pipeline = getFramePipeline();
        const { frameOutput, runtime } = pipeline;
        const detector = model, resizer = converter;
        const enabled = createSynchronizable(true);
        active = enabled;
        const pending = createSynchronizable(false);
        let inferenceReported = false;
        const deliver = (result: LiveResult) => {
          try {
            if (!stopped && enabled.getBlocking() && isFreshResult(result, Date.now())) {
              if (result.quality.status === "usable" && !inferenceReported) {
                inferenceReported = true;
                console.info("[SENSEA] First frame inference ready", { detections: result.detections.length, labels: result.detections.slice(0, 3).map(item => item.label) });
              }
              onResult(result);
            }
          } finally { pending.setBlocking(false); }
        };
        const reportTiming = (milliseconds: number, quality: string, preprocessingMs: number, inferenceMs: number) => {
          console.info("[SENSEA] First frame processing", Math.round(milliseconds), quality,
            { preprocessingMs: Math.round(preprocessingMs), inferenceMs: Math.round(inferenceMs) });
        };
        const failAnalysis = (reason: string) => {
          console.warn("[SENSEA] Frame analysis stopped", reason);
          if (!stopped) onAnalysisError("사물 분석을 중지했습니다. 실시간 카메라 화면은 계속 표시합니다.");
        };
        await new Promise<void>((resolve, reject) => {
          scheduleOnRuntime(runtime, () => {
            "worklet";
            try {
              // One model-sized buffer per session; camera pixels never cross to RN.
              const cpuRgbBuffer = useCpuRgb ? new Uint8Array(320 * 320 * 3) : undefined;
              let lastStartedAt = -Infinity;
              let timingReported = false;
              let consecutiveDeadlineMisses = 0;
              frameOutput.setOnFrameCallback(frame => {
                const now = performance.now(), receivedAt = Date.now();
                const shouldAnalyze = enabled.getBlocking() && !pending.getBlocking() && now - lastStartedAt >= 200;
                if (shouldAnalyze) lastStartedAt = now;
                try {
                  const result = analyzeOwnedFrame(frame, resizer, detector, labels, shouldAnalyze, cpuRgbBuffer);
                  if (result && !timingReported) {
                    timingReported = true;
                    scheduleOnRN(reportTiming, performance.now() - now, result.quality.status, result.preprocessingMs, result.inferenceMs);
                  }
                  if (result && enabled.getBlocking()) {
                    if (Date.now() - receivedAt > 1000) {
                      // Allow a slow warmup, but do not leave analysis preparing forever
                      // on a device that cannot produce results within the freshness limit.
                      consecutiveDeadlineMisses++;
                      if (consecutiveDeadlineMisses >= 3) {
                        enabled.setBlocking(false);
                        scheduleOnRN(failAnalysis, "Frame processing deadline exceeded");
                      }
                    } else {
                      consecutiveDeadlineMisses = 0;
                      pending.setBlocking(true);
                      scheduleOnRN(deliver, { ...result, receivedAt, processedMs: performance.now() - now, navigation_safe: false });
                    }
                  }
                } catch (error) {
                  enabled.setBlocking(false);
                  // One bounded diagnostic, no pixels or frame references cross runtimes.
                  const reason = error instanceof Error ? error.message.slice(0, 240) : "Native frame error";
                  scheduleOnRN(failAnalysis, reason);
                }
                return true;
              });
              scheduleOnRN(resolve);
            } catch { scheduleOnRN(reject, new Error("Cannot initialize frame processing")); }
          });
        });
        if (stopped) return;
        stage = "analysis output";
        await camera.configure([{
          input: "back",
          outputs: [{ output: previewOutput, mirrorMode: "off" }, { output: frameOutput, mirrorMode: "off" }],
          constraints: [{ resolutionBias: frameOutput }],
        }]);
      } catch (error) {
        console.warn(`[SENSEA] Analysis initialization failed at ${stage}`, error instanceof Error ? error.message : "native error");
        try { await releaseAnalysis(); } catch (error) { cleanupFailed = true; console.warn("[SENSEA] Analysis cleanup failed", error instanceof Error ? error.message : "native error"); }
        if (!stopped) {
          // If attaching an analysis output failed, restore the plain preview.
          try { await configurePreview(); }
          catch { onError("카메라 미리보기를 연결하지 못했습니다. 다시 켜 주세요."); return; }
          onAnalysisError("사물 분석을 준비하지 못했습니다. 실시간 카메라 화면은 사용할 수 있습니다.");
        }
      }
    };

    return {
      preview: previewOutput,
      start() {
        if (stopped) return Promise.resolve();
        starting ??= (async () => {
          await configurePreview();
          if (!stopped) await camera.start();
        })();
        return starting;
      },
      startAnalysis() {
        if (stopped) return Promise.resolve();
        analysisStarting ??= prepareAnalysis();
        return analysisStarting;
      },
      pause() { stopped = true; active?.setBlocking(false); },
      dispose() {
        if (closing) return closing;
        stopped = true;
        active?.setBlocking(false);
        closing = (async () => {
          try { await starting; } catch { /* Still detach on failed startup. */ }
          // Stop hardware immediately; model loading must not keep the camera on.
          try { await camera.stop(); } catch { cleanupFailed = true; hardwareReleaseFailed = true; }
          try { await camera.configure([]); } catch { cleanupFailed = true; hardwareReleaseFailed = true; }
          try { await analysisStarting; } catch { cleanupFailed = true; }
          // A configure already in flight may have completed after the first detach.
          try { await camera.configure([]); } catch { cleanupFailed = true; hardwareReleaseFailed = true; }
          errors.remove();
          interruptions.remove();
          try { await releaseAnalysis(); } catch (error) { cleanupFailed = true; console.warn("[SENSEA] Analysis cleanup failed", error instanceof Error ? error.message : "native error"); }
          try { previewOutput.dispose(); } catch { cleanupFailed = true; }
          // Analysis resource disposal can fail after the camera has detached.
          // Keep retry available when the hardware itself was released.
          occupied = hardwareReleaseFailed;
          if (cleanupFailed) throw new Error("카메라 정리를 완료하지 못했습니다. 앱을 다시 실행해 주세요.");
        })();
        return closing;
      },
    };
  } catch (error) {
    try { preview?.dispose(); } finally { occupied = false; }
    if (!preview) cameraPromise = undefined;
    throw error;
  }
}

// Reuse the frame executor/runtime; creating one on every open leaks native threads
// with VisionCamera 5.2.3. The preview does not depend on this pipeline.
let framePipeline: {
  frameOutput: ReturnType<typeof VisionCamera.createFrameOutput>;
  runtime: ReturnType<typeof createWorkletRuntimeForThread>;
} | undefined;
let framePipelineFailed = false;
function getFramePipeline() {
  if (framePipeline) return framePipeline;
  if (framePipelineFailed) throw new Error("Frame runtime is unavailable until app restart");
  const frameOutput = VisionCamera.createFrameOutput({
    targetResolution: { width: 640, height: 480 },
    // CameraX converts Android frames to readable RGBA; no Vulkan support is required.
    // Resize/rotation then use one reusable model-sized RGB buffer in the worklet.
    pixelFormat: Platform.OS === "android" ? "rgb" : "yuv", dropFramesWhileBusy: true,
    enablePreviewSizedOutputBuffers: true, enableCameraMatrixDelivery: false,
    enablePhysicalBufferRotation: Platform.OS !== "android", allowDeferredStart: false,
  });
  frameOutput.outputOrientation = "up";
  try {
    const runtime = createWorkletRuntimeForThread(frameOutput.thread);
    framePipeline = { frameOutput, runtime };
  } catch (error) {
    // The library does not shut down the executor on dispose; do not allocate
    // another thread on each retry after an unsupported runtime failure.
    framePipelineFailed = true;
    frameOutput.dispose();
    throw error;
  }
  return framePipeline;
}
