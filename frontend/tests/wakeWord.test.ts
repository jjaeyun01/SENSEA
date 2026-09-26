import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceController } from '../src/voice/controller.ts';
import { WakeWordSession } from '../src/voice/wakeWordSession.ts';

function setup(capture = async (_signal: AbortSignal, _duration: number) => 'pause') {
  const events: string[] = [];
  let detected = () => {};
  const voice = new VoiceController({
    stopListening: async () => { events.push('stop-recording'); },
    stopSpeaking: async () => { events.push('stop-speech'); },
    speak: async text => { events.push(text); },
    onCommand: async command => { events.push(command.type); },
  });
  const session = new WakeWordSession(voice, {
    startDetection: async callback => { detected = callback; events.push('wake-start'); },
    stopDetection: async () => { events.push('wake-stop'); },
    captureCommand: async (signal, duration) => {
      events.push('capture');
      assert.equal(duration, 15_000);
      return capture(signal, duration);
    },
    onError: message => { events.push(message); },
  });
  return { session, voice, events, detect: () => detected() };
}

test('wake flow releases detector, prompts, captures, dispatches, and rearms', async () => {
  const { session, events } = setup();
  await session.enable();
  await session.requestCommand();
  assert.equal(session.state, 'waiting');
  assert.ok(events.indexOf('wake-stop') < events.indexOf('How can I help?'));
  assert.ok(events.indexOf('How can I help?') < events.indexOf('capture'));
  assert.ok(events.includes('PAUSE'));
  assert.equal(events.at(-1), 'wake-start');
});

test('wake prompt preserves the last navigation instruction for repeat', async () => {
  const { session, events } = setup(async () => 'repeat');
  await session.enable();
  await session.announce('Continue to the plaza.');
  await session.requestCommand();
  assert.equal(events.filter(e => e === 'Continue to the plaza.').length, 2);
});

test('duplicate detection does not create overlapping captures', async () => {
  const { session, events, detect } = setup();
  await session.enable();
  const first = session.requestCommand();
  detect(); detect();
  await first;
  assert.equal(events.filter(e => e === 'capture').length, 1);
});

test('disable aborts capture and ignores late transcription and detections', async () => {
  let began: () => void = () => {};
  const started = new Promise<void>(resolve => { began = resolve; });
  const { session, events, detect } = setup(signal => new Promise(resolve => {
    signal.addEventListener('abort', () => resolve('start navigation'), { once: true });
    began();
  }));
  await session.enable();
  const request = session.requestCommand();
  await started;
  await session.disable();
  await request;
  detect();
  assert.equal(session.state, 'off');
  assert.ok(!events.includes('START_NAVIGATION'));
  assert.equal(events.filter(e => e === 'wake-start').length, 1);
});

test('capture failure stops the session and exposes a fallback', async () => {
  const { session, events } = setup(async () => { throw new Error('Microphone interrupted'); });
  await session.enable();
  await session.requestCommand();
  assert.equal(session.state, 'error');
  assert.ok(events.at(-1)?.includes('on-screen controls'));
});

test('silence returns to wake-word waiting without dispatching a command', async () => {
  const { session, events } = setup(async () => ' ');
  await session.enable();
  await session.requestCommand();
  assert.equal(session.state, 'waiting');
  assert.ok(events.includes('I did not hear a command. Say SENSEA to try again.'));
  assert.ok(!events.includes('PAUSE'));
});
