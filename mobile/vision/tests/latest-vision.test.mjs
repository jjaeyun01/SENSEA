import assert from "node:assert/strict";
import test from "node:test";
import { LatestVisionController } from "../LatestVisionController.mjs";

const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const scene = (requestId, description = "표지판이 보입니다.") => ({
  request_id: requestId, status: "described",
  quality: { status: "usable", reason: null, guidance: null },
  recognized_text: [], uncertainty: "medium", roadway: "uncertain", sidewalk: "uncertain",
  description, navigation_safe: false,
});

async function harness(overrides = {}) {
  const spoken = [], results = [], errors = [], calls = [];
  let count = 0, stops = 0;
  const controller = new LatestVisionController({
    capture: async () => ({ uri: "file:///generated-test.jpg" }),
    releasePhoto: async () => {},
    describe: args => {
      const pending = deferred();
      calls.push({ ...args, ...pending });
      return pending.promise;
    },
    stopSpeech: async () => { stops += 1; },
    speak: text => spoken.push(text),
    makeRequestId: () => "00000000-0000-4000-8000-" + String(++count).padStart(12, "0"),
    onResult: result => results.push(result),
    onError: error => errors.push(error),
    ...overrides,
  });
  await controller.setStationary(true);
  await controller.setExternalProcessingConsent(true);
  return { controller, spoken, results, errors, calls, stops: () => stops };
}

test("out-of-order responses speak only the newest, even if abort is ignored", async () => {
  const h = await harness();
  const first = h.controller.request();
  await tick();
  const second = h.controller.request();
  await tick();
  assert.equal(h.calls[0].signal.aborted, true);
  h.calls[1].resolve(scene(h.calls[1].requestId, "새 사진"));
  assert.equal((await second).description, "새 사진");
  h.calls[0].resolve(scene(h.calls[0].requestId, "이전 사진"));
  assert.equal(await first, null);
  assert.deepEqual(h.spoken, ["새 사진"]);
  assert.equal(h.results.length, 1);
});

test("only latest pending capture runs; the camera is never entered concurrently", async () => {
  const camera = deferred();
  let captures = 0;
  const h = await harness({
    capture: () => ++captures === 1 ? camera.promise : Promise.resolve({ uri: "new.jpg" }),
  });
  const first = h.controller.request();
  await tick();
  const middle = h.controller.request();
  await tick();
  const latest = h.controller.request();
  await tick();
  assert.equal(captures, 1);
  camera.resolve({ uri: "old.jpg" });
  await tick();
  assert.equal(captures, 2);
  assert.equal(h.calls.length, 1);
  h.calls[0].resolve(scene(h.calls[0].requestId));
  await Promise.all([first, middle, latest]);
  assert.equal(h.spoken.length, 1);
});

for (const action of ["cancel", "dispose", "move"]) {
  test(action + " stops speech and invalidates outstanding results", async () => {
    const h = await harness();
    const pending = h.controller.request();
    await tick();
    if (action === "move") await h.controller.setStationary(false);
    else await h.controller[action]();
    h.calls[0].resolve(scene(h.calls[0].requestId));
    assert.equal(await pending, null);
    assert.equal(h.calls[0].signal.aborted, true);
    assert.deepEqual(h.spoken, []);
    assert.deepEqual(h.results, []);
    assert.ok(h.stops() >= 2);
  });
}

test("moving back to stationary cannot revive an old result", async () => {
  const h = await harness();
  const pending = h.controller.request();
  await tick();
  await h.controller.setStationary(false);
  await h.controller.setStationary(true);
  h.calls[0].resolve(scene(h.calls[0].requestId));
  await pending;
  assert.deepEqual(h.spoken, []);
});

