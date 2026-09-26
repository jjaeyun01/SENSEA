import assert from "node:assert/strict";
import test from "node:test";
import { RealtimeFrameProcessor } from "../RealtimeFrameProcessor.mjs";
import { analyzeLumaFrame } from "../analyzeLumaFrame.mjs";

const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function clock() {
  let time = 0, nextId = 0;
  const timers = new Map();
  return {
    now: () => time,
    schedule: (callback, delay) => {
      const id = ++nextId;
      timers.set(id, { callback, at: time + delay });
      return id;
    },
    unschedule: id => timers.delete(id),
    advance: amount => {
      const end = time + amount;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        time = due[1].at;
        timers.delete(due[0]);
        due[1].callback();
      }
      time = end;
    },
    timerCount: () => timers.size,
  };
}
function harness(options = {}) {
  const time = clock(), calls = [], results = [], errors = [], releases = new Map();
  const processor = new RealtimeFrameProcessor({
    analyze: (frame, context) => {
      const pending = deferred();
      calls.push({ frame, ...context, ...pending });
      return pending.promise;
    },
    onResult: (value, timing) => results.push({ value, timing }),
    onError: error => errors.push(error),
    minIntervalMs: 0,
    ...time, ...options,
  });
  function frame(id, overrides = {}) {
    return {
      id, data: new Uint8Array(64), width: 8, height: 8,
      capturedAt: time.now(),
      release: () => releases.set(id, (releases.get(id) ?? 0) + 1),
      ...overrides,
    };
  }
  processor.start();
  return { processor, time, calls, results, errors, releases, frame };
}

test("10,000 offered frames retain only active and newest pending buffers", async () => {
  const h = harness();
  for (let i = 0; i < 10000; i++) h.processor.offer(h.frame(i));
  const stats = h.processor.getStats();
  assert.equal(h.calls.length, 1);
  assert.equal(stats.retainedFrames, 2);
  assert.equal(stats.peakRetainedFrames, 2);
  assert.equal(stats.retainedBytes, 128);
  assert.equal(stats.peakRetainedBytes, 128);
  assert.equal(stats.released, 9998);
  h.calls[0].resolve("first");
  await tick();
  assert.equal(h.calls[1].frame.id, 9999);
  assert.deepEqual(h.results.map(item => item.value), ["first"]);
  h.calls[1].resolve("latest");
  await tick();
  assert.equal(h.processor.getStats().retainedFrames, 0);
  assert.equal(h.releases.size, 10000);
  assert.ok([...h.releases.values()].every(value => value === 1));
});

test("5 Hz budget processes the latest pending frame without accumulating timers", async () => {
  const h = harness({ minIntervalMs: 200 });
  h.processor.offer(h.frame("first"));
  h.calls[0].resolve("done");
  await tick();
  h.time.advance(10);
  h.processor.offer(h.frame("old-pending"));
  h.time.advance(100);
  h.processor.offer(h.frame("new-pending"));
  assert.equal(h.calls.length, 1);
  assert.equal(h.time.timerCount(), 1);
  h.time.advance(89);
  assert.equal(h.calls.length, 1);
  h.time.advance(1);
  assert.equal(h.calls[1].frame.id, "new-pending");
  assert.equal(h.releases.get("old-pending"), 1);
  h.calls[1].resolve("done");
  await tick();
  assert.equal(h.time.timerCount(), 0);
});

test("slow completed results expire and only the newest queued frame runs next", async () => {
  const h = harness({ maxResultAgeMs: 300 });
  h.processor.offer(h.frame("old"));
  h.time.advance(301);
  h.processor.offer(h.frame("fresh"));
  h.calls[0].resolve("expired");
  await tick();
  assert.deepEqual(h.results, []);
  assert.equal(h.calls[1].frame.id, "fresh");
  h.calls[1].resolve("fresh result");
  await tick();
  assert.equal(h.results[0].value, "fresh result");
});

