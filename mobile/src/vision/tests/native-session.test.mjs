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

function fixture({ supported = true, failModel = false, pendingModel = false, failAttach = false } = {}) {
  const events = [], fatal = [], analysis = [];
  let resolveModel, frameOutputs = 0;
  const disposable = name => ({ dispose() { events.push(`dispose:${name}`); } });
  const model = {
    ...disposable("model"), inputs: [{ dataType: "uint8", shape: [1, 320, 320, 3] }],
    outputs: Array.from({ length: 4 }, () => ({ dataType: "float32" })),
  };
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
    "expo-asset": { Asset: { fromModule: () => ({ localUri: "file:///cache/public-model.tflite", downloadAsync: async () => {} }) } },
    "react-native-fast-tflite": { loadTensorflowModel(source) {
      assert.match(source.url, /^file:\/\//, "native loader must receive a file URL, never Android raw resource name");
      events.push("load:model");
      if (failModel) return Promise.reject(new Error("model unavailable"));
      return pendingModel ? new Promise(resolve => { resolveModel = () => resolve(model); }) : Promise.resolve(model);
    } },
    "react-native-vision-camera": { VisionCamera: {
      createCameraSession: async () => camera,
      createPreviewOutput: () => disposable("preview"),
      createFrameOutput() { frameOutputs++; return { thread: {}, setOnFrameCallback() {}, ...disposable("frame") }; },
    } },
    "react-native-vision-camera-resizer": {
      isResizerAvailable: () => supported,
      createResizer: async () => disposable("resizer"),
    },
    "react-native-vision-camera-worklets": { createWorkletRuntimeForThread: () => ({}) },
    "react-native-worklets": {
      createSynchronizable(value) { return { setBlocking(next) { value = next; }, getBlocking: () => value }; },
      scheduleOnRN: (fn, ...args) => queueMicrotask(() => fn(...args)),
      scheduleOnRuntime: (_, fn) => queueMicrotask(fn),
    },
    "../../assets/models/labels.json": [],
    "../../assets/models/efficientdet-lite0.tflite": 1,
    "./detection.mjs": { isFreshResult: () => true },
  };
  const module = { exports: {} };
  vm.runInNewContext(`(function(require, module, exports) {${compiled}\n})`, { performance, Date, Promise, console: { info() {}, warn() {} } })(
    name => { assert.ok(name in modules, name); return modules[name]; }, module, module.exports,
  );
  return { events, fatal, analysis, resolveModel: () => resolveModel(), frameOutputs: () => frameOutputs,
    create: () => module.exports.createNativeSession(() => {}, text => fatal.push(text), text => analysis.push(text)) };
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

test("an unsupported GPU keeps a plain camera preview without loading a model", async () => {
  const f = fixture({ supported: false });
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

test("repeated starts and reopen reuse the executor and release per-session resources", async () => {
  const f = fixture();
  for (let i = 0; i < 3; i++) {
    const session = await f.create();
    await Promise.all([session.start(), session.start()]);
    await Promise.all([session.startAnalysis(), session.startAnalysis()]);
    session.pause();
    await Promise.all([session.dispose(), session.dispose()]);
  }
  assert.equal(f.frameOutputs(), 1);
  assert.equal(f.events.filter(x => x === "start").length, 3);
  assert.equal(f.events.filter(x => x === "load:model").length, 3);
  assert.equal(f.events.filter(x => x === "dispose:preview").length, 3);
});
