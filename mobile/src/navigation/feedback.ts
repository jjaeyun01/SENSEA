import { AccessibilityInfo, Platform, Vibration } from "react-native";
import * as Speech from "expo-speech";
import { ExpoSpeechRecognitionModule as Recognition } from "expo-speech-recognition";
import { recordEvent } from "./audit";
import type { DirectionHaptic } from './direction';

type Delivery = { onDelivered?: () => void; onDropped?: () => void; haptic?: DirectionHaptic };
type Notice = Delivery & { text: string; priority: number; at: number; language: string; done?: () => void; valid?: () => boolean; record: boolean; delivered: boolean };
let audioControl: { suspend: () => void; resume: () => void; prepare?: () => Promise<void> } | null = null;
export function registerFeedbackAudioControl(control: typeof audioControl) {
  audioControl = control;
  return () => { if (audioControl === control) audioControl = null; };
}
let active: Notice | null = null;
let queue: Notice[] = [];
let generation = 0;
let screenReader = false;
let watchdog: ReturnType<typeof setTimeout> | null = null;
let accessibilitySubscription: { remove(): void } | null = null;
function vibrationPattern(direction: DirectionHaptic | undefined, priority: number) {
  if (direction === 'left') return [0, 80, 70, 220];
  if (direction === 'right') return [0, 220, 70, 80];
  if (direction === 'straight') return [0, 90];
  if (direction === 'uturn') return [0, 120, 70, 120, 70, 240];
  return priority <= 1 ? [0, 250, 150, 250] : priority === 2 ? [0, 120, 100, 120] : [0, 120];
}
function clearCompletion() {
  if (watchdog) clearTimeout(watchdog);
  watchdog = null;
  accessibilitySubscription?.remove(); accessibilitySubscription = null;
}
function drop(notice: Notice) { if (!notice.delivered) notice.onDropped?.(); }
function valid(notice: Notice) { return Date.now() - notice.at <= 30000 && (!notice.valid || notice.valid()); }
export function isFeedbackActive() { return active !== null; }
export function setFeedbackScreenReader(value: boolean) { screenReader = value; }
export function stopFeedback() {
  generation++; clearCompletion();
  if (active) drop(active);
  queue.forEach(drop); queue = []; active = null;
  Vibration.cancel(); void Speech.stop(); audioControl?.resume();
}
export function announce(text: string, priority = 3, language = "en-US", done?: () => void, record = true, isValid?: () => boolean, delivery: Delivery = {}) {
  const notice: Notice = { text, priority, language, at: Date.now(), done, valid: isValid, record, delivered: false, ...delivery };
  if (!valid(notice)) { drop(notice); return; }
  if (active && priority >= active.priority) {
    queue.push(notice);
    if (queue.length > 4) drop(queue.shift()!);
    return;
  }
  if (active) drop(active);
  clearCompletion();
  audioControl?.suspend();
  Recognition.abort();
  const token = ++generation; active = notice;
  const delivered = () => {
    if (token !== generation || notice.delivered) return;
    notice.delivered = true; notice.onDelivered?.();
  };
  let finished = false;
  const finish = () => {
    if (token !== generation || finished) return;
    finished = true;
    clearCompletion(); active = null; drop(notice);
    // Screen-reader completion must never automatically turn on recognition.
    if (notice.delivered && !screenReader) notice.done?.();
    if (token !== generation || active) return;
    queue.sort((a, b) => a.priority - b.priority || a.at - b.at);
    while (queue.length) {
      const next = queue.shift()!;
      if (!valid(next)) { drop(next); continue; }
      // Keep the remaining queue; only the selected item leaves it.
      play(next); break;
    }
    if (!active) audioControl?.resume();
  };
  function play(next: Notice) {
    // Preserve original age and delivery metadata when dispatching queued items.
    announce(next.text, next.priority, next.language, next.done, next.record,
      () => valid(next), { onDelivered: next.onDelivered, onDropped: next.onDropped, haptic: next.haptic });
  }
  const ready = audioControl?.prepare ? audioControl.prepare().then(() => Speech.stop()) : Speech.stop();
  void ready.then(() => {
    if (token !== generation) return;
    if (!valid(notice)) { finish(); return; }
    Vibration.vibrate(vibrationPattern(notice.haptic, priority));
    if (record) recordEvent("feedback", `priority:${priority}`);
    if (screenReader) {
      // iOS provides a completion event; Android needs a conservative fallback.
      // The fallback drains retained notices instead of clearing the queue.
      if (Platform.OS === 'ios') {
        accessibilitySubscription = AccessibilityInfo.addEventListener('announcementFinished', event => {
          if (event.announcement === text) finish();
        });
      }
      watchdog = setTimeout(finish, Math.min(30000, Math.max(4500, text.length * 100 + 1000)));
      if (Platform.OS === 'ios' && AccessibilityInfo.announceForAccessibilityWithOptions) {
        AccessibilityInfo.announceForAccessibilityWithOptions(text, { queue: priority > 1 });
      } else AccessibilityInfo.announceForAccessibility(text);
      delivered();
    } else {
      Speech.speak(text, { language, onStart: delivered, onDone: finish, onStopped: finish, onError: finish });
    }
  }).catch(finish);
}