test("pause releases pending immediately but not memory still being analyzed", async () => {
  const h = harness();
  h.processor.offer(h.frame("busy"));
  h.processor.offer(h.frame("waiting"));
  h.processor.pause();
  assert.equal(h.releases.get("waiting"), 1);
  assert.equal(h.releases.has("busy"), false);
  assert.equal(h.calls[0].signal.aborted, true);
  assert.equal(h.processor.getStats().retainedFrames, 1);
  h.calls[0].resolve("late");
  await tick();
  assert.equal(h.releases.get("busy"), 1);
  assert.deepEqual(h.results, []);
  assert.equal(h.processor.getStats().retainedBytes, 0);
});

test("pause/resume never starts another analyzer until cancellation settles", async () => {
  const h = harness();
  h.processor.offer(h.frame("old"));
  h.processor.pause();
  h.processor.start();
  h.processor.offer(h.frame("new"));
  assert.equal(h.calls.length, 1);
  h.calls[0].resolve("old");
  await tick();
  assert.equal(h.calls[1].frame.id, "new");
  assert.deepEqual(h.results, []);
  h.calls[1].resolve("new");
  await tick();
  assert.equal(h.results.length, 1);
});

test("analysis timeout pauses the source without freeing active memory early", async () => {
  const h = harness({ analysisTimeoutMs: 100 });
  h.processor.offer(h.frame("hung"));
  h.processor.offer(h.frame("queued"));
  h.time.advance(100);
  assert.equal(h.processor.getStats().enabled, false);
  assert.equal(h.processor.getStats().timeouts, 1);
  assert.equal(h.calls[0].signal.aborted, true);
  assert.equal(h.releases.has("hung"), false);
  assert.equal(h.releases.get("queued"), 1);
  for (let i = 0; i < 100; i++) h.processor.offer(h.frame(i));
  assert.equal(h.calls.length, 1);
  assert.equal(h.processor.getStats().retainedFrames, 1);
  h.calls[0].resolve("ignored after cancellation");
  await tick();
  assert.equal(h.processor.getStats().retainedFrames, 0);
  assert.deepEqual(h.results, []);
});

test("dispose rejects new work, releases arrivals, and silences old errors", async () => {
  const h = harness();
  h.processor.offer(h.frame("old"));
  h.processor.dispose();
  assert.equal(h.processor.offer(h.frame("late")), false);
  assert.equal(h.releases.get("late"), 1);
  h.calls[0].reject(new Error("old error"));
  await tick();
  assert.equal(h.processor.getStats().retainedFrames, 0);
  assert.deepEqual(h.errors, []);
  assert.throws(() => h.processor.start(), /disposed/);
});

test("analysis errors release their buffer and permit the newest queued frame", async () => {
  const h = harness();
  h.processor.offer(h.frame("bad"));
  h.processor.offer(h.frame("next"));
  h.calls[0].reject(new Error("inference failed"));
  await tick();
  assert.equal(h.releases.get("bad"), 1);
  assert.equal(h.calls[1].frame.id, "next");
  assert.equal(h.errors.length, 1);
  h.calls[1].resolve("ok");
  await tick();
});

test("even a tiny view is rejected when its backing allocation exceeds the cap", () => {
  const h = harness({ maxFrameBytes: 128 });
  const huge = new Uint8Array(1024);
  assert.equal(h.processor.offer(h.frame("big", { data: huge.subarray(0, 64) })), false);
  assert.equal(h.calls.length, 0);
  assert.equal(h.releases.get("big"), 1);
  assert.equal(h.processor.getStats().retainedBytes, 0);
});

for (const issue of ["stale", "future", "layout"]) {
  test(issue + " frames are released without analysis", () => {
    const h = harness();
    const overrides = issue === "layout" ? { rowStride: 100 } :
      { capturedAt: issue === "stale" ? -2000 : 1000 };
    assert.equal(h.processor.offer(h.frame("invalid", overrides)), false);
    assert.equal(h.releases.get("invalid"), 1);
    assert.equal(h.calls.length, 0);
  });
}

