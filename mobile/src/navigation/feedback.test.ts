import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ speak: vi.fn(), stop: vi.fn(() => Promise.resolve()), vibrate: vi.fn() }));
vi.mock('react-native', () => ({ AccessibilityInfo: { announceForAccessibility: vi.fn() }, Vibration: { vibrate: mocks.vibrate, cancel: vi.fn() } }));
vi.mock('expo-speech', () => ({ speak: mocks.speak, stop: mocks.stop }));
vi.mock('expo-speech-recognition', () => ({ ExpoSpeechRecognitionModule: { abort: vi.fn() } }));
vi.mock('./audit', () => ({ recordEvent: vi.fn() }));
import { announce, stopFeedback } from './feedback';
beforeEach(() => { stopFeedback(); vi.clearAllMocks(); });
it('drops a camera observation that expires while speech is stopping', async () => {
  let fresh = true;
  announce('camera warning', 0, 'ko-KR', undefined, true, () => fresh);
  fresh = false;
  await Promise.resolve();
  expect(mocks.speak).not.toHaveBeenCalled();
});
it('does not play an expired camera observation queued behind a warning', async () => {
  announce('priority warning', 0);
  await Promise.resolve();
  let fresh = true;
  announce('camera observation', 1, 'ko-KR', undefined, true, () => fresh);
  fresh = false;
  mocks.speak.mock.calls[0][1].onDone();
  await Promise.resolve();
  expect(mocks.speak).toHaveBeenCalledTimes(1);
  expect(mocks.vibrate).toHaveBeenCalledTimes(1);
});
it('fresh priority camera observations interrupt route speech and vibrate', async () => {
  announce('turn ahead', 2);
  await Promise.resolve();
  announce('priority camera warning', 0, 'ko-KR', undefined, true, () => true);
  await Promise.resolve();
  expect(mocks.speak.mock.calls.map(call => call[0])).toEqual(['turn ahead', 'priority camera warning']);
  expect(mocks.vibrate).toHaveBeenCalledTimes(2);
});