test("retake speaks guidance without requiring or inventing a scene", async () => {
  const h = await harness();
  const pending = h.controller.request();
  await tick();
  h.calls[0].resolve({
    request_id: h.calls[0].requestId, status: "retake", navigation_safe: false,
    quality: { status: "retake", reason: "too_dark", guidance: "조명을 확인해 주세요." },
  });
  assert.equal((await pending).status, "retake");
  assert.deepEqual(h.spoken, ["조명을 확인해 주세요."]);
});

for (const mutation of ["id", "unsafe", "empty", "status", "quality", "scene"]) {
  test("invalid response is never spoken: " + mutation, async () => {
    const h = await harness();
    const pending = h.controller.request();
    await tick();
    const result = scene(h.calls[0].requestId);
    if (mutation === "id") result.request_id = "wrong-id";
    if (mutation === "unsafe") result.navigation_safe = true;
    if (mutation === "empty") result.description = "";
    if (mutation === "status") result.status = "unknown";
    if (mutation === "quality") result.quality.reason = "too_dark";
    if (mutation === "scene") delete result.uncertainty;
    h.calls[0].resolve(result);
    assert.equal(await pending, null);
    assert.deepEqual(h.spoken, []);
    assert.equal(h.errors[0].code, "invalid_response");
  });
}

test("even the latest response expires if capture and network take too long", async () => {
  let now = 0;
  const h = await harness({ now: () => now, maxResultAgeMs: 500 });
  const pending = h.controller.request();
  await tick();
  now = 501;
  h.calls[0].resolve(scene(h.calls[0].requestId));
  await pending;
  assert.deepEqual(h.spoken, []);
  assert.equal(h.errors[0].code, "expired_result");
});

test("request superseded while awaiting native speech stop cannot speak", async () => {
  const nativeStop = deferred();
  let stops = 0;
  const h = await harness({ stopSpeech: () => ++stops === 2 ? nativeStop.promise : Promise.resolve() });
  const old = h.controller.request();
  await tick();
  h.calls[0].resolve(scene(h.calls[0].requestId, "old"));
  await tick(); // old result is waiting inside native stop
  const latest = h.controller.request();
  await tick();
  assert.equal(stops, 2); // newest stop is serialized behind old native operation
  nativeStop.resolve();
  await tick();
  h.calls[1].resolve(scene(h.calls[1].requestId, "new"));
  await Promise.all([old, latest]);
  assert.deepEqual(h.spoken, ["new"]);
});

test("expired result cannot start speech after waiting for native stop", async () => {
  const nativeStop = deferred();
  let now = 0, stops = 0;
  const h = await harness({
    now: () => now,
    maxResultAgeMs: 500,
    stopSpeech: () => ++stops === 2 ? nativeStop.promise : Promise.resolve(),
  });
  const pending = h.controller.request();
  await tick();
  h.calls[0].resolve(scene(h.calls[0].requestId));
  await tick();
  now = 501;
  nativeStop.resolve();
  await pending;
  assert.deepEqual(h.spoken, []);
  assert.equal(h.errors[0].code, "expired_result");
});

test("late errors from obsolete requests do not replace the newest result", async () => {
  const h = await harness();
  const old = h.controller.request();
  await tick();
  const latest = h.controller.request();
  await tick();
  h.calls[1].resolve(scene(h.calls[1].requestId));
  await latest;
  h.calls[0].reject(new Error("old network error"));
  await old;
  assert.deepEqual(h.errors, []);
  assert.equal(h.spoken.length, 1);
});

test("stationary confirmation is required and disposal is permanent", async () => {
  const h = await harness();
  await h.controller.setStationary(false);
  await assert.rejects(h.controller.request(), { code: "stationary_required" });
  await h.controller.dispose();
  await h.controller.setStationary(true);
  await assert.rejects(h.controller.request(), { code: "disposed" });
  assert.equal(h.calls.length, 0);
});

