import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ speak: vi.fn(), stop: vi.fn(() => Promise.resolve()), vibrate: vi.fn(), accessibility: vi.fn(), options: vi.fn(), os: { OS: 'android' }, listeners: new Map<string, (event: any) => void>() }));
vi.mock('react-native', () => ({ Platform: mocks.os, AccessibilityInfo: { announceForAccessibility: mocks.accessibility, announceForAccessibilityWithOptions: mocks.options, addEventListener: (name: string, fn: (event: any) => void) => { mocks.listeners.set(name, fn); return { remove: () => mocks.listeners.delete(name) }; } }, Vibration: { vibrate: mocks.vibrate, cancel: vi.fn() } }));
vi.mock('expo-speech', () => ({ speak: mocks.speak, stop: mocks.stop }));
vi.mock('expo-speech-recognition', () => ({ ExpoSpeechRecognitionModule: { abort: vi.fn() } }));
vi.mock('./audit', () => ({ recordEvent: vi.fn() }));
import { announce, stopFeedback, setFeedbackScreenReader, registerFeedbackAudioControl } from './feedback';
beforeEach(() => { stopFeedback(); setFeedbackScreenReader(false); mocks.os.OS='android'; vi.useRealTimers(); vi.clearAllMocks(); });
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

it('screen-reader fallback retains and drains multiple pending instructions', async () => {
 vi.useFakeTimers(); setFeedbackScreenReader(true);
 announce('first',2); await Promise.resolve();
 announce('second',2); announce('third',2);
 await vi.advanceTimersByTimeAsync(4500);
 expect(mocks.accessibility.mock.calls.map(call=>call[0])).toEqual(['first','second']);
 await vi.advanceTimersByTimeAsync(4500);
 expect(mocks.accessibility.mock.calls.map(call=>call[0])).toEqual(['first','second','third']);
});
it('iOS completion drains the next instruction through the OS queue', async () => {
 mocks.os.OS='ios'; setFeedbackScreenReader(true);
 announce('first',2); await Promise.resolve(); announce('second',2);
 mocks.listeners.get('announcementFinished')!({announcement:'first',success:true}); await Promise.resolve();
 expect(mocks.options.mock.calls.map(call=>call[0])).toEqual(['first','second']);
 expect(mocks.options.mock.calls[1][1]).toEqual({queue:true});
});
it('delivery is acknowledged at TTS start and unplayed warnings are released on cancellation', async () => {
 const onDelivered=vi.fn(),onDropped=vi.fn();
 announce('warning',0,'ko-KR',undefined,true,()=>true,{onDelivered,onDropped}); await Promise.resolve();
 expect(onDelivered).not.toHaveBeenCalled();
 stopFeedback(); expect(onDropped).toHaveBeenCalledOnce();
 announce('new warning',0,'ko-KR',undefined,true,()=>true,{onDelivered});await Promise.resolve();
 mocks.speak.mock.calls.at(-1)![1].onStart(); expect(onDelivered).toHaveBeenCalledOnce();
});

it('duplicate completion callbacks do not consume the next pending announcement', async () => {
 const done=vi.fn(); announce('first',2,'en-US',done); await Promise.resolve();
 const first=mocks.speak.mock.calls[0][1]; first.onStart();
 announce('second',2); first.onDone(); first.onStopped(); await Promise.resolve();
 expect(done).toHaveBeenCalledOnce();
 expect(mocks.speak.mock.calls.map(call=>call[0])).toEqual(['first','second']);
});


it('holds the noise microphone until a priority warning finishes', async () => {
 const suspend=vi.fn(),resume=vi.fn();
 const unregister=registerFeedbackAudioControl({suspend,resume});
 try {
   announce('High alert',0); await Promise.resolve();
   expect(suspend).toHaveBeenCalledOnce(); expect(resume).not.toHaveBeenCalled();
   mocks.speak.mock.calls.at(-1)![1].onStart();
   mocks.speak.mock.calls.at(-1)![1].onDone();
   expect(resume).toHaveBeenCalledOnce();
 } finally { unregister(); }
});
