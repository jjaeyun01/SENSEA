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
      const detector = model, resizer = converter;
      if (pipeline) {
        const { frameOutput, runtime } = pipeline;
        await new Promise<void>((resolve, reject) => {
          const complete = (failed: boolean) => failed ? reject(new Error("analysis cleanup failed")) : resolve();
          scheduleOnRuntime(runtime, () => {
            "worklet";
            let failed = false;
            try { frameOutput.setOnFrameCallback(undefined); } catch { failed = true; }
            try { resizer?.dispose(); } catch { failed = true; }
            try { detector?.dispose(); } catch { failed = true; }
            scheduleOnRN(complete, failed);
          });
        });
      }
      // Nitro creates one JS wrapper per runtime; release the RN wrappers too.
      for (const resource of [converter, model]) resource?.dispose();
      converter = undefined;
      model = undefined;
    };

    const prepareAnalysis = async () => {
      // Called only after onPreviewStarted confirms that the user sees camera frames.
      try {
        await starting;
        if (stopped) return;
        if (!isResizerAvailable()) {
          onAnalysisError("이 기기는 현재 사물 분석 방식을 지원하지 않습니다. 실시간 카메라 화면은 사용할 수 있습니다.");
          return;
        }
        model = await loadTensorflowModel(require("../../assets/models/efficientdet-lite0.tflite"), []);
        if (stopped) return;
        const input = model.inputs[0];
        if (model.inputs.length !== 1 || input.dataType !== "uint8" ||
            input.shape.join(",") !== "1,320,320,3" || model.outputs.length !== 4 ||
            model.outputs.some(tensor => tensor.dataType !== "float32")) {
          throw new Error("Invalid model contract");
        }
        converter = await createResizer({
          width: 320, height: 320, channelOrder: "rgb", dataType: "uint8",
          scaleMode: "contain", pixelLayout: "interleaved",
        });
        if (stopped) return;
        pipeline = getFramePipeline();
        const { frameOutput, runtime } = pipeline;
        const detector = model, resizer = converter;
        const enabled = createSynchronizable(true);
        active = enabled;
        const pending = createSynchronizable(false);
        const deliver = (result: LiveResult) => {
          try {
            if (!stopped && enabled.getBlocking() && isFreshResult(result, Date.now())) onResult(result);
          } finally { pending.setBlocking(false); }
        };
        const failAnalysis = () => {
          if (!stopped) onAnalysisError("사물 분석을 중지했습니다. 실시간 카메라 화면은 계속 표시합니다.");
        };
        await new Promise<void>((resolve, reject) => {
          scheduleOnRuntime(runtime, () => {
            "worklet";
            try {
              let lastStartedAt = -Infinity;
              frameOutput.setOnFrameCallback(frame => {
                const now = performance.now(), receivedAt = Date.now();
                const shouldAnalyze = enabled.getBlocking() && !pending.getBlocking() && now - lastStartedAt >= 200;
                if (shouldAnalyze) lastStartedAt = now;
                try {
                  const result = analyzeOwnedFrame(frame, resizer, detector, labels, shouldAnalyze);
                  if (result && enabled.getBlocking() && Date.now() - receivedAt <= 1000) {
                    pending.setBlocking(true);
                    scheduleOnRN(deliver, { ...result, receivedAt, processedMs: performance.now() - now, navigation_safe: false });
                  }
                } catch {
                  enabled.setBlocking(false);
                  scheduleOnRN(failAnalysis);
                }
                return true;
              });
              scheduleOnRN(resolve);
            } catch { scheduleOnRN(reject, new Error("Cannot initialize frame processing")); }
          });
        });
        if (stopped) return;
        await camera.configure([{
          input: "back",
          outputs: [{ output: previewOutput, mirrorMode: "off" }, { output: frameOutput, mirrorMode: "off" }],
          constraints: [{ resolutionBias: frameOutput }],
        }]);
      } catch {
        try { await releaseAnalysis(); } catch { cleanupFailed = true; }
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
          try { await camera.stop(); } catch { cleanupFailed = true; }
          try { await camera.configure([]); } catch { cleanupFailed = true; }
          try { await analysisStarting; } catch { cleanupFailed = true; }
          // A configure already in flight may have completed after the first detach.
          try { await camera.configure([]); } catch { cleanupFailed = true; }
          errors.remove();
          interruptions.remove();
          try { await releaseAnalysis(); } catch { cleanupFailed = true; }
          try { previewOutput.dispose(); } catch { cleanupFailed = true; }
          occupied = cleanupFailed;
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
    pixelFormat: "yuv", dropFramesWhileBusy: true,
    enablePreviewSizedOutputBuffers: true, enableCameraMatrixDelivery: false,
    enablePhysicalBufferRotation: true, allowDeferredStart: false,
  });
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