test("expired pending buffers are dropped before starting analysis", async () => {
  const h = harness({ maxResultAgeMs: 200, minIntervalMs: 500 });
  h.processor.offer(h.frame("first"));
  h.calls[0].resolve("ok");
  await tick();
  h.processor.offer(h.frame("waiting"));
  h.time.advance(500);
  assert.equal(h.calls.length, 1);
  assert.equal(h.releases.get("waiting"), 1);
});

test("offering the same lease twice cannot release memory in active use", async () => {
  const h = harness();
  const frame = h.frame("lease");
  h.processor.offer(frame);
  assert.throws(() => h.processor.offer(frame), /only be offered once/);
  assert.equal(h.releases.has("lease"), false);
  h.calls[0].resolve("done");
  await tick();
  assert.equal(h.releases.get("lease"), 1);
});

test("throwing result and error callbacks do not break cleanup", async () => {
  const h = harness({
    onResult: () => { throw new Error("UI failed"); },
    onError: () => { throw new Error("error UI failed"); },
  });
  h.processor.offer(h.frame("first"));
  h.processor.offer(h.frame("next"));
  h.calls[0].resolve("done");
  await tick();
  assert.equal(h.releases.get("first"), 1);
  assert.equal(h.calls.length, 2);
  h.calls[1].resolve("done");
  await tick();
  assert.equal(h.processor.getStats().retainedFrames, 0);
});

test("release failure pauses input instead of continuing allocation", async () => {
  const h = harness();
  h.processor.offer(h.frame("broken", { release: () => { throw new Error("native release failed"); } }));
  h.processor.offer(h.frame("queued"));
  h.calls[0].resolve("done");
  await tick();
  assert.equal(h.processor.getStats().enabled, false);
  assert.equal(h.releases.get("queued"), 1);
  assert.equal(h.calls.length, 1);
  assert.equal(h.errors.length, 1);
});

test("actual local quality analyzer runs with the bounded frame processor", async () => {
  const h = harness({ analyze: analyzeLumaFrame });
  h.processor.offer(h.frame("dark", { data: new Uint8Array(320 * 240), width: 320, height: 240 }));
  await tick();
  assert.equal(h.results[0].value.reason, "too_dark");
  assert.equal(h.results[0].value.navigation_safe, false);
  assert.equal(h.releases.get("dark"), 1);
});

for (const [value, reason] of [[0, "too_dark"], [255, "too_bright"], [128, "low_detail"]]) {
  test("local quality identifies " + reason + " without image copies", () => {
    const data = new Uint8Array(320 * 240).fill(value);
    const result = analyzeLumaFrame({ data, width: 320, height: 240 });
    assert.equal(result.reason, reason);
    assert.ok(result.sampledPixels <= 160 * 160);
    assert.equal(data[0], value);
    assert.equal("data" in result, false);
  });
}

test("structured luma input passes; row padding does not affect the statistics", () => {
  const width = 320, height = 240, rowStride = 336;
  const data = new Uint8Array(rowStride * height).fill(255);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data[y * rowStride + x] = x % 16 < 8 ? 80 : 180;
  }
  const result = analyzeLumaFrame({ data, width, height, rowStride });
  assert.equal(result.status, "usable");
  assert.equal(result.meanLuma, 130);
});

test("local analysis rejects invalid layout and an already cancelled operation", () => {
  assert.throws(() => analyzeLumaFrame({ data: new Uint8Array(8), width: 10, height: 10 }));
  const abort = new AbortController();
  abort.abort();
  assert.throws(() => analyzeLumaFrame(
    { data: new Uint8Array(64), width: 8, height: 8 },
    { signal: abort.signal },
  ), /cancelled/);
});

test("an old deadline after disposal does not notify a closed screen", async () => {
  const h = harness({ analysisTimeoutMs: 100 });
  h.processor.offer(h.frame("old"));
  h.processor.dispose();
  h.time.advance(100);
  assert.deepEqual(h.errors, []);
  h.calls[0].resolve("old");
  await tick();
  assert.equal(h.processor.getStats().retainedBytes, 0);
});
