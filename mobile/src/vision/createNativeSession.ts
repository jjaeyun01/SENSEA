import { loadTensorflowModel, type TfliteModel } from "react-native-fast-tflite";
import { VisionCamera, type CameraFrameOutput, type CameraPreviewOutput, type CameraSession } from "react-native-vision-camera";
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
  let output: CameraFrameOutput | undefined;
  let preview: CameraPreviewOutput | undefined;
  let camera: CameraSession | undefined;
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
    output = VisionCamera.createFrameOutput({
      targetResolution: { width: 640, height: 480 },
      pixelFormat: "yuv",
      dropFramesWhileBusy: true,
      enablePreviewSizedOutputBuffers: true,
      enableCameraMatrixDelivery: false,
      enablePhysicalBufferRotation: true,
      allowDeferredStart: false,
    });
    preview = VisionCamera.createPreviewOutput();
    camera = await VisionCamera.createCameraSession(false);
    const frameOutput = output, detector = model, converter = resizer;
    const previewOutput = preview, cameraSession = camera;
    frameOutput.outputOrientation = "up";
    previewOutput.outputOrientation = "up";
    const runtime = createWorkletRuntimeForThread(frameOutput.thread);
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
          try { await cameraSession.stop(); } catch { /* Dispose also closes the session. */ }
          errors.remove();
          interruptions.remove();
          await new Promise<void>((resolve, reject) => {
            const complete = (failure?: string) => {
              occupied = Boolean(failure);
              if (failure) reject(new Error(failure)); else resolve();
            };
            scheduleOnRuntime(runtime, () => {
              "worklet";
              let failure = false;
              try { frameOutput.setOnFrameCallback(undefined); } catch { failure = true; }
              try { converter.dispose(); } catch { failure = true; }
              try { detector.dispose(); } catch { failure = true; }
              try { cameraSession.dispose(); } catch { failure = true; }
              try { previewOutput.dispose(); } catch { failure = true; }
              try { frameOutput.dispose(); } catch { failure = true; }
              scheduleOnRN(complete, failure ? "카메라 자원 정리에 실패했습니다." : undefined);
            });
          });
        })();
        return closing;
      },
    };
  } catch (error) {
    let cleanupFailed = false;
    for (const resource of [camera, preview, output, resizer, model]) {
      try { resource?.dispose(); } catch { cleanupFailed = true; }
    }
    occupied = cleanupFailed;
    throw error;
  }
}
