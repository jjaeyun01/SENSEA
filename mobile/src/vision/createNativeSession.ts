import { loadTensorflowModel, type TfliteModel } from "react-native-fast-tflite";
import { VisionCamera, type CameraPreviewOutput } from "react-native-vision-camera";
import { createResizer, type Resizer } from "react-native-vision-camera-resizer";
import { createWorkletRuntimeForThread } from "react-native-vision-camera-worklets";
import { createSynchronizable, scheduleOnRN, scheduleOnRuntime } from "react-native-worklets";
import labels from "../../assets/models/labels.json";
import { analyzeOwnedFrame } from "./detection.mjs";
import type { LiveResult, NativeSession } from "./types";

// A second opening cannot allocate another interpreter while the first is closing.
let occupied = false;

export async function createNativeSession(
  onResult: (result: LiveResult) => void,
  onError: (message: string) => void,
): Promise<NativeSession> {
  if (occupied) throw new Error("이전 카메라 처리를 정리하고 있습니다. 잠시 후 다시 열어 주세요.");
  occupied = true;
  let model: TfliteModel | undefined;
  let resizer: Resizer | undefined;
  let preview: CameraPreviewOutput | undefined;
  let pipeline: Awaited<ReturnType<typeof getPipeline>> | undefined;
  try {
    model = await loadTensorflowModel(require("../../assets/models/efficientdet-lite0.tflite"), []);
    const input = model.inputs[0];
    if (model.inputs.length !== 1 || input.dataType !== "uint8" ||
        input.shape.join(",") !== "1,320,320,3" || model.outputs.length !== 4 ||
        model.outputs.some(tensor => tensor.dataType !== "float32")) {
      throw new Error("객체 인식 모델 형식을 확인하지 못했습니다.");
    }
    resizer = await createResizer({
      width: 320, height: 320, channelOrder: "rgb", dataType: "uint8",
      scaleMode: "contain", pixelLayout: "interleaved",
    });
    pipeline = await getPipeline();
    const { frameOutput, runtime, cameraSession } = pipeline;
    preview = VisionCamera.createPreviewOutput();
    const detector = model, converter = resizer, previewOutput = preview;
    previewOutput.outputOrientation = "up";
    const active = createSynchronizable(true);
    const notificationPending = createSynchronizable(false);
    let disposed = false;
    let closing: Promise<void> | undefined;

    const deliver = (result: LiveResult) => {
      try {
        const age = Date.now() - result.receivedAt;
        if (!disposed && active.getBlocking() && age >= 0 && age <= 1000) onResult(result);
      } finally { notificationPending.setBlocking(false); }
    };
    const fail = (message: string) => {
      if (!disposed) onError(message);
    };

    // Initialization and teardown use the SAME native thread as inference.
    await new Promise<void>((resolve, reject) => {
      scheduleOnRuntime(runtime, () => {
        "worklet";
        try {
          let lastStartedAt = -Infinity;
          frameOutput.setOnFrameCallback(frame => {
            const now = performance.now();
            const receivedAt = Date.now();
            const shouldAnalyze = active.getBlocking() && !notificationPending.getBlocking() &&
              now - lastStartedAt >= 200;
            if (shouldAnalyze) lastStartedAt = now;
            try {
              const result = analyzeOwnedFrame(frame, converter, detector, labels, shouldAnalyze);
              if (result && active.getBlocking() && Date.now() - receivedAt <= 1000) {
                notificationPending.setBlocking(true);
                scheduleOnRN(deliver, {
                  ...result, receivedAt,
                  processedMs: performance.now() - now, navigation_safe: false,
                });
              }
            } catch {
              active.setBlocking(false);
              scheduleOnRN(fail, "카메라 분석을 중지했습니다. 카메라를 다시 열어 주세요.");
            }
            // This callback has taken ownership and disposed the frame on every path.
            return true;
          });
          scheduleOnRN(resolve);
        } catch { scheduleOnRN(reject, new Error("카메라 분석 스레드를 시작하지 못했습니다.")); }
      });
    });

    await cameraSession.configure([{
      input: "back",
      outputs: [
        { output: frameOutput, mirrorMode: "off" },
        { output: previewOutput, mirrorMode: "off" },
      ],
      constraints: [{ fps: 30 }, { resolutionBias: frameOutput }],
    }]);
    const errors = cameraSession.addOnErrorListener(() => {
      if (!disposed && active.getBlocking()) fail("카메라 연결이 끊겼습니다. 다시 열어 주세요.");
    });
    const interruptions = cameraSession.addOnInterruptionStartedListener(() => {
      if (!disposed && active.getBlocking()) fail("카메라가 일시 중단되었습니다. 다시 열어 주세요.");
    });
    let starting: Promise<void> | undefined;
    return {
      preview: previewOutput,
      start() {
        if (disposed || !active.getBlocking()) return Promise.resolve();
        starting ??= cameraSession.start();
        return starting;
      },
      pause() { active.setBlocking(false); },
      dispose() {
        if (closing) return closing;
        disposed = true;
        active.setBlocking(false);
        closing = (async () => {
          try { await starting; } catch { /* A failed start still needs cleanup. */ }
          let detachFailed = false;
          try { await cameraSession.stop(); } catch { detachFailed = true; }
          try { await cameraSession.configure([]); } catch { detachFailed = true; }
          errors.remove();
          interruptions.remove();
          await new Promise<void>((resolve, reject) => {
            const complete = (failure?: string) => {
              // Nitro creates a separate JS wrapper in each runtime. Release the
              // RN wrappers too, after the worker has stopped using the resources.
              for (const resource of [converter, detector, previewOutput]) {
                try { resource.dispose(); }
                catch { failure = "카메라 자원 정리에 실패했습니다."; }
              }
              occupied = Boolean(failure);
              if (failure) reject(new Error(failure)); else resolve();
            };
            scheduleOnRuntime(runtime, () => {
              "worklet";
              let failure = detachFailed;
              try { frameOutput.setOnFrameCallback(undefined); } catch { failure = true; }
              try { converter.dispose(); } catch { failure = true; }
              try { detector.dispose(); } catch { failure = true; }
              try { previewOutput.dispose(); } catch { failure = true; }
              scheduleOnRN(complete, failure ? "카메라 자원 정리에 실패했습니다." : undefined);
            });
          });
        })();
        return closing;
      },
    };
  } catch (error) {
    let cleanupFailed = false;
    if (pipeline) {
      const { cameraSession, frameOutput, runtime } = pipeline;
      try { await cameraSession.stop(); } catch { cleanupFailed = true; }
      try { await cameraSession.configure([]); } catch { cleanupFailed = true; }
      try {
        await new Promise<void>((resolve, reject) => {
          scheduleOnRuntime(runtime, () => {
            "worklet";
            try { frameOutput.setOnFrameCallback(undefined); scheduleOnRN(resolve); }
            catch { scheduleOnRN(reject, new Error("프레임 입력을 해제하지 못했습니다.")); }
          });
        });
      } catch { cleanupFailed = true; }
    }
    for (const resource of [preview, resizer, model]) {
      try { resource?.dispose(); } catch { cleanupFailed = true; }
    }
    occupied = cleanupFailed;
    throw error;
  }
}

