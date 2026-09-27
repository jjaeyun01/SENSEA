import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
let text = "SENSEA camera prototype\n\nEfficientDet Lite0 V1 — TensorFlow\n";
text += "The model and its extracted label map are used unmodified under Apache-2.0.\n";
text += "Source: " + JSON.parse(await readFile(path.join(root, "assets/models/manifest.json"), "utf8")).url + "\n\n";
text += await readFile(path.join(root, "assets/models/LICENSE.txt"), "utf8");
text += "\n\n---\nLiteRT 1.4.0 XNNPACK C API header — Apache-2.0\n";
text += "Copyright 2019 The TensorFlow Authors. Header used without modification.\n";
text += "Source: https://github.com/google-ai-edge/LiteRT/blob/0348ffbe4232df35ab2651e6383528b3d8bf792f/tflite/delegates/xnnpack/xnnpack_delegate.h\n";
text += "SENSEA adds an Android CPU delegate integration to react-native-fast-tflite 3.0.1.\n\n";
text += await readFile(path.join(root, "native/litert-1.4.0/LICENSE"), "utf8");
text += "\n\n---\nOWL-ViT — Google Research / Apache-2.0\n";
text += "Source: https://huggingface.co/google/owlvit-base-patch32/tree/cbc355fb364588351c5d51c7f74465e8e7ec6f72\n";
text += "SENSEA modifications: fixed 29 text queries, 384px input with positional interpolation, ONNX export, INT8 MatMul quantization. No retraining. Apache-2.0 text above applies.\n";
text += "\nONNX Runtime Android 1.22.0 — Microsoft / MIT\n";
text += await readFile(path.join(root, "licenses/onnxruntime-LICENSE.txt"), "utf8");
text += await readFile(path.join(root, "licenses/onnxruntime-ThirdPartyNotices.txt"), "utf8");
text += "\nGoogle ML Kit Text Recognition (Latin) 16.0.1\nTerms: https://developers.google.com/ml-kit/terms\nInput images and OCR results are processed on device. The SDK may send performance and usage metrics to Google. Privacy: https://policies.google.com/privacy\n";
text += "\nSENSEA adds a bounded Android frame-observer hook to react-native-vision-camera 5.2.3 (MIT; notice below).\n";
for (const [name, version] of Object.entries(pkg.dependencies)) {
  const directory = path.join(root, "node_modules", name);
  const names = await readdir(directory);
  const license = names.find(n => /^license(\.(txt|md))?$/i.test(n));
  const licensePath = license ? path.join(directory, license) :
    name === "expo-router" ? path.join(root, "node_modules/expo/LICENSE") :
    name.startsWith("react-native-vision-camera")
      ? path.join(root, "licenses/vision-camera-LICENSE.txt") :
    name === "react-native-nitro-modules" ? path.join(root, "licenses/nitro-LICENSE.txt") :
    name === "react-native-nitro-image" ? path.join(root, "licenses/nitro-image-LICENSE.txt") : null;
  if (!licensePath) throw new Error("License file not found for " + name);
  text += "\n\n---\n" + name + " " + version + "\n\n" + await readFile(licensePath, "utf8");
}
await writeFile(path.join(root, "assets/third-party-notices.json"), JSON.stringify({ text }, null, 2) + "\n");
console.log("Bundled model and direct dependency licenses");
