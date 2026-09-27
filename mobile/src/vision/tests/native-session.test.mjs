import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Execute the production session orchestration with native devices substituted.
// Hardware preview/permission behavior is covered by the emulator workflow.
const source = readFileSync(new URL("../createNativeSession.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture({ platform = "android", supported = true, failModel = false, pendingModel = false, failAttach = false, failModelDispose = false, frameDurations = [] } = {}) {
  const events = [], fatal = [], analysis = [], results = [], info = [], warnings = [];
  const processingDurations = [...frameDurations];
  let resolveModel, frameOutputs = 0, gpuChecks = 0, frameCallback, clock = 0;
  const frameCalls = [];
  class FakeDate extends Date { static now() { return clock; } }
  const disposable = name => {
    let disposed = false;
    return { dispose() {
      if (disposed) throw new Error(`Already disposed: ${name}`);
      disposed = true;
      events.push(`dispose:${name}`);
    } };
  };
  const newModel = () => ({
    ...disposable("model"), dispose() { events.push("dispose:model"); if (failModelDispose) throw new Error("model disposal failed"); },
    inputs: [{ dataType: "uint8", shape: [1, 320, 320, 3] }],
    outputs: Array.from({ length: 4 }, () => ({ dataType: "float32" })),
  });
  const camera = {
    addOnErrorListener: () => ({ remove() {} }),
    addOnInterruptionStartedListener: () => ({ remove() {} }),
    async configure(outputs) {
      const count = outputs[0]?.outputs.length ?? 0;
      events.push(`configure:${count}`);
      if (count === 2 && failAttach) throw new Error("unsupported output combination");
    },
    async start() { events.push("start"); },
    async stop() { events.push("stop"); },
  };
  const modules = {
    "react-native": { Platform: { OS: platform } },
    "expo-asset": { Asset: { fromModule: () => ({ localUri: "file:///cache/public-model.tflite", downloadAsync: async () => {} }) } },
    "react-native-fast-tflite": { loadTensorflowModel(source) {
      assert.match(source.url, /^file:\/\//, "native loader must receive a file URL, never Android raw resource name");
      events.push("load:model");
      const model = newModel();
      if (failModel) return Promise.reject(new Error("model unavailable"));
      return pendingModel ? new Promise(resolve => { resolveModel = () => resolve(model); }) : Promise.resolve(model);
    } },
    "react-native-vision-camera": { VisionCamera: {
      createCameraSession: async () => camera,
      createPreviewOutput: () => disposable("preview"),
      createFrameOutput(options) {
        assert.equal(options.pixelFormat, platform === "android" ? "rgb" : "yuv");
        assert.equal(options.enablePhysicalBufferRotation, platform !== "android");
        assert.equal(options.dropFramesWhileBusy, true);
        frameOutputs++;
        return { thread: {}, setOnFrameCallback(callback) { frameCallback = callback; }, ...disposable("frame") };
      },
    } },
    "react-native-vision-camera-resizer": {
      isResizerAvailable() { gpuChecks++; return supported; },
      createResizer: async () => { events.push("create:resizer"); return disposable("resizer"); },
    },
    "react-native-vision-camera-worklets": { createWorkletRuntimeForThread: () => ({}) },
    "react-native-worklets": {
      createSynchronizable(value) { return { setBlocking(next) { value = next; }, getBlocking: () => value }; },
      scheduleOnRN: (fn, ...args) => queueMicrotask(() => fn(...args)),
      scheduleOnRuntime: (_, fn) => queueMicrotask(fn),
    },
    "../../assets/models/labels.json": [],
    "../../assets/models/efficientdet-lite0.tflite": 1,
    "./detection.mjs": {
      isFreshResult: (result, now) => now - result.receivedAt >= 0 && now - result.receivedAt <= 1000,
      analyzeOwnedFrame(...args) {
        frameCalls.push(args);
        try {
          if (!args[4]) return;
          const duration = processingDurations.shift();
          if (duration === undefined) return;
          clock += duration;
          return { quality: { status: "usable", reason: null }, detections: [],
            preprocessingMs: duration / 2, inferenceMs: duration / 2 };
        } finally { args[0].dispose(); }
      },
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(`(function(require, module, exports) {${compiled}\n})`, { performance: { now: () => clock }, Date: FakeDate, Promise,
    console: { info: (...args) => info.push(args), warn: (...args) => warnings.push(args) } })(
    name => { assert.ok(name in modules, name); return modules[name]; }, module, module.exports,
  );
  return { events, fatal, analysis, results, info, warnings, frameCalls, gpuChecks: () => gpuChecks,
    emitFrame(advance = 250) { clock += advance; assert.equal(typeof frameCallback, "function"); return frameCallback(disposable("frame-input")); },
    resolveModel: () => resolveModel(), frameOutputs: () => frameOutputs,
    create: () => module.exports.createNativeSession(result => results.push(result), text => fatal.push(text), text => analysis.push(text)) };
}

test("preview starts before loading any model and survives a model failure", async () => {
  const f = fixture({ failModel: true });
  const session = await f.create();
  await session.start();
  assert.deepEqual(f.events, ["configure:1", "start"]);
  await session.startAnalysis();
  assert.equal(f.fatal.length, 0);
  assert.equal(f.analysis.length, 1);
  assert.equal(f.events.at(-1), "configure:1");
  assert.ok(!f.events.includes("stop"));
  await session.dispose();
});

test("an unsupported iOS GPU keeps a plain camera preview without loading a model", async () => {
  const f = fixture({ platform: "ios", supported: false });
  const session = await f.create();
  await session.start();
  await session.startAnalysis();
  assert.deepEqual(f.events, ["configure:1", "start"]);
  assert.equal(f.analysis.length, 1);
  assert.equal(f.fatal.length, 0);
  await session.dispose();
});

test("closing stops camera hardware without waiting for model download/loading", async () => {
  const f = fixture({ pendingModel: true });
  const session = await f.create();
  await session.start();
  const preparing = session.startAnalysis();
  await new Promise(resolve => setImmediate(resolve));
  const closing = session.dispose();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(f.events.includes("stop"));
  assert.ok(f.events.includes("configure:0"));
  assert.ok(!f.events.includes("configure:2"));
  f.resolveModel();
  await Promise.all([preparing, closing]);
  assert.ok(f.events.includes("dispose:model"));
  assert.equal(f.frameOutputs(), 0);
  const reopened = await f.create();
  await reopened.start();
  await reopened.dispose();
});

test("failed analysis output binding restores preview and reports a separate error", async () => {
  const f = fixture({ failAttach: true });
  const session = await f.create();
  await session.start();
  await session.startAnalysis();
  assert.ok(f.events.includes("configure:2"));
  assert.equal(f.events.at(-1), "configure:1");
  assert.equal(f.fatal.length, 0);
  assert.equal(f.analysis.length, 1);
  await session.dispose();
});

test("model cleanup failure does not permanently lock a detached camera", async () => {
  const f = fixture({ platform: "ios", failModelDispose: true });
  const session = await f.create();
  await session.start();
  await session.startAnalysis();
  await assert.rejects(session.dispose(), /카메라 정리/);
  const reopened = await f.create();
  await reopened.start();
  await reopened.dispose();
});

for (const platform of ["android", "ios"]) {
  test(`${platform} repeated starts and reopen reuse the executor and release per-session resources`, async () => {
    const f = fixture({ platform });
    const cpuBuffers = [];
    for (let i = 0; i < 3; i++) {
      const session = await f.create();
      await Promise.all([session.start(), session.start()]);
      await Promise.all([session.startAnalysis(), session.startAnalysis()]);
      if (platform === "android") {
        f.emitFrame();
        cpuBuffers.push(f.frameCalls.at(-1)[5]);
      }
      session.pause();
      await Promise.all([session.dispose(), session.dispose()]);
    }
    assert.equal(f.frameOutputs(), 1);
    assert.equal(f.events.filter(x => x === "start").length, 3);
    assert.equal(f.events.filter(x => x === "load:model").length, 3);
    assert.equal(f.events.filter(x => x === "dispose:preview").length, 3);
    // Native disposal runs once, after detaching the worklet callback.
    assert.equal(f.events.filter(x => x === "dispose:model").length, 3);
    assert.equal(f.events.filter(x => x === "create:resizer").length, platform === "ios" ? 3 : 0);
    assert.equal(f.events.filter(x => x === "dispose:resizer").length, platform === "ios" ? 3 : 0);
    if (platform === "android") assert.equal(new Set(cpuBuffers).size, 3, "reopening gets a new session buffer");
  });
}

test("Android CPU analysis runs when GPU resizing is unavailable and reuses one bounded RGB buffer", async () => {
  const f = fixture({ platform: "android", supported: false });
  const session = await f.create();
  await session.start();
  await session.startAnalysis();
  assert.ok(f.events.includes("load:model"));
  assert.ok(f.events.includes("configure:2"));
  assert.equal(f.frameOutputs(), 1);
  assert.equal(f.gpuChecks(), 0, "Android must not depend on Vulkan availability");
  assert.ok(!f.events.includes("create:resizer"));
  assert.equal(f.analysis.length, 0);
  assert.equal(f.fatal.length, 0);
  f.emitFrame();
  f.emitFrame();
  assert.equal(f.frameCalls.length, 2);
  const [first, second] = f.frameCalls;
  assert.equal(first[1], undefined, "Android does not capture a GPU resizer");
  assert.equal(first[4], true);
  assert.equal(second[4], true);
  assert.equal(first[5].byteLength, 320 * 320 * 3);
  assert.strictEqual(first[5], second[5], "CPU scratch buffer is reused between frames");
  await session.dispose();
});

test("Android CPU input changes leave iOS YUV/GPU frame configuration compatible", async () => {
  const f = fixture({ platform: "ios" });
  const session = await f.create();
  await session.start();
  await session.startAnalysis();
  assert.ok(f.events.includes("configure:2"));
  assert.ok(f.events.includes("create:resizer"));
  assert.equal(f.gpuChecks(), 1);
  assert.equal(f.analysis.length, 0);
  f.emitFrame();
  assert.equal(typeof f.frameCalls[0][1].dispose, "function");
  assert.equal(f.frameCalls[0][5], undefined, "iOS retains the GPU path without a CPU buffer");
  await session.dispose();
});


test("three consecutive processing deadline misses stop analysis while retaining the camera preview", async () => {
  const f = fixture({ frameDurations: [1001, 1001, 1001, 50] });
  const session = await f.create();
  await session.start();
  await session.startAnalysis();
  for (let i = 0; i < 3; i++) {
    f.emitFrame();
    await Promise.resolve();
    assert.equal(f.results.length, 0, "stale results never reach the UI");
    assert.equal(f.analysis.length, i === 2 ? 1 : 0);
  }
  assert.deepEqual(f.warnings, [["[SENSEA] Frame analysis stopped", "Frame processing deadline exceeded"]]);
  assert.match(f.analysis[0], /live camera view will stay on/);
  assert.equal(f.fatal.length, 0);
  assert.ok(!f.events.includes("stop"), "deadline failure must keep preview hardware running");
  assert.equal(f.events.filter(event => event.startsWith("configure:")).at(-1), "configure:2");
  f.emitFrame();
  await Promise.resolve();
  assert.equal(f.frameCalls.at(-1)[4], false, "failed analysis stops consuming inference work");
  assert.equal(f.events.filter(event => event === "dispose:frame-input").length, 4);
  assert.equal(f.analysis.length, 1, "failure notification is bounded");
  await session.dispose();

  const restarted = await f.create();
  await restarted.start();
  await restarted.startAnalysis();
  f.emitFrame();
  await Promise.resolve();
  assert.equal(f.results.length, 1, "an explicit restart gets a fresh deadline budget");
  await restarted.dispose();
});

test("one slow warmup is discarded without stopping subsequent fresh inference or timing diagnostics", async () => {
  const f = fixture({ frameDurations: [1200, 100] });
  const session = await f.create();
  await session.start();
  await session.startAnalysis();
  f.emitFrame();
  await Promise.resolve();
  assert.equal(f.results.length, 0);
  assert.equal(f.analysis.length, 0);
  f.emitFrame();
  await Promise.resolve();
  assert.equal(f.results.length, 1);
  assert.equal(f.results[0].processedMs, 100);
  assert.equal(f.analysis.length, 0);
  const timings = f.info.filter(entry => entry[0] === "[SENSEA] First frame processing");
  assert.equal(timings.length, 1);
  assert.equal(timings[0][1], 1200);
  assert.equal(timings[0][2], "usable");
  assert.equal(timings[0][3].preprocessingMs, 600);
  assert.equal(timings[0][3].inferenceMs, 600);
  await session.dispose();
});

test("a result exactly at the freshness deadline resets consecutive misses", async () => {
  const f = fixture({ frameDurations: [1001, 1001, 1000, 1001, 1001, 999] });
  const session = await f.create();
  await session.start();
  await session.startAnalysis();
  for (let i = 0; i < 6; i++) {
    f.emitFrame();
    await Promise.resolve();
  }
  assert.deepEqual(f.results.map(result => result.processedMs), [1000, 999]);
  assert.equal(f.analysis.length, 0);
  assert.equal(f.fatal.length, 0);
  await session.dispose();
});

test("deadline tracking preserves the one-pending-result limit and the 200ms throttle", async () => {
  const f = fixture({ frameDurations: [50, 50] });
  const session = await f.create();
  await session.start();
  await session.startAnalysis();
  f.emitFrame();
  f.emitFrame(0); // The RN delivery is still pending.
  await Promise.resolve();
  f.emitFrame(149); // 199ms since the first inference started.
  f.emitFrame(1); // Exactly 200ms since the first inference started.
  await Promise.resolve();
  assert.deepEqual(f.frameCalls.map(call => call[4]), [true, false, false, true]);
  assert.equal(f.results.length, 2);
  assert.equal(f.analysis.length, 0);
  assert.equal(f.events.filter(event => event === "dispose:frame-input").length, 4);
  await session.dispose();
});
