import { AccessibilityInfo, Vibration } from "react-native";
import * as Speech from "expo-speech";
import { ExpoSpeechRecognitionModule as Recognition } from "expo-speech-recognition";
import { recordEvent } from "./audit";

type Notice = { text: string; priority: number; at: number; language: string; done?: () => void; valid?: () => boolean };
let active: Notice | null = null;
let queue: Notice[] = [];
let generation = 0;
let screenReader = false;
export function isFeedbackActive() { return active !== null; }
export function setFeedbackScreenReader(value: boolean) { screenReader = value; }
export function stopFeedback() {
  generation++;
  queue = [];
  active = null;
  Vibration.cancel();
  void Speech.stop();
}
export function announce(text: string, priority = 3, language = "en-US", done?: () => void, record = true, valid?: () => boolean) {
  if (valid && !valid()) return;
  const notice = { text, priority, language, at: Date.now(), done, valid };
  if (active && priority >= active.priority) { queue = [...queue, notice].slice(-4); return; }
  Recognition.abort();
  const token = ++generation;
  active = notice;
  Vibration.vibrate(priority <= 1 ? [0, 250, 150, 250] : priority === 2 ? [0, 120, 100, 120] : [0, 120]);
  if (record) recordEvent("feedback", `priority:${priority}`); // Do not persist Google route content.
  const finish = () => {
    if (token !== generation) return;
    active = null;
    notice.done?.();
    const next = queue.sort((a, b) => a.priority - b.priority).find(item => Date.now() - item.at < 5000 && (!item.valid || item.valid()));
    queue = [];
    if (next) announce(next.text, next.priority, next.language, next.done, true, next.valid);
  };
  void Speech.stop().then(() => {
    if (token !== generation) return;
    if (notice.valid && !notice.valid()) { finish(); return; }
    if (screenReader) {
      AccessibilityInfo.announceForAccessibility(text);
      // No auto microphone start: screen-reader utterance timing is controlled by the OS.
      setTimeout(() => { if (token === generation) { active = null; queue = []; } }, 4000);
    } else {
      Speech.speak(text, { language, onDone: finish, onStopped: finish, onError: finish });
    }
  }).catch(finish);
}
