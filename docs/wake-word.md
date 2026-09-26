# In-app SENSEA Wake Word

## Agreed scope

Users open the app first, grant microphone permission, and enable voice control. While the app is active in the foreground, they can say **SENSEA** to request a command. Both iPhone and Android are targets. The initial release does not promise detection while backgrounded, locked, or terminated.

The launch greeting remains a separate onboarding flow: after initialization and permissions, ask “Where would you like to go?” and collect/confirm the destination. Start wake-word waiting after that exchange, or when the user explicitly enables it. Do not make users repeat the wake word during an already active destination confirmation exchange.

## Implemented coordination

`frontend/src/voice/wakeWordSession.ts` coordinates injected adapters; it does not recognize audio by itself.

```text
off → starting → waiting for SENSEA
                    ↓ detection or microphone button
             stop wake-word microphone capture
                    ↓
             say “How can I help?”
                    ↓
             record one English command
                    ↓
             transcribe → VoiceController → onCommand
                    ↓
             resume wake-word waiting
```

- `enable()`: use after permission and explicit opt-in.
- `requestCommand()`: same flow for an accessible microphone button.
- `announce(text)`: stop detection for route/camera speech and then rearm. Returns false if busy; queue or reconsider the announcement instead of speaking concurrently.
- `disable()`: cancel the current operation and release audio resources. Call on background/inactive transitions, unmount, or the voice-control off button. Resume only after the app becomes active and the user enables voice control again.
- `state`: exposes off/starting/waiting/prompting/listening/processing/error for an accessible status display. The frontend still needs to wire state updates into its UI.

Duplicate detections are ignored while busy. Cancelled transcripts are not dispatched. The “How can I help?” prompt does not overwrite the last navigation instruction used by “Repeat.” Silence returns to waiting; capture errors disable the session and expose a text fallback.

## Native adapter work still required

1. Choose and integrate an iOS/Android wake-word engine, with a custom **SENSEA** model. Porcupine is a candidate, not an installed dependency. Confirm licensing, access-key handling, model availability, and device compatibility before adoption.
2. Implement `startDetection(callback, signal)` and `stopDetection()`. Startup must respect cancellation; stop must be idempotent and wait until the microphone is released. Forward asynchronous engine failures by disabling the session and showing an accessible error.
3. Implement `captureCommand(signal, maxDurationMs)`. End recording on silence or within the supplied 15-second limit, send only command audio to the existing transcription API, and delete temporary recordings in `finally`. Cancellation must stop capture/network work and settle the promise promptly; the coordinator cannot release native resources by itself.
4. Implement the existing `VoiceController` speech/stop adapters, including completion and cancellation. Route `onCommand` responses through that controller while detection is stopped. Do not await `WakeWordSession` operations from inside `onCommand`; these operations are serialized behind the command itself. A navigation “Stop” command resets navigation; the separate voice-control off action disables listening.
5. Connect app lifecycle events to `disable()`. Do not run the noise meter concurrently with wake-word/command microphone capture.
6. Add opt-in, a listening indicator, an accessible off button, and text/manual alternatives. Explain that wake-word detection is local but command transcription uses the backend/provider.
7. Test recognition and false triggers with multiple speakers and campus noise on both platforms, plus phone calls, audio interruptions, app switching, screen locking, and permission denial.

The current unit tests use injected fake adapters. Neither actual wake-word recognition nor background execution has been validated on a phone.

Native SDK reference: [Porcupine React Native quick start](https://picovoice.ai/docs/quick-start/porcupine-react-native/).
