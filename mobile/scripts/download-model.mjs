import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, rename, rm } from "node:fs/promises";
import manifest from "../assets/models/manifest.json" with { type: "json" };

const target = new URL("../assets/models/" + manifest.file, import.meta.url);
const digest = data => createHash("sha256").update(data).digest("hex");
let present;
try { present = await readFile(target); } catch (error) { if (error.code !== "ENOENT") throw error; }
if (present && digest(present) === manifest.sha256) {
  console.log("Verified existing " + manifest.name);
} else {
  const response = await fetch(manifest.url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error("Model download failed: HTTP " + response.status);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== manifest.bytes || digest(bytes) !== manifest.sha256) {
    throw new Error("Model size or SHA-256 differs from the reviewed asset");
  }
  await mkdir(new URL("../assets/models/", import.meta.url), { recursive: true });
  const temporary = new URL(target.href + ".partial");
  try { await writeFile(temporary, bytes); await rename(temporary, target); }
  finally { await rm(temporary, { force: true }); }
  console.log("Downloaded and verified " + manifest.name);
}