// Keep one idle pipeline for the app lifetime. VisionCamera 5.2.3's Android
// FrameOutput.dispose() clears the analyzer but does not shut down its executor.
// Reusing the output/runtime avoids a new native thread for every camera open.
// stop() + configure([]) explicitly release the camera hardware between sessions.
let pipelinePromise: Promise<{
  frameOutput: ReturnType<typeof VisionCamera.createFrameOutput>;
  runtime: ReturnType<typeof createWorkletRuntimeForThread>;
  cameraSession: Awaited<ReturnType<typeof VisionCamera.createCameraSession>>;
}> | undefined;
function getPipeline() {
  pipelinePromise ??= (async () => {
    const frameOutput = VisionCamera.createFrameOutput({
      targetResolution: { width: 640, height: 480 },
      pixelFormat: "yuv", dropFramesWhileBusy: true,
      enablePreviewSizedOutputBuffers: true, enableCameraMatrixDelivery: false,
      enablePhysicalBufferRotation: true, allowDeferredStart: false,
    });
    try {
      frameOutput.outputOrientation = "up";
      const runtime = createWorkletRuntimeForThread(frameOutput.thread);
      const cameraSession = await VisionCamera.createCameraSession(false);
      return { frameOutput, runtime, cameraSession };
    } catch (error) {
      frameOutput.dispose();
      // Retain the rejected promise: initialization cannot repeatedly allocate threads.
      throw error;
    }
  })();
  return pipelinePromise;
}