test("capture failures do not wedge the capture queue", async () => {
  let captures = 0;
  const h = await harness({ capture: async () => {
    if (++captures === 1) throw new Error("camera failed");
    return { uri: "retry.jpg" };
  } });
  assert.equal(await h.controller.request(), null);
  const retry = h.controller.request();
  await tick();
  h.calls[0].resolve(scene(h.calls[0].requestId));
  await retry;
  assert.equal(h.spoken.length, 1);
  assert.equal(h.errors.length, 1);
});

test("a new request stops currently playing speech", async () => {
  const h = await harness();
  const first = h.controller.request();
  await tick();
  h.calls[0].resolve(scene(h.calls[0].requestId));
  await first;
  const stops = h.stops();
  const next = h.controller.request();
  await tick();
  assert.ok(h.stops() > stops);
  await h.controller.cancel();
  h.calls[1].resolve(scene(h.calls[1].requestId));
  await next;
  assert.equal(h.spoken.length, 1);
});

test("native stop failure suppresses speech and a later request can recover", async () => {
  let stops = 0;
  const h = await harness({ stopSpeech: async () => {
    if (++stops === 1) throw new Error("native stop failed");
  } });
  assert.equal(await h.controller.request(), null);
  assert.equal(h.calls.length, 0);
  const next = h.controller.request();
  await tick();
  h.calls[0].resolve(scene(h.calls[0].requestId));
  await next;
  assert.equal(h.errors.length, 1);
  assert.equal(h.spoken.length, 1);
});


test("explicit external consent is required before capture and revoking it invalidates results", async () => {
  const released = [];
  const h = await harness({ releasePhoto: async photo => released.push(photo.uri) });
  await h.controller.setExternalProcessingConsent(false);
  await assert.rejects(h.controller.request(), { code: "external_consent_required" });
  assert.equal(h.calls.length, 0);
  await h.controller.setExternalProcessingConsent(true);
  const pending = h.controller.request();
  await tick();
  await h.controller.setExternalProcessingConsent(false);
  assert.equal(h.calls[0].signal.aborted, true);
  h.calls[0].resolve(scene(h.calls[0].requestId));
  assert.equal(await pending, null);
  assert.deepEqual(h.spoken, []);
  assert.deepEqual(released, ["file:///generated-test.jpg"]);
});

for (const outcome of ["success", "network-failure", "invalid", "expired", "dispose-during-capture"]) {
  test("temporary photo is released exactly once: " + outcome, async () => {
    const camera = deferred();
    const released = [];
    let now = 0;
    const h = await harness({
      capture: () => camera.promise,
      releasePhoto: async photo => released.push(photo.uri), now: () => now,
    });
    const pending = h.controller.request();
    await tick();
    if (outcome === "dispose-during-capture") await h.controller.dispose();
    camera.resolve({ uri: "owned-temporary-photo.jpg" });
    await tick();
    if (h.calls.length) {
      if (outcome === "network-failure") h.calls[0].reject(new Error("network failure"));
      else {
        if (outcome === "expired") now = 15001;
        h.calls[0].resolve(outcome === "invalid" ? {} : scene(h.calls[0].requestId));
      }
    }
    await pending;
    assert.deepEqual(released, ["owned-temporary-photo.jpg"]);
  });
}

test("photo cleanup failures are surfaced and block further captures", async () => {
  const h = await harness({ releasePhoto: async () => { throw new Error("private file path"); } });
  const pending = h.controller.request();
  await tick();
  h.calls[0].resolve(scene(h.calls[0].requestId));
  await pending;
  assert.equal(h.errors.at(-1).code, "photo_cleanup_failed");
  assert.doesNotMatch(h.errors.at(-1).message, /private file path/);
  await assert.rejects(h.controller.request(), { code: "photo_cleanup_failed" });
});

test("high uncertainty is explicitly spoken", async () => {
  const h = await harness();
  const pending = h.controller.request();
  await tick();
  h.calls[0].resolve({ ...scene(h.calls[0].requestId), uncertainty: "high" });
  await pending;
  assert.match(h.spoken[0], /확실하게 알 수 없습니다/);
});
