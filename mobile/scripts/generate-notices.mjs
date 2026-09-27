import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
let text = "SENSEA camera prototype\n\nEfficientDet Lite0 V1 — TensorFlow\n";
text += "The model and its extracted label map are used unmodified under Apache-2.0.\n";
text += "Source: " + JSON.parse(await readFile(path.join(root, "assets/models/manifest.json"), "utf8")).url + "\n\n";
text += await readFile(path.join(root, "assets/models/LICENSE.txt"), "utf8");
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
