import test from "node:test";
import assert from "node:assert/strict";
import { LatestSpeechChannel } from "../speech-channel.mjs";
function fixture() {
  let now = 1000, allowed = true;
  const stops = [], spoken = [];
  const channel = new LatestSpeechChannel({
    stop: () => new Promise(resolve => stops.push(resolve)),
    speak: (text, manual) => spoken.push({ text, manual }),
    isAllowed: manual => allowed || manual, now: () => now,
  });
  return { channel, stops, spoken, setNow: value => { now = value; }, setAllowed: value => { allowed = value; } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const utterance = (text, priority = false, receivedAt = 1000) => ({ text, priority, receivedAt });
test("a priority warning replaces an ordinary utterance while stop is pending", async () => {
  const f = fixture();
  f.channel.offer(utterance("일반 사물"));
  f.channel.offer(utterance("화면 중앙 자동차 주의", true));
  f.stops.shift()(); await tick();
  assert.equal(f.spoken.length, 0);
  f.stops.shift()(); await tick();
  assert.deepEqual(f.spoken.map(item => item.text), ["화면 중앙 자동차 주의"]);
});
test("a burst retains one latest warning and ordinary speech cannot displace it", async () => {
  const f = fixture(); f.channel.offer(utterance("처음 경고", true));
  for (let i = 0; i < 10000; i++) f.channel.offer(utterance(`경고 ${i}`, true));
  assert.equal(f.channel.offer(utterance("일반 사물")), false);
  assert.equal(f.stops.length, 1);
  assert.equal(f.channel.pending.text, "경고 9999");
  f.stops.shift()(); await tick(); f.stops.shift()(); await tick();
  assert.deepEqual(f.spoken.map(item => item.text), ["경고 9999"]);
  assert.equal(f.channel.pending, null); assert.equal(f.channel.inFlight, null);
});
test("stopping the camera cancels speech already awaiting a native stop", async () => {
  const f = fixture(); f.channel.offer(utterance("경고", true));
  f.channel.cancel(); f.stops.splice(0).forEach(resolve => resolve()); await tick();
  assert.deepEqual(f.spoken, []);
});
test("speech that becomes stale while waiting is discarded", async () => {
  const f = fixture(); f.channel.offer(utterance("경고", true));
  f.setNow(2001); f.stops.shift()(); await tick(); assert.deepEqual(f.spoken, []);
});
test("voice state is rechecked after asynchronous stop; manual replay may bypass mute", async () => {
  const f = fixture(); f.channel.offer(utterance("경고", true));
  f.setAllowed(false); f.stops.shift()(); await tick(); assert.deepEqual(f.spoken, []);
  assert.equal(f.channel.offer(utterance("자동")), false);
  f.channel.offer({ ...utterance("수동", true), manual: true });
  f.stops.shift()(); await tick(); assert.deepEqual(f.spoken, [{ text: "수동", manual: true }]);
});
test("outdated, future and invalid requests never reach the speech engine", () => {
  const f = fixture();
  for (const at of [-1, 1001, NaN, Infinity]) assert.equal(f.channel.offer(utterance("경고", true, at)), false);
  assert.equal(f.channel.offer({ text: "", receivedAt: 1000 }), false);
  assert.equal(f.stops.length, 0);
});
test("speech-engine failures do not reject offers or retain pending warnings", async () => {
  const channel = new LatestSpeechChannel({ stop: () => Promise.reject(new Error("engine unavailable")),
    speak: () => { throw new Error("unexpected"); }, isAllowed: () => true, now: () => 1000 });
  assert.equal(channel.offer(utterance("경고", true)), true);
  await tick(); assert.equal(channel.pending, null); assert.equal(channel.draining, null);
});

test("a fresh offer at drain completion is not stranded between promise microtasks", async () => {
  const spoken = [];
  const channel = new LatestSpeechChannel({ stop: () => Promise.resolve(),
    speak: text => { spoken.push(text); if (text === "첫 경고") queueMicrotask(() => channel.offer(utterance("새 경고", true))); },
    isAllowed: () => true, now: () => 1000 });
  channel.offer(utterance("첫 경고", true)); await tick();
  assert.deepEqual(spoken, ["첫 경고", "새 경고"]);
  assert.equal(channel.pending, null);
});

test("an accepted warning dropped after expiration releases its announcement reservation", async () => {
  const f = fixture(); let reserved = false, dropped = 0;
  const offerWarning = at => {
    if (reserved) return false;
    reserved = true;
    return f.channel.offer({ ...utterance("동일한 차량 주의", true, at), onDropped: () => { reserved = false; dropped++; } });
  };
  assert.equal(offerWarning(1000), true);
  f.setNow(2001); f.stops.shift()(); await tick();
  assert.equal(dropped, 1); assert.equal(reserved, false);
  assert.equal(offerWarning(2001), true);
  f.stops.shift()(); await tick();
  assert.deepEqual(f.spoken.map(item => item.text), ["동일한 차량 주의"]);
});
test("replaced and cancelled messages each report dropped exactly once", async () => {
  const f = fixture(), dropped = [];
  const item = n => ({ ...utterance(`경고 ${n}`, true), onDropped: () => dropped.push(n) });
  f.channel.offer(item(1)); f.channel.offer(item(2)); f.channel.offer(item(3));
  f.channel.cancel(); f.stops.splice(0).forEach(resolve => resolve()); await tick();
  assert.deepEqual(dropped.sort(), [1, 2, 3]);
});
