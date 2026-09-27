import test from "node:test";
import assert from "node:assert/strict";
import { englishSpeechOptions } from "../english-speech.mjs";

test("Android chooses a US English voice even when the first installed voice is Korean", () => {
  assert.deepEqual(englishSpeechOptions([
    { identifier: "korean", language: "ko-KR" },
    { identifier: "british", language: "en-GB" },
    { identifier: "american", language: "en-US" },
  ]), { language: "en", rate: 0.95, voice: "american" });
});
test("voice locale spelling is normalized and other English accents are a valid fallback", () => {
  assert.equal(englishSpeechOptions([{ identifier: "us", language: "EN_us" }]).voice, "us");
  assert.equal(englishSpeechOptions([{ identifier: "au", language: "en-AU" }]).voice, "au");
});
test("missing or malformed voices never select a non-English voice or the device locale", () => {
  assert.deepEqual(englishSpeechOptions(), { language: "en", rate: 0.95 });
  assert.deepEqual(englishSpeechOptions([null, {}, { identifier: "ko", language: "ko-KR" },
    { identifier: "bad", language: "english" }, { identifier: "", language: "en-US" }]),
  { language: "en", rate: 0.95 });
});
test("iPhone keeps a BCP-47 English locale and the same voice preference", () => {
  assert.deepEqual(englishSpeechOptions([{ identifier: "us", language: "en-US" }], "ios"),
    { language: "en-US", rate: 0.95, voice: "us" });
});
