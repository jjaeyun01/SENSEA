import { test } from 'vitest';
import assert from 'node:assert/strict';
import { parseCommand } from '../voice/commands';
import { VoiceController } from '../voice/controller';
import { summarizeMetering } from '../noise/noiseMeter';
import { NavigationSession } from '../navigation/session';
import type { SenseaApi } from '../api/client';

test('English commands and unknown speech', () => {
  assert.deepEqual(parseCommand('Take me to library.'), { type: 'SET_DESTINATION', query: 'library' });
  assert.deepEqual(parseCommand('Take me to cafe'), { type: 'SET_DESTINATION', query: 'cafe' });
  assert.deepEqual(parseCommand('Take me to Library!'), { type: 'SET_DESTINATION', query: 'library' });
  assert.deepEqual(parseCommand('Take me to the library.'), { type: 'SET_DESTINATION', query: 'library' });
  assert.equal(parseCommand('do not start').type, 'UNKNOWN');
  assert.equal(parseCommand('yes').type, 'CONFIRM_DESTINATION');
  assert.equal(parseCommand('pause').type, 'PAUSE');
});

test('noise uses power average and rejects absent or invalid readings', () => {
  assert.equal(summarizeMetering([-60, -60]).relative_noise, 0);
  assert.equal(summarizeMetering([0]).relative_noise, 1);
  assert.ok(summarizeMetering([-60, 0]).relative_noise > 0.9);
  for (const values of [[], [NaN], [1]]) assert.throws(() => summarizeMetering(values));
});

test('voice stops microphone before speaking and repeats the latest message', async () => {
  const events: string[] = [];
  const voice = new VoiceController({
    stopListening: async () => { events.push('mic-stop'); },
    stopSpeaking: async () => { events.push('speech-stop'); },
    speak: async text => { events.push(text); },
    onCommand: async command => { events.push(command.type); },
  });
  await voice.say('Is Library your destination?');
  await voice.acceptTranscript('repeat');
  assert.deepEqual(events.slice(0, 3), ['mic-stop', 'speech-stop', 'Is Library your destination?']);
  assert.equal(events.at(-1), 'Is Library your destination?');
  await voice.acceptTranscript('stop');
  assert.equal(events.at(-1), 'STOP');
});

test('navigation requires confirmation, supports pause and simulation completion', async () => {
  const api = { routes: async () => ({ mode: 'simulation', arrived: false, recommended_route_id: 'shortest', routes: [{ id: 'shortest', segments: [{ instruction: 'First waypoint' }] }] }) } as unknown as SenseaApi;
  const session = new NavigationSession(api);
  assert.throws(() => session.start());
  session.setDestination({ id: 'library', name: 'Library', aliases: [], waypoint_id: 'library_entrance' });
  assert.throws(() => session.start());
  await session.confirmDestination();
  assert.equal(session.start(), 'First waypoint');
  session.pause();
  assert.throws(() => session.advanceSimulation());
  session.start(); session.advanceSimulation();
  assert.equal(session.state, 'arrived');
});

test('stop discards pending route responses', async () => {
  let resolve: (value: unknown) => void = () => {};
  const api = { routes: () => new Promise(done => { resolve = done; }) } as unknown as SenseaApi;
  const session = new NavigationSession(api);
  session.setDestination({ id: 'library', name: 'Library', aliases: [], waypoint_id: 'library_entrance' });
  const pending = session.confirmDestination(); session.reset();
  resolve({ routes: [] }); await pending;
  assert.equal(session.state, 'idle'); assert.equal(session.options, null);
});
