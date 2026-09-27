import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Only the exact pinned upstream sources or this exact applied patch are accepted.
// Validate every input before changing any file, so dependency drift fails closed.
const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--package-dir")) {
  throw new Error("Usage: node patch-tflite-cpu.mjs [--package-dir isolated-test-package]");
}
const packageRoot = args.length ? path.resolve(args[1]) : path.join(mobileRoot, "node_modules", "react-native-fast-tflite");
const hash = text => createHash("sha256").update(text).digest("hex");
const normalize = text => text.replace(/\r\n/g, "\n");
const pkg = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
if (pkg.name !== "react-native-fast-tflite" || pkg.version !== "3.0.1") {
  throw new Error("SENSEA CPU patch requires react-native-fast-tflite 3.0.1; review the patch before upgrading.");
}
const patches = [
  { name: "HybridTfliteModule.cpp",
    originalSha: "35826e9fd36dc95435d27db148ee167aa0bac41309142c48d6e45dba8c15a72f",
    patchedSha: "a6a32c5884328af0f8c94e6db0cd0ef53771fec9060397004790f34d5ef2d275",
    replacements: [
      [String.raw`#include <tflite/c/c_api.h>`, String.raw`#include <tflite/c/c_api.h>
#include "SenseaCpuModel.hpp"`],
      [String.raw`  TfLiteModel* model = TfLiteModelCreate(modelData->data(), modelData->size());`, String.raw`#if defined(ANDROID)
  if (delegates.empty()) return createSenseaCpuModel(modelData);
#endif
  TfLiteModel* model = TfLiteModelCreate(modelData->data(), modelData->size());`],
    ]
  },
  { name: "HybridTfliteModel.hpp",
    originalSha: "92099d5e5e68d2ced594b122c0a3b05a2d83646652ddb0aeb64e763f0c84a399",
    patchedSha: "0dfe1cd0fc2897c64d1c547a8b0d197266c2651e0fa713c7c26a66759ae6be27",
    replacements: [
      [String.raw`                             std::vector<TensorflowModelDelegate> delegates);`, String.raw`                             std::vector<TensorflowModelDelegate> delegates
#if defined(ANDROID)
                             , std::shared_ptr<TfLiteDelegate> cpuDelegate = nullptr,
                             bool cpuDelegateFallback = false
#endif
                             );`],
      [String.raw`  std::unordered_map<std::string, std::shared_ptr<ArrayBuffer>> _outputBuffers;`, String.raw`  std::unordered_map<std::string, std::shared_ptr<ArrayBuffer>> _outputBuffers;
#if defined(ANDROID)
  // Member ownership outlives the destructor body, which deletes the interpreter.
  std::shared_ptr<TfLiteDelegate> _cpuDelegate;
  bool _cpuDelegateFallback = false;
#endif`],
    ]
  },
  { name: "HybridTfliteModel.cpp",
    originalSha: "f386754b83e3f8ad2614ae82278581b0c6384b60d7f883f484456ddd7ea16803",
    patchedSha: "a3c5620a183b33cfe6a45590282afebb93eb432139987d7e4bac6c686fea7c11",
    replacements: [
      [String.raw`#include <tflite/c/c_api.h>`, String.raw`#include <tflite/c/c_api.h>
#include <android/log.h>`],
      [String.raw`                                     std::vector<TensorflowModelDelegate> delegates)`, String.raw`                                     std::vector<TensorflowModelDelegate> delegates
#if defined(ANDROID)
                                     , std::shared_ptr<TfLiteDelegate> cpuDelegate,
                                     bool cpuDelegateFallback
#endif
                                     )`],
      [String.raw`      _modelData(modelData) {`, String.raw`      _modelData(modelData)
#if defined(ANDROID)
      , _cpuDelegate(std::move(cpuDelegate)), _cpuDelegateFallback(cpuDelegateFallback)
#endif
      {`],
      [String.raw`  TfLiteStatus status = TfLiteInterpreterInvoke(_interpreter);
  if (status != kTfLiteOk) {`, String.raw`  TfLiteStatus status = TfLiteInterpreterInvoke(_interpreter);
#if defined(ANDROID)
  // With the C API fallback explicitly enabled, these statuses mean the CPU
  // retry succeeded and its outputs are valid. Other failures remain errors.
  if (_cpuDelegateFallback &&
      (status == kTfLiteDelegateError || status == kTfLiteApplicationError)) {
    _cpuDelegateFallback = false;
    __android_log_print(ANDROID_LOG_WARN, "SENSEATflite", "XNNPACK execution fell back to CPU successfully");
    return;
  }
#endif
  if (status != kTfLiteOk) {`],
    ]
  }
];
const copies = [
  { source: "native/litert-1.4.0/xnnpack_delegate.h", target: "sensea-xnnpack-v1.4.0.h",
    sha: "d01b38bc1ae87422c9fe96f5f0daee0ef284272a6020f69aab75a0b1cab07aed" },
  { source: "native/tflite-cpu/SenseaCpuModel.hpp", target: "SenseaCpuModel.hpp",
    sha: "45b47f82702800713f0ca65592cb8e14cd2ab30d9e759fe41c043e6b461a2278" },
];
const writes = [];
for (const patch of patches) {
  const target = path.join(packageRoot, "cpp", patch.name);
  const current = normalize(await readFile(target, "utf8"));
  if (hash(current) === patch.patchedSha) continue;
  if (hash(current) !== patch.originalSha) throw new Error(`Unexpected upstream content: ${patch.name}`);
  let changed = current;
  for (const [before, after] of patch.replacements) {
    if (changed.split(before).length !== 2) throw new Error(`Ambiguous patch anchor: ${patch.name}`);
    changed = changed.replace(before, after);
  }
  if (hash(changed) !== patch.patchedSha) throw new Error(`Patch checksum mismatch: ${patch.name}`);
  writes.push({ target, content: changed });
}
for (const copy of copies) {
  const content = normalize(await readFile(path.join(mobileRoot, copy.source), "utf8"));
  if (hash(content) !== copy.sha) throw new Error(`Vendored source checksum mismatch: ${copy.source}`);
  const target = path.join(packageRoot, "cpp", copy.target);
  let current;
  try { current = normalize(await readFile(target, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (current !== undefined && current !== content) throw new Error(`Unexpected existing SENSEA header: ${copy.target}`);
  if (current === undefined) writes.push({ target, content });
}
for (const { target, content } of writes) await writeFile(target, content, "utf8");
console.log(`SENSEA Android CPU patch ready (${writes.length} files updated).`);
